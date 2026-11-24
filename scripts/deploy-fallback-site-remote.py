#!/usr/bin/env python3
"""Build (optional) XHBlogs static out/ and deploy to each VPS /var/www/reality-fallback.

Cross-platform companion to deploy-fallback-site-remote.sh (works on Windows and Linux).
Reads SSH aliases from scripts/hosts.conf (or HOSTS_FILE env override).
Uses incremental rsync when available (Linux), or tar-over-ssh when rsync is absent (Windows).
"""
from __future__ import annotations

import argparse
import hashlib
import io
import os
import re
import shlex
import shutil
import subprocess
import sys
import tarfile
import time
import urllib.request
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
DEFAULT_HOSTS_FILE = SCRIPT_DIR / "hosts.conf"
DEFAULT_SITE_ROOT = (SCRIPT_DIR.parent / "XHBlogs").resolve()

REMOTE_LIVE = "/var/www/reality-fallback"
REMOTE_NEXT = "/var/www/reality-fallback.next"
REMOTE_OLD = "/var/www/reality-fallback.prev"

SSH_BASE_OPTS = [
    "-o", "StrictHostKeyChecking=accept-new",
    "-o", "ConnectTimeout=30",
    "-o", "ServerAliveInterval=15",
    "-o", "ServerAliveCountMax=4",
]

DISCONNECT_RE = re.compile(
    r"connection (closed|reset|refused|timed out)|broken pipe|closed by remote",
    re.IGNORECASE,
)


def log(msg: str) -> None:
    print(msg, flush=True)


def info(msg: str) -> None:
    log(f"[INFO] {msg}")


def warn(msg: str) -> None:
    log(f"[WARN] {msg}")


def ok(msg: str) -> None:
    log(f"[OK] {msg}")


def fail(msg: str) -> None:
    print(f"[FAIL] {msg}", file=sys.stderr, flush=True)


def is_disconnect(rc: int, out: str) -> bool:
    return rc == 255 or bool(DISCONNECT_RE.search(out))


def load_hosts(hosts_file: Path, filter_host: str) -> list[str]:
    if not hosts_file.is_file():
        raise FileNotFoundError(f"missing {hosts_file}")
    names: list[str] = []
    for raw in hosts_file.read_text(encoding="utf-8").splitlines():
        line = raw.split("#", 1)[0].strip()
        if not line:
            continue
        parts = line.split()
        if len(parts) != 1:
            raise ValueError(f"bad hosts.conf line: {line}")
        name = parts[0]
        if filter_host and name != filter_host:
            continue
        names.append(name)
    if not names:
        raise ValueError(f"no hosts in {hosts_file}")
    return names


def ssh_raw(alias: str, remote_cmd: str, stdin_bytes: bytes | None = None) -> tuple[int, str]:
    cmd = ["ssh", *SSH_BASE_OPTS, alias, "--", f"bash -lc {shlex.quote(remote_cmd)}"]
    proc = subprocess.run(
        cmd,
        input=stdin_bytes,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        check=False,
    )
    out = (proc.stdout or b"").decode("utf-8", errors="replace")
    return proc.returncode, out


def step_ssh(
    alias: str,
    step: str,
    remote_cmd: str,
    step_retries: int,
    reconnect_tries: int,
    reconnect_wait: int,
) -> int:
    attempt = 1
    disc_try = 0
    info(f"{alias}: step={step} start")
    while True:
        rc, out = ssh_raw(alias, remote_cmd)
        log(f"----- {alias} step={step} output (exit {rc}) -----")
        if out.strip():
            log(out.rstrip())
        log(f"----- end {alias} step={step} -----")

        if rc == 0:
            info(f"{alias}: step={step} ok")
            return 0
        if is_disconnect(rc, out):
            disc_try += 1
            warn(f"{alias}: ssh disconnected at step={step} (exit {rc})")
            if disc_try > reconnect_tries:
                fail(f"{alias}: reconnect exhausted at step={step}")
                return 2
            info(f"{alias}: waiting {reconnect_wait}s (try {disc_try}/{reconnect_tries})")
            time.sleep(reconnect_wait)
            continue
        if attempt < step_retries:
            warn(f"{alias}: step={step} failed (exit {rc}); retry {attempt}/{step_retries}")
            attempt += 1
            time.sleep(2)
            continue
        fail(f"{alias}: step={step} failed (exit {rc})")
        return 1


