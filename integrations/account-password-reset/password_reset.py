"""Email-only, single-use password recovery for the account service."""
from __future__ import annotations

import hashlib
import os
import re
import secrets
import smtplib
import ssl
import threading
from datetime import datetime, timedelta, timezone
from email.message import EmailMessage
from urllib.parse import urlsplit

from config import DB_ENGINE
from db import audit_event, connect


def ensure_schema(conn):
    conn.execute("""CREATE TABLE IF NOT EXISTS local_auth_password_resets (
      token_hash TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES local_auth_users(id),
      tenant_id TEXT NOT NULL,
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      used_at TEXT
    )""")
    conn.execute("CREATE INDEX IF NOT EXISTS local_auth_password_resets_user ON local_auth_password_resets(user_id)")
    conn.execute("CREATE TABLE IF NOT EXISTS local_auth_password_reset_attempts(email_hash TEXT NOT NULL,created_at TEXT NOT NULL)")
    conn.execute("CREATE INDEX IF NOT EXISTS local_auth_password_reset_attempts_email ON local_auth_password_reset_attempts(email_hash,created_at)")
    conn.execute("""CREATE TABLE IF NOT EXISTS local_auth_password_reset_codes (
      challenge_hash TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES local_auth_users(id),
      tenant_id TEXT NOT NULL, code_hash TEXT NOT NULL,
      created_at TEXT NOT NULL, expires_at TEXT NOT NULL,
      attempts INTEGER NOT NULL DEFAULT 0, used_at TEXT
    )""")
    conn.execute("CREATE INDEX IF NOT EXISTS local_auth_password_reset_codes_user ON local_auth_password_reset_codes(user_id)")


_schema_lock = threading.Lock()
_schema_ready = False


def prepare_schema():
    global _schema_ready
    with _schema_lock:
        if not _schema_ready:
            with connect() as conn:
                ensure_schema(conn)
            _schema_ready = True


def mail_settings():
    from auth import AuthError
    host = os.getenv("SMTP_HOST", "").strip()
    sender = os.getenv("SMTP_FROM", "").strip()
    reset_url = os.getenv("PASSWORD_RESET_PUBLIC_URL", "").strip()
    parsed = urlsplit(reset_url)
    if not host or not sender or parsed.scheme != "https" or not parsed.netloc or parsed.query or parsed.fragment:
        raise AuthError(503, "password_reset_not_configured")
    return host, int(os.getenv("SMTP_PORT", "465")), sender, reset_url


def deliver(email: str, token: str, *, send: bool = True, code: str | None = None):
    host, port, sender, reset_url = mail_settings()
    message = EmailMessage()
    message["From"] = sender
    message["To"] = email
    message["Subject"] = "灵笔密码重置验证码" if code is not None else "灵笔账号密码重置"
    if code is not None:
        message.set_content(f"你的灵笔密码重置验证码是：{code}\n\n请在当前页面输入验证码和新密码，10 分钟内有效，仅可使用一次。不要把验证码提供给他人。若不是本人申请，请忽略此邮件。")
    else:
        message.set_content(f"你申请了重置灵笔账号密码。请在 15 分钟内打开以下链接设置新密码：\n\n{reset_url}#token={token}\n\n链接仅可使用一次。若不是你本人申请，请忽略此邮件，你的密码不会改变。")
    context = ssl.create_default_context()
    transport = smtplib.SMTP_SSL(host, port, timeout=15, context=context) if port == 465 else smtplib.SMTP(host, port, timeout=15)
    with transport as smtp:
        if port != 465:
            smtp.starttls(context=context)
        username = os.getenv("SMTP_USER", "")
        if username:
            smtp.login(username, os.getenv("SMTP_PASSWORD", ""))
        if send:
            smtp.send_message(message)


def reserve_request(conn, email: str, timestamp: datetime, *, cooldown: int = 0):
    from auth import AuthError
    email_hash = hashlib.sha256(email.encode()).hexdigest()
    # Serialize PostgreSQL requests for the same email, including unknown accounts.
    if DB_ENGINE == "postgres":
        conn.execute("SELECT pg_advisory_xact_lock(?)", (int(email_hash[:15], 16),))
    since = (timestamp - timedelta(minutes=15)).isoformat()
    count = conn.execute("SELECT COUNT(*) AS count FROM local_auth_password_reset_attempts WHERE email_hash=? AND created_at>?", (email_hash, since)).fetchone()["count"]
    latest = conn.execute("SELECT MAX(created_at) AS latest FROM local_auth_password_reset_attempts WHERE email_hash=?", (email_hash,)).fetchone()["latest"]
    if cooldown and latest and latest > (timestamp - timedelta(seconds=cooldown)).isoformat():
        raise AuthError(429, "code_resend_too_soon")
    if count >= 3:
        raise AuthError(429, "too_many_requests")
    conn.execute("DELETE FROM local_auth_password_reset_attempts WHERE created_at<?", (since,))
    conn.execute("INSERT INTO local_auth_password_reset_attempts(email_hash,created_at) VALUES(?,?)", (email_hash, timestamp.isoformat()))
    conn.execute("DELETE FROM local_auth_password_resets WHERE expires_at<?", ((timestamp - timedelta(days=7)).isoformat(),))
    conn.execute("DELETE FROM local_auth_password_reset_codes WHERE expires_at<?", ((timestamp - timedelta(days=7)).isoformat(),))


