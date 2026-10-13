"""Signed provider lookup/refund responses, never a client return-page claim."""
import base64
import json
import re
import urllib.request
from datetime import datetime
from decimal import Decimal
from urllib.parse import urlencode, quote
from lingbi_payments import clients, verify_wechat_signature
from lingbi_orders import fulfill
from lingbi_finance import original_order, prepare_refund, finish_refund


def alipay_call(client, method, biz):
    from cryptography.hazmat.primitives import hashes, serialization
    from cryptography.hazmat.primitives.asymmetric import padding
    params = dict(app_id=client.app_id, method=method, charset="utf-8", sign_type="RSA2", timestamp=datetime.now().strftime("%Y-%m-%d %H:%M:%S"), version="1.0", biz_content=json.dumps(biz, ensure_ascii=False))
    params["sign"] = client._sign(params)
    request = urllib.request.Request(client.GATEWAY, data=urlencode(params).encode(), headers={"Content-Type": "application/x-www-form-urlencoded"}, method="POST")
    with urllib.request.urlopen(request, timeout=15) as response:
        raw = response.read().decode()
    key = method.replace(".", "_") + "_response"
    marker = re.search('"' + re.escape(key) + '"\\s*:', raw)
    if not marker:
        raise ValueError("alipay_response_missing")
    start = marker.end()
    while raw[start].isspace(): start += 1
    result, length = json.JSONDecoder().raw_decode(raw[start:])
    envelope = json.loads(raw)
    signature = envelope.get("sign", "")
    public_key = serialization.load_pem_public_key(client.alipay_public_key.encode())
    public_key.verify(base64.b64decode(signature), raw[start:start + length].encode(), padding.PKCS1v15(), hashes.SHA256())
    return result


def wechat_call(client, path, body=None):
    raw = json.dumps(body).encode() if body is not None else b""
    method = "POST" if body is not None else "GET"
    request = urllib.request.Request("https://api.mch.weixin.qq.com" + path, data=raw if body is not None else None, headers={"Content-Type": "application/json", "Accept": "application/json", "Authorization": client._sign_request(method, path, raw)}, method=method)
    with urllib.request.urlopen(request, timeout=15) as response:
        data = response.read()
        verify_wechat_signature(data, response.headers)
    return json.loads(data)


def query_payment(order_id):
    row, detail = original_order(order_id)
    module = clients()
    if detail["provider"] == "alipay":
        client = module.get_alipay()
        data = alipay_call(client, "alipay.trade.query", dict(out_trade_no=order_id))
        if data.get("code") != "10000" or data.get("trade_status") not in ("TRADE_SUCCESS", "TRADE_FINISHED") or data.get("out_trade_no") != order_id:
            return dict(status="pending")
        amount = Decimal(str(data["total_amount"])) * 100
        if amount != amount.to_integral_value(): raise ValueError("invalid_payment_amount")
        return fulfill(order_id, provider="alipay", event_id=data["trade_no"], amount_fen=int(amount))
    if detail["provider"] == "wechat":
        client = module.get_wechat_pay()
        data = wechat_call(client, "/v3/pay/transactions/out-trade-no/" + quote(order_id) + "?mchid=" + quote(client.mch_id))
        if data.get("trade_state") != "SUCCESS": return dict(status="pending")
        if data.get("mchid") != client.mch_id or data.get("appid") != client.app_id or data.get("out_trade_no") != order_id or data.get("amount", {}).get("currency") != "CNY":
            raise ValueError("provider_payment_mismatch")
        return fulfill(order_id, provider="wechat", event_id=data["transaction_id"], amount_fen=data["amount"]["total"])
    return dict(status=row["status"], message="银行转账需要财务确认")


def refund_payment(order_id):
    refund = prepare_refund(order_id)
    if refund["status"] == "refunded": return dict(status="refunded")
    row, detail = original_order(order_id)
    module = clients()
    if detail["provider"] == "alipay":
        client = module.get_alipay()
        result = alipay_call(client, "alipay.trade.refund", dict(trade_no=detail["providerEventId"], refund_amount=f'{refund["amountFen"] / 100:.2f}', out_request_no=refund["refundId"]))
        if result.get("code") != "10000" or result.get("trade_no") != detail["providerEventId"] or Decimal(str(result.get("refund_fee", "-1"))) * 100 != refund["amountFen"]:
            raise ValueError("refund_response_unconfirmed")
        return finish_refund(order_id, provider_refund_id=refund["refundId"], amount_fen=refund["amountFen"])
    if detail["provider"] == "wechat":
        client = module.get_wechat_pay()
        result = wechat_call(client, "/v3/refund/domestic/refunds", dict(transaction_id=detail["providerEventId"], out_refund_no=refund["refundId"], amount=dict(refund=refund["amountFen"], total=row["amount_fen"], currency="CNY")))
        if result.get("status") != "SUCCESS": return dict(status="refunding")
        if result.get("out_refund_no") != refund["refundId"] or result.get("amount", {}).get("refund") != refund["amountFen"]:
            raise ValueError("refund_response_unconfirmed")
        return finish_refund(order_id, provider_refund_id=result["refund_id"], amount_fen=refund["amountFen"])
    return dict(status="refunding", message="银行退款需要财务转账凭据")
