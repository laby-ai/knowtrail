"""Server-owned prices and exactly-once fulfillment isolated from legacy wallets."""
import json
import os
import uuid
from datetime import datetime, timedelta
from db import connect
from lingbi_catalog import product, utcnow, month_after, VERSION
from lingbi_store import locked, scoped_key, uid, batch, event


def readiness():
    blockers = []
    try:
        started = datetime.fromisoformat(os.getenv("LINGBI_COST_OBSERVATION_STARTED_AT", ""))
        if utcnow() - started < timedelta(days=7):
            blockers.append("成本采集尚未满 7 天")
    except (ValueError, TypeError):
        blockers.append("尚未登记成本采集起始时间")
    for key, label in (("LINGBI_COST_AUDIT_PASSED", "成本对账未通过"), ("LINGBI_PAYMENT_AUDIT_PASSED", "真实支付及退款验收未通过"), ("LINGBI_STORAGE_AUDIT_PASSED", "套餐附件容量承载尚未验收")):
        if os.getenv(key) != "true":
            blockers.append(label)
    if os.getenv("LINGBI_COMMERCE_MODE", "observe") != "enforced":
        blockers.append("当前仅采集用量，不扣科研点数")
    return dict(mode=os.getenv("LINGBI_COMMERCE_MODE", "observe"), chargingReady=not blockers, blockers=blockers)


def create_order(tenant, member, account, data):
    if not readiness()["chargingReady"]:
        raise PermissionError("commercial_acceptance_pending")
    product_id = data.get("productId")
    sku = product(product_id)
    provider = data.get("provider")
    if provider not in ("alipay", "wechat", "bank"):
        raise ValueError("unsupported_payment_provider")
    key = scoped_key(member, data.get("idempotencyKey"))
    with locked(account, tenant, member, admin=True) as (conn, state):
        if (sku.get("plan") == "team" or sku["kind"] == "seat" or provider == "bank") and state["kind"] != "team":
            raise ValueError("team_account_required")
        if sku.get("plan") in ("research", "pro") and state["kind"] != "personal":
            raise ValueError("personal_account_required")
        if sku["kind"] == "seat" and (state["plan"] != "team" or not state["end"] or state["end"] <= utcnow().isoformat()):
            raise ValueError("active_team_subscription_required")
        old = conn.execute("SELECT * FROM lingbi_orders WHERE request_key=?", (key,)).fetchone()
        if old:
            detail = json.loads(old["data_json"])
            if old["account_id"] != account or detail["productId"] != product_id or detail["provider"] != provider:
                raise ValueError("idempotency_payload_conflict")
            return dict(id=old["id"], status=old["status"], amountFen=old["amount_fen"], **detail)
        if sku["kind"] == "subscription" and state["end"] and state["end"] > utcnow().isoformat() and state["plan"] != sku["plan"]:
            raise ValueError("active_plan_change_requires_prorated_upgrade")
        order_id = "lb" + uuid.uuid4().hex[:30]
        detail = dict(productId=product_id, provider=provider, sku=sku, version=VERSION, tenantId=tenant, expiresAt=(utcnow() + timedelta(minutes=30)).isoformat())
        conn.execute("INSERT INTO lingbi_orders(id,account_id,member_id,request_key,status,amount_fen,created_at,data_json) VALUES(?,?,?,?,?,?,?,?)", (order_id, account, member, key, "pending", sku["amount"], utcnow().isoformat(), json.dumps(detail)))
    return dict(id=order_id, status="pending", amountFen=sku["amount"], **detail)


