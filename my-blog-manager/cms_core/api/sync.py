import json
import os
import shutil
import signal
import subprocess
import sys
import threading
from fastapi import APIRouter, Request
from fastapi.responses import StreamingResponse

router = APIRouter()

CURRENT_API_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_ROOT = os.path.abspath(os.path.join(CURRENT_API_DIR, "..", ".."))
REPO_ROOT = os.path.abspath(os.path.join(PROJECT_ROOT, ".."))
DEFAULT_DEPLOY_SH = os.path.abspath(
    os.path.join(REPO_ROOT, "scripts", "deploy-fallback-site-remote.sh")
)
DEFAULT_DEPLOY_PY = os.path.abspath(
    os.path.join(REPO_ROOT, "scripts", "deploy-fallback-site-remote.py")
)

SYNC_DIRS = ["posts", "chatters"]
SYNC_FILES = [
    "app/about/about.md",
    "data/albums.ts",
    "data/friends.ts",
    "data/projects.ts",
    "siteConfig.ts"
]

_publish_lock = threading.Lock()
_publish_proc = None
_cancel_requested = False


def is_safe_blog_dir(target_path):
    """防呆检测：只有包含 package.json 的才被认为是安全的博客目录"""
    return os.path.exists(os.path.join(target_path, "package.json"))


def mirror_to_blog(target_path: str) -> None:
    if not is_safe_blog_dir(target_path):
        raise ValueError("安全拦截：目标路径不合法！")

    for d in SYNC_DIRS:
        src_dir = os.path.join(PROJECT_ROOT, d)
        dst_dir = os.path.join(target_path, d)

        if os.path.exists(src_dir):
            if os.path.exists(dst_dir):
                shutil.rmtree(dst_dir)
            shutil.copytree(src_dir, dst_dir)

    for f in SYNC_FILES:
        src_file = os.path.join(PROJECT_ROOT, f.replace("/", os.sep))
        dst_file = os.path.join(target_path, f.replace("/", os.sep))

        if os.path.exists(src_file):
            os.makedirs(os.path.dirname(dst_file), exist_ok=True)

            if f == "siteConfig.ts":
                with open(src_file, "r", encoding="utf-8") as file_in:
                    lines = file_in.readlines()

                with open(dst_file, "w", encoding="utf-8") as file_out:
                    for line in lines:
                        if "picBedName:" in line or "picBedUrl:" in line or "picBedToken:" in line or "图床核心配置" in line:
                            continue
                        file_out.write(line)
            else:
                shutil.copy2(src_file, dst_file)


def _ndjson(event: dict) -> str:
    return json.dumps(event, ensure_ascii=False) + "\n"


def resolve_blog_path(raw_path: str) -> str:
    val = (raw_path or "").strip()
    if not val:
        return ""
    return os.path.abspath(os.path.join(PROJECT_ROOT, val)) if not os.path.isabs(val) else val


def resolve_deploy_command(target_path: str, skip_build: bool = False) -> list[str]:
    extra = ["--skip-build"] if skip_build else []
    # Prefer XHBLOGS_DEPLOY_SCRIPT; ABOUTVPS_DEPLOY_SCRIPT kept as override alias.
    for key in ("XHBLOGS_DEPLOY_SCRIPT", "ABOUTVPS_DEPLOY_SCRIPT"):
        env_path = os.environ.get(key, "").strip()
        if env_path and os.path.isfile(env_path):
            if env_path.endswith(".py"):
                return [sys.executable, "-u", env_path, "--yes", *extra, "--site-root", target_path]
            return ["bash", env_path, "--yes", *extra, "--site-root", target_path]

    use_sh = (
        os.name != "nt"
        and shutil.which("bash") is not None
        and shutil.which("rsync") is not None
        and os.path.isfile(DEFAULT_DEPLOY_SH)
    )
    if use_sh:
        return ["bash", DEFAULT_DEPLOY_SH, "--yes", *extra, "--site-root", target_path]
    if os.path.isfile(DEFAULT_DEPLOY_PY):
        return [sys.executable, "-u", DEFAULT_DEPLOY_PY, "--yes", *extra, "--site-root", target_path]
    raise FileNotFoundError(f"找不到部署脚本: {DEFAULT_DEPLOY_PY}")


