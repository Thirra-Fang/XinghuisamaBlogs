"""Prepare the source console and keep a readable log of startup failures."""
import importlib.util
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import traceback
import venv

ROOT = Path(__file__).resolve().parent
VENV_DIR = ROOT / ".venv"
PACKAGES = {
    "webview": "pywebview", "fastapi": "fastapi", "uvicorn": "uvicorn",
    "multipart": "python-multipart", "requests": "requests", "yaml": "PyYAML",
    "markdown": "markdown", "markdownify": "markdownify", "httpx": "httpx",
    "boto3": "boto3",
}


def _venv_python() -> Path:
    if os.name == "nt":
        return VENV_DIR / "Scripts" / "python.exe"
    return VENV_DIR / "bin" / "python"


def _has_pip(executable: str) -> bool:
    try:
        r = subprocess.run(
            [executable, "-m", "pip", "--version"],
            capture_output=True,
            text=True,
            check=False,
        )
        return r.returncode == 0
    except OSError:
        return False


def _is_system_python(executable: str) -> bool:
    path = Path(executable).resolve()
    # Common system locations (Arch/CachyOS, Debian, etc.)
    system_roots = ("/usr/bin", "/bin", "/usr/local/bin")
    return any(str(path).startswith(root + "/") or str(path) == root + "/python" or str(path).startswith(root + "/python")
               for root in system_roots) and ".venv" not in path.parts


def _in_project_venv() -> bool:
    # Do not compare resolved executable paths: .venv/bin/python often symlinks to /usr/bin/python.
    try:
        return Path(sys.prefix).resolve() == VENV_DIR.resolve()
    except OSError:
        return False


def ensure_project_venv(report) -> str:
    """Prefer project .venv so Arch EXTERNALLY-MANAGED / missing system pip work."""
    py = _venv_python()

    # Already running inside this project's venv
    if _in_project_venv():
        if not _has_pip(sys.executable):
            raise RuntimeError(f"Project venv exists but pip is missing: {sys.executable}")
        return sys.executable

    # Always prefer project venv when on system Python, missing pip, or venv already exists
    need_venv = (
        _is_system_python(sys.executable)
        or not _has_pip(sys.executable)
        or (py.is_file() and _has_pip(str(py)))
    )
    if not need_venv:
        return sys.executable

    if not py.is_file():
        report(f"Creating project virtualenv at {VENV_DIR} ...")
        # system_site_packages: Arch provides gi/webkit via pacman (python-gobject)
        venv.create(VENV_DIR, with_pip=True, clear=False, system_site_packages=True)
        py = _venv_python()
        if not py.is_file():
            raise RuntimeError(
                "Failed to create .venv. On Arch/CachyOS try: sudo pacman -S python-pip"
            )

    if not _has_pip(str(py)):
        raise RuntimeError(
            f"No pip in {py}. Recreate with: /usr/bin/python -m venv --clear .venv"
        )

    report(f"Using project venv: {py}")
    return str(py)


def main(log):
    def report(message):
        print(message, flush=True)
        print(message, file=log, flush=True)

    def run(args):
        env = os.environ.copy()
        env.update(PYTHONIOENCODING="utf-8", PYTHONUNBUFFERED="1")
        shell = os.name == "nt" and Path(args[0]).suffix.lower() in {".cmd", ".bat"}
        with subprocess.Popen(
            args, cwd=ROOT, env=env, shell=shell, stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT, encoding="utf-8", errors="replace",
        ) as child:
            for line in child.stdout:
                report(line.rstrip("\r\n"))
            code = child.wait()
            if code:
                raise RuntimeError(f"{Path(args[0]).name} exited with code {code}")

    report(f"Python {sys.version.split()[0]}: {sys.executable}")
    if sys.version_info < (3, 10):
        raise RuntimeError("Python 3.10 or newer is required.")
    node = shutil.which("node")
    if not node:
        raise RuntimeError("Node.js 20.9 or newer is required. Add it to PATH.")
    version = subprocess.check_output([node, "--version"], text=True).strip()
    match = re.fullmatch(r"v(\d+)\.(\d+)\.(\d+).*", version)
    if not match or tuple(map(int, match.groups())) < (20, 9, 0):
        raise RuntimeError(f"Node.js 20.9 or newer is required; found {version}.")
    report(f"Node.js {version}: {node}")

    python_exe = ensure_project_venv(report)

    # Re-exec into venv so importlib checks and launcher use the same interpreter.
    # Compare via sys.prefix, not resolved executable (venv python often symlinks to /usr/bin/python).
    if not _in_project_venv():
        report("Re-launching under venv Python...")
        env = os.environ.copy()
        env.update(PYTHONIOENCODING="utf-8", PYTHONUNBUFFERED="1")
        raise SystemExit(subprocess.call([python_exe, "-u", str(ROOT / "run_me.py")], cwd=ROOT, env=env))

    if not (ROOT / "node_modules/next/dist/bin/next").is_file():
        npm = shutil.which("npm.cmd" if os.name == "nt" else "npm")
        if not npm:
            raise RuntimeError("npm is missing. Reinstall Node.js with npm.")
        report("Installing console frontend dependencies...")
        run([npm, "install"])
        if not (ROOT / "node_modules/next/dist/bin/next").is_file():
            raise RuntimeError("Next.js is still missing after npm install.")

    missing = [pkg for module, pkg in PACKAGES.items() if importlib.util.find_spec(module) is None]
    if missing:
        report("Installing Python dependencies: " + ", ".join(missing))
        run([sys.executable, "-m", "pip", "install", *missing])

    report("Starting the console...")
    # Keep this process attached to Start.bat so a child crash cannot look like success.
    run([sys.executable, "-u", str(ROOT / "launcher.py")])


if __name__ == "__main__":
    log_path = ROOT / "startup.log"
    try:
        with log_path.open("w", encoding="utf-8", buffering=1) as log:
            try:
                main(log)
            except Exception:
                traceback.print_exc(file=log)
                raise
    except Exception as error:
        print(f"Startup failed: {error}", file=sys.stderr)
        print(f"Startup log (if writable): {log_path}", file=sys.stderr)
        raise SystemExit(1)
