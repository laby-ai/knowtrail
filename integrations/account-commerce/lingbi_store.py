"""Account DB only: serialized asset accounts, immutable events and orders."""
import hashlib
import json
import uuid
from contextlib import contextmanager
from config import DB_ENGINE
from db import connect
from lingbi_catalog import PLANS, utcnow, month_after

SCHEMA = """
CREATE TABLE IF NOT EXISTS lingbi_accounts(id TEXT PRIMARY KEY,tenant_id TEXT NOT NULL,owner_id TEXT NOT NULL,kind TEXT NOT NULL,state_json TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS lingbi_events(id TEXT PRIMARY KEY,account_id TEXT NOT NULL,member_id TEXT NOT NULL,event_key TEXT NOT NULL UNIQUE,created_at TEXT NOT NULL,data_json TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS lingbi_orders(id TEXT PRIMARY KEY,account_id TEXT NOT NULL,member_id TEXT NOT NULL,request_key TEXT NOT NULL UNIQUE,status TEXT NOT NULL,amount_fen INTEGER NOT NULL,created_at TEXT NOT NULL,data_json TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS lingbi_tasks(id TEXT PRIMARY KEY,account_id TEXT NOT NULL,member_id TEXT NOT NULL,request_key TEXT NOT NULL UNIQUE,status TEXT NOT NULL,created_at TEXT NOT NULL,data_json TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS lingbi_usage(id TEXT PRIMARY KEY,account_id TEXT NOT NULL,member_id TEXT NOT NULL,created_at TEXT NOT NULL,data_json TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS lingbi_events_account ON lingbi_events(account_id,created_at);
CREATE INDEX IF NOT EXISTS lingbi_tasks_account ON lingbi_tasks(account_id,status);
CREATE INDEX IF NOT EXISTS lingbi_usage_account ON lingbi_usage(account_id,created_at);
"""


def migrate():
    with connect() as conn:
        conn.executescript(SCHEMA)


def uid(prefix):
    return prefix + "_" + uuid.uuid4().hex


def decode(row):
    return json.loads(row["state_json"])


def new_state(owner, kind):
    return dict(plan="free", start=None, end=None, grantPeriods=[], batches=[], members={owner: "admin"}, budgets={}, seats=[], verified=False, modelSource="platform", owner=owner, kind=kind)


def ensure_personal(tenant, member):
    account = "personal:" + tenant + ":" + member
    with connect() as conn:
        conn.execute("INSERT INTO lingbi_accounts(id,tenant_id,owner_id,kind,state_json) VALUES(?,?,?,?,?) ON CONFLICT(id) DO NOTHING", (account, tenant, member, "personal", json.dumps(new_state(member, "personal"))))
    return account


@contextmanager
def locked(account, tenant, member, *, admin=False, internal=False):
    with connect() as conn:
        if DB_ENGINE == "sqlite":
            conn.execute("BEGIN IMMEDIATE")
        row = conn.execute("SELECT * FROM lingbi_accounts WHERE id=? AND tenant_id=?" + (" FOR UPDATE" if DB_ENGINE == "postgres" else ""), (account, tenant)).fetchone()
        if not row:
            raise PermissionError("account_not_accessible")
        state = decode(row)
        role = state["members"].get(member)
        if not internal and (not role or (admin and role != "admin")):
            raise PermissionError("account_access_denied")
        previous_batches = {item["id"] for item in state["batches"]}
        refresh(state)
        for item in state["batches"]:
            if item["id"] not in previous_batches and item["source"] == "membership":
                event(conn, account, state["owner"], account + ":" + item["id"], dict(type="membership_grant", points=item["points"], expiresAt=item["expires"], orderId=item["order"]))
        yield conn, state
        conn.execute("UPDATE lingbi_accounts SET state_json=? WHERE id=?", (json.dumps(state), account))


def active_plan(state):
    return state["plan"] if state["end"] and state["end"] > utcnow().isoformat() else "free"


def batch(state, points, source, *, expires=None, order=None, key=None):
    if key and any(item["id"] == key for item in state["batches"]):
        return
    state["batches"].append(dict(id=key or uid("batch"), points=points, spent=0, held=0, expires=expires, source=source, order=order))


def refresh(state):
    if active_plan(state) == "free":
        return
    contracts = state.get("subscriptions") or [dict(start=state["start"], end=state["end"], order=None)]
    for contract in contracts:
        start = __import__("datetime").datetime.fromisoformat(contract["start"])
        for index in range(12):
            period = month_after(start, index)
            end = min(month_after(start, index + 1).isoformat(), contract["end"], state["end"])
            key = (contract["order"] + ":" + str(index)) if contract["order"] else period.isoformat()
            if period.isoformat() >= end or period > utcnow():
                break
            if key not in state["grantPeriods"]:
                batch(state, PLANS[state["plan"]]["points"], "membership", expires=end, order=contract["order"], key="grant:" + key)
                state["grantPeriods"].append(key)


def balance(state):
    current = utcnow().isoformat()
    usable = [item for item in state["batches"] if not item["expires"] or item["expires"] > current]
    return dict(purchased=sum(item["points"] - item["spent"] - item["held"] for item in usable if item["source"] == "purchase"),
                gifted=sum(item["points"] - item["spent"] - item["held"] for item in usable if item["source"] != "purchase"),
                reserved=sum(item["held"] for item in state["batches"]))


def event(conn, account, member, key, data):
    conn.execute("INSERT INTO lingbi_events(id,account_id,member_id,event_key,created_at,data_json) VALUES(?,?,?,?,?,?) ON CONFLICT(event_key) DO NOTHING", (uid("event"), account, member, key, utcnow().isoformat(), json.dumps(data)))


def scoped_key(member, key):
    if not isinstance(key, str) or not 8 <= len(key) <= 160:
        raise ValueError("invalid_idempotency_key")
    return hashlib.sha256((member + ":" + key).encode()).hexdigest()