def resolve_build_command(target_path: str) -> list[str]:
    """Cross-platform static build command for XHBlogs (Linux + Windows)."""
    node = shutil.which("node")
    build_script = os.path.join(target_path, "scripts", "build-static.mjs")
    if node and os.path.isfile(build_script):
        return [node, build_script]
    npm = shutil.which("npm.cmd" if os.name == "nt" else "npm")
    if npm:
        return [npm, "run", "build:static"]
    raise FileNotFoundError("未找到 node 或 npm，无法执行静态打包")


def _run_streaming_cmd(cmd: list[str], cwd: str):
    """Run subprocess with streaming NDJSON log lines; returns process exit code via generator."""
    global _publish_proc
    env = os.environ.copy()
    env["FORCE_COLOR"] = "0"
    env["NO_COLOR"] = "1"
    popen_kwargs = (
        {"creationflags": subprocess.CREATE_NEW_PROCESS_GROUP}
        if os.name == "nt"
        else {"start_new_session": True}
    )
    yield _ndjson({"type": "log", "line": f"$ {' '.join(cmd)}"})
    proc = subprocess.Popen(
        cmd,
        cwd=cwd,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        encoding="utf-8",
        errors="replace",
        env=env,
        **popen_kwargs,
    )
    _publish_proc = proc
    assert proc.stdout is not None
    for line in proc.stdout:
        yield _ndjson({"type": "log", "line": line.rstrip("\n")})
    code = proc.wait()
    _publish_proc = None
    return code


@router.post("/check")
async def check_blog_path(request: Request):
    """检测目标路径是否合法且具备基本结构"""
    try:
        payload = await request.json()
        target_path = resolve_blog_path(payload.get("blogPath", ""))

        if not target_path or not os.path.exists(target_path):
            return {"success": False, "message": "🚫 目标物理路径不存在，请检查输入！"}

        if not is_safe_blog_dir(target_path):
            return {"success": False,
                    "message": "⚠️ 危险！目标路径未检测到 package.json，似乎不是一个有效的前端项目，已拦截操作。"}

        missing = []
        for d in ["posts", "data", "app"]:
            if not os.path.exists(os.path.join(target_path, d)):
                missing.append(d)

        if missing:
            return {"success": True,
                    "message": f"✅ 路径安全。但目标缺失以下文件夹：{', '.join(missing)}。同步时将自动创建。"}

        return {"success": True, "message": "✅ 路径校验通过，目录结构完美！"}
    except Exception as e:
        return {"success": False, "message": f"校验异常: {str(e)}"}


@router.post("/execute")
async def execute_sync(request: Request):
    """执行物理覆盖同步"""
    try:
        payload = await request.json()
        target_path = resolve_blog_path(payload.get("blogPath", ""))
        mirror_to_blog(target_path)
        return {"success": True, "message": "🎉 完美撒花！所有文章与配置已镜像覆盖至目标博客。"}
    except Exception as e:
        return {"success": False, "message": f"同步过程中发生致命错误: {str(e)}"}


