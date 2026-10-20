"""Authenticated, password-confirmed closure requests. No wallet or data deletion."""
import uuid
from datetime import datetime, timezone
from auth import AuthError, verify_password
from db import audit_event, connect


def closure(tenant, member, data=None):
    with connect() as conn:
        conn.execute("CREATE TABLE IF NOT EXISTS lingbi_account_closure_requests (member_id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, request_id TEXT NOT NULL, status TEXT NOT NULL, created_at TEXT NOT NULL)")
        if data is not None:
            if data.get("confirmation") != "注销账号":
                raise AuthError(400, "closure_confirmation_required")
            user = conn.execute("SELECT password_hash,password_salt FROM local_auth_users WHERE tenant_id=? AND member_id=? AND status='active'", (tenant, member)).fetchone()
            password = data.get("password")
            if not user or not isinstance(password, str) or len(password) > 512 or not verify_password(password, user["password_hash"], user["password_salt"]):
                raise AuthError(403, "closure_password_invalid")
            timestamp = datetime.now(timezone.utc).isoformat()
            request_id = "closure_" + uuid.uuid4().hex
            conn.execute("INSERT INTO lingbi_account_closure_requests(member_id,tenant_id,request_id,status,created_at) VALUES(?,?,?,?,?) ON CONFLICT(member_id) DO NOTHING", (member, tenant, request_id, "pending_review", timestamp))
            audit_event(conn, tenant_id=tenant, member_id=member, event_type="account.closure_requested", actor_type="member", actor_id=member, payload={"reviewRequired": True})
        row = conn.execute("SELECT request_id,status,created_at FROM lingbi_account_closure_requests WHERE tenant_id=? AND member_id=?", (tenant, member)).fetchone()
        return {"request": {"id": row["request_id"], "status": row["status"], "createdAt": row["created_at"]} if row else None}
