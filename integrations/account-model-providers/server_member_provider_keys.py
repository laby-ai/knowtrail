from __future__ import annotations

from datetime import date, datetime
import re
import uuid
from typing import Callable

from server_provider_keys import _fernet, _secret_meta


WORKSPACE_ID_RE = re.compile(r"^[A-Za-z0-9_-]{3,128}$")
PROFILE_APP_KEY = "knowtrail"
RESOLVER_APP_KEYS = frozenset({"knowtrail", "huiying"})
PROVIDER_ID = "aliyun-bailian"
REGION = "cn-beijing"
TEXT_MODEL = "qwen3.8-flash"
IMAGE_MODEL = "qwen-image-3.0-pro"
TTS_MODEL = "qwen-audio-3.0-tts-plus"
PROVIDERS = {
    "aliyun-bailian": (TEXT_MODEL, IMAGE_MODEL, TTS_MODEL),
    "moonshot": ("kimi-k3", "", ""),
    "deepseek": ("deepseek-flash", "", ""),
}


def public_profile(row=None) -> dict:
    if row is None:
        return {
            "configured": False,
            "provider_id": PROVIDER_ID,
            "region": REGION,
            "text_model": TEXT_MODEL,
            "image_model": IMAGE_MODEL,
            "tts_model": TTS_MODEL,
        }
    data = dict(row)
    for key in ("secret_ciphertext", "secret_fingerprint", "tenant_id", "member_id"):
        data.pop(key, None)
    for key, value in list(data.items()):
        if isinstance(value, (datetime, date)):
            data[key] = value.isoformat()
    data["configured"] = data.get("status") == "active"
    data["secret_mask"] = f"****{data.pop('secret_last4', '')}"
    if not data.get("workspace_id"):
        data.pop("workspace_id", None)
    return data


def fetch_profile(connect: Callable, tenant_id: str, member_id: str) -> dict:
    with connect() as conn:
        row = conn.execute(
            """SELECT * FROM member_provider_key_profiles
            WHERE tenant_id = ? AND member_id = ? AND app_key = ? AND status = 'active'""",
            (tenant_id, member_id, PROFILE_APP_KEY),
        ).fetchone()
    return public_profile(row)


def save_profile(tenant_id: str, member_id: str, data: dict, *, connect: Callable, audit_event: Callable, now_func: Callable[[], str]) -> dict:
    provider_id = str(data.get("provider_id") or PROVIDER_ID)
    if provider_id not in PROVIDERS:
        raise ValueError("unsupported_model_provider")
    text_model, image_model, tts_model = PROVIDERS[provider_id]
    workspace_id = str(data.get("workspace_id") or "").strip()
    region = str(data.get("region") or REGION).strip().lower() if provider_id == PROVIDER_ID else "global"
    if provider_id != PROVIDER_ID:
        workspace_id = ""
    if workspace_id and not WORKSPACE_ID_RE.fullmatch(workspace_id):
        raise ValueError("invalid_workspace_id")
    if provider_id == PROVIDER_ID and region != REGION:
        raise ValueError("unsupported_bailian_region")
    ciphertext, fingerprint, last4 = _secret_meta(str(data.get("api_key") or ""))
    timestamp = now_func()
    with connect() as conn:
        member = conn.execute(
            "SELECT id FROM tenant_members WHERE tenant_id = ? AND id = ? AND status = 'active'",
            (tenant_id, member_id),
        ).fetchone()
        if not member:
            raise ValueError("active_member_not_found")
        conn.execute(
            """
            INSERT INTO member_provider_key_profiles (
              id, tenant_id, member_id, app_key, provider_id, workspace_id, region,
              text_model, image_model, tts_model, secret_ciphertext, secret_fingerprint,
              secret_last4, status, created_at, updated_at, revoked_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, NULL)
            ON CONFLICT(tenant_id, member_id, app_key) DO UPDATE SET
              provider_id = excluded.provider_id, workspace_id = excluded.workspace_id,
              region = excluded.region, text_model = excluded.text_model,
              image_model = excluded.image_model, tts_model = excluded.tts_model,
              secret_ciphertext = excluded.secret_ciphertext,
              secret_fingerprint = excluded.secret_fingerprint,
              secret_last4 = excluded.secret_last4, status = 'active',
              updated_at = excluded.updated_at, revoked_at = NULL
            """,
            (
                f"mpkp_{uuid.uuid4().hex[:12]}", tenant_id, member_id, PROFILE_APP_KEY, provider_id,
                workspace_id, region, text_model, image_model, tts_model,
                ciphertext, fingerprint, last4, timestamp, timestamp,
            ),
        )
        audit_event(
            conn,
            tenant_id=tenant_id,
            member_id=member_id,
            event_type="member_provider_key_profile.saved",
            actor_type="member",
            actor_id=member_id,
            payload={"app_key": PROFILE_APP_KEY, "provider_id": provider_id, "region": region},
        )
    return {"profile": fetch_profile(connect, tenant_id, member_id)}


def revoke_profile(tenant_id: str, member_id: str, *, connect: Callable, audit_event: Callable, now_func: Callable[[], str]) -> dict:
    timestamp = now_func()
    with connect() as conn:
        conn.execute(
            """UPDATE member_provider_key_profiles
            SET status = 'revoked', updated_at = ?, revoked_at = ?
            WHERE tenant_id = ? AND member_id = ? AND app_key = ? AND status = 'active'""",
            (timestamp, timestamp, tenant_id, member_id, PROFILE_APP_KEY),
        )
        audit_event(
            conn,
            tenant_id=tenant_id,
            member_id=member_id,
            event_type="member_provider_key_profile.revoked",
            actor_type="member",
            actor_id=member_id,
            payload={"app_key": PROFILE_APP_KEY, "provider_id": PROVIDER_ID},
        )
    return {"profile": public_profile()}


def resolve_profile(connect: Callable, tenant_id: str, member_id: str, app_key: str) -> dict:
    if app_key not in RESOLVER_APP_KEYS:
        raise ValueError("provider_profile_app_mismatch")
    with connect() as conn:
        row = conn.execute(
            """SELECT * FROM member_provider_key_profiles
            WHERE tenant_id = ? AND member_id = ? AND app_key = ? AND status = 'active'""",
            (tenant_id, member_id, PROFILE_APP_KEY),
        ).fetchone()
    if not row:
        raise ValueError("member_provider_profile_not_found")
    if row["provider_id"] not in PROVIDERS or (app_key != PROFILE_APP_KEY and row["provider_id"] != PROVIDER_ID):
        raise ValueError("provider_profile_app_mismatch")
    try:
        api_key = _fernet().decrypt(str(row["secret_ciphertext"]).encode("utf-8")).decode("utf-8")
    except Exception as exc:
        raise ValueError("member_provider_profile_decrypt_failed") from exc
    return {
        "tenant_id": tenant_id,
        "member_id": member_id,
        "provider_id": row["provider_id"],
        "workspace_id": row["workspace_id"],
        "region": row["region"],
        "text_model": row["text_model"],
        "image_model": row["image_model"],
        "tts_model": row["tts_model"],
        "api_key": api_key,
    }