@router.post("/publish-remote")
async def publish_remote(request: Request):
    """镜像到 XHBlogs，再流式执行 monorepo scripts/ 远程静态部署。"""
    payload = await request.json()
    target_path = resolve_blog_path(payload.get("blogPath") or "")

    if not target_path:
        return {"success": False, "message": "blogPath 为空"}

    def event_stream():
        global _publish_proc, _cancel_requested

        acquired = _publish_lock.acquire(blocking=False)
        if not acquired and _cancel_requested:
            acquired = _publish_lock.acquire(timeout=3.0)
        if not acquired:
            yield _ndjson({"type": "error", "message": "已有发布任务在进行中"})
            return

        _cancel_requested = False
        try:
            yield _ndjson({"type": "phase", "phase": "mirror", "message": "正在镜像管理端内容到展示站…"})
            try:
                mirror_to_blog(target_path)
            except Exception as e:
                yield _ndjson({"type": "error", "message": f"镜像失败: {e}"})
                return
            yield _ndjson({"type": "log", "line": "镜像完成"})
            yield _ndjson({"type": "phase", "phase": "deploy", "message": "开始构建并以 rsync 增量同步到 VPS…"})

            try:
                cmd = resolve_deploy_command(target_path)
            except FileNotFoundError as e:
                yield _ndjson({"type": "error", "message": str(e)})
                return

            script_dir = os.path.dirname(cmd[2] if cmd[0] == sys.executable else cmd[1])
            yield _ndjson({"type": "log", "line": f"$ {' '.join(cmd)}"})

            env = os.environ.copy()
            env["FORCE_COLOR"] = "0"
            env["NO_COLOR"] = "1"
            popen_kwargs = (
                {"creationflags": subprocess.CREATE_NEW_PROCESS_GROUP}
                if os.name == "nt"
                else {"start_new_session": True}
            )

            try:
                proc = subprocess.Popen(
                    cmd,
                    cwd=script_dir,
                    stdout=subprocess.PIPE,
                    stderr=subprocess.STDOUT,
                    text=True,
                    encoding="utf-8",
                    errors="replace",
                    env=env,
                    **popen_kwargs,
                )
            except Exception as e:
                yield _ndjson({"type": "error", "message": f"无法启动部署脚本: {e}"})
                return

            _publish_proc = proc
            assert proc.stdout is not None
            for line in proc.stdout:
                yield _ndjson({"type": "log", "line": line.rstrip("\n")})

            code = proc.wait()
            _publish_proc = None

            if _cancel_requested or code < 0:
                yield _ndjson({"type": "error", "message": "部署已取消"})
            elif code == 0:
                yield _ndjson({"type": "done", "message": "同步并远程部署完成"})
            else:
                yield _ndjson({"type": "error", "message": f"部署失败，退出码 {code}"})
        finally:
            _publish_proc = None
            _cancel_requested = False
            _publish_lock.release()

    return StreamingResponse(event_stream(), media_type="application/x-ndjson")


@router.post("/sync-local-build")
async def sync_local_build(request: Request):
    """仅执行本地操作：镜像管理端内容到 XHBlogs，再本地静态打包生成 out/。"""
    payload = await request.json()
    target_path = resolve_blog_path(payload.get("blogPath") or "")

    if not target_path:
        return {"success": False, "message": "blogPath 为空"}

    def event_stream():
        global _publish_proc, _cancel_requested

        acquired = _publish_lock.acquire(blocking=False)
        if not acquired and _cancel_requested:
            acquired = _publish_lock.acquire(timeout=3.0)
        if not acquired:
            yield _ndjson({"type": "error", "message": "已有同步或上传任务在进行中"})
            return

        _cancel_requested = False
        try:
            yield _ndjson({"type": "phase", "phase": "mirror", "message": "正在镜像管理端内容到展示站…"})
            try:
                mirror_to_blog(target_path)
            except Exception as e:
                yield _ndjson({"type": "error", "message": f"镜像失败: {e}"})
                return
            yield _ndjson({"type": "log", "line": "镜像完成"})

            if not os.path.isdir(os.path.join(target_path, "node_modules")):
                npm = shutil.which("npm.cmd" if os.name == "nt" else "npm")
                if not npm:
                    yield _ndjson({"type": "error", "message": "缺少 node_modules 且未找到 npm"})
                    return
                yield _ndjson({"type": "phase", "phase": "install", "message": "检测到缺少 node_modules，正在执行 npm ci…"})
                try:
                    code = yield from _run_streaming_cmd([npm, "ci"], target_path)
                except Exception as e:
                    yield _ndjson({"type": "error", "message": f"无法启动 npm ci: {e}"})
                    return
                if _cancel_requested or code < 0:
                    yield _ndjson({"type": "error", "message": "本地同步已取消"})
                    return
                if code != 0:
                    yield _ndjson({"type": "error", "message": f"npm ci 失败，退出码 {code}"})
                    return

            yield _ndjson({"type": "phase", "phase": "build", "message": "正在本地静态打包（build:static → out/）…"})
            try:
                cmd = resolve_build_command(target_path)
            except FileNotFoundError as e:
                yield _ndjson({"type": "error", "message": str(e)})
                return

            try:
                code = yield from _run_streaming_cmd(cmd, target_path)
            except Exception as e:
                yield _ndjson({"type": "error", "message": f"无法启动打包命令: {e}"})
                return

            if _cancel_requested or code < 0:
                yield _ndjson({"type": "error", "message": "本地同步已取消"})
            elif code == 0 and os.path.isfile(os.path.join(target_path, "out", "index.html")):
                yield _ndjson({"type": "done", "message": "本地同步与静态打包完成"})
            elif code == 0:
                yield _ndjson({"type": "error", "message": "打包结束但未生成 out/index.html"})
            else:
                yield _ndjson({"type": "error", "message": f"打包失败，退出码 {code}"})
        finally:
            _publish_proc = None
            _cancel_requested = False
            _publish_lock.release()

    return StreamingResponse(event_stream(), media_type="application/x-ndjson")


