"""Server-only shared transport secret; never export it to a workstation or Git."""
import os
from pathlib import Path
import secrets
import sys
from datetime import datetime, timezone

account_env = Path(sys.argv[1]).resolve()
app_env = Path(sys.argv[2]).resolve()
if not str(account_env).startswith("/opt/account-entitlement/") or not str(app_env).startswith("/opt/knowtrail/releases/"):
    raise RuntimeError("unexpected_deployment_environment_path")
if not account_env.exists():
    content = "\n".join(("LINGBI_COMMERCE_MODE=observe", "LINGBI_COMMERCE_INTERNAL_SECRET=" + secrets.token_hex(32), "LINGBI_COST_OBSERVATION_STARTED_AT=" + datetime.now(timezone.utc).isoformat(), "LINGBI_COST_AUDIT_PASSED=false", "LINGBI_PAYMENT_AUDIT_PASSED=false", "LINGBI_PRICE_BOOK_JSON={}")) + "\n"
    descriptor = os.open(account_env, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(descriptor, "w") as stream: stream.write(content)
values = dict(line.split("=", 1) for line in account_env.read_text().splitlines() if "=" in line and not line.startswith("#"))
if values.get("LINGBI_COMMERCE_MODE") != "observe":
    raise RuntimeError("refusing_to_override_existing_charging_mode")
os.chmod(account_env, 0o600)
lines = [line for line in app_env.read_text().splitlines() if not line.startswith(("LINGBI_COMMERCE_MODE=", "LINGBI_COMMERCE_INTERNAL_SECRET="))]
app_env.write_text("\n".join(lines + ["LINGBI_COMMERCE_MODE=observe", "LINGBI_COMMERCE_INTERNAL_SECRET=" + values["LINGBI_COMMERCE_INTERNAL_SECRET"]]) + "\n")
os.chmod(app_env, 0o600)
print("OBSERVE_ONLY_ENV_READY")
