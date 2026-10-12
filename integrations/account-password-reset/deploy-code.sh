set -euo pipefail
account_root=$(readlink -f /opt/account-entitlement/account-system-new)
case "$account_root" in /opt/account-entitlement/releases/*) ;; *) exit 1 ;; esac
backup=/opt/account-entitlement/password-reset-code-backup-20261012
mkdir -m 700 "$backup"
cp "$account_root/password_reset.py" "$account_root/server.py" "$backup/"
rollback() {
 cp "$backup/password_reset.py" "$backup/server.py" "$account_root/"
 rm -f -- "$account_root/password_reset_codes.py" /etc/systemd/system/account-entitlement.service.d/password-reset-code.conf
 systemctl daemon-reload
 systemctl restart account-entitlement
}
trap 'rollback' ERR
"$account_root/.venv/bin/python" - <<'PY'
import os,secrets
from pathlib import Path
p=Path('/opt/account-entitlement/password-reset-code.env')
if not p.exists():
 fd=os.open(p,os.O_CREAT|os.O_EXCL|os.O_WRONLY,0o600)
 with os.fdopen(fd,'w') as stream: stream.write('PASSWORD_RESET_CODE_SECRET='+secrets.token_hex(32)+'\n')
p.chmod(0o600)
PY
cp /tmp/password_reset.py /tmp/password_reset_codes.py "$account_root/"
"$account_root/.venv/bin/python" - "$account_root" <<'PY'
from pathlib import Path
import sys
p=Path(sys.argv[1])/'server.py'
s=p.read_text()
a='hash_secret(str(data.get("token") or ""))'
b='hash_secret(str(data.get("token") or data.get("challengeId") or ""))'
assert s.count(a)==1
p.write_text(s.replace(a,b))
compile(s.replace(a,b),str(p),'exec')
PY
printf '[Service]\nEnvironmentFile=/opt/account-entitlement/password-reset-code.env\n' > /etc/systemd/system/account-entitlement.service.d/password-reset-code.conf
cd "$account_root"
set -a; source .env; source /opt/account-entitlement/password-reset-code.env; set +a
"$account_root/.venv/bin/python" -c 'from password_reset import prepare_schema; prepare_schema()'
systemctl daemon-reload
systemctl restart account-entitlement
for i in $(seq 1 20); do
 if curl -fsS http://127.0.0.1:8088/v1/health > /tmp/password-code-account-health.json; then
  trap - ERR
  echo ACCOUNT_PASSWORD_CODE_DEPLOY_OK
  exit 0
 fi
 sleep 1
done
false