@router.post("/upload-remote")
async def upload_remote(request: Request):
    """跳过打包（--skip-build），仅将本地已生成的 out/ 增量上传到远端 VPS。"""
    payload = await request.json()
    target_path = resolve_blog_path(payload.get("blogPath") or "")

    if not target_path:
        return {"success": False, "message": "blogPath 为空"}

    def event_stream():
        global _publish_proc, _cancel_requested

        acquired = _publish_lock.acquire(blocking=False)
        if not acquired and _cancel_requested:
            acquired = _publish_lock.acquire(timeout=3.0)
        if not acquired:
            yield _ndjson({"type": "error", "message": "已有同步或上传任务在进行中"})
            return

        _cancel_requested = False
        try:
            out_index = os.path.join(target_path, "out", "index.html")
            if not os.path.isfile(out_index):
                yield _ndjson({
                    "type": "error",
                    "message": "未找到静态构建产物 out/index.html，请先点击「本地同步」完成打包",
                })
                return

            yield _ndjson({"type": "phase", "phase": "upload", "message": "开始将本地 out/ 增量上传到远端 VPS…"})
            try:
                cmd = resolve_deploy_command(target_path, skip_build=True)
            except FileNotFoundError as e:
                yield _ndjson({"type": "error", "message": str(e)})
                return

            script_dir = os.path.dirname(cmd[2] if cmd[0] == sys.executable else cmd[1])
            try:
                code = yield from _run_streaming_cmd(cmd, script_dir)
            except Exception as e:
                yield _ndjson({"type": "error", "message": f"无法启动上传脚本: {e}"})
                return

            if _cancel_requested or code < 0:
                yield _ndjson({"type": "error", "message": "远程上传已取消"})
            elif code == 0:
                yield _ndjson({"type": "done", "message": "远程增量上传并切换完成"})
            else:
                yield _ndjson({"type": "error", "message": f"远程上传失败，退出码 {code}"})
        finally:
            _publish_proc = None
            _cancel_requested = False
            _publish_lock.release()

    return StreamingResponse(event_stream(), media_type="application/x-ndjson")


@router.post("/publish-cancel")
async def publish_cancel():
    global _publish_proc, _cancel_requested
    proc = _publish_proc
    if proc is None or proc.poll() is not None:
        return {"success": False, "message": "当前没有进行中的发布任务"}
    _cancel_requested = True
    try:
        if os.name == "nt":
            subprocess.run(
                ["taskkill", "/F", "/T", "/PID", str(proc.pid)],
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                check=False,
            )
        else:
            os.killpg(os.getpgid(proc.pid), signal.SIGTERM)
        try:
            proc.wait(timeout=3)
        except subprocess.TimeoutExpired:
            pass
        return {"success": True, "message": "已发送取消信号"}
    except Exception as e:
        try:
            proc.terminate()
            return {"success": True, "message": "已发送终止信号"}
        except Exception:
            return {"success": False, "message": f"取消失败: {e}"}
