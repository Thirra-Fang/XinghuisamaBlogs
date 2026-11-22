import os
import subprocess
from fastapi import APIRouter, Request

router = APIRouter()

CURRENT_API_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_ROOT = os.path.abspath(os.path.join(CURRENT_API_DIR, "..", ".."))
REPO_ROOT = os.path.abspath(os.path.join(PROJECT_ROOT, ".."))


def _run_git(args, cwd=REPO_ROOT):
    return subprocess.run(
        ["git", *args],
        cwd=cwd,
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
    )


@router.post("/commit-push")
async def commit_push(request: Request):
    try:
        payload = await request.json()
        message = (payload.get("message") or "").strip()
        if not message:
            return {"success": False, "message": "请填写 git commit message"}

        if not os.path.isdir(os.path.join(REPO_ROOT, ".git")):
            return {"success": False, "message": f"未找到 git 仓库: {REPO_ROOT}"}

        status = _run_git(["status", "--porcelain"])
        if status.returncode != 0:
            return {"success": False, "message": f"git status 失败:\n{status.stderr}"}
        if not status.stdout.strip():
            return {"success": False, "message": "工作区无改动，无需提交"}

        add = _run_git(["add", "-A"])
        if add.returncode != 0:
            return {"success": False, "message": f"git add 失败:\n{add.stderr}"}

        commit = _run_git(["commit", "-m", message])
        if commit.returncode != 0:
            return {"success": False, "message": f"git commit 失败:\n{commit.stderr or commit.stdout}"}

        push = _run_git(["push"])
        if push.returncode != 0:
            # Fallback: push current HEAD to origin
            push = _run_git(["push", "-u", "origin", "HEAD"])
        if push.returncode != 0:
            return {"success": False, "message": f"git push 失败:\n{push.stderr or push.stdout}"}

        return {
            "success": True,
            "message": "✅ 已提交并推送到远程",
            "commit": (commit.stdout or "").strip(),
            "push": (push.stdout or push.stderr or "").strip(),
        }
    except Exception as e:
        return {"success": False, "message": f"git 操作异常: {str(e)}"}
