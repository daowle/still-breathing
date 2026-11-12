"""PayPal Orders v2 REST 호출 (표준 라이브러리 urllib만 사용)."""
import base64
import json
import os
import time
import urllib.error
import urllib.request

_token = {"value": None, "exp": 0}


def _base():
    if os.environ.get("PAYPAL_ENV", "sandbox") == "live":
        return "https://api-m.paypal.com"
    return "https://api-m.sandbox.paypal.com"


class PayPalError(Exception):
    pass


def _request(method, path, body=None, headers=None, auth=None):
    req = urllib.request.Request(_base() + path, method=method)
    for k, v in (headers or {}).items():
        req.add_header(k, v)
    if auth:
        req.add_header("Authorization", auth)
    data = None
    if body is not None:
        if isinstance(body, (bytes, str)):
            data = body.encode() if isinstance(body, str) else body
        else:
            data = json.dumps(body).encode()
            req.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(req, data=data, timeout=20) as r:
            return json.loads(r.read() or b"{}")
    except urllib.error.HTTPError as e:
        raise PayPalError(f"{e.code} {e.read().decode(errors='replace')[:500]}") from None


def access_token():
    if _token["value"] and time.time() < _token["exp"] - 60:
        return _token["value"]
    cid, secret = os.environ["PAYPAL_CLIENT_ID"], os.environ["PAYPAL_CLIENT_SECRET"]
    basic = base64.b64encode(f"{cid}:{secret}".encode()).decode()
    res = _request(
        "POST", "/v1/oauth2/token", body="grant_type=client_credentials",
        headers={"Content-Type": "application/x-www-form-urlencoded"}, auth=f"Basic {basic}",
    )
    _token.update(value=res["access_token"], exp=time.time() + int(res.get("expires_in", 3000)))
    return _token["value"]


def create_order(price, description):
    res = _request(
        "POST", "/v2/checkout/orders",
        body={
            "intent": "CAPTURE",
            "purchase_units": [{
                "amount": {"currency_code": "USD", "value": f"{price:.2f}"},
                "description": description[:127],
            }],
        },
        auth=f"Bearer {access_token()}",
    )
    return res["id"]


def capture_order(order_id):
    """캡처하고 (상태, 실제 결제 금액)을 돌려준다."""
    res = _request(
        "POST", f"/v2/checkout/orders/{order_id}/capture", body={},
        auth=f"Bearer {access_token()}",
    )
    status = res.get("status")
    try:
        amount = float(res["purchase_units"][0]["payments"]["captures"][0]["amount"]["value"])
    except (KeyError, IndexError, TypeError, ValueError):
        amount = None
    return status, amount