def ensure_build(site_root: Path, out_dir: Path, skip_build: bool) -> None:
    if skip_build:
        if not (out_dir / "index.html").is_file():
            raise FileNotFoundError("out/index.html missing and --skip-build set")
        info(f"skip build; using {out_dir}")
        return

    npm = shutil.which("npm.cmd" if os.name == "nt" else "npm")
    if not npm:
        raise FileNotFoundError("missing dependency: npm")

    info(f"building static site in {site_root} ...")
    shell = os.name == "nt"
    if not (site_root / "node_modules").is_dir():
        subprocess.run([npm, "ci"], cwd=site_root, shell=shell, check=True)
    node = shutil.which("node")
    build_script = site_root / "scripts" / "build-static.mjs"
    if node and build_script.is_file():
        subprocess.run([node, str(build_script)], cwd=site_root, check=True)
    else:
        subprocess.run([npm, "run", "build:static"], cwd=site_root, shell=shell, check=True)

    if not (out_dir / "index.html").is_file():
        raise FileNotFoundError(f"build did not produce {out_dir / 'index.html'}")
    ok(f"build ready: {out_dir}")


def _local_file_hashes(out_dir: Path) -> dict[str, tuple[Path, str]]:
    files: dict[str, tuple[Path, str]] = {}
    for entry in sorted(out_dir.rglob("*")):
        if not entry.is_file():
            continue
        rel = entry.relative_to(out_dir).as_posix()
        h = hashlib.sha256()
        with entry.open("rb") as f:
            for chunk in iter(lambda: f.read(65536), b""):
                h.update(chunk)
        files[rel] = (entry, h.hexdigest())
    return files


def _build_tar_gz_subset(out_dir: Path, rel_paths: list[str]) -> bytes:
    buf = io.BytesIO()
    with tarfile.open(fileobj=buf, mode="w:gz") as tar:
        for rel in rel_paths:
            tar.add(out_dir / rel, arcname=rel, recursive=False)
    return buf.getvalue()


def _upload_via_rsync(
    alias: str,
    out_dir: Path,
    step_retries: int,
    reconnect_tries: int,
    reconnect_wait: int,
) -> bool:
    rc, out = ssh_raw(alias, "command -v rsync >/dev/null")
    if rc != 0:
        fail(f"{alias}: remote missing rsync (apt install rsync)")
        if out.strip():
            log(out.rstrip())
        return False

    seed_cmd = (
        "set -euo pipefail\n"
        f"if [[ -d '{REMOTE_LIVE}' ]]; then\n"
        f"  mkdir -p '{REMOTE_NEXT}'\n"
        f"  rsync -a --delete '{REMOTE_LIVE}'/ '{REMOTE_NEXT}'/\n"
        "else\n"
        f"  rm -rf '{REMOTE_NEXT}'\n"
        f"  mkdir -p '{REMOTE_NEXT}'\n"
        "fi\n"
        "echo seed_ok\n"
    )
    ssh_e = "ssh " + " ".join(shlex.quote(opt) for opt in SSH_BASE_OPTS)

    attempt = 1
    disc_try = 0
    while True:
        rc, seed_out = ssh_raw(alias, seed_cmd)
        log(f"----- {alias} step=seed output (exit {rc}) -----")
        if seed_out.strip():
            log(seed_out.rstrip())
        log(f"----- end {alias} step=seed -----")

        if rc != 0:
            if is_disconnect(rc, seed_out):
                disc_try += 1
                warn(f"{alias}: seed/ssh issue (exit {rc})")
                if disc_try > reconnect_tries:
                    return False
                time.sleep(reconnect_wait)
                continue
            if attempt < step_retries:
                attempt += 1
                time.sleep(2)
                continue
            return False

        proc = subprocess.run(
            ["rsync", "-az", "--delete", "--info=stats2", "-e", ssh_e, f"{out_dir}/", f"{alias}:{REMOTE_NEXT}/"],
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            encoding="utf-8",
            errors="replace",
            check=False,
        )
        log(f"----- {alias} step=rsync output (exit {proc.returncode}) -----")
        if proc.stdout.strip():
            log(proc.stdout.rstrip())
        log(f"----- end {alias} step=rsync -----")

        if proc.returncode == 0:
            info(f"{alias}: step=upload ok")
            return True
        if is_disconnect(proc.returncode, proc.stdout):
            disc_try += 1
            warn(f"{alias}: rsync/ssh issue (exit {proc.returncode})")
            if disc_try > reconnect_tries:
                return False
            time.sleep(reconnect_wait)
            continue
        if attempt < step_retries:
            attempt += 1
            time.sleep(2)
            continue
        return False


