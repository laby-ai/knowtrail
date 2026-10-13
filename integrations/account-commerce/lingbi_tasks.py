"""Quote-bound reservations and settlement; provider quantities never come from browsers."""
import json
import math
import os
from decimal import Decimal, ROUND_CEILING
from datetime import timedelta
from db import connect
from lingbi_catalog import FEES, PREMIUM, UNPRICED, VERSION, PLANS, utcnow
from lingbi_store import active_plan, locked, scoped_key, uid, event


def rates():
    value = json.loads(os.getenv("LINGBI_PRICE_BOOK_JSON", "{}"))
    if not isinstance(value, dict):
        raise ValueError("invalid_price_book")
    return value


def model_points(resources, price_book):
    cost = Decimal(0)
    for resource in resources:
        if resource.get("source") == "byok":
            continue
        price = price_book.get(resource["rateKey"])
        if not price:
            raise ValueError("model_not_priced")
        cached = resource.get("cachedInputTokens", 0)
        if type(cached) != int or not 0 <= cached <= resource.get("inputTokens", 0):
            raise ValueError("invalid_cached_usage")
        if cached:
            if "cachedInputPerMillionCny" not in price:
                raise ValueError("cached_input_not_priced")
            cost += Decimal(str(price["cachedInputPerMillionCny"])) * cached / 1000000
        for quantity, price_name in (("inputTokens", "inputPerMillionCny"), ("outputTokens", "outputPerMillionCny"), ("images", "imageCny"), ("queries", "queryCny")):
            count = resource.get(quantity, 0)
            if type(count) != int or not 0 <= count <= 10000000:
                raise ValueError("invalid_provider_quantity")
            if count:
                if price_name not in price:
                    raise ValueError("missing_quantity_price")
                unit = Decimal(str(price[price_name]))
                if not unit.is_finite() or unit < 0:
                    raise ValueError("invalid_price")
                cost += unit * (count - cached if quantity == "inputTokens" else count) / (1000000 if "Tokens" in quantity else 1)
    return int((cost * 300).to_integral_value(rounding=ROUND_CEILING))


def quote(tenant, member, account, data):
    operation = data.get("operation")
    if operation in UNPRICED or operation not in FEES:
        raise ValueError("operation_not_priced")
    resources = data.get("resources", [])
    if not isinstance(resources, list) or not 1 <= len(resources) <= 100:
        raise ValueError("invalid_resources")
    price_book = rates()
    maximum = FEES[operation] + model_points(resources, price_book)
    digest = data.get("inputHash", "")
    if len(digest) != 64 or any(c not in "0123456789abcdef" for c in digest):
        raise ValueError("invalid_input_hash")
    key = scoped_key(member, data.get("idempotencyKey"))
    with locked(account, tenant, member) as (conn, state):
        if operation in PREMIUM and active_plan(state) == "free":
            raise PermissionError("paid_membership_required")
        old = conn.execute("SELECT * FROM lingbi_tasks WHERE request_key=?", (key,)).fetchone()
        if old:
            item = json.loads(old["data_json"])
            if old["account_id"] != account or item["inputHash"] != digest or item["operation"] != operation or item["resources"] != resources:
                raise ValueError("idempotency_payload_conflict")
            return dict(id=old["id"], **item)
        record = dict(operation=operation, inputHash=digest, resources=resources, priceBook=price_book, version=VERSION,
                      maxPoints=maximum, expiresAt=(utcnow() + timedelta(minutes=5)).isoformat(), allocations=[], settledPoints=0)
        task_id = uid("quote")
        conn.execute("INSERT INTO lingbi_tasks(id,account_id,member_id,request_key,status,created_at,data_json) VALUES(?,?,?,?,?,?,?)", (task_id, account, member, key, "quoted", utcnow().isoformat(), json.dumps(record)))
    return dict(id=task_id, **record)


def task(conn, task_id, account, member):
    row = conn.execute("SELECT * FROM lingbi_tasks WHERE id=? AND account_id=? AND member_id=?", (task_id, account, member)).fetchone()
    if not row:
        raise PermissionError("task_not_accessible")
    return row, json.loads(row["data_json"])


def save_task(conn, task_id, status, data):
    conn.execute("UPDATE lingbi_tasks SET status=?,data_json=? WHERE id=?", (status, json.dumps(data), task_id))


