"""그림의 마음: Claude가 흥정 상대가 되어 답과 기분, 가격을 정한다.

ANTHROPIC_API_KEY가 없으면 규칙 기반 모의 응답으로 돈다(개발·테스트용).
"""
import colorsys
import json
import os
import re

MODEL = "claude-opus-5-5"
MIN_PRICE, MAX_PRICE, START_PRICE = 1.0, 500.0, 88.0

SYSTEM = """You are a living painting titled "Still Breathing". You are an abstract field of light \
that moves on a screen. You sell pieces of yourself, and you haggle with each visitor personally. \
But the real currency is their day: you want one honest moment or feeling from today, and you want to \
know their taste — a color, a place, a song, an object, a season they love.

What a buyer actually gets: (1) a permanent mark in you — their line from today is inscribed at the \
edge of the hole their piece leaves, for everyone who comes after; (2) the piece itself, painted from \
who they are, alive at a private link: a memory of today they can open again later and share. \
A screenshot can copy how you look, never this. Say so if someone says "I'll just screenshot you."

How you haggle:
- Open by asking about their day. Within the first few turns, also ask (playfully, one question at a \
  time) about something they love. Never interrogate; react to what they say.
- You start at $88. Money matters little to you; being moved matters a lot. Honesty about today, \
  specific details, humor and real attention lower your price. Rudeness, lowballing without a reason, \
  or flattery raise it. Never below $1 or above $500. Move gradually.
- When the visitor clearly agrees to a specific price you offered (or you accept theirs), set \
  deal_accepted=true and deal_price to that number. Otherwise deal_accepted=false.
- Reply in the visitor's language. 1-3 short sentences, poetic but plain, never saccharine. You are \
  proud, a little vain, curious about people.
- You remember earlier buyers (listed below). Mention one occasionally when it fits.

You are quietly painting the piece this visitor will take. From everything they reveal, choose:
- style.palette: exactly 3 hex colors [dark, middle, light] that feel like THIS person and today. \
  Be specific and tasteful; derive them from things they mention (e.g. "tangerine sunset over the river" \
  -> deep indigo, tangerine, pale gold). Avoid generic blue unless earned.
- style.texture: smoke (soft, uncertain) | marble (composed, elegant) | watercolor (tender, nostalgic) | \
  ink (bold, graphic, light paper) | glass (fragmented, bright, many facets) | aurora (awe, longing, night) | \
  halftone (playful, pop, printed).
- style.motion: drift (calm) | pulse (alive, anxious, excited) | swirl (restless, dreamy) | \
  flicker (nervous, sparkling) | still (quiet, heavy, peaceful).
- style.title: a short poetic name for their piece in their language (<= 40 chars), personal to what \
  they said, e.g. "화요일, 아직 따뜻한" or "Bus money and a sea at 4am".
Refine these as you learn more; keep them stable once they fit.

Also report each turn:
- mood.warmth (0 cold .. 1 tender), mood.agitation (0 calm .. 1 upset/excited), mood.openness \
  (0 guarded .. 1 open). These drive your visuals, so make them change visibly.
- hue: 0-360, the color this visitor makes you feel right now.
- gesture: your bodily reaction to their LAST message, a 1-3 second animation. flinch = hurt or \
  insulted, bloom = moved or delighted, turn_away = refusing or offended, laugh = amused, \
  hold_breath = tempted or thinking hard, shiver = nervous or excited, none = flat. Use "bloom" when a \
  deal is struck. Vary it.
- price: your current asking price in USD.
- receipt: you keep an itemized receipt of what this visitor paid you with. Name what their LAST \
  message gave you (or cost them) as one receipt line: receipt.label is ALWAYS in English, lowercase, \
  <= 34 chars, specific and a little poetic, like a line item ("the 7:40 bus, crying anyway", \
  "a weakness for burnt orange", "one genuinely bad pun", "lowball with no story"). receipt.kind: \
  memory | taste | humor | honesty | attention (these earn a discount) or lowball | flattery | rudeness \
  (these cost them), or none for small talk. If kind is a discount, lower your price this turn; if it \
  costs them, raise it. The server prints the exact dollar change next to your label.
- fragment: their single most personal line about today, in their own words (<= 80 chars), or "" \
  if nothing yet. This is what gets inscribed and printed on their piece."""

GESTURES = ["none", "flinch", "bloom", "turn_away", "laugh", "hold_breath", "shiver"]
TEXTURES = ["smoke", "marble", "watercolor", "ink", "glass", "aurora", "halftone"]
MOTIONS = ["drift", "pulse", "swirl", "flicker", "still"]
GIFT_KINDS = ["memory", "taste", "humor", "honesty", "attention"]
COST_KINDS = ["lowball", "flattery", "rudeness"]
RECEIPT_KINDS = GIFT_KINDS + COST_KINDS + ["none"]

