import os
import json
from fastapi import APIRouter, Request

router = APIRouter()

CURRENT_API_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_ROOT = os.path.abspath(os.path.join(CURRENT_API_DIR, "..", ".."))
CONFIG_FILE = os.path.join(PROJECT_ROOT, "data", "deploy_config.json")


@router.get("/config")
async def get_deploy_config():
    if os.path.exists(CONFIG_FILE):
        try:
            with open(CONFIG_FILE, "r", encoding="utf-8") as f:
                data = json.load(f)
                return {"blogPath": data.get("blogPath", "")}
        except Exception:
            pass
    return {"blogPath": ""}


@router.post("/config")
async def save_deploy_config(request: Request):
    try:
        data = await request.json()
        blog_path = (data.get("blogPath") or "").strip()
        os.makedirs(os.path.dirname(CONFIG_FILE), exist_ok=True)
        with open(CONFIG_FILE, "w", encoding="utf-8") as f:
            json.dump({"blogPath": blog_path}, f, ensure_ascii=False, indent=2)
        return {"success": True, "message": "✅ 配置已永久保存！"}
    except Exception as e:
        return {"success": False, "message": f"保存失败: {str(e)}"}
