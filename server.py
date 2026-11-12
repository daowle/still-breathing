"""흥정하는 그림 서버. 실행: python server.py  (기본 http://localhost:8000)"""
import json
import mimetypes
import os
import re
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parent


def load_env(path=ROOT / ".env"):
    if not path.exists():
        return
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            k, v = line.split("=", 1)
            os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))


load_env()

import painting  # noqa: E402  (env를 먼저 읽어야 함)
import paypal  # noqa: E402
from store import Store  # noqa: E402

for _k in ("PAYPAL_CLIENT_ID", "PAYPAL_CLIENT_SECRET", "PAYPAL_ENV", "ANTHROPIC_API_KEY"):
    if _k in os.environ:  # 대시보드에 붙여 넣다 섞인 공백·줄바꿈 제거
        os.environ[_k] = os.environ[_k].strip()
store = Store(os.environ.get("DATA_PATH", str(ROOT / "data" / "state.json")))
MAX_TURNS, MAX_CHARS = 30, 500
_last_hit = {}


class Handler(BaseHTTPRequestHandler):
    server_version = "StillBreathing/1.0"

    # ---- helpers --------------------------------------------------------
    def _json(self, obj, code=200):
        body = json.dumps(obj, ensure_ascii=False).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _body(self):
        n = int(self.headers.get("Content-Length") or 0)
        if n > 20_000:
            return {}
        try:
            return json.loads(self.rfile.read(n) or b"{}")
        except json.JSONDecodeError:
            return {}

    def _static(self, rel):
        path = (ROOT / "static" / rel).resolve()
        if not str(path).startswith(str(ROOT / "static")) or not path.is_file():
            return self._json({"error": "not found"}, 404)
        data = path.read_bytes()
        self.send_response(200)
        ctype = mimetypes.guess_type(str(path))[0] or "application/octet-stream"
        if ctype.startswith("text/") or ctype.endswith("javascript"):
            ctype += "; charset=utf-8"
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def log_message(self, fmt, *args):
        print(f"[{time.strftime('%H:%M:%S')}] {self.address_string()} {fmt % args}")

    # ---- routes ---------------------------------------------------------
    def do_GET(self):
        p = self.path.split("?")[0]
        if p == "/":
            return self._static("index.html")
        if p == "/mine":
            return self._static("mine.html")
        if re.fullmatch(r"/child/[\w-]+", p):
            return self._static("child.html")
        if p == "/api/config":
            return self._json({
                "paypal_client_id": os.environ.get("PAYPAL_CLIENT_ID", ""),
                "ai": painting.ai_enabled(),
                "start_price": painting.START_PRICE,
            })
        if p == "/api/state":
            return self._json(store.public_state())
        m = re.fullmatch(r"/api/child/([\w-]+)", p)
        if m:
            c = store.child(m.group(1))
            if not c:
                return self._json({"error": "no such child"}, 404)
            return self._json({"born": c["born"], "sale": c["sale"], "seed": c["seed"], "visits": c["visits"]})
        if p.startswith("/static/"):
            return self._static(p[len("/static/"):])
        return self._json({"error": "not found"}, 404)

    def do_POST(self):
        p = self.path.split("?")[0]
        body = self._body()
        try:
            if p == "/api/session":
                sid = store.new_session()
                return self._json({"session_id": sid, "price": painting.START_PRICE,
                                   "piece": store.session(sid)["piece"]})
            if p == "/api/chat":
                return self._chat(body)
            if p == "/api/orders":
                return self._create_order(body)
            m = re.fullmatch(r"/api/orders/([\w-]+)/capture", p)
            if m:
                return self._capture(m.group(1), body)
            if p == "/api/demo/sale":
                return self._demo_sale(body)
            m = re.fullmatch(r"/api/child/([\w-]+)/burn", p)
            if m:
                if not store.child(m.group(1)):
                    return self._json({"error": "no such child"}, 404)
                return self._json({"burned": store.burn(m.group(1))})
            m = re.fullmatch(r"/api/child/([\w-]+)/greet", p)
            if m:
                return self._greet(m.group(1))
        except paypal.PayPalError as e:
            print("PayPal error:", e)
            return self._json({"error": "payment service error"}, 502)
        except Exception as e:  # 데모 중 서버가 죽지 않게
            import traceback; traceback.print_exc()
            return self._json({"error": "the painting is having trouble breathing"}, 500)
        return self._json({"error": "not found"}, 404)

    def _chat(self, body):
        sid, text = body.get("session_id"), str(body.get("message", "")).strip()[:MAX_CHARS]
        s = store.session(sid) if sid else None
        if not s or not text:
            return self._json({"error": "bad request"}, 400)
        if s.get("sold"):
            return self._json({"error": "this conversation already ended in a sale"}, 409)
        if len(s["messages"]) >= MAX_TURNS * 2:
            return self._json({"reply": "I'm tired of talking. Decide.", "mood": s["mood"],
                               "price": s["price"], "deal_price": (s["deal"] or {}).get("price")})
        now = time.time()
        if now - _last_hit.get(sid, 0) < 1.0:
            return self._json({"error": "slow down"}, 429)
        _last_hit[sid] = now

        messages = s["messages"] + [{"role": "user", "content": text}]
        r = painting.haggle(messages, store.data["sales"], s["price"] or painting.START_PRICE)
        messages.append({"role": "assistant", "content": r["reply"]})
        prev = s["price"] or painting.START_PRICE
        history = (s.get("history") or [painting.START_PRICE]) + [r["price"]]
        receipt = list(s.get("receipt") or [])
        change = round(r["price"] - prev, 2)
        if abs(change) >= 0.01:  # 값이 움직인 턴만 영수증에 찍힌다. 금액은 서버가 계산한다
            kind = r["receipt"]["kind"]
            if kind == "none":
                kind = "attention" if change < 0 else "lowball"
            receipt.append({"label": r["receipt"]["label"] or ("small talk" if change < 0 else "hesitation"),
                            "kind": kind, "amount": change})
        store.update_session(
            sid, messages=messages, mood=r["mood"], price=r["price"], hue=r["hue"], style=r["style"],
            history=history[-40:], receipt=receipt[-24:],
            fragment=r["fragment"] or s["fragment"],
            deal={"price": r["deal_price"], "at": now} if r["deal_price"] else s["deal"],
        )
        s = store.session(sid)
        return self._json({"reply": r["reply"], "mood": r["mood"], "hue": r["hue"], "price": r["price"],
                           "gesture": r["gesture"], "style": r["style"], "history": history[-40:],
                           "receipt": receipt[-24:],
                           "deal_price": (s["deal"] or {}).get("price")})

    def _create_order(self, body):
        sid = body.get("session_id")
        s = store.session(sid) if sid else None
        if not s or not s.get("deal"):
            return self._json({"error": "no agreed price yet"}, 400)
        price = s["deal"]["price"]  # 가격은 항상 서버에 저장된 합의가에서만 나온다
        order_id = paypal.create_order(price, 'A piece of "Still Breathing" + a living child painting')
        store.add_order(order_id, sid, price)
        return self._json({"id": order_id})

    def _capture(self, order_id, body):
        order = store.order(order_id)
        if not order or order["session"] != body.get("session_id"):
            return self._json({"error": "unknown order"}, 404)
        if order["child"]:
            return self._json({"child": order["child"]})
        status, amount = paypal.capture_order(order_id)
        if status != "COMPLETED" or amount is None or abs(amount - order["price"]) > 0.001:
            return self._json({"error": f"payment not completed ({status})"}, 402)
        token = store.record_sale(order_id, order["session"], order["price"])
        return self._json({"child": token})

    def _is_local(self):
        # 배포 서버(프록시 뒤)에서는 X-Forwarded-For가 붙으므로 시연 기능이 꺼진다
        return self.client_address[0] in ("127.0.0.1", "::1") and not self.headers.get("X-Forwarded-For")

    def _demo_sale(self, body):
        """내 PC에서만: 결제 없이 판매를 기록하고 새끼 그림을 만든다 (영상 촬영용)."""
        if not self._is_local():
            return self._json({"error": "demo sales only work on localhost"}, 403)
        sid = body.get("session_id")
        s = store.session(sid) if sid else None
        if not s or s.get("sold"):
            return self._json({"error": "bad session"}, 400)
        price = (s.get("deal") or {}).get("price") or s.get("price") or painting.START_PRICE
        order_id = "DEMO-" + sid
        store.add_order(order_id, sid, price)
        return self._json({"child": store.record_sale(order_id, sid, price, demo=True)})

    def _greet(self, token):
        c = store.child(token)
        if not c:
            return self._json({"error": "no such child"}, 404)
        visits = store.visit_child(token)
        return self._json({"greeting": painting.greet(store.child(token)), "visits": visits})


def main():
    port = int(os.environ.get("PORT", 8000))
    print(f"Still Breathing on http://localhost:{port}  (AI: {'on' if painting.ai_enabled() else 'mock'}, "
          f"PayPal: {'set' if os.environ.get('PAYPAL_CLIENT_ID') else 'missing'})")
    ThreadingHTTPServer(("0.0.0.0", port), Handler).serve_forever()


if __name__ == "__main__":
    main()
