# Still Breathing

**A painting that sells itself — and makes you pay with yourself.**

Still Breathing is a living WebGL painting with a voice (Claude). You don't buy it at a fixed price: you haggle.
Tell it about your day, your taste, a name you still carry — and it lowers its price. Lowball it or flatter it, and it notices.
When you agree, you pay the agreed amount through **PayPal (sandbox)**.

What you get is not an image file:

- **An inscription.** A line from your conversation is cut permanently into the parent painting. The painting is finite — it shows *"N% of me remains"* and never refills.
- **A living child piece.** A private link to a small painting born from your conversation: its palette, texture, motion and title are your taste; its outline is the shape of the haggle itself (price drops become curves, price rises become notches).
- **A receipt of yourself.** Every turn becomes an itemized English receipt line (`the 7:40 bus, crying unseen  −$24.00`). Lines always add up exactly to what you paid.
- **The burn.** You may burn the receipt — irreversibly deleting your words from the server. In return the piece is gilded and its hole in the parent painting gets a gold rim. (After Yves Klein's *Zones of Immaterial Pictorial Sensibility*.)
- **A shareable 9:16 story card** (museum wall label or thermal receipt) and a 6-second video for Instagram / TikTok.

The parent slowly being given away piece by piece is a nod to Félix González-Torres' candy works.
The question the piece answers: *"Why pay when I can just screenshot it?"* — because a screenshot can't hold what you paid with.

## How PayPal and AI are used

| | |
|---|---|
| **Claude (`claude-opus-5-5`)** | Plays the painting. Each turn returns structured JSON (reply, new price, deal state, mood, taste genes, receipt line) via `output_config` JSON schema. The server clamps and validates everything — the model never decides money on its own. |
| **PayPal Orders v2 (sandbox)** | The server creates an order **only for the agreed price** of that session, and on capture verifies the captured amount matches before minting the child piece. Captures are idempotent; other sessions can't capture your order. |

## Run it locally

Requires Python 3.10+.

```bash
pip install -r requirements.txt
cp .env.example .env      # fill in keys (see below)
python server.py          # http://localhost:8000
```

- `PAYPAL_CLIENT_ID` / `PAYPAL_CLIENT_SECRET`: [PayPal Developer Dashboard](https://developer.paypal.com) → Apps & Credentials → **Sandbox** app. Pay with a sandbox *Personal* account from Testing Tools → Sandbox Accounts.
- `ANTHROPIC_API_KEY`: [console.anthropic.com](https://console.anthropic.com). **Optional** — if empty, the painting runs on a rule-based mock haggler so you can try the whole flow without a key.

On `localhost` only, `?demo` enables keyboard shortcuts for recording (gestures `1`–`6`, and a no-payment demo sale).

```bash
python -m unittest tests.test_flow   # full haggle → order → capture → child → burn flow, PayPal mocked
```

## Deploy

`render.yaml` deploys it as a single Render web service (no dependencies besides the `anthropic` SDK; the server is Python stdlib). Set the three secrets in the Render dashboard.

## Structure

```
server.py        HTTP server + API (sessions, chat, orders, capture, child pieces, burn)
painting.py      Claude prompt + JSON schema, sanitizing, mock haggler
paypal.py        PayPal Orders v2 (create / capture)
store.py         JSON store: sales, inscriptions, receipts, "remains"
static/field.js  WebGL painting (fragment shader + spring dynamics)
static/share.js  Story cards (wall label / receipt) and video export
```

## License

MIT