def fulfill(order_id, *, provider, event_id, amount_fen):
    # Called only by a verified provider adapter or authenticated finance workflow.
    if type(amount_fen) != int or amount_fen < 1 or not isinstance(event_id, str) or not 1 <= len(event_id) <= 160:
        raise ValueError("invalid_payment_receipt")
    with connect() as conn:
        row = conn.execute("SELECT * FROM lingbi_orders WHERE id=?", (order_id,)).fetchone()
    if not row:
        raise ValueError("order_not_found")
    detail = json.loads(row["data_json"])
    with locked(row["account_id"], detail["tenantId"], row["member_id"], admin=True) as (conn, state):
        row = conn.execute("SELECT * FROM lingbi_orders WHERE id=?", (order_id,)).fetchone()
        if amount_fen != row["amount_fen"] or provider != detail["provider"]:
            raise ValueError("payment_amount_or_provider_mismatch")
        if row["status"] in ("paid", "refunding", "refunded"):
            if detail.get("providerEventId") != event_id:
                raise ValueError("payment_event_mismatch")
            return dict(status=row["status"])
        if row["status"] != "pending":
            raise ValueError("order_not_payable")
        event_key = "payment:" + provider + ":" + event_id
        duplicate = conn.execute("SELECT account_id FROM lingbi_events WHERE event_key=?", (event_key,)).fetchone()
        if duplicate:
            raise ValueError("provider_event_already_used")
        sku = detail["sku"]
        if sku["kind"] == "points":
            batch(state, sku["points"], "purchase", order=order_id, key="purchase:" + order_id)
        elif sku["kind"] == "subscription":
            now = utcnow()
            active = state["end"] and state["end"] > now.isoformat()
            if active and state["plan"] != sku["plan"]:
                raise ValueError("subscription_conflict_requires_refund_review")
            if active:
                start = datetime.fromisoformat(state["end"])
            else:
                start = now
                state.update(plan=sku["plan"], start=start.isoformat(), grantPeriods=[])
            previous_end = state["end"]
            state["end"] = month_after(start, sku["months"]).isoformat()
            state.setdefault("subscriptions", []).append(dict(order=order_id, start=start.isoformat(), end=state["end"]))
            detail.update(serviceStart=start.isoformat(), serviceEnd=state["end"], previousEnd=previous_end)
        else:
            state["seats"].append(dict(order=order_id, end=month_after(utcnow(), sku["months"]).isoformat()))
        detail.update(paidAt=utcnow().isoformat(), providerEventId=event_id)
        conn.execute("UPDATE lingbi_orders SET status='paid',data_json=? WHERE id=?", (json.dumps(detail), order_id))
        event(conn, row["account_id"], row["member_id"], event_key, dict(type="payment", orderId=order_id, amountFen=amount_fen, productId=detail["productId"]))
    return dict(status="paid")


def invoice_request(tenant, member, account, order_id, data):
    with locked(account, tenant, member, admin=True) as (conn, _):
        row = conn.execute("SELECT * FROM lingbi_orders WHERE id=? AND account_id=? AND status='paid'", (order_id, account)).fetchone()
        if not row:
            raise ValueError("paid_order_required")
        title = str(data.get("title", "")).strip()
        tax_id = str(data.get("taxId", "")).strip()
        if not 1 <= len(title) <= 160 or len(tax_id) > 40:
            raise ValueError("invalid_invoice_details")
        detail = json.loads(row["data_json"])
        if detail.get("invoice", {}).get("status") == "issued":
            raise ValueError("invoice_already_issued")
        detail["invoice"] = dict(status="requested", title=title, taxId=tax_id, requestedAt=utcnow().isoformat())
        conn.execute("UPDATE lingbi_orders SET data_json=? WHERE id=?", (json.dumps(detail), order_id))
    return dict(status="requested")


def refund_review(tenant, member, account, order_id):
    with locked(account, tenant, member, admin=True) as (conn, state):
        row = conn.execute("SELECT * FROM lingbi_orders WHERE id=? AND account_id=? AND status='paid'", (order_id, account)).fetchone()
        if not row:
            raise ValueError("paid_order_required")
        detail = json.loads(row["data_json"])
        purchased = [item for item in state["batches"] if item.get("order") == order_id]
        refundable = sum(item["points"] - item["spent"] - item["held"] for item in purchased)
        # Finance confirmation required; never mark a refund completed before provider confirmation.
        detail["refund"] = dict(status="review_requested", unconsumedPoints=refundable, requestedAt=utcnow().isoformat())
        conn.execute("UPDATE lingbi_orders SET data_json=? WHERE id=?", (json.dumps(detail), order_id))
        event(conn, account, member, order_id + ":refund-review", dict(type="refund_review", orderId=order_id, unconsumedPoints=refundable))
    return detail["refund"]
