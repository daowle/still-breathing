"""PayPal과 Claude를 쓰지 않고 흥정→주문→캡처→새끼 그림까지 확인한다."""
import json, os, sys, tempfile, threading, unittest, urllib.request
from http.server import ThreadingHTTPServer

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
os.environ["DATA_PATH"] = os.path.join(tempfile.mkdtemp(), "state.json")
os.environ["ANTHROPIC_API_KEY"] = ""
import server, painting, paypal  # noqa: E402

class FlowTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        paypal.create_order = lambda price, desc: "ORDER1"
        cls.captured = {"amount": None}
        paypal.capture_order = lambda oid: ("COMPLETED", cls.captured["amount"])
        cls.httpd = ThreadingHTTPServer(("127.0.0.1", 0), server.Handler)
        cls.base = f"http://127.0.0.1:{cls.httpd.server_address[1]}"
        threading.Thread(target=cls.httpd.serve_forever, daemon=True).start()

    @classmethod
    def tearDownClass(cls):
        cls.httpd.shutdown()

    def call(self, path, body=None):
        req = urllib.request.Request(self.base + path, method="POST" if body is not None else "GET",
                                     data=json.dumps(body).encode() if body is not None else None,
                                     headers={"Content-Type": "application/json"})
        try:
            with urllib.request.urlopen(req) as r:
                return r.status, json.loads(r.read())
        except urllib.error.HTTPError as e:
            return e.code, json.loads(e.read())

    def test_full_flow(self):
        _, s = self.call("/api/session", {})
        sid = s["session_id"]
        before = self.call("/api/state")[1]["count"]
        code, _ = self.call("/api/orders", {"session_id": sid})
        self.assertEqual(code, 400)  # 합의 전에는 주문 불가
        server._last_hit.clear()
        code, r = self.call("/api/chat", {"session_id": sid, "message": "my grandmother painted skies like you, deal"})
        self.assertEqual(code, 200)
        self.assertIsNotNone(r["deal_price"])
        code, o = self.call("/api/orders", {"session_id": sid})
        self.assertEqual(o["id"], "ORDER1")
        # 다른 세션은 남의 주문을 캡처할 수 없다
        self.assertEqual(self.call("/api/orders/ORDER1/capture", {"session_id": "x"})[0], 404)
        # 금액이 다르면 거절
        self.captured["amount"] = 0.5
        self.assertEqual(self.call("/api/orders/ORDER1/capture", {"session_id": sid})[0], 402)
        self.captured["amount"] = r["deal_price"]
        code, c = self.call("/api/orders/ORDER1/capture", {"session_id": sid})
        self.assertEqual(code, 200)
        # 두 번 캡처해도 같은 새끼 그림
        self.assertEqual(self.call("/api/orders/ORDER1/capture", {"session_id": sid})[1]["child"], c["child"])
        _, st = self.call("/api/state")
        self.assertEqual(st["count"], before + 1)
        code, child = self.call(f"/api/child/{c['child']}")
        self.assertEqual(code, 200)
        _, g = self.call(f"/api/child/{c['child']}/greet", {})
        self.assertEqual(g["visits"], 1)
        # 판매 후 같은 대화는 계속할 수 없다
        server._last_hit.clear()
        self.assertEqual(self.call("/api/chat", {"session_id": sid, "message": "hi"})[0], 409)

    def test_demo_sale_localhost(self):
        _, s = self.call("/api/session", {})
        code, r = self.call("/api/demo/sale", {"session_id": s["session_id"]})
        self.assertEqual(code, 200)
        code, child = self.call(f"/api/child/{r['child']}")
        self.assertEqual(code, 200)
        self.assertTrue(server.store.data["sales"][-1]["demo"])
        self.assertIsNotNone(child["sale"]["piece"])

    def test_receipt_adds_up(self):
        """영수증: 시작가 + 줄마다의 금액 = 실제 결제가 (한 푼도 안 틀리게)."""
        _, s = self.call("/api/session", {})
        sid = s["session_id"]
        for msg in ["this morning I cried on the 7:40 bus and nobody noticed at all",
                    "how about 5", "would you take 40?", "ok deal"]:
            server._last_hit.clear()
            code, r = self.call("/api/chat", {"session_id": sid, "message": msg})
            self.assertEqual(code, 200)
        self.assertTrue(r["receipt"])
        code, d = self.call("/api/demo/sale", {"session_id": sid})
        sale = self.call(f"/api/child/{d['child']}")[1]["sale"]
        total = sale["asking"] + sum(x["amount"] for x in sale["receipt"])
        self.assertAlmostEqual(total, sale["price"], places=2)
        self.assertEqual(len(sale["history"]), 5)
        # 영수증 소각: 한 번만, 원본 목록의 판매 기록에서도 지워진다
        self.assertTrue(self.call(f"/api/child/{d['child']}/burn", {})[1]["burned"])
        self.assertFalse(self.call(f"/api/child/{d['child']}/burn", {})[1]["burned"])
        sale = self.call(f"/api/child/{d['child']}")[1]["sale"]
        self.assertIsNone(sale["receipt"])
        self.assertTrue(server.store.data["sales"][-1]["burned"])
        self.assertLess(self.call("/api/state")[1]["remains"], 1)

    def test_sanitize_clamps(self):
        r = painting.sanitize({"price": -5, "deal_accepted": True, "deal_price": 99999,
                               "mood": {"warmth": 3}, "hue": 999}, 88)
        self.assertEqual(r["price"], 1.0)
        self.assertEqual(r["deal_price"], 500.0)
        self.assertEqual(r["mood"]["warmth"], 1)
        self.assertEqual(r["hue"], 360)

if __name__ == "__main__":
    unittest.main()
