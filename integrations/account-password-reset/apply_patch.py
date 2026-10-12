"""Apply the small adapter patch; never copies configuration or account data."""
from pathlib import Path
import shutil
import sys

root = Path(sys.argv[1]).resolve()
auth_path = root / "auth.py"
server_path = root / "server.py"
auth = auth_path.read_text(encoding="utf-8")
server = server_path.read_text(encoding="utf-8")
start = auth.index("def request_local_password_reset(data: dict) -> dict:")
end = auth.index("\ndef request_key(", start)
assert '"manual_follow_up"' in auth[start:end], "Unexpected password-reset implementation"
auth = auth[:start] + '''def request_local_password_reset(data: dict) -> dict:
    from password_reset import request_reset
    return request_reset(data)


def confirm_local_password_reset(data: dict) -> dict:
    from password_reset import confirm_reset
    return confirm_reset(data)

''' + auth[end:]
assert "confirm_local_password_reset" not in server, "Already patched"
server = server.replace("request_key, request_local_password_reset,", "request_key, request_local_password_reset, confirm_local_password_reset,")
anchor = '            elif path == "/v1/auth/logout":'
assert server.count(anchor) == 1
server = server.replace('self.check_rate_limit(bucket="auth.password-reset", max_requests=3, window=300)', 'self.check_rate_limit(bucket="auth.password-reset", max_requests=60, window=300)')
server = server.replace(anchor, '''            elif path == "/v1/auth/password-reset/confirm":
                self.check_rate_limit(bucket="auth.password-reset-confirm", max_requests=60, window=300)
                self.check_rate_limit(bucket="auth.password-reset-confirm:" + hash_secret(str(data.get("token") or "")), max_requests=5, window=300)
                self.send_json(200, confirm_local_password_reset(data))
''' + anchor)
compile(auth, str(auth_path), "exec")
compile(server, str(server_path), "exec")
shutil.copy2(Path(__file__).with_name("password_reset.py"), root / "password_reset.py")
auth_path.write_text(auth, encoding="utf-8")
server_path.write_text(server, encoding="utf-8")
print("Password recovery adapter applied")
