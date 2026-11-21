"""Cloudflare R2 picbed — credentials from ~/.config/AboutVPS/r2.env (never from siteConfig).

Minimizes Class A/B: one PutObject per upload; gallery list reads local manifest (no ListObjects).
"""
from __future__ import annotations

import json
import os
import re
import uuid
from datetime import datetime, timezone
from pathlib import Path

from fastapi import APIRouter, File, UploadFile

router = APIRouter()

CONFIG_DIR = Path(os.environ.get("XDG_CONFIG_HOME", Path.home() / ".config")) / "AboutVPS"
R2_ENV_PATH = CONFIG_DIR / "r2.env"
MANIFEST_PATH = CONFIG_DIR / "r2-uploads.json"


def _parse_env_file(path: Path) -> dict[str, str]:
    out: dict[str, str] = {}
    if not path.is_file():
        return out
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        out[k.strip()] = v.strip().strip("'").strip('"')
    return out


def _load_r2_config() -> dict[str, str] | None:
    cfg = _parse_env_file(R2_ENV_PATH)
    required = (
        "R2_ACCESS_KEY_ID",
        "R2_SECRET_ACCESS_KEY",
        "R2_BUCKET",
        "R2_ENDPOINT",
        "R2_PUBLIC_BASE",
    )
    if not all(cfg.get(k) for k in required):
        return None
    return cfg


def _load_manifest() -> list[dict]:
    if not MANIFEST_PATH.is_file():
        return []
    try:
        data = json.loads(MANIFEST_PATH.read_text(encoding="utf-8"))
        return data if isinstance(data, list) else []
    except Exception:
        return []


def _save_manifest(items: list[dict]) -> None:
    CONFIG_DIR.mkdir(parents=True, exist_ok=True)
    MANIFEST_PATH.write_text(
        json.dumps(items, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    try:
        os.chmod(MANIFEST_PATH, 0o600)
    except OSError:
        pass


def _safe_filename(name: str | None) -> str:
    base = Path(name or "image.bin").name
    base = re.sub(r"[^\w.\-]+", "_", base)[:80] or "image.bin"
    return base


def _s3_client(cfg: dict[str, str]):
    import boto3
    from botocore.config import Config

    return boto3.client(
        "s3",
        endpoint_url=cfg["R2_ENDPOINT"].rstrip("/"),
        aws_access_key_id=cfg["R2_ACCESS_KEY_ID"],
        aws_secret_access_key=cfg["R2_SECRET_ACCESS_KEY"],
        region_name=cfg.get("R2_REGION") or "auto",
        config=Config(signature_version="s3v4"),
    )


@router.get("/status")
async def r2_status():
    cfg = _load_r2_config()
    if not cfg:
        return {
            "success": False,
            "configured": False,
            "message": f"未找到完整 R2 配置，请填写 {R2_ENV_PATH}",
            "env_path": str(R2_ENV_PATH),
            "manifest_path": str(MANIFEST_PATH),
            "count": 0,
        }
    items = _load_manifest()
    return {
        "success": True,
        "configured": True,
        "message": f"R2 已配置 → {cfg['R2_PUBLIC_BASE']}（清单 {len(items)} 条，不 List bucket）",
        "public_base": cfg["R2_PUBLIC_BASE"].rstrip("/"),
        "bucket": cfg["R2_BUCKET"],
        "env_path": str(R2_ENV_PATH),
        "manifest_path": str(MANIFEST_PATH),
        "count": len(items),
    }


@router.post("/test")
async def test_r2_connection():
    cfg = _load_r2_config()
    if not cfg:
        return {"success": False, "message": f"缺少 {R2_ENV_PATH} 或字段不完整"}
    try:
        client = _s3_client(cfg)
        # HeadBucket is Class A; only used for explicit user test — not on every open.
        client.head_bucket(Bucket=cfg["R2_BUCKET"])
        return {
            "success": True,
            "message": f"连接成功：bucket={cfg['R2_BUCKET']} public={cfg['R2_PUBLIC_BASE']}",
        }
    except Exception as e:
        return {"success": False, "message": f"R2 校验失败: {e}"}


@router.get("/list")
async def list_uploads():
    """Local manifest only — no R2 ListObjects (avoids Class A)."""
    items = _load_manifest()
    return {"success": True, "items": items, "count": len(items)}


@router.post("/upload")
async def upload_image(file: UploadFile = File(...)):
    cfg = _load_r2_config()
    if not cfg:
        return {
            "success": False,
            "message": f"未配置 R2。请编辑 {R2_ENV_PATH}（参考同目录 r2.env.example）",
        }

    content = await file.read()
    if not content:
        return {"success": False, "message": "空文件"}

    ext_name = _safe_filename(file.filename)
    day = datetime.now(timezone.utc).strftime("%Y/%m/%d")
    key = f"blog/{day}/{uuid.uuid4().hex[:12]}-{ext_name}"
    public_base = cfg["R2_PUBLIC_BASE"].rstrip("/")
    public_url = f"{public_base}/{key}"
    content_type = file.content_type or "application/octet-stream"

    try:
        client = _s3_client(cfg)

        def _put():
            client.put_object(
                Bucket=cfg["R2_BUCKET"],
                Key=key,
                Body=content,
                ContentType=content_type,
            )

        import asyncio

        await asyncio.to_thread(_put)
    except Exception as e:
        return {"success": False, "message": f"上传失败: {e}"}

    entry = {
        "url": public_url,
        "key": key,
        "name": ext_name,
        "size": len(content),
        "content_type": content_type,
        "uploaded_at": datetime.now(timezone.utc).isoformat(),
    }
    items = _load_manifest()
    items.insert(0, entry)
    # keep last 500 locally
    _save_manifest(items[:500])

    return {"success": True, "message": "上传成功", "url": public_url, "key": key}
