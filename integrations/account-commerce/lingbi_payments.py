"""Provider adapters: validate merchant, signature, currency and server order amount."""
import base64
import copy
import json
import os
import time
import urllib.request
from decimal import Decimal
from urllib.parse import parse_qs
from lingbi_orders import fulfill


def clients():
    import sys
    module = sys.modules.get("__main__")
    if not module or not hasattr(module, "get_alipay"):
        raise ValueError("payment_adapter_not_available")
    return module


def public_callback(provider):
    base = os.getenv("LINGBI_PAYMENT_PUBLIC_BASE", "https://airai.world/lingbi/api/account/commerce/payment")
    if not base.startswith("https://"):
        raise ValueError("https_payment_callback_required")
    return base.rstrip("/") + "/" + provider


def verify_wechat_signature(body, headers):
    from cryptography.hazmat.primitives import hashes, serialization
    from cryptography.hazmat.primitives.asymmetric import padding
    serial = headers.get("Wechatpay-Serial", "")
    timestamp = headers.get("Wechatpay-Timestamp", "")
    nonce = headers.get("Wechatpay-Nonce", "")
    if not serial or serial != os.getenv("LINGBI_WECHAT_PUBLIC_KEY_ID") or not timestamp.isdigit() or abs(time.time() - int(timestamp)) > 300 or not nonce:
        raise ValueError("wechat_signature_invalid")
    key_file = os.getenv("LINGBI_WECHAT_PUBLIC_KEY_FILE", "")
    if not key_file:
        raise ValueError("wechat_verification_key_not_configured")
    with open(key_file, "rb") as stream:
        key = serialization.load_pem_public_key(stream.read())
    key.verify(base64.b64decode(headers.get("Wechatpay-Signature", "")), timestamp.encode() + b"\n" + nonce.encode() + b"\n" + body + b"\n", padding.PKCS1v15(), hashes.SHA256())


def qr_image(text):
    from qrcodegen import QrCode
    qr = QrCode.encode_text(text, QrCode.Ecc.MEDIUM)
    size = qr.get_size()
    path = " ".join(f"M{x+4},{y+4}h1v1h-1z" for y in range(size) for x in range(size) if qr.get_module(x, y))
    svg = f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {size+8} {size+8}"><rect width="100%" height="100%" fill="white"/><path d="{path}" fill="black"/></svg>'
    return "data:image/svg+xml;base64," + base64.b64encode(svg.encode()).decode()


def checkout(order):
    module = clients()
    provider = order["provider"]
    if provider == "bank":
        # Never fabricate bank details. Finance fills account details outside Git.
        bank = os.getenv("LINGBI_BANK_PAYMENT_INSTRUCTIONS", "")
        if not bank:
            raise ValueError("bank_payment_not_configured")
        return dict(bankInstructions=bank)
    client = copy.copy(module.get_alipay() if provider == "alipay" else module.get_wechat_pay())
    if not client.enabled:
        raise ValueError(provider + "_not_configured")
    client.notify_url = public_callback(provider)
    if provider == "alipay":
        if not os.getenv("LINGBI_ALIPAY_SELLER_ID"):
            raise ValueError("alipay_merchant_verification_not_configured")
        return client.create_page_payment(order["id"], order["amountFen"], "灵笔 " + order["productId"], "https://airai.world/lingbi/")
    if not os.getenv("LINGBI_WECHAT_PUBLIC_KEY_FILE"):
        raise ValueError("wechat_verification_key_not_configured")
    path = "/v3/pay/transactions/native"
    body = json.dumps(dict(appid=client.app_id, mchid=client.mch_id, description="灵笔 " + order["productId"], out_trade_no=order["id"], notify_url=client.notify_url, amount=dict(total=order["amountFen"], currency="CNY"))).encode()
    request = urllib.request.Request("https://api.mch.weixin.qq.com" + path, data=body, headers={"Content-Type": "application/json", "Accept": "application/json", "Authorization": client._sign_request("POST", path, body)}, method="POST")
    with urllib.request.urlopen(request, timeout=15) as response:
        raw = response.read()
        verify_wechat_signature(raw, response.headers)
        url = json.loads(raw)["code_url"]
    return dict(qrImage=qr_image(url))


def notify(provider, raw, headers):
    module = clients()
    if provider == "alipay":
        client = module.get_alipay()
        data = {key: values[0] for key, values in parse_qs(raw.decode()).items()}
        if data.get("app_id") != client.app_id or not os.getenv("LINGBI_ALIPAY_SELLER_ID") or data.get("seller_id") != os.getenv("LINGBI_ALIPAY_SELLER_ID"):
            raise ValueError("alipay_merchant_mismatch")
        verified = client.verify_notification(dict(data))
        if not verified:
            raise ValueError("alipay_signature_invalid")
        amount = Decimal(verified["total_amount"]) * 100
        if amount != amount.to_integral_value():
            raise ValueError("invalid_payment_amount")
        fulfill(verified["out_trade_no"], provider=provider, event_id=verified["trade_no"], amount_fen=int(amount))
        return "success"
    if provider == "wechat":
        client = module.get_wechat_pay()
        verify_wechat_signature(raw, headers)
        envelope = json.loads(raw)
        resource = envelope.get("resource", {})
        decrypted = client._aes_gcm_decrypt(resource.get("ciphertext", ""), resource.get("nonce", ""), resource.get("associated_data", ""))
        data = json.loads(decrypted or "{}")
        if data.get("mchid") != client.mch_id or data.get("appid") != client.app_id or data.get("trade_state") != "SUCCESS" or data.get("amount", {}).get("currency") != "CNY":
            raise ValueError("wechat_payment_mismatch")
        fulfill(data["out_trade_no"], provider=provider, event_id=data["transaction_id"], amount_fen=data["amount"]["total"])
        return dict(code="SUCCESS", message="成功")
    raise ValueError("unsupported_payment_provider")


def dispatch_callback(handler):
    from urllib.parse import urlparse
    path = urlparse(handler.path).path
    if not path.startswith("/v1/lingbi/payment/"):
        return False
    try:
        length = int(handler.headers.get("Content-Length", "0"))
        if not 1 <= length <= 65536:
            raise ValueError("invalid_callback_size")
        result = notify(path.rsplit("/", 1)[1], handler.rfile.read(length), handler.headers)
        if isinstance(result, str):
            body = result.encode()
            handler.send_response(200); handler.send_header("Content-Type", "text/plain"); handler.send_header("Content-Length", str(len(body))); handler.end_headers(); handler.wfile.write(body)
        else:
            handler.send_json(200, result)
    except Exception:
        handler.send_json(400, dict(code="FAIL", message="支付通知核验失败"))
    return True