def _parse_remote_sha256(output: str) -> dict[str, str]:
    hashes: dict[str, str] = {}
    for line in output.splitlines():
        if len(line) < 67 or line[64] != " ":
            continue
        digest = line[:64]
        if not all(c in "0123456789abcdefABCDEF" for c in digest):
            continue
        rel = line[66:]
        if rel.startswith("./"):
            rel = rel[2:]
        if rel:
            hashes[rel] = digest.lower()
    return hashes


def _upload_via_tar_ssh(
    alias: str,
    out_dir: Path,
    local_files: dict[str, tuple[Path, str]],
    step_retries: int,
    reconnect_tries: int,
    reconnect_wait: int,
) -> bool:
    seed_cmd = (
        "set -euo pipefail\n"
        f"if [[ -d '{REMOTE_LIVE}' ]]; then\n"
        f"  mkdir -p '{REMOTE_NEXT}'\n"
        "  if command -v rsync >/dev/null 2>&1; then\n"
        f"    rsync -a --delete '{REMOTE_LIVE}'/ '{REMOTE_NEXT}'/\n"
        "  else\n"
        f"    rm -rf '{REMOTE_NEXT}'\n"
        f"    cp -a '{REMOTE_LIVE}' '{REMOTE_NEXT}'\n"
        "  fi\n"
        "else\n"
        f"  rm -rf '{REMOTE_NEXT}'\n"
        f"  mkdir -p '{REMOTE_NEXT}'\n"
        "fi\n"
        f"cd '{REMOTE_NEXT}'\n"
        "find . -type f -exec sha256sum {} +\n"
    )
    attempt = 1
    disc_try = 0
    remote_hashes: dict[str, str] | None = None
    while True:
        rc, out = ssh_raw(alias, seed_cmd)
        if rc == 0:
            remote_hashes = _parse_remote_sha256(out)
            break
        log(f"----- {alias} step=seed output (exit {rc}) -----")
        if out.strip():
            log(out.rstrip())
        log(f"----- end {alias} step=seed -----")
        if is_disconnect(rc, out):
            disc_try += 1
            warn(f"{alias}: seed/ssh issue (exit {rc})")
            if disc_try > reconnect_tries:
                return False
            time.sleep(reconnect_wait)
            continue
        if attempt < step_retries:
            attempt += 1
            time.sleep(2)
            continue
        return False

    assert remote_hashes is not None
    to_upload = sorted(rel for rel, (_, h) in local_files.items() if remote_hashes.get(rel) != h)
    to_delete = sorted(rel for rel in remote_hashes if rel not in local_files)
    unchanged = len(local_files) - len(to_upload)
    info(f"{alias}: incremental diff: upload={len(to_upload)}, delete={len(to_delete)}, unchanged={unchanged}")

    if not to_upload and not to_delete:
        info(f"{alias}: step=upload ok (no changes)")
        return True

    if to_delete:
        del_cmd = f"cd '{REMOTE_NEXT}' && xargs -0 -r rm -f"
        del_bytes = b"\0".join(p.encode("utf-8") for p in to_delete)
        rc, out = ssh_raw(alias, del_cmd, stdin_bytes=del_bytes)
        if rc != 0:
            log(f"----- {alias} step=delete output (exit {rc}) -----")
            if out.strip():
                log(out.rstrip())
            log(f"----- end {alias} step=delete -----")
            return False

    if not to_upload:
        info(f"{alias}: step=upload ok")
        return True

    tar_bytes = _build_tar_gz_subset(out_dir, to_upload)
    info(f"{alias}: uploading {len(to_upload)} files ({len(tar_bytes) / 1024:.1f} KiB) ...")
    remote_cmd = (
        "set -euo pipefail\n"
        f"mkdir -p '{REMOTE_NEXT}'\n"
        f"tar -xzf - -C '{REMOTE_NEXT}'\n"
        "echo tar_upload_ok\n"
    )
    attempt = 1
    disc_try = 0
    while True:
        rc, out = ssh_raw(alias, remote_cmd, stdin_bytes=tar_bytes)
        log(f"----- {alias} step=tar-upload output (exit {rc}) -----")
        if out.strip():
            log(out.rstrip())
        log(f"----- end {alias} step=tar-upload -----")

        if rc == 0:
            info(f"{alias}: step=upload ok")
            return True
        if is_disconnect(rc, out):
            disc_try += 1
            warn(f"{alias}: ssh disconnected during upload (exit {rc})")
            if disc_try > reconnect_tries:
                return False
            time.sleep(reconnect_wait)
            continue
        if attempt < step_retries:
            attempt += 1
            time.sleep(2)
            continue
        return False


