"""Isolated asset-account regression; no production users, payments or emails."""
import atexit
import concurrent.futures
import json
import os
import sqlite3
import sys
import tempfile
import types
import unittest
from pathlib import Path
from datetime import timedelta
from unittest.mock import patch

scratch = tempfile.TemporaryDirectory()
database = Path(scratch.name) / "test.sqlite3"
os.environ.update(LINGBI_COMMERCE_MODE="enforced", LINGBI_COST_OBSERVATION_STARTED_AT="2026-01-01T00:00:00+00:00", LINGBI_COST_AUDIT_PASSED="true", LINGBI_PAYMENT_AUDIT_PASSED="true", LINGBI_STORAGE_AUDIT_PASSED="true", LINGBI_COMMERCE_INTERNAL_SECRET="isolated-test-secret-only-do-not-deploy-12345", LINGBI_PRICE_BOOK_JSON=json.dumps({"fixture:model": {"inputPerMillionCny": 1, "outputPerMillionCny": 2, "imageCny": 1}, "fixture:search": {"queryCny": 0.01}}))

class TestConnection(sqlite3.Connection):
    def __exit__(self, *args):
        result = super().__exit__(*args)
        self.close()
        return result

postgres_url = os.getenv("COMMERCE_TEST_DATABASE_URL")
schema = None
if postgres_url:
    import psycopg
    from psycopg import sql
    from psycopg.rows import dict_row
    import uuid
    schema = "lingbi_commerce_qa_" + uuid.uuid4().hex[:12]
    setup = psycopg.connect(postgres_url, autocommit=True)
    setup.execute(sql.SQL("CREATE SCHEMA {}").format(sql.Identifier(schema)))
    def cleanup():
        setup.execute(sql.SQL("DROP SCHEMA {} CASCADE").format(sql.Identifier(schema)))
        setup.close()
    atexit.register(cleanup)

class PostgresTestConnection:
    def __init__(self):
        self.conn = psycopg.connect(postgres_url, row_factory=dict_row)
        self.conn.execute(sql.SQL("SET search_path TO {}").format(sql.Identifier(schema)))
        assert self.conn.execute("SELECT current_schema() AS name").fetchone()["name"] == schema
    def __enter__(self): return self
    def __exit__(self, exc_type, exc, tb):
        self.conn.rollback() if exc_type else self.conn.commit()
        self.conn.close()
    def execute(self, query, args=()): return self.conn.execute(query.replace("?", "%s"), args)
    def executescript(self, script):
        for statement in script.split(";"):
            if statement.strip(): self.execute(statement)
    def executemany(self, query, values):
        with self.conn.cursor() as cursor: cursor.executemany(query.replace("?", "%s"), values)

def connect():
    if postgres_url: return PostgresTestConnection()
    connection = sqlite3.connect(database, timeout=30, factory=TestConnection)
    connection.row_factory = sqlite3.Row
    return connection

sys.modules["db"] = types.SimpleNamespace(connect=connect)
sys.modules["config"] = types.SimpleNamespace(DB_ENGINE="postgres" if postgres_url else "sqlite")
sys.modules["auth"] = types.SimpleNamespace(AuthError=Exception, local_session_from_headers=lambda _: None)
import lingbi_catalog as policy
import lingbi_store as store
import lingbi_accounts as accounts
import lingbi_orders as orders
import lingbi_tasks as tasks
import lingbi_verification as verification
import lingbi_capacity as capacity
import lingbi_finance as finance