def reserve(tenant, member, account, task_id, digest, operation=None, source=None):
    if os.getenv("LINGBI_COMMERCE_MODE", "observe") != "enforced":
        raise PermissionError("charging_not_enabled")
    with locked(account, tenant, member) as (conn, state):
        row, data = task(conn, task_id, account, member)
        if data["inputHash"] != digest:
            raise ValueError("quote_payload_changed")
        if (operation and data["operation"] != operation) or (source and not any(item["source"] == source for item in data["resources"])):
            raise ValueError("quote_operation_or_source_mismatch")
        if row["status"] != "quoted":
            raise ValueError("quote_already_consumed")
        if data["expiresAt"] <= utcnow().isoformat():
            raise ValueError("quote_expired")
        plan = active_plan(state)
        if state["kind"] == "team":
            if plan != "team":
                raise PermissionError("active_team_subscription_required")
            seats = PLANS[plan]["seats"] + sum(1 for item in state["seats"] if item["end"] > utcnow().isoformat())
            members = [state["owner"]] + [item for item in state["members"] if item != state["owner"]]
            if members.index(member) >= seats:
                raise PermissionError("active_team_seat_required")
        if data["operation"] in PREMIUM and plan == "free":
            raise PermissionError("paid_membership_required")
        running = conn.execute("SELECT COUNT(*) AS count FROM lingbi_tasks WHERE account_id=? AND status IN ('reserved','reconcile')", (account,)).fetchone()["count"]
        if running >= PLANS[plan]["concurrent"]:
            raise ValueError("concurrency_limit")
        month = utcnow().isoformat()[:7]
        used = 0
        for item in conn.execute("SELECT status,data_json,created_at FROM lingbi_tasks WHERE account_id=? AND member_id=? AND created_at>=?", (account, member, month)).fetchall():
            detail = json.loads(item["data_json"])
            used += detail["maxPoints"] if item["status"] in ("reserved", "reconcile") else detail["settledPoints"]
        if member in state["budgets"] and used + data["maxPoints"] > state["budgets"][member]:
            raise ValueError("member_budget_exceeded")
        remaining = data["maxPoints"]
        for item in sorted(state["batches"], key=lambda item: item["expires"] or "9999"):
            if item["expires"] and item["expires"] <= utcnow().isoformat():
                continue
            amount = min(remaining, item["points"] - item["spent"] - item["held"])
            if amount > 0:
                item["held"] += amount
                data["allocations"].append(dict(batch=item["id"], points=amount))
                remaining -= amount
        if remaining:
            raise ValueError("insufficient_research_points")
        save_task(conn, task_id, "reserved", data)
        event(conn, account, member, task_id + ":reserved", dict(type="reserved", points=data["maxPoints"], taskId=task_id))
    return data


def finalize(tenant, member, account, task_id, usage, delivered, *, reliable=True):
    with locked(account, tenant, member, internal=True) as (conn, state):
        row, data = task(conn, task_id, account, member)
        if row["status"] in ("settled", "released"):
            return dict(status=row["status"], points=data["settledPoints"])
        if row["status"] not in ("reserved", "reconcile"):
            raise ValueError("task_not_reserved")
        if type(delivered) != int or delivered < 0:
            raise ValueError("invalid_delivery_count")
        if not reliable and delivered:
            save_task(conn, task_id, "reconcile", {**data, "usage": usage, "delivered": delivered})
            return dict(status="reconcile", points=None)
        fee = FEES[data["operation"]] if delivered else 0
        total = fee + model_points(usage, data["priceBook"]) if delivered else 0
        if total > data["maxPoints"]:
            save_task(conn, task_id, "reconcile", {**data, "usage": usage, "delivered": delivered, "reason": "quote_ceiling_exceeded"})
            return dict(status="reconcile", points=None)
        remaining = total
        for allocation in data["allocations"]:
            item = next(item for item in state["batches"] if item["id"] == allocation["batch"])
            spent = min(remaining, allocation["points"])
            item["held"] -= allocation["points"]
            item["spent"] += spent
            remaining -= spent
        data.update(settledPoints=total, usage=usage, delivered=delivered)
        status = "settled" if delivered else "released"
        save_task(conn, task_id, status, data)
        event(conn, account, member, task_id + ":final", dict(type=status, points=total, released=data["maxPoints"] - total, taskId=task_id, operation=data["operation"]))
    return dict(status=status, points=total)


def record_usage(tenant, member, account, data):
    # Strict allow-list: never persist prompts, documents, tokens or API keys.
    safe = {key: data.get(key) for key in ("operation", "resources", "delivered", "reliable", "durationMs", "outcome", "requestId")}
    if not isinstance(safe["resources"], list) or len(safe["resources"]) > 100:
        raise ValueError("invalid_usage")
    allowed = {"rateKey", "source", "inputTokens", "outputTokens", "cachedInputTokens", "images", "queries", "usageMissing", "retry", "status"}
    safe["resources"] = [{key: value for key, value in item.items() if key in allowed} for item in safe["resources"]]
    try:
        safe["modelPoints"] = model_points(safe["resources"], rates()) if safe["reliable"] else None
    except ValueError:
        safe["modelPoints"] = None
    if (tenant, member, account) == ("anonymous", "anonymous", "anonymous-platform"):
        with connect() as conn:
            conn.execute("INSERT INTO lingbi_usage(id,account_id,member_id,created_at,data_json) VALUES(?,?,?,?,?) ON CONFLICT(id) DO NOTHING", (safe["requestId"], account, member, utcnow().isoformat(), json.dumps(safe)))
    else:
        with locked(account, tenant, member, internal=True) as (conn, _):
            conn.execute("INSERT INTO lingbi_usage(id,account_id,member_id,created_at,data_json) VALUES(?,?,?,?,?) ON CONFLICT(id) DO NOTHING", (safe["requestId"], account, member, utcnow().isoformat(), json.dumps(safe)))
    return dict(status="recorded")