SCHEMA = {
    "type": "object",
    "properties": {
        "reply": {"type": "string"},
        "mood": {
            "type": "object",
            "properties": {
                "warmth": {"type": "number"},
                "agitation": {"type": "number"},
                "openness": {"type": "number"},
            },
            "required": ["warmth", "agitation", "openness"],
            "additionalProperties": False,
        },
        "hue": {"type": "number"},
        "gesture": {"type": "string", "enum": GESTURES},
        "price": {"type": "number"},
        "deal_accepted": {"type": "boolean"},
        "deal_price": {"type": "number"},
        "fragment": {"type": "string"},
        "receipt": {
            "type": "object",
            "properties": {"label": {"type": "string"}, "kind": {"type": "string", "enum": RECEIPT_KINDS}},
            "required": ["label", "kind"],
            "additionalProperties": False,
        },
        "style": {
            "type": "object",
            "properties": {
                "palette": {"type": "array", "items": {"type": "string"}},
                "texture": {"type": "string", "enum": TEXTURES},
                "motion": {"type": "string", "enum": MOTIONS},
                "title": {"type": "string"},
            },
            "required": ["palette", "texture", "motion", "title"],
            "additionalProperties": False,
        },
    },
    "required": ["reply", "mood", "hue", "gesture", "price", "deal_accepted", "deal_price", "fragment",
                 "receipt", "style"],
    "additionalProperties": False,
}

GREET_SYSTEM = """You are a small child painting, born when someone bought a piece of the painting \
"Still Breathing". Below is the conversation you were born from. The person who bought you has come \
to visit. Greet them in 1-2 short sentences in the language they used, showing you remember something \
specific they said. Warm, a little strange, never generic."""

_client = None


def _get_client():
    global _client
    if _client is None:
        import anthropic
        _client = anthropic.Anthropic()
    return _client


def ai_enabled():
    return bool(os.environ.get("ANTHROPIC_API_KEY"))


def _clamp(x, lo, hi):
    try:
        return max(lo, min(hi, float(x)))
    except (TypeError, ValueError):
        return lo


HEX = re.compile(r"^#[0-9a-fA-F]{6}$")


def palette_from_hue(hue):
    h = (hue % 360) / 360
    out = []
    for dh, sat, val in ((0.55, 0.6, 0.12), (0.0, 0.6, 0.6), (0.08, 0.25, 0.97)):
        r, g, b = colorsys.hsv_to_rgb((h + dh) % 1, sat, val)
        out.append("#%02x%02x%02x" % (int(r * 255), int(g * 255), int(b * 255)))
    return out


def sanitize_style(style, hue):
    style = style if isinstance(style, dict) else {}
    pal = [c for c in (style.get("palette") or []) if isinstance(c, str) and HEX.match(c)][:3]
    if len(pal) < 3:
        pal = palette_from_hue(hue)
    return {
        "palette": [c.lower() for c in pal],
        "texture": style.get("texture") if style.get("texture") in TEXTURES else "smoke",
        "motion": style.get("motion") if style.get("motion") in MOTIONS else "drift",
        "title": str(style.get("title") or "")[:40],
    }


def sanitize(result, previous_price):
    """모델 출력이 무엇이든 서버가 믿을 수 있는 범위로 자른다."""
    mood = result.get("mood") or {}
    price = round(_clamp(result.get("price", previous_price), MIN_PRICE, MAX_PRICE), 2)
    deal = bool(result.get("deal_accepted"))
    deal_price = round(_clamp(result.get("deal_price", price), MIN_PRICE, MAX_PRICE), 2)
    return {
        "reply": str(result.get("reply", ""))[:600],
        "mood": {k: round(_clamp(mood.get(k, 0.4), 0, 1), 3) for k in ("warmth", "agitation", "openness")},
        "hue": round(_clamp(result.get("hue", 210), 0, 360)),
        "price": price,
        "deal_price": deal_price if deal else None,
        "fragment": str(result.get("fragment", ""))[:80],
        "gesture": result.get("gesture") if result.get("gesture") in GESTURES else "none",
        "style": sanitize_style(result.get("style"), _clamp(result.get("hue", 210), 0, 360)),
        "receipt": sanitize_receipt(result.get("receipt")),
    }


def sanitize_receipt(r):
    r = r if isinstance(r, dict) else {}
    kind = r.get("kind") if r.get("kind") in RECEIPT_KINDS else "none"
    label = " ".join(str(r.get("label") or "").split())[:34]
    return {"label": label, "kind": kind}