def request_reset(data: dict) -> dict:
    if data.get("mode") == "email_code":
        from password_reset_codes import request_code
        return request_code(data)
    from auth import AuthError, normalize_email
    mail_settings()  # Same capability check for registered and unregistered addresses.
    email = normalize_email(str(data.get("email") or ""))
    if not re.fullmatch(r"[^\s@]+@[^\s@]+\.[^\s@]+", email):
        raise ValueError("invalid_email")
    tenant_id = str(data.get("tenant_id") or "tenant_acme").strip()
    token = secrets.token_urlsafe(32)
    digest = hashlib.sha256(token.encode()).hexdigest()
    timestamp = datetime.now(timezone.utc)
    user = None
    prepare_schema()
    with connect() as conn:
        if DB_ENGINE == "sqlite":
            conn.execute("BEGIN IMMEDIATE")
        reserve_request(conn, email, timestamp)
        user = conn.execute("SELECT id, tenant_id, member_id FROM local_auth_users WHERE email = ? AND status = 'active'" + (" FOR UPDATE" if DB_ENGINE == "postgres" else ""), (email,)).fetchone()
        if user:
            tenant_id = user["tenant_id"]
            conn.execute("UPDATE local_auth_password_resets SET used_at = ? WHERE user_id = ? AND used_at IS NULL", (timestamp.isoformat(), user["id"]))
            conn.execute("UPDATE local_auth_password_reset_codes SET used_at = ? WHERE user_id = ? AND used_at IS NULL", (timestamp.isoformat(), user["id"]))
            conn.execute("INSERT INTO local_auth_password_resets(token_hash,user_id,tenant_id,created_at,expires_at) VALUES(?,?,?,?,?)", (digest, user["id"], tenant_id, timestamp.isoformat(), (timestamp + timedelta(minutes=15)).isoformat()))
            audit_event(conn, tenant_id=tenant_id, member_id=user["member_id"], event_type="local_auth.password_reset_requested", actor_type="anonymous", actor_id="password_reset", payload={"email_sha256": hashlib.sha256(email.encode()).hexdigest()})
    try:
        # Validate the transport for unknown emails too, without sending a message.
        deliver(email, token, send=bool(user))
    except Exception:
        if user:
            with connect() as conn:
                conn.execute("UPDATE local_auth_password_resets SET used_at = ? WHERE token_hash = ?", (datetime.now(timezone.utc).isoformat(), digest))
        raise AuthError(503, "password_reset_delivery_failed") from None
    return {"status": "accepted", "delivery": "email"}


def confirm_reset(data: dict) -> dict:
    if "challengeId" in data:
        from password_reset_codes import confirm_code
        return confirm_code(data)
    from auth import AuthError, require_password
    token = str(data.get("token") or "")
    if not re.fullmatch(r"[A-Za-z0-9_-]{43}", token):
        raise AuthError(400, "password_reset_invalid_or_expired")
    password = require_password(str(data.get("password") or ""))
    digest = hashlib.sha256(token.encode()).hexdigest()
    timestamp = datetime.now(timezone.utc).isoformat()
    prepare_schema()
    with connect() as conn:
        if DB_ENGINE == "sqlite":
            conn.execute("BEGIN IMMEDIATE")
        if DB_ENGINE == "postgres":
            owner = conn.execute("SELECT user_id FROM local_auth_password_resets WHERE token_hash=?", (digest,)).fetchone()
            if owner:
                conn.execute("SELECT id FROM local_auth_users WHERE id=? FOR UPDATE", (owner["user_id"],))
        row = conn.execute("""SELECT r.user_id,r.tenant_id,r.expires_at,r.used_at,u.member_id,u.status
          FROM local_auth_password_resets r JOIN local_auth_users u ON u.id=r.user_id
          WHERE r.token_hash = ?""" + (" FOR UPDATE OF r" if DB_ENGINE == "postgres" else ""), (digest,)).fetchone()
        if not row or row["used_at"] or row["expires_at"] <= timestamp or row["status"] != "active":
            raise AuthError(400, "password_reset_invalid_or_expired")
        update_password(conn, row, password, timestamp)
    return {"status": "ok"}


def update_password(conn, row, password: str, timestamp: str):
    from auth import hash_password
    password_hash, salt = hash_password(password)
    conn.execute("UPDATE local_auth_users SET password_hash=?,password_salt=? WHERE id=?", (password_hash, salt, row["user_id"]))
    conn.execute("UPDATE local_auth_password_resets SET used_at=? WHERE user_id=? AND used_at IS NULL", (timestamp, row["user_id"]))
    conn.execute("UPDATE local_auth_sessions SET revoked_at=? WHERE user_id=? AND revoked_at IS NULL", (timestamp, row["user_id"]))
    conn.execute("UPDATE local_auth_password_reset_codes SET used_at=? WHERE user_id=? AND used_at IS NULL", (timestamp, row["user_id"]))
    audit_event(conn, tenant_id=row["tenant_id"], member_id=row["member_id"], event_type="local_auth.password_reset_completed", actor_type="anonymous", actor_id="password_reset", payload={"sessions_revoked": True})
