"""Finance operations are signed, allow-listed and trace the original purchase."""
import json
from decimal import Decimal, ROUND_FLOOR
from datetime import datetime
from db import connect
from lingbi_catalog import utcnow
from lingbi_store import locked, event


def original_order(order_id):
    with connect() as conn:
        row = conn.execute("SELECT * FROM lingbi_orders WHERE id=?", (order_id,)).fetchone()
    if not row:
        raise ValueError("order_not_found")
    return row, json.loads(row["data_json"])


def prepare_refund(order_id):
    row, detail = original_order(order_id)
    with locked(row["account_id"], detail["tenantId"], row["member_id"], internal=True) as (conn, state):
        current = conn.execute("SELECT * FROM lingbi_orders WHERE id=?", (order_id,)).fetchone()
        detail = json.loads(current["data_json"])
        if current["status"] in ("refunding", "refunded"):
            return dict(orderId=order_id, status=current["status"], **detail["refund"])
        if current["status"] != "paid" or detail.get("refund", {}).get("status") != "review_requested":
            raise ValueError("refund_review_required")
        purchases = [item for item in state["batches"] if item.get("order") == order_id]
        if any(item["held"] for item in purchases):
            raise ValueError("refund_waits_for_running_tasks")
        sku = detail["sku"]
        if sku["kind"] == "points":
            points = sum(item["points"] - item["spent"] for item in purchases)
            amount = points  # One purchased research point equals one CNY fen.
        elif sku["kind"] == "subscription":
            start, end = datetime.fromisoformat(detail["serviceStart"]), datetime.fromisoformat(detail["serviceEnd"])
            if state["end"] != detail["serviceEnd"]:
                raise ValueError("later_renewal_requires_manual_proration")
            seconds = max(0, (end - max(start, utcnow())).total_seconds())
            prorated = Decimal(current["amount_fen"]) * Decimal(str(seconds)) / Decimal(str((end - start).total_seconds()))
            spent = sum(item["spent"] for item in purchases)
            amount = max(0, int(prorated.to_integral_value(rounding=ROUND_FLOOR)) - spent)
            points = sum(item["points"] - item["spent"] for item in purchases)
        else:
            seat = next((item for item in state["seats"] if item["order"] == order_id), None)
            if not seat:
                raise ValueError("seat_order_not_found")
            start, end = datetime.fromisoformat(detail["paidAt"]), datetime.fromisoformat(seat["end"])
            seconds = max(0, (end - utcnow()).total_seconds())
            amount = int((Decimal(current["amount_fen"]) * Decimal(str(seconds)) / Decimal(str((end - start).total_seconds()))).to_integral_value(rounding=ROUND_FLOOR))
            points = 0
        if amount <= 0:
            raise ValueError("no_refundable_amount")
        allocations = []
        for item in purchases:
            held = item["points"] - item["spent"]
            item["held"] += held
            allocations.append(dict(batch=item["id"], points=held))
        detail["refund"] = dict(status="processing", amountFen=amount, allocations=allocations, unconsumedPoints=points, refundId="lbrf" + order_id[2:28])
        conn.execute("UPDATE lingbi_orders SET status='refunding',data_json=? WHERE id=?", (json.dumps(detail), order_id))
    return dict(orderId=order_id, status="refunding", **detail["refund"])


def finish_refund(order_id, *, provider_refund_id, amount_fen):
    row, detail = original_order(order_id)
    with locked(row["account_id"], detail["tenantId"], row["member_id"], internal=True) as (conn, state):
        row = conn.execute("SELECT * FROM lingbi_orders WHERE id=?", (order_id,)).fetchone()
        detail = json.loads(row["data_json"])
        if row["status"] == "refunded":
            return dict(status="refunded")
        refund = detail.get("refund", {})
        if row["status"] != "refunding" or refund.get("amountFen") != amount_fen or not provider_refund_id:
            raise ValueError("refund_confirmation_mismatch")
        for allocation in refund["allocations"]:
            item = next(item for item in state["batches"] if item["id"] == allocation["batch"])
            item["held"] -= allocation["points"]
            item["spent"] += allocation["points"]
        if detail["sku"]["kind"] == "subscription":
            # The order must still be the last subscription extension.
            state["end"] = max(detail.get("previousEnd") or utcnow().isoformat(), utcnow().isoformat())
            for item in state.get("subscriptions", []):
                if item["order"] == order_id: item["end"] = utcnow().isoformat()
        elif detail["sku"]["kind"] == "seat":
            state["seats"] = [item for item in state["seats"] if item["order"] != order_id]
        detail["refund"].update(status="refunded", providerRefundId=provider_refund_id, completedAt=utcnow().isoformat())
        conn.execute("UPDATE lingbi_orders SET status='refunded',data_json=? WHERE id=?", (json.dumps(detail), order_id))
        event(conn, row["account_id"], row["member_id"], order_id + ":refunded", dict(type="refund", orderId=order_id, amountFen=amount_fen, providerRefundId=provider_refund_id))
    return dict(status="refunded")


def issue_invoice(order_id, number, file_url):
    if not isinstance(number, str) or not number.strip() or len(number) > 100 or not isinstance(file_url, str) or not file_url.startswith("https://"):
        raise ValueError("real_invoice_reference_required")
    row, detail = original_order(order_id)
    with locked(row["account_id"], detail["tenantId"], row["member_id"], internal=True) as (conn, _):
        row = conn.execute("SELECT * FROM lingbi_orders WHERE id=?", (order_id,)).fetchone()
        detail = json.loads(row["data_json"])
        if row["status"] != "paid" or detail.get("invoice", {}).get("status") != "requested":
            raise ValueError("invoice_request_required")
        detail["invoice"].update(status="issued", number=number, fileUrl=file_url)
        conn.execute("UPDATE lingbi_orders SET data_json=? WHERE id=?", (json.dumps(detail), order_id))
        event(conn, row["account_id"], row["member_id"], order_id + ":invoice", dict(type="invoice_issued", orderId=order_id, number=number))
    return dict(status="issued")
