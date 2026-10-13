"""Explicit account-service extension; no unauthenticated balance mutation."""
import hashlib
import hmac
import json
import os
import time
from urllib.parse import urlparse, parse_qs
from auth import AuthError, local_session_from_headers
from db import connect
from lingbi_catalog import catalog
from lingbi_store import ensure_personal, migrate
from lingbi_accounts import summary, list_accounts, create_team, update_team, preference
from lingbi_orders import readiness, create_order, invoice_request, refund_review
from lingbi_tasks import quote, reserve, finalize, record_usage
from lingbi_verification import request_code, confirm


def identity(headers):
    session = local_session_from_headers(headers)
    if not session:
        raise AuthError(401, "account_login_required")
    member = session[0]
    with connect() as conn:
        row = conn.execute("SELECT tenant_id,email,status FROM tenant_members WHERE id=?", (member,)).fetchone()
    if not row or row["status"] != "active":
        raise AuthError(403, "active_member_required")
    return row["tenant_id"], member, row["email"]


def require_internal(handler):
    secret = os.getenv("LINGBI_COMMERCE_INTERNAL_SECRET", "")
    ts = handler.headers.get("X-Lingbi-Timestamp", "")
    signature = handler.headers.get("X-Lingbi-Signature", "")
    if len(secret) < 32 or not ts.isdigit() or abs(time.time() - int(ts)) > 60:
        raise AuthError(401, "commerce_signature_required")
    expected = hmac.new(secret.encode(), ts.encode() + b"." + handler._raw_body, hashlib.sha256).hexdigest()
    if not hmac.compare_digest(signature, expected):
        raise AuthError(401, "commerce_signature_invalid")


def dispatch(handler, method):
    parsed = urlparse(handler.path)
    prefix = "/v1/lingbi/"
    if not parsed.path.startswith(prefix):
        return False
    path = parsed.path[len(prefix):]
    try:
        if method == "GET" and path == "catalog":
            handler.send_json(200, {**catalog(), "readiness": readiness()})
            return True
        internal_data = None
        if path.startswith("internal/") and method == "POST":
            internal_data = handler.read_json()
            require_internal(handler)
            tenant, member = internal_data.get("tenantId"), internal_data.get("memberId")
            with connect() as conn:
                principal = conn.execute("SELECT email,status FROM tenant_members WHERE id=? AND tenant_id=?", (member, tenant)).fetchone()
            anonymous_usage = path == "internal/usage" and (tenant, member, internal_data.get("accountId")) == ("anonymous", "anonymous", "anonymous-platform")
            if not anonymous_usage and (not principal or (principal["status"] != "active" and path not in ("internal/finalize", "internal/usage"))):
                raise AuthError(403, "invalid_internal_member")
            email = principal["email"] if principal else ""
        else:
            tenant, member, email = identity(handler.headers)
        if method == "GET":
            args = parse_qs(parsed.query)
            account = args.get("accountId", [None])[0]
            if path == "membership":
                result = {**summary(tenant, member, account), "accounts": list_accounts(tenant, member), "readiness": readiness()}
            else:
                raise AuthError(404, "commerce_route_not_found")
        else:
            data = internal_data if internal_data is not None else handler.read_json()
            account = data.get("accountId") or ensure_personal(tenant, member)
            if path == "preferences":
                result = preference(tenant, member, data.get("modelSource"))
            elif path == "teams":
                result = create_team(tenant, member, data.get("name"))
            elif path == "team-members":
                result = update_team(tenant, member, account, data)
            elif path == "orders":
                result = create_order(tenant, member, account, data)
                from lingbi_payments import checkout
                result = {**result, **checkout(result)}
            elif path == "invoice":
                result = invoice_request(tenant, member, account, data.get("orderId"), data)
            elif path == "refund":
                result = refund_review(tenant, member, account, data.get("orderId"))
            elif path == "verify-email/request":
                result = request_code(tenant, member, email)
            elif path == "verify-email/confirm":
                result = confirm(tenant, member, email, data.get("code"))
            elif path == "internal/quote":
                result = quote(tenant, member, account, data)
            elif path == "internal/provider":
                from server_member_provider_keys import resolve_profile
                result = resolve_profile(connect, tenant, member, "knowtrail")
            elif path == "internal/capacity":
                from lingbi_capacity import capacity
                ensure_personal(tenant, member)
                result = capacity(tenant, member, account, data)
            elif path == "check-order":
                from lingbi_finance import original_order
                from lingbi_provider_operations import query_payment
                from lingbi_store import locked
                order, detail = original_order(data.get("orderId"))
                if detail["tenantId"] != tenant:
                    raise AuthError(403, "order_access_denied")
                with locked(order["account_id"], tenant, member, admin=True):
                    pass
                result = query_payment(data.get("orderId"))
            elif path == "internal/finance":
                allowed = os.getenv("LINGBI_FINANCE_MEMBER_IDS", "").split(",")
                if member not in allowed:
                    raise AuthError(403, "finance_operator_required")
                from lingbi_finance import original_order, issue_invoice, finish_refund
                from lingbi_orders import fulfill
                from lingbi_provider_operations import refund_payment
                order_id = data.get("orderId")
                order, detail = original_order(order_id)
                if detail["tenantId"] != tenant:
                    raise AuthError(403, "order_access_denied")
                action = data.get("action")
                if action == "refund":
                    result = refund_payment(order_id)
                elif action == "invoice":
                    result = issue_invoice(order_id, data.get("invoiceNumber"), data.get("fileUrl"))
                elif action == "bank-paid" and detail["provider"] == "bank":
                    result = fulfill(order_id, provider="bank", event_id=data.get("receiptId"), amount_fen=data.get("amountFen"))
                elif action == "bank-refunded" and detail["provider"] == "bank":
                    result = finish_refund(order_id, provider_refund_id=data.get("receiptId"), amount_fen=data.get("amountFen"))
                else:
                    raise ValueError("invalid_finance_action")
            elif path == "internal/reserve":
                if not readiness()["chargingReady"]:
                    raise AuthError(503, "commercial_acceptance_pending")
                result = reserve(tenant, member, account, data.get("quoteId"), data.get("inputHash"), data.get("operation"), data.get("source"))
            elif path == "internal/finalize":
                result = finalize(tenant, member, account, data.get("quoteId"), data.get("resources", []), data.get("delivered", 0), reliable=data.get("reliable", False))
            elif path == "internal/usage":
                result = record_usage(tenant, member, account, data)
            else:
                raise AuthError(404, "commerce_route_not_found")
        handler.send_json(200, result)
    except AuthError as error:
        handler.send_json(error.status, {"error": error.error})
    except PermissionError as error:
        handler.send_json(403, {"error": str(error)})
    except (ValueError, KeyError, TypeError) as error:
        handler.send_json(400, {"error": str(error) if isinstance(error, (ValueError, PermissionError)) else "invalid_commerce_request"})
    except Exception:
        handler.send_json(503, {"error": "commerce_service_unavailable"})
    return True