def process_host(
    alias: str,
    out_dir: Path,
    local_files: dict[str, tuple[Path, str]] | None,
    has_rsync: bool,
    step_retries: int,
    reconnect_tries: int,
    reconnect_wait: int,
) -> str | None:
    info(f"=== host {alias} — deploy fallback site ===")
    info(f"{alias}: step=upload ({'rsync incremental' if has_rsync else 'tar-over-ssh incremental'}) start")

    if has_rsync:
        uploaded = _upload_via_rsync(alias, out_dir, step_retries, reconnect_tries, reconnect_wait)
    else:
        assert local_files is not None
        uploaded = _upload_via_tar_ssh(alias, out_dir, local_files, step_retries, reconnect_tries, reconnect_wait)

    if not uploaded:
        return f"{alias}: upload"

    activate_cmd = (
        "set -euo pipefail\n"
        f"test -f '{REMOTE_NEXT}/index.html'\n"
        "if id www-data >/dev/null 2>&1; then\n"
        f"  chown -R www-data:www-data '{REMOTE_NEXT}'\n"
        "elif id nginx >/dev/null 2>&1; then\n"
        f"  chown -R nginx:nginx '{REMOTE_NEXT}'\n"
        "fi\n"
        f"rm -rf '{REMOTE_OLD}'\n"
        f"if [[ -d '{REMOTE_LIVE}' ]]; then\n"
        f"  mv '{REMOTE_LIVE}' '{REMOTE_OLD}'\n"
        "fi\n"
        f"mv '{REMOTE_NEXT}' '{REMOTE_LIVE}'\n"
        f"test -f '{REMOTE_LIVE}/index.html'\n"
        f"rm -rf '{REMOTE_OLD}'\n"
        f"ls -la '{REMOTE_LIVE}' | head -n 20\n"
        "echo activate_ok\n"
    )
    if step_ssh(alias, "activate", activate_cmd, step_retries, reconnect_tries, reconnect_wait) != 0:
        return f"{alias}: activate"

    verify_cmd = (
        "set -euo pipefail\n"
        "code=$(curl -sk -o /dev/null -w '%{http_code}' --resolve thirra.com:8443:127.0.0.1 https://thirra.com:8443/)\n"
        "echo http=$code\n"
        "[[ \"$code\" == \"200\" ]]\n"
        "! curl -sk --resolve thirra.com:8443:127.0.0.1 https://thirra.com:8443/ | grep -q '<h1>It works.</h1>'\n"
        "echo verify_ok\n"
    )
    if step_ssh(alias, "verify-local", verify_cmd, step_retries, reconnect_tries, reconnect_wait) != 0:
        return f"{alias}: verify-local"

    ok(f"{alias}: finished successfully")
    return None


