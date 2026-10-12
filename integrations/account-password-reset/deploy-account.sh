set -euo pipefail
account_root=$(readlink -f /opt/account-entitlement/account-system-new)
case "$account_root" in /opt/account-entitlement/releases/*) ;; *) exit 1 ;; esac
backup=/opt/account-entitlement/password-reset-backup-20261012
mkdir -m 700 "$backup"
test ! -e "$account_root/password_reset.py"
test ! -e /etc/systemd/system/account-entitlement.service.d/password-reset.conf
cp "$account_root/auth.py" "$account_root/server.py" "$backup/"
printf '%s\n' "$account_root" > "$backup/source-root.txt"
rollback() {
 cp "$backup/auth.py" "$backup/server.py" "$account_root/"
 rm -f -- "$account_root/password_reset.py" /etc/systemd/system/account-entitlement.service.d/password-reset.conf
 systemctl daemon-reload
 systemctl restart account-entitlement
}
trap 'rollback' ERR
"$account_root/.venv/bin/python" /tmp/apply_patch.py "$account_root"
mkdir -p /etc/systemd/system/account-entitlement.service.d
printf '[Service]\nEnvironment="PASSWORD_RESET_PUBLIC_URL=https://airai.world/lingbi/account/reset-password/"\n' > /etc/systemd/system/account-entitlement.service.d/password-reset.conf
cd "$account_root"
set -a; source .env; set +a
"$account_root/.venv/bin/python" -c 'from password_reset import prepare_schema; prepare_schema()'
systemctl daemon-reload
systemctl restart account-entitlement
for i in $(seq 1 20); do
 if curl -fsS http://127.0.0.1:8088/v1/health > /tmp/password-reset-account-health.json; then
  trap - ERR
  echo ACCOUNT_PASSWORD_RESET_DEPLOY_OK
  exit 0
 fi
 sleep 1
done
false
