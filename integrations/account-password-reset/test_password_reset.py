"""Run with the isolated account source directory as the first argument."""
import concurrent.futures
import os
from pathlib import Path
import re
import sys
import tempfile
import unittest
from unittest.mock import patch

scratch = tempfile.TemporaryDirectory()
os.environ.update(DB_ENGINE="postgres" if os.getenv("RESET_TEST_DATABASE_URL") else "sqlite", DATABASE_URL=os.getenv("RESET_TEST_DATABASE_URL", ""), SQLITE_PATH=str(Path(scratch.name) / "account.sqlite3"),
                  SMTP_HOST="capture.invalid", SMTP_PORT="465", SMTP_FROM="service@example.invalid",
                  SMTP_USER="", PASSWORD_RESET_PUBLIC_URL="https://airai.world/lingbi/account/reset-password/")
sys.path.insert(0, sys.argv.pop(1))
import auth
import db
import password_reset as reset


class CaptureSMTP:
    messages = []
    fail = False

    def __init__(self, *args, **kwargs): pass
    def __enter__(self): return self
    def __exit__(self, *args): pass
    def login(self, *args): pass
    def send_message(self, message):
        if self.fail: raise OSError("isolated transport failure")
        self.messages.append(message)


class PasswordRecoveryTests(unittest.TestCase):
    def setUp(self):
        Path(os.environ["SQLITE_PATH"]).unlink(missing_ok=True)
        db.init_db()
        with db.connect() as conn: reset.ensure_schema(conn)
        if db.DB_ENGINE == "postgres":
            with db.connect() as conn:
                reset.ensure_schema(conn)
                conn.execute("TRUNCATE tenants,local_auth_password_reset_attempts CASCADE")
            db.init_db()
        CaptureSMTP.messages = []
        CaptureSMTP.fail = False
        self.smtp = patch.object(reset.smtplib, "SMTP_SSL", CaptureSMTP)
        self.smtp.start()
        self.session = auth.register_local_user({"display_name": "Recovery QA", "email": "recovery@example.invalid", "password": "OldFixture123"})  # gitleaks:allow

    def tearDown(self): self.smtp.stop()

    def request(self):
        result = reset.request_reset({"email": "recovery@example.invalid"})
        self.assertEqual(result["delivery"], "email")
        return re.search(r"#token=([A-Za-z0-9_-]+)", CaptureSMTP.messages[-1].get_content()).group(1)

    def test_email_reset_and_session_revocation(self):
        token = self.request()
        with db.connect() as conn:
            row = conn.execute("SELECT * FROM local_auth_password_resets").fetchone()
            self.assertNotIn(token, str(dict(row)))
        reset.confirm_reset({"token": token, "password": "NewFixture456"})  # gitleaks:allow
        with self.assertRaises(auth.AuthError): auth.current_local_user({"Authorization": "Bearer " + self.session["token"]})
        with self.assertRaises(auth.AuthError): auth.login_local_user({"email": "recovery@example.invalid", "password": "OldFixture123"})
        self.assertIn("token", auth.login_local_user({"email": "recovery@example.invalid", "password": "NewFixture456"}))
        with self.assertRaises(auth.AuthError): reset.confirm_reset({"token": token, "password": "AnotherFixture789"})

    def test_latest_link_only_and_expiry(self):
        old = self.request()
        latest = self.request()
        with self.assertRaises(auth.AuthError): reset.confirm_reset({"token": old, "password": "NewFixture456"})
        with db.connect() as conn: conn.execute("UPDATE local_auth_password_resets SET expires_at='2000-01-01T00:00:00+00:00'")
        with self.assertRaises(auth.AuthError): reset.confirm_reset({"token": latest, "password": "NewFixture456"})

    def test_uniform_unknown_address_and_rate_limit(self):
        known = reset.request_reset({"email": "recovery@example.invalid"})
        unknown = reset.request_reset({"email": "unknown@example.invalid"})
        self.assertEqual(known, unknown)
        self.assertEqual(len(CaptureSMTP.messages), 1)
        self.request(); self.request()
        with self.assertRaises(auth.AuthError) as caught: self.request()
        self.assertEqual(caught.exception.status, 429)

    def test_transport_failure_invalidates_token(self):
        CaptureSMTP.fail = True
        with self.assertRaises(auth.AuthError) as caught: self.request()
        self.assertEqual(caught.exception.status, 503)
        with db.connect() as conn:
            self.assertIsNotNone(conn.execute("SELECT used_at FROM local_auth_password_resets").fetchone()["used_at"])

    def test_concurrent_consumption_is_atomic(self):
        token = self.request()
        def consume(_):
            try:
                reset.confirm_reset({"token": token, "password": "NewFixture456"})
                return 200
            except auth.AuthError as failure: return failure.status
        with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
            self.assertEqual(sorted(pool.map(consume, range(2))), [200, 400])

    def test_short_password_does_not_consume_link(self):
        token = self.request()
        with self.assertRaises(ValueError): reset.confirm_reset({"token": token, "password": "short"})
        reset.confirm_reset({"token": token, "password": "NewFixture456"})


if __name__ == "__main__": unittest.main()