def public_check() -> None:
    info("=== public check ===")
    try:
        req = urllib.request.Request("https://thirra.com/", method="HEAD")
        with urllib.request.urlopen(req, timeout=20) as resp:
            log(f"HTTP {resp.status} {resp.reason}")
            for k, v in list(resp.headers.items())[:10]:
                log(f"{k}: {v}")
    except Exception as exc:
        warn(f"public check failed: {exc}")


def main() -> int:
    parser = argparse.ArgumentParser(description="Build and deploy XHBlogs static site.")
    parser.add_argument("--yes", "-y", action="store_true", help="Non-interactive")
    parser.add_argument("--skip-build", action="store_true", help="Use existing out/")
    parser.add_argument("--host", default="", help="Only this SSH alias")
    parser.add_argument("--site-root", default=str(DEFAULT_SITE_ROOT), help="XHBlogs directory")
    args = parser.parse_args()

    if not shutil.which("ssh"):
        fail("missing dependency: ssh")
        return 1

    hosts_file = Path(os.environ.get("HOSTS_FILE") or DEFAULT_HOSTS_FILE)
    try:
        names = load_hosts(hosts_file, args.host)
    except (OSError, ValueError) as exc:
        fail(str(exc))
        return 1

    site_root = Path(args.site_root).resolve()
    if not site_root.is_dir():
        fail(f"SITE_ROOT not found: {site_root} (set --site-root)")
        return 1
    out_dir = site_root / "out"

    info(f"site: {site_root}")
    info(f"out:  {out_dir}")
    info(f"hosts: {' '.join(names)}")

    if not args.yes:
        ans = input(f"[INFO] Deploy fallback site to [{' '.join(names)}]? [y/N] ").strip().lower()
        if ans not in {"y", "yes"}:
            info("Aborted.")
            return 0

    try:
        ensure_build(site_root, out_dir, args.skip_build)
    except Exception as exc:
        fail(f"build failed: {exc}")
        return 1

    has_rsync = shutil.which("rsync") is not None and os.name != "nt"
    local_files = None if has_rsync else _local_file_hashes(out_dir)
    if not has_rsync and local_files is not None:
        info(f"indexed {len(local_files)} local files in out/ for incremental diff")

    step_retries = int(os.environ.get("STEP_RETRIES", "2"))
    reconnect_tries = int(os.environ.get("RECONNECT_TRIES", "5"))
    reconnect_wait = int(os.environ.get("RECONNECT_WAIT", "5"))

    ok_hosts: list[str] = []
    fail_hosts: list[str] = []
    fail_reasons: list[str] = []

    for idx, alias in enumerate(names):
        reason = process_host(
            alias,
            out_dir,
            local_files,
            has_rsync,
            step_retries,
            reconnect_tries,
            reconnect_wait,
        )
        if reason is None:
            ok_hosts.append(alias)
        else:
            fail_hosts.append(alias)
            fail_reasons.append(reason)
        if idx + 1 < len(names):
            time.sleep(2)

    public_check()

    log("======== HOST SUMMARY ========")
    log(f"  OK={len(ok_hosts)}  FAIL={len(fail_hosts)}")
    if ok_hosts:
        log("--- OK ---")
        for h in ok_hosts:
            log(f"  - {h}")
    if fail_hosts:
        log("--- FAIL ---")
        for h in fail_hosts:
            log(f"  - {h}")
        for r in fail_reasons:
            log(f"  - {r}")
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
