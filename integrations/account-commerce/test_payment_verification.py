"""Cryptographic fixtures only: never contact a merchant or payment provider."""
import base64
import json
import os
import time
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch
from urllib.parse import urlencode
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import padding, rsa
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
import test_commerce as fixture
from lingbi_orders import create_order
from lingbi_payments import notify
from lingbi_accounts import summary


class ProviderVerificationTests(fixture.CommerceTests):
    def setUp(self):
        super().setUp()
        self.key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
        self.public = self.key.public_key()
        self.pem = Path(fixture.scratch.name) / "fixture-public.pem"
        self.pem.write_bytes(self.public.public_bytes(serialization.Encoding.PEM, serialization.PublicFormat.SubjectPublicKeyInfo))
        self.env = patch.dict(os.environ, LINGBI_ALIPAY_SELLER_ID="fixture-seller", LINGBI_WECHAT_PUBLIC_KEY_ID="fixture-public-id", LINGBI_WECHAT_PUBLIC_KEY_FILE=str(self.pem))
        self.env.start()
    def tearDown(self): self.env.stop()

    def test_alipay_signature_merchant_amount_and_duplicate(self):
        order = create_order("org", "owner", self.account, dict(productId="points.20", provider="alipay", idempotencyKey="pay-test-001"))
        outer = self
        class Client:
            app_id = "fixture-app"
            def verify_notification(self, params):
                signature = params.pop("sign"); params.pop("sign_type", None)
                if params.get("trade_status") != "TRADE_SUCCESS": return None
                raw = "&".join(f"{key}={value}" for key, value in sorted(params.items()) if value)
                outer.public.verify(base64.b64decode(signature), raw.encode(), padding.PKCS1v15(), hashes.SHA256())
                return params
        def body(amount="20.00", seller="fixture-seller"):
            data = dict(app_id="fixture-app", seller_id=seller, out_trade_no=order["id"], trade_no="fixture-trade", total_amount=amount, trade_status="TRADE_SUCCESS")
            raw = "&".join(f"{key}={value}" for key, value in sorted(data.items()))
            data.update(sign=base64.b64encode(self.key.sign(raw.encode(), padding.PKCS1v15(), hashes.SHA256())).decode(), sign_type="RSA2")
            return urlencode(data).encode()
        with patch("lingbi_payments.clients", return_value=SimpleNamespace(get_alipay=lambda: Client())):
            with self.assertRaises(ValueError): notify("alipay", body("0.01"), {})
            with self.assertRaises(ValueError): notify("alipay", body(seller="wrong"), {})
            for _ in range(2): self.assertEqual(notify("alipay", body(), {}), "success")
        self.assertEqual(summary("org", "owner")["balance"]["purchased"], 12000)

    def test_wechat_rsa_aes_currency_and_wrong_signature(self):
        order = create_order("org", "owner", self.account, dict(productId="points.20", provider="wechat", idempotencyKey="wx-test-001"))
        aes_key = AESGCM.generate_key(bit_length=256)
        class Client:
            app_id, mch_id = "fixture-app", "fixture-merchant"
            def _aes_gcm_decrypt(self, ciphertext, nonce, aad): return AESGCM(aes_key).decrypt(nonce.encode(), base64.b64decode(ciphertext), aad.encode()).decode()
        def callback(currency):
            nonce, aad = "fixture-nonc", "fixture-aad"
            payment = dict(appid=Client.app_id, mchid=Client.mch_id, trade_state="SUCCESS", out_trade_no=order["id"], transaction_id="fixture-wx-trade", amount=dict(total=2000, currency=currency))
            ciphertext = AESGCM(aes_key).encrypt(nonce.encode(), json.dumps(payment).encode(), aad.encode())
            raw = json.dumps(dict(resource=dict(ciphertext=base64.b64encode(ciphertext).decode(), nonce=nonce, associated_data=aad))).encode()
            ts = str(int(time.time()))
            signature = base64.b64encode(self.key.sign(ts.encode() + b"\nfixture\n" + raw + b"\n", padding.PKCS1v15(), hashes.SHA256())).decode()
            headers = {"Wechatpay-Serial": "fixture-public-id", "Wechatpay-Timestamp": ts, "Wechatpay-Nonce": "fixture", "Wechatpay-Signature": signature}
            return raw, headers
        with patch("lingbi_payments.clients", return_value=SimpleNamespace(get_wechat_pay=lambda: Client())):
            raw, headers = callback("USD")
            with self.assertRaises(ValueError): notify("wechat", raw, headers)
            raw, headers = callback("CNY")
            with self.assertRaises(Exception): notify("wechat", raw + b" ", headers)
            self.assertEqual(notify("wechat", raw, headers)["code"], "SUCCESS")

if __name__ == "__main__": unittest.main()