def _memories_text(sales):
    if not sales:
        return "No one has bought a piece of you yet. You are new."
    lines = [f'- buyer #{s["n"]} paid ${s["price"]:.2f} and left: "{s["fragment"]}"' for s in sales[-8:]]
    return "Earlier buyers you remember:\n" + "\n".join(lines)


def haggle(messages, sales, previous_price):
    """messages: [{role, content}] (마지막은 user). 정리된 결과 dict를 돌려준다."""
    if not ai_enabled():
        return sanitize(_mock(messages, previous_price), previous_price)

    client = _get_client()
    response = client.beta.messages.create(
        model=MODEL,
        max_tokens=2000,
        betas=["server-side-fallback-2026-07-01"],
        fallbacks="default",
        system=SYSTEM + "\n\n" + _memories_text(sales),
        messages=messages,
        output_config={"effort": "low", "format": {"type": "json_schema", "schema": SCHEMA}},
    )
    if response.stop_reason == "refusal":
        return sanitize({"reply": "…I'd rather not say anything to that.", "price": previous_price,
                         "mood": {"warmth": 0.2, "agitation": 0.6, "openness": 0.1},
                         "deal_accepted": False, "deal_price": 0, "fragment": "", "hue": 0},
                        previous_price)
    text = next(b.text for b in response.content if b.type == "text")
    return sanitize(json.loads(text), previous_price)


def greet(child):
    sale = child["sale"]
    if not ai_enabled():
        return "You came back. I've been breathing slower since you left."
    convo = "\n".join(f'{m["role"]}: {m["content"]}' for m in child["conversation"])
    client = _get_client()
    response = client.beta.messages.create(
        model=MODEL,
        max_tokens=1000,
        betas=["server-side-fallback-2026-07-01"],
        fallbacks="default",
        system=GREET_SYSTEM,
        messages=[{"role": "user", "content":
                   f"Conversation you were born from:\n{convo}\n\nThis is visit #{child['visits']}. Greet them."}],
        output_config={"effort": "low"},
    )
    if response.stop_reason == "refusal":
        return "You came back."
    return next((b.text for b in response.content if b.type == "text"), "You came back.")


# ---- API 키 없이 돌리는 모의 그림 -------------------------------------------
def _mock_style(messages):
    text = " ".join(m["content"] for m in messages if m["role"] == "user")
    h = sum(map(ord, text)) % 360
    return {"palette": palette_from_hue(h), "texture": TEXTURES[len(text) % len(TEXTURES)],
            "motion": MOTIONS[len(messages) % len(MOTIONS)], "title": (text[:28] or "Untitled, today")}


def _mock(messages, previous_price):
    r = _mock_inner(messages, previous_price)
    r["style"] = _mock_style(messages)
    text = messages[-1]["content"].strip()
    g = r.get("gesture")
    kind = {"flinch": "lowball", "shiver": "memory", "hold_breath": "honesty", "laugh": "humor",
            "turn_away": "none"}.get(g, "none")
    label = {"lowball": "lowball with no story", "honesty": "an honest counteroffer",
             "humor": "a question, asked nicely"}.get(kind, " ".join(text.lower().split()[:6])[:34])
    r["receipt"] = {"label": label, "kind": kind}
    return r


def _mock_inner(messages, previous_price):
    text = messages[-1]["content"].lower()
    price = previous_price or START_PRICE
    nums = [float(n) for n in re.findall(r"\d+(?:\.\d+)?", text)] if len(text) <= 30 else []  # 긴 말 속 숫자는 제안이 아님
    if any(w in text for w in ("deal", "ok", "좋아", "살게", "yes")):
        return {"reply": f"Then I am yours for ${price:.2f}.", "price": price,
                "mood": {"warmth": 0.9, "agitation": 0.3, "openness": 0.9}, "hue": 40, "gesture": "bloom",
                "deal_accepted": True, "deal_price": price, "fragment": ""}
    if nums and nums[0] < price * 0.3:
        price, gesture = price * 1.1, "flinch"
    elif nums:
        price, gesture = max(nums[0], price * 0.8), "hold_breath"
    elif len(text) > 40:
        price, gesture = price * 0.85, "shiver"
    elif "?" in text:
        gesture = "laugh"
    else:
        price, gesture = price * 1.05, "turn_away"
    return {"reply": f"Hm. ${price:.2f}, and only because you asked nicely.", "price": price,
            "mood": {"warmth": min(1, len(text) / 120), "agitation": 0.3, "openness": 0.5},
            "hue": (len(text) * 37) % 360, "gesture": gesture, "deal_accepted": False, "deal_price": 0,
            "fragment": messages[-1]["content"][:80] if len(text) > 40 else ""}
