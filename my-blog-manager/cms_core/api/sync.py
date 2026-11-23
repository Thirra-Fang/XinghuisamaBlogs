import json
import os
import shutil
import signal
import subprocess
import threading
from fastapi import APIRouter, Request
from fastapi.responses import StreamingResponse

router = APIRouter()

CURRENT_API_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_ROOT = os.path.abspath(os.path.join(CURRENT_API_DIR, "..", ".."))
REPO_ROOT = os.path.abspath(os.path.join(PROJECT_ROOT, ".."))
DEFAULT_DEPLOY_SCRIPT = os.path.abspath(
    os.path.join(REPO_ROOT, "..", "AboutVPS", "scripts", "deploy-fallback-site-remote.sh")
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


def resolve_deploy_script() -> str:
    env_path = os.environ.get("ABOUTVPS_DEPLOY_SCRIPT", "").strip()
    if env_path and os.path.isfile(env_path):
        return env_path
    if os.path.isfile(DEFAULT_DEPLOY_SCRIPT):
        return DEFAULT_DEPLOY_SCRIPT
    raise FileNotFoundError(f"找不到部署脚本: {DEFAULT_DEPLOY_SCRIPT}")


@router.post("/check")
async def check_blog_path(request: Request):
    """检测目标路径是否合法且具备基本结构"""
    try:
        payload = await request.json()
        target_path = payload.get("blogPath", "").strip()

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
        target_path = payload.get("blogPath", "").strip()
        mirror_to_blog(target_path)
        return {"success": True, "message": "🎉 完美撒花！所有文章与配置已镜像覆盖至目标博客。"}
    except Exception as e:
        return {"success": False, "message": f"同步过程中发生致命错误: {str(e)}"}


@router.post("/publish-remote")
async def publish_remote(request: Request):
    """镜像到 XHBlogs，再流式执行 AboutVPS 远程静态部署。"""
    payload = await request.json()
    target_path = (payload.get("blogPath") or "").strip()

    if not target_path:
        return {"success": False, "message": "blogPath 为空"}

    def event_stream():
        global _publish_proc

        if not _publish_lock.acquire(blocking=False):
            yield _ndjson({"type": "error", "message": "已有发布任务在进行中"})
            return

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
                script = resolve_deploy_script()
            except FileNotFoundError as e:
                yield _ndjson({"type": "error", "message": str(e)})
                return

            script_dir = os.path.dirname(script)
            cmd = ["bash", script, "--yes", "--site-root", target_path]
            yield _ndjson({"type": "log", "line": f"$ {' '.join(cmd)}"})

            env = os.environ.copy()
            env["FORCE_COLOR"] = "0"
            env["NO_COLOR"] = "1"

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
                    start_new_session=True,
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

            if code == 0:
                yield _ndjson({"type": "done", "message": "同步并远程部署完成"})
            elif code < 0:
                yield _ndjson({"type": "error", "message": "部署已取消"})
            else:
                yield _ndjson({"type": "error", "message": f"部署失败，退出码 {code}"})
        finally:
            _publish_proc = None
            _publish_lock.release()

    return StreamingResponse(event_stream(), media_type="application/x-ndjson")


@router.post("/publish-cancel")
async def publish_cancel():
    global _publish_proc
    proc = _publish_proc
    if proc is None or proc.poll() is not None:
        return {"success": False, "message": "当前没有进行中的发布任务"}
    try:
        os.killpg(os.getpgid(proc.pid), signal.SIGTERM)
        return {"success": True, "message": "已发送取消信号"}
    except Exception as e:
        try:
            proc.terminate()
            return {"success": True, "message": "已发送终止信号"}
        except Exception:
            return {"success": False, "message": f"取消失败: {e}"}
