"""Bounded, email-delivered recovery codes; no code is returned by the API."""
from datetime import datetime, timedelta, timezone
import hashlib
import hmac
import os
import re
import secrets

from config import DB_ENGINE
from db import audit_event, connect
from password_reset import deliver, mail_settings, prepare_schema, reserve_request, update_password


def code_digest(challenge: str, code: str) -> str:
    from auth import AuthError
    secret = os.getenv("PASSWORD_RESET_CODE_SECRET", "")
    if len(secret) < 32:
        raise AuthError(503, "password_reset_not_configured")
    return hmac.new(secret.encode(), f"{challenge}:{code}".encode(), hashlib.sha256).hexdigest()


def request_code(data: dict) -> dict:
    from auth import AuthError, normalize_email
    mail_settings()
    email = normalize_email(str(data.get("email") or ""))
    if not re.fullmatch(r"[^\s@]+@[^\s@]+\.[^\s@]+", email):
        raise ValueError("invalid_email")
    challenge = secrets.token_urlsafe(32)
    code = f"{secrets.randbelow(1_000_000):06d}"
    hashed_code = code_digest(challenge, code)
    challenge_hash = hashlib.sha256(challenge.encode()).hexdigest()
    timestamp = datetime.now(timezone.utc)
    prepare_schema()
    with connect() as conn:
        if DB_ENGINE == "sqlite": conn.execute("BEGIN IMMEDIATE")
        reserve_request(conn, email, timestamp, cooldown=60)
        user = conn.execute("SELECT id,tenant_id,member_id FROM local_auth_users WHERE email=? AND status='active'" + (" FOR UPDATE" if DB_ENGINE == "postgres" else ""), (email,)).fetchone()
        if user:
            conn.execute("UPDATE local_auth_password_resets SET used_at=? WHERE user_id=? AND used_at IS NULL", (timestamp.isoformat(), user["id"]))
            conn.execute("UPDATE local_auth_password_reset_codes SET used_at=? WHERE user_id=? AND used_at IS NULL", (timestamp.isoformat(), user["id"]))
            conn.execute("INSERT INTO local_auth_password_reset_codes(challenge_hash,user_id,tenant_id,code_hash,created_at,expires_at) VALUES(?,?,?,?,?,?)", (challenge_hash, user["id"], user["tenant_id"], hashed_code, timestamp.isoformat(), (timestamp + timedelta(minutes=10)).isoformat()))
            audit_event(conn, tenant_id=user["tenant_id"], member_id=user["member_id"], event_type="local_auth.password_reset_code_requested", actor_type="anonymous", actor_id="password_reset", payload={"email_sha256": hashlib.sha256(email.encode()).hexdigest()})
    try:
        deliver(email, challenge, send=bool(user), code=code)
    except Exception:
        if user:
            with connect() as conn:
                conn.execute("UPDATE local_auth_password_reset_codes SET used_at=? WHERE challenge_hash=?", (datetime.now(timezone.utc).isoformat(), challenge_hash))
        raise AuthError(503, "password_reset_delivery_failed") from None
    return {"status": "accepted", "delivery": "email", "mode": "email_code", "challengeId": challenge, "expiresInSeconds": 600}


def confirm_code(data: dict) -> dict:
    from auth import AuthError, require_password
    challenge = str(data.get("challengeId") or "")
    code = str(data.get("code") or "")
    if not re.fullmatch(r"[A-Za-z0-9_-]{43}", challenge) or not re.fullmatch(r"[0-9]{6}", code):
        raise AuthError(400, "password_reset_code_invalid_or_expired")
    password = require_password(str(data.get("password") or ""))
    hashed_code = code_digest(challenge, code)
    challenge_hash = hashlib.sha256(challenge.encode()).hexdigest()
    timestamp = datetime.now(timezone.utc).isoformat()
    prepare_schema()
    failure = None
    with connect() as conn:
        if DB_ENGINE == "sqlite": conn.execute("BEGIN IMMEDIATE")
        if DB_ENGINE == "postgres":
            owner = conn.execute("SELECT user_id FROM local_auth_password_reset_codes WHERE challenge_hash=?", (challenge_hash,)).fetchone()
            if owner: conn.execute("SELECT id FROM local_auth_users WHERE id=? FOR UPDATE", (owner["user_id"],))
        row = conn.execute("""SELECT r.user_id,r.tenant_id,r.code_hash,r.expires_at,r.used_at,r.attempts,u.member_id,u.status
          FROM local_auth_password_reset_codes r JOIN local_auth_users u ON u.id=r.user_id
          WHERE r.challenge_hash=?""" + (" FOR UPDATE OF r" if DB_ENGINE == "postgres" else ""), (challenge_hash,)).fetchone()
        if not row or row["used_at"] or row["expires_at"] <= timestamp or row["status"] != "active" or row["attempts"] >= 5:
            failure = AuthError(400, "password_reset_code_invalid_or_expired")
        elif not hmac.compare_digest(row["code_hash"], hashed_code):
            attempts = row["attempts"] + 1
            conn.execute("UPDATE local_auth_password_reset_codes SET attempts=?,used_at=? WHERE challenge_hash=?", (attempts, timestamp if attempts >= 5 else None, challenge_hash))
            failure = AuthError(400, "password_reset_code_invalid_or_expired")
        else:
            update_password(conn, row, password, timestamp)
    # Failed verification increments must commit before returning an error.
    if failure: raise failure
    return {"status": "ok"}