class CommerceTests(unittest.TestCase):
    def setUp(self):
        if postgres_url:
            with connect() as conn:
                conn.execute("DROP TABLE IF EXISTS lingbi_accounts,lingbi_events,lingbi_orders,lingbi_tasks,lingbi_usage,lingbi_email_codes,lingbi_verified_emails,tenant_members")
        else:
            database.unlink(missing_ok=True)
        store.migrate()
        with connect() as conn:
            conn.execute("CREATE TABLE tenant_members(id TEXT PRIMARY KEY,tenant_id TEXT,email TEXT,status TEXT,display_name TEXT)")
            conn.executemany("INSERT INTO tenant_members VALUES(?,?,?,?,?)", [("owner", "org", "owner@example.invalid", "active", "Owner fixture"), ("reader", "org", "reader@example.invalid", "active", "Reader fixture"), ("outsider", "other", "foreign@example.invalid", "active", "Foreign fixture")])
        self.account = store.ensure_personal("org", "owner")
        with store.locked(self.account, "org", "owner") as (_, state):
            store.batch(state, 10000, "purchase")

    def quotation(self, account=None, member="owner", operation="chat", key="quote-0001", **extra):
        data = dict(operation=operation, inputHash="a" * 64, idempotencyKey=key, resources=[dict(rateKey="fixture:model", source="platform", inputTokens=10000, outputTokens=1000)])
        data.update(extra)
        return tasks.quote("org", member, account or self.account, data)

    def test_prices_gate_and_legacy_asset(self):
        self.assertEqual(policy.product("pro.annual")["amount"], 79000)
        self.assertEqual(policy.product("points.20")["points"], 2000)
        self.assertTrue(orders.readiness()["chargingReady"])
        with patch.dict(os.environ, LINGBI_COMMERCE_MODE="observe"):
            self.assertFalse(orders.readiness()["chargingReady"])
            with self.assertRaises(PermissionError): orders.create_order("org", "owner", self.account, dict(productId="points.20", provider="alipay", idempotencyKey="order-001"))

    def test_order_server_price_and_exactly_once(self):
        order = orders.create_order("org", "owner", self.account, dict(productId="points.20", provider="alipay", amountFen=1, points=99999999, idempotencyKey="order-001"))
        self.assertEqual(order["amountFen"], 2000)
        with self.assertRaises(ValueError): orders.fulfill(order["id"], provider="alipay", event_id="event", amount_fen=1)
        for _ in range(2): orders.fulfill(order["id"], provider="alipay", event_id="event", amount_fen=2000)
        self.assertEqual(accounts.summary("org", "owner")["balance"]["purchased"], 12000)

    def test_quote_binding_expiry_and_idempotency(self):
        item = self.quotation()
        self.assertEqual(item["id"], self.quotation()["id"])
        with self.assertRaises(ValueError): tasks.reserve("org", "owner", self.account, item["id"], "b" * 64)
        with self.assertRaises(ValueError): self.quotation(inputHash="b" * 64)
        with patch.object(tasks, "utcnow", return_value=policy.utcnow() + timedelta(minutes=6)):
            with self.assertRaises(ValueError): tasks.reserve("org", "owner", self.account, item["id"], "a" * 64)

    def test_settlement_and_missing_usage_holds(self):
        item = self.quotation()
        tasks.reserve("org", "owner", self.account, item["id"], "a" * 64)
        pending = tasks.finalize("org", "owner", self.account, item["id"], [], 1, reliable=False)
        self.assertEqual(pending["status"], "reconcile")
        self.assertGreater(accounts.summary("org", "owner")["balance"]["reserved"], 0)
        usage = [dict(rateKey="fixture:model", source="platform", inputTokens=1000, outputTokens=100)]
        done = tasks.finalize("org", "owner", self.account, item["id"], usage, 1)
        self.assertEqual(done["points"], 3)
        self.assertEqual(tasks.finalize("org", "owner", self.account, item["id"], usage, 1), done)
        self.assertEqual(accounts.summary("org", "owner")["balance"]["reserved"], 0)

    def test_ceiling_and_failure_release(self):
        item = self.quotation()
        tasks.reserve("org", "owner", self.account, item["id"], "a" * 64)
        result = tasks.finalize("org", "owner", self.account, item["id"], [dict(rateKey="fixture:model", source="platform", images=100)], 100)
        self.assertEqual(result["status"], "reconcile")
        released = tasks.finalize("org", "owner", self.account, item["id"], [], 0)
        self.assertEqual(released["points"], 0)

    def test_byok_and_unknown_rates(self):
        self.assertEqual(tasks.model_points([dict(rateKey="unknown", source="byok", images=5)], {}), 0)
        with self.assertRaises(ValueError): tasks.model_points([dict(rateKey="unknown", source="platform", images=1)], {})
        with self.assertRaises(ValueError): tasks.model_points([dict(rateKey="fixture:model", source="platform", inputTokens=-1)], tasks.rates())

    def test_cross_account_and_concurrent_balance(self):
        with self.assertRaises(PermissionError): accounts.summary("other", "outsider", self.account)
        with store.locked(self.account, "org", "owner") as (_, state):
            state["batches"][0]["points"] = 6
            state["plan"], state["start"], state["end"] = "pro", policy.utcnow().isoformat(), (policy.utcnow() + timedelta(days=1)).isoformat()
            state["grantPeriods"] = [state["start"]]
        quotes = [self.quotation(key=f"concurrent-{index}") for index in range(4)]
        def claim(item):
            try: tasks.reserve("org", "owner", self.account, item["id"], "a" * 64); return True
            except ValueError: return False
        with concurrent.futures.ThreadPoolExecutor(max_workers=4) as executor:
            results = list(executor.map(claim, quotes))
        self.assertEqual(sum(results), 1)

    def test_team_budget_visibility_and_revoke(self):
        team = accounts.create_team("org", "owner", "Fixture group")["accountId"]
        with store.locked(team, "org", "owner") as (_, state):
            state.update(plan="team", start=policy.utcnow().isoformat(), end=(policy.utcnow() + timedelta(days=30)).isoformat())
        accounts.update_team("org", "owner", team, dict(email="reader@example.invalid", action="add"))
        accounts.update_team("org", "owner", team, dict(email="reader@example.invalid", action="budget", points=0))
        item = self.quotation(team, "reader", key="reader-quote")
        with self.assertRaises(ValueError): tasks.reserve("org", "reader", team, item["id"], "a" * 64)
        self.assertIsNone(accounts.summary("org", "reader", team)["members"])
        accounts.update_team("org", "owner", team, dict(email="reader@example.invalid", action="remove"))
        with self.assertRaises(PermissionError): tasks.reserve("org", "reader", team, item["id"], "a" * 64)

    def test_monthly_grants_and_expired_subscription(self):
        order = orders.create_order("org", "owner", self.account, dict(productId="pro.annual", provider="alipay", idempotencyKey="annual-001"))
        orders.fulfill(order["id"], provider="alipay", event_id="annual-payment", amount_fen=79000)
        self.assertEqual(accounts.summary("org", "owner")["balance"]["gifted"], 2500)
        self.assertEqual(accounts.summary("org", "owner")["balance"]["gifted"], 2500)
        with store.locked(self.account, "org", "owner") as (_, state): state["end"] = (policy.utcnow() - timedelta(days=1)).isoformat()
        self.assertEqual(accounts.summary("org", "owner")["plan"], "free")

    def test_email_verification_and_five_attempts(self):
        with patch.object(verification, "send_code") as sender:
            verification.request_code("org", "owner", "owner@example.invalid")
            code = sender.call_args.args[1]
            verification.confirm("org", "owner", "owner@example.invalid", code)
        self.assertEqual(accounts.summary("org", "owner")["balance"]["gifted"], 100)
        with self.assertRaises(ValueError): verification.confirm("org", "owner", "owner@example.invalid", code)

    def test_five_wrong_verification_attempts_commit(self):
        with patch.object(verification, "send_code") as sender:
            verification.request_code("org", "owner", "owner@example.invalid")
            correct = sender.call_args.args[1]
        wrong = "000000" if correct != "000000" else "111111"
        for _ in range(5):
            with self.assertRaises(ValueError): verification.confirm("org", "owner", "owner@example.invalid", wrong)
        with self.assertRaises(ValueError): verification.confirm("org", "owner", "owner@example.invalid", correct)
        self.assertEqual(accounts.summary("org", "owner")["balance"]["gifted"], 0)

    def test_capacity_lease_prevents_parallel_overflow(self):
        request = dict(action="reserve", usedBytes=0, usedNotebooks=0, addBytes=600000000, addNotebooks=1)
        first = capacity.capacity("org", "owner", self.account, request)
        with self.assertRaises(ValueError): capacity.capacity("org", "owner", self.account, request)
        capacity.capacity("org", "owner", self.account, dict(action="release", leaseId=first["leaseId"]))
        self.assertIn("leaseId", capacity.capacity("org", "owner", self.account, request))

    def test_refund_traces_purchase_and_freezes_original_batch(self):
        order = orders.create_order("org", "owner", self.account, dict(productId="points.20", provider="alipay", idempotencyKey="refund-001"))
        orders.fulfill(order["id"], provider="alipay", event_id="paid-refund", amount_fen=2000)
        orders.refund_review("org", "owner", self.account, order["id"])
        refund = finance.prepare_refund(order["id"])
        self.assertEqual(refund["amountFen"], 2000)
        self.assertEqual(accounts.summary("org", "owner")["balance"]["purchased"], 10000)
        with self.assertRaises(ValueError): finance.finish_refund(order["id"], provider_refund_id="fixture-refund", amount_fen=1)
        finance.finish_refund(order["id"], provider_refund_id="fixture-refund", amount_fen=2000)
        self.assertEqual(accounts.summary("org", "owner")["balance"]["purchased"], 10000)
        self.assertEqual(finance.finish_refund(order["id"], provider_refund_id="fixture-refund", amount_fen=2000)["status"], "refunded")

    def test_annual_grants_once_each_service_month(self):
        order = orders.create_order("org", "owner", self.account, dict(productId="pro.annual", provider="alipay", idempotencyKey="grant-001"))
        orders.fulfill(order["id"], provider="alipay", event_id="grant-payment", amount_fen=79000)
        accounts.summary("org", "owner")
        with store.locked(self.account, "org", "owner") as (_, state):
            next_month = policy.month_after(__import__("datetime").datetime.fromisoformat(state["start"])) + timedelta(seconds=1)
        with patch.object(store, "utcnow", return_value=next_month):
            self.assertEqual(accounts.summary("org", "owner")["balance"]["gifted"], 2500)
            self.assertEqual(accounts.summary("org", "owner")["balance"]["gifted"], 2500)

    def test_month_end_manual_renewals_have_no_credit_gap(self):
        from datetime import datetime, timezone
        def at(month, day): return datetime(2026, month, day, 12, tzinfo=timezone.utc)
        for index, timestamp in enumerate((at(1, 31), at(2, 15), at(3, 15))):
            with patch.object(orders, "utcnow", return_value=timestamp), patch.object(store, "utcnow", return_value=timestamp):
                order = orders.create_order("org", "owner", self.account, dict(productId="research.monthly", provider="alipay", idempotencyKey=f"month-renew-{index}"))
                orders.fulfill(order["id"], provider="alipay", event_id=f"renew-receipt-{index}", amount_fen=3900)
                accounts.summary("org", "owner")
        with patch.object(store, "utcnow", return_value=at(3, 29)):
            self.assertEqual(accounts.summary("org", "owner")["balance"]["gifted"], 1000)


if __name__ == "__main__": unittest.main()
