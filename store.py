"""JSON 파일 하나에 작품 상태를 저장한다. 해커톤용이라 DB 없이 잠금 + 원자적 쓰기만 한다."""
import json
import math
import os
import random
import secrets
import threading
import time

_lock = threading.RLock()


def choose_piece(sales, aspect=1.6):
    """아직 안 팔린 자리에서 조각 하나를 고른다. uv 좌표(아래가 0), 반지름은 화면 높이 기준.
    왼쪽 아래(대화창)와 오른쪽 위(가격)는 피한다."""
    taken = [s["piece"] for s in sales if s.get("piece")]
    best, best_gap = None, -1.0
    for _ in range(80):
        cand = {"x": round(random.uniform(0.40, 0.86), 4), "y": round(random.uniform(0.22, 0.76), 4),
                "r": round(random.uniform(0.075, 0.11), 4), "seed": round(random.uniform(0, 100), 3)}
        gap = min((math.hypot((cand["x"] - t["x"]) * aspect, cand["y"] - t["y"]) - (cand["r"] + t["r"]) * 1.35
                   for t in taken), default=1.0)
        if gap > 0:
            return cand
        if gap > best_gap:
            best, best_gap = cand, gap
    return best  # 자리가 꽉 차면 가장 덜 겹치는 곳


def _settle(lines, history, paid):
    """영수증이 정확히 맞아떨어지게: 마지막 호가와 실제 합의가가 다르면 그 차이를 한 줄로 더한다."""
    lines = [dict(x) for x in lines]
    last = (history or [paid])[-1]
    diff = round(paid - last, 2)
    if abs(diff) >= 0.01:
        lines.append({"label": "your offer, accepted" if diff < 0 else "rounding, in my favor",
                      "kind": "honesty" if diff < 0 else "lowball", "amount": diff})
    return lines


class Store:
    def __init__(self, path):
        self.path = path
        os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
        if os.path.exists(path):
            with open(path, encoding="utf-8") as f:
                self.data = json.load(f)
        else:
            self.data = {"sales": [], "children": {}, "sessions": {}, "orders": {}}

    def _save(self):
        tmp = self.path + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(self.data, f, ensure_ascii=False, indent=1)
        os.replace(tmp, self.path)

    # ---- sessions -------------------------------------------------------
    def new_session(self):
        with _lock:
            sid = secrets.token_urlsafe(12)
            self.data["sessions"][sid] = {
                "created": time.time(),
                "messages": [],
                "mood": {"warmth": 0.4, "agitation": 0.2, "openness": 0.3},
                "price": None,
                "deal": None,
                "fragment": "",
                "hue": 210,
                "piece": choose_piece(self.data["sales"]),
            }
            self._save()
            return sid

    def session(self, sid):
        return self.data["sessions"].get(sid)

    def update_session(self, sid, **fields):
        with _lock:
            self.data["sessions"][sid].update(fields)
            self._save()

    # ---- orders ---------------------------------------------------------
    def add_order(self, order_id, sid, price):
        with _lock:
            self.data["orders"][order_id] = {"session": sid, "price": price, "child": None}
            self._save()

    def order(self, order_id):
        return self.data["orders"].get(order_id)

    # ---- sales & children ----------------------------------------------
    def record_sale(self, order_id, sid, price, demo=False):
        """결제가 확인된 주문을 판매로 기록하고 새끼 그림을 만든다. 같은 주문은 한 번만."""
        with _lock:
            order = self.data["orders"][order_id]
            if order["child"]:
                return order["child"]
            s = self.data["sessions"][sid]
            token = secrets.token_urlsafe(10)
            sale = {
                "n": len(self.data["sales"]) + 1,
                "price": price,
                "fragment": s["fragment"] or "(they said nothing worth keeping)",
                "hue": s["hue"],
                "mood": s["mood"],
                "piece": s.get("piece") or choose_piece(self.data["sales"]),
                "style": s.get("style"),
                "time": time.time(),
                "asking": s.get("history", [None])[0] or price,
                "history": (s.get("history") or [])[-40:],
                "receipt": _settle(s.get("receipt") or [], s.get("history"), price),
            }
            if demo:
                sale["demo"] = True  # 결제 없이 만든 시연용 판매. 출품 전에 지울 수 있게 표시
            self.data["sales"].append(sale)
            self.data["children"][token] = {
                "born": time.time(),
                "sale": sale,
                "seed": secrets.randbelow(10_000),
                "conversation": s["messages"][-12:],
                "visits": 0,
            }
            order["child"] = token
            s["deal"] = None
            s["sold"] = True
            self._save()
            return token

    def burn(self, token):
        """영수증을 태운다: 영수증 줄은 영원히 지워지고, 산 사람이 '완전한 소유자'가 된다."""
        with _lock:
            c = self.data["children"][token]
            if c["sale"].get("burned"):
                return False
            now = time.time()
            for sale in [c["sale"]] + [s for s in self.data["sales"] if s["n"] == c["sale"]["n"]]:
                sale["receipt"] = None
                sale["burned"] = now
            self._save()
            return True

    def child(self, token):
        return self.data["children"].get(token)

    def visit_child(self, token):
        with _lock:
            c = self.data["children"][token]
            c["visits"] += 1
            self._save()
            return c["visits"]

    def public_state(self):
        public = [{k: v for k, v in s.items() if k != "receipt"} for s in self.data["sales"][-32:]]
        # 곤잘레스-토레스의 사탕 더미처럼: 조각이 팔릴수록 원본이 줄어든다. 다만 이 그림은 다시 채워지지 않는다
        taken = sum(math.pi * s["piece"]["r"] ** 2 for s in self.data["sales"] if s.get("piece"))
        return {"sales": public, "count": len(self.data["sales"]), "remains": round(max(0.0, 1 - taken / 1.6), 4)}
