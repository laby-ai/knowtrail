"""Install explicit commerce hooks without replacing the account service."""
from pathlib import Path
import sys

root = Path(sys.argv[1])
server = root / "server.py"
source = server.read_text(encoding="utf-8")
if "from lingbi_http import dispatch as lingbi_dispatch" not in source:
    source = source.replace("    def do_GET(self) -> None:\n", "    def do_GET(self) -> None:\n        if lingbi_dispatch(self, 'GET'): return\n", 1)
    source = source.replace("    def do_POST(self) -> None:\n", "    def do_POST(self) -> None:\n        if lingbi_payment_callback(self): return\n        if lingbi_dispatch(self, 'POST'): return\n", 1)
    # Module imports must follow any future import. The insertion point is stable.
    position = source.index("\nclass Handler(")
    source = source[:position] + "\nfrom lingbi_http import dispatch as lingbi_dispatch\nfrom lingbi_payments import dispatch_callback as lingbi_payment_callback\nfrom lingbi_store import migrate as lingbi_migrate\n" + source[position:]
    if "    init_db()\n" not in source:
        raise RuntimeError("account_init_anchor_not_found")
    source = source.replace("    init_db()\n", "    init_db()\n    lingbi_migrate()\n", 1)
    # Keep legacy asset units; only correct identity and display arithmetic.
    for start_name, end_name in (("_handle_member_get", "_handle_member_recharge"), ("_handle_member_recharge", "do_GET")):
        start = source.index("    def " + start_name + "(")
        end = source.index("    def " + end_name + "(", start + 1)
        block = source[start:end].replace("self._require_member_session(member_id)", "self._require_member_session(member_id)\n        with connect() as identity_conn:\n            identity_row = identity_conn.execute('SELECT tenant_id FROM tenant_members WHERE id=?', (member_id,)).fetchone()\n            if not identity_row: raise AuthError(403, 'member_access_denied')\n            current_tenant_id = identity_row['tenant_id']", 1)
        block = block.replace('"tenant_acme"', "current_tenant_id")
        source = source[:start] + block + source[end:]
    server.write_text(source, encoding="utf-8")

wallet = root / "server_self_recharge.py"
text = wallet.read_text(encoding="utf-8")
text = text.replace('"enterprise_quota": allocated,', '"enterprise_quota": max(0, allocated - self_allocated),')
text = text.replace('"remaining": allocated + self_allocated - consumed - reserved', '"remaining": allocated - consumed - reserved')
wallet.write_text(text, encoding="utf-8")
print("ACCOUNT_COMMERCE_HOOKS_READY")
