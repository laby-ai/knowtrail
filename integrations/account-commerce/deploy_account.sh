set -euo pipefail
root=$(readlink -f /opt/account-entitlement/account-system-new)
case "$root" in /opt/account-entitlement/releases/*) ;; *) exit 1 ;; esac
release=/opt/knowtrail/releases/lingbi-commerce-20261013
backup=/opt/account-entitlement/commerce-backup-20261013
test ! -e "$backup"
mkdir -m 700 "$backup"
cp "$root/server.py" "$root/server_self_recharge.py" "$backup/"
cp "$release/integrations/account-commerce/"lingbi_*.py "$root/"
python=$root/.venv/bin/python
test -x "$python"
"$python" "$release/integrations/account-commerce/apply_account.py" "$root"
"$python" -m py_compile "$root/"lingbi_*.py "$root/server.py"
mkdir -p /etc/systemd/system/account-entitlement.service.d
printf '[Service]\nEnvironmentFile=/opt/account-entitlement/lingbi-commerce.env\n' > /etc/systemd/system/account-entitlement.service.d/lingbi-commerce.conf
systemctl daemon-reload
systemctl restart account-entitlement
for attempt in $(seq 1 20); do
  if curl -fsS http://127.0.0.1:8088/v1/lingbi/catalog > /tmp/commerce-account-health.json; then echo ACCOUNT_COMMERCE_READY; exit 0; fi
  sleep 1
done
cp "$backup/server.py" "$backup/server_self_recharge.py" "$root/"
rm -f /etc/systemd/system/account-entitlement.service.d/lingbi-commerce.conf
systemctl daemon-reload
systemctl restart account-entitlement
exit 1
