import hashlib
import hmac
import os
import secrets
import smtplib
import ssl
from datetime import timedelta
from email.message import EmailMessage
from db import connect
from config import DB_ENGINE
from lingbi_catalog import utcnow
from lingbi_store import locked, ensure_personal, batch, event


def digest(member, code):
    secret = os.getenv("LINGBI_COMMERCE_INTERNAL_SECRET", "")
    if len(secret) < 32:
        raise ValueError("commerce_secret_not_configured")
    return hmac.new(secret.encode(), (member + ":" + code).encode(), hashlib.sha256).hexdigest()


def migrate(conn):
    conn.execute("CREATE TABLE IF NOT EXISTS lingbi_email_codes(member_id TEXT PRIMARY KEY,email TEXT NOT NULL,code_hash TEXT NOT NULL,expires_at TEXT NOT NULL,created_at TEXT NOT NULL,attempts INTEGER NOT NULL DEFAULT 0)")
    conn.execute("CREATE TABLE IF NOT EXISTS lingbi_verified_emails(email_hash TEXT PRIMARY KEY,member_id TEXT NOT NULL,created_at TEXT NOT NULL)")


def send_code(email, code):
    from password_reset import mail_settings
    host, port, sender, _ = mail_settings()
    message = EmailMessage()
    message["From"], message["To"], message["Subject"] = sender, email, "灵笔邮箱验证"
    message.set_content(f"你的灵笔邮箱验证码：{code}。10 分钟内有效，请在会员与用量页面输入。验证成功后可领取一次体验点数。")
    context = ssl.create_default_context()
    transport = smtplib.SMTP_SSL(host, port, timeout=15, context=context) if port == 465 else smtplib.SMTP(host, port, timeout=15)
    with transport as smtp:
        if port != 465:
            smtp.starttls(context=context)
        if os.getenv("SMTP_USER"):
            smtp.login(os.getenv("SMTP_USER"), os.getenv("SMTP_PASSWORD", ""))
        smtp.send_message(message)


def request_code(tenant, member, email):
    account = ensure_personal(tenant, member)
    code = f"{secrets.randbelow(1000000):06d}"
    with locked(account, tenant, member) as (conn, state):
        migrate(conn)
        if state["verified"]:
            return dict(status="verified")
        previous = conn.execute("SELECT * FROM lingbi_email_codes WHERE member_id=?", (member,)).fetchone()
        if previous and previous["created_at"] > (utcnow() - timedelta(seconds=60)).isoformat():
            raise ValueError("verification_resend_too_soon")
        conn.execute("INSERT INTO lingbi_email_codes(member_id,email,code_hash,expires_at,created_at,attempts) VALUES(?,?,?,?,?,0) ON CONFLICT(member_id) DO UPDATE SET email=excluded.email,code_hash=excluded.code_hash,expires_at=excluded.expires_at,created_at=excluded.created_at,attempts=0", (member, email, digest(member, code), (utcnow() + timedelta(minutes=10)).isoformat(), utcnow().isoformat()))
    try:
        send_code(email, code)
    except Exception:
        with connect() as conn:
            conn.execute("DELETE FROM lingbi_email_codes WHERE member_id=? AND code_hash=?", (member, digest(member, code)))
        raise ValueError("verification_email_delivery_failed") from None
    return dict(status="sent", expiresInSeconds=600)


def confirm(tenant, member, email, code):
    if not isinstance(code, str) or len(code) != 6 or not code.isascii() or not code.isdigit():
        raise ValueError("invalid_verification_code")
    failure = False
    account = ensure_personal(tenant, member)
    with locked(account, tenant, member) as (conn, state):
        migrate(conn)
        row = conn.execute("SELECT * FROM lingbi_email_codes WHERE member_id=?", (member,)).fetchone()
        if not row or row["email"] != email or row["expires_at"] <= utcnow().isoformat() or row["attempts"] >= 5:
            failure = True
        elif not hmac.compare_digest(row["code_hash"], digest(member, code)):
            conn.execute("UPDATE lingbi_email_codes SET attempts=attempts+1 WHERE member_id=?", (member,))
            failure = True
        else:
            email_hash = hashlib.sha256(email.lower().encode()).hexdigest()
            granted = conn.execute("INSERT INTO lingbi_verified_emails(email_hash,member_id,created_at) VALUES(?,?,?) ON CONFLICT(email_hash) DO NOTHING", (email_hash, member, utcnow().isoformat())).rowcount
            state["verified"] = True
            if granted:
                batch(state, 100, "trial", key="verified-trial:" + email_hash)
                event(conn, account, member, "trial:" + email_hash, dict(type="trial_grant", points=100))
            conn.execute("DELETE FROM lingbi_email_codes WHERE member_id=?", (member,))
    if failure:
        raise ValueError("verification_code_invalid_or_expired")
    return dict(status="verified")
