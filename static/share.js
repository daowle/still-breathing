// 9:16 스토리 카드 (이미지 / 6초 영상) 만들기 + 내 조각 보관함(localStorage)
import { createField } from "/static/field.js";
const SANS = `"Helvetica Neue", Helvetica, Arial, "Noto Sans KR", sans-serif`;
const MONO = `"IBM Plex Mono", "SF Mono", Menlo, Consolas, "Courier New", "Noto Sans KR", monospace`;

const W = 1080, H = 1920;
const SERIF = `"Iowan Old Style", "Palatino Linotype", Georgia, "Noto Serif KR", "Nanum Myeongjo", serif`;

export function rememberPiece(token, sale) {
  const list = myPieces().filter((x) => x.token !== token);
  list.unshift({ token, n: sale.n, title: (sale.style && sale.style.title) || "", fragment: sale.fragment,
                 time: sale.time, palette: sale.style && sale.style.palette });
  localStorage.setItem("sb_pieces", JSON.stringify(list.slice(0, 200)));
}
export function myPieces() {
  try { return JSON.parse(localStorage.getItem("sb_pieces") || "[]"); } catch { return []; }
}

export const money = (v) => (v < 0 ? "−$" : "$") + Math.abs(v).toFixed(2);
const weekday = (t) => new Date(t * 1000).toLocaleDateString("en-US", { weekday: "long" }).toLowerCase();
const stamp = (t) => new Date(t * 1000).toLocaleDateString("en-US", { month: "short", day: "2-digit", year: "numeric" }).toUpperCase();

// 영수증: 시작가 → 내어 준 것/치른 것 줄들 → PayPal로 낸 값 + 그날 하루
export function receiptModel(sale, maxLines = 7) {
  let items = (sale.receipt || []).map((x) => ({ label: x.label, amount: x.amount, kind: x.kind }));
  if (items.length > maxLines) {
    const rest = items.slice(maxLines - 1), sum = rest.reduce((a, x) => a + x.amount, 0);
    items = items.slice(0, maxLines - 1).concat([{ label: `+${rest.length} more, all true`, amount: sum, kind: "memory" }]);
  }
  return {
    no: sale.n, date: stamp(sale.time), asking: sale.asking || 88, items,
    paid: Number(sale.price), day: `+ one ${weekday(sale.time)}, in full`,
    title: (sale.style && sale.style.title) || "Untitled, today", fragment: sale.fragment,
    palette: (sale.style && sale.style.palette) || ["#0b0f1a", "#3d6b99", "#e6eefc"],
  };
}

function wrap(ctx, text, maxW) {
  // 띄어쓰기 단위로 줄바꿈 (한국어 긴 단어도 글자 단위로 끊어짐)
  const out = []; let line = "";
  for (const word of text.split(/(\s+)/)) {
    if (ctx.measureText(line + word).width <= maxW) { line += word; continue; }
    if (line.trim()) out.push(line.trim());
    line = word.trimStart();
    while (ctx.measureText(line).width > maxW) {
      let i = line.length; while (i > 1 && ctx.measureText(line.slice(0, i)).width > maxW) i--;
      out.push(line.slice(0, i)); line = line.slice(i);
    }
  }
  if (line.trim()) out.push(line.trim());
  return out;
}

function fit(ctx, text, maxW) {  // 넘치면 말줄임
  if (ctx.measureText(text).width <= maxW) return text;
  while (text.length > 1 && ctx.measureText(text + "…").width > maxW) text = text.slice(0, -1);
  return text + "…";
}

function drawReceipt(ctx, m, cx, bottom) {
  const RW = 800, PAD = 56, LH = 46, x0 = -RW / 2 + PAD, x1 = RW / 2 - PAD;
  const fragLines = (() => { ctx.font = `italic 400 30px ${SERIF}`; return wrap(ctx, `“${m.fragment}”`, RW - PAD * 2).slice(0, 3); })();
  const RH = 210 + LH * (m.items.length + 1) + 150 + fragLines.length * 42 + 200;
  ctx.save();
  ctx.translate(cx, bottom - RH / 2); ctx.rotate(-0.018);
  const top = -RH / 2;
  // 종이 + 그림자 + 아래쪽 찢긴 톱니
  ctx.shadowColor = "rgba(0,0,0,.45)"; ctx.shadowBlur = 40; ctx.shadowOffsetY = 18;
  ctx.fillStyle = "#f3efe6";
  ctx.beginPath(); ctx.moveTo(-RW / 2, top); ctx.lineTo(RW / 2, top);
  const teeth = 32, tw = RW / teeth;
  ctx.lineTo(RW / 2, RH / 2 - 10);
  for (let i = teeth; i > 0; i--) { ctx.lineTo(-RW / 2 + (i - 0.5) * tw, RH / 2); ctx.lineTo(-RW / 2 + (i - 1) * tw, RH / 2 - 10); }
  ctx.closePath(); ctx.fill();
  ctx.shadowColor = "transparent";
  // 종이 결
  for (let i = 0; i < 900; i++) { ctx.fillStyle = `rgba(80,60,30,${Math.random() * 0.05})`;
    ctx.fillRect(-RW / 2 + Math.random() * RW, top + Math.random() * RH, 2, 2); }

  const ink = "#24211c"; ctx.fillStyle = ink; ctx.strokeStyle = ink;
  let y = top + 78;
  ctx.textAlign = "center"; ctx.font = `600 34px ${MONO}`;
  ctx.fillText("S T I L L   B R E A T H I N G", 0, y); y += 40;
  ctx.font = `400 22px ${MONO}`; ctx.globalAlpha = 0.7;
  ctx.fillText("a painting that sold a piece of itself", 0, y); ctx.globalAlpha = 1; y += 34;
  const rule = () => { ctx.save(); ctx.setLineDash([6, 8]); ctx.lineWidth = 2; ctx.beginPath();
    ctx.moveTo(x0, y); ctx.lineTo(x1, y); ctx.stroke(); ctx.restore(); y += 46; };
  const row = (l, r, font = `400 26px ${MONO}`, alpha = 1) => {
    ctx.font = font; ctx.globalAlpha = alpha;
    ctx.textAlign = "right"; ctx.fillText(r, x1, y); const rw = ctx.measureText(r).width;
    ctx.textAlign = "left"; ctx.fillText(fit(ctx, l, x1 - x0 - rw - 30), x0, y);
    ctx.globalAlpha = 1; y += LH;
  };
  rule();
  row(`PIECE Nº ${String(m.no).padStart(3, "0")}`, m.date, `500 24px ${MONO}`, 0.8);
  y -= 8; rule();
  row("asking price", money(m.asking));
  m.items.forEach((it) => row(it.label, money(it.amount)));
  y -= 8; rule();
  row("PAID VIA PAYPAL", money(m.paid), `700 34px ${MONO}`);
  row(m.day, "", `italic 400 26px ${MONO}`, 0.85);
  y += 6;
  ctx.textAlign = "center"; ctx.font = `italic 400 30px ${SERIF}`;
  fragLines.forEach((l) => { ctx.fillText(l, 0, y); y += 42; });
  y += 18;
  // 바코드 대신: 그 사람의 세 가지 색
  const bw = 150, bh = 40;
  m.palette.forEach((c, i) => { ctx.fillStyle = c; ctx.fillRect(-bw * 1.5 + i * bw, y, bw, bh); });
  ctx.strokeStyle = "rgba(0,0,0,.25)"; ctx.lineWidth = 2; ctx.strokeRect(-bw * 1.5, y, bw * 3, bh);
  y += bh + 44; ctx.fillStyle = ink; ctx.font = `400 22px ${MONO}`; ctx.globalAlpha = 0.65;
  ctx.fillText(`no refunds. it remembers you. — ${location.host}`, 0, y);
  ctx.restore();
}

function compose(ctx, glCanvas, sale) {
  const m = receiptModel(sale);
  ctx.drawImage(glCanvas, 0, 0, W, H);
  const g = ctx.createLinearGradient(0, 0, 0, 420); g.addColorStop(0, "rgba(0,0,0,.55)"); g.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, 420);
  ctx.textAlign = "center"; ctx.fillStyle = "#f6f1e7";
  ctx.font = `500 24px ${MONO}`; ctx.globalAlpha = 0.75;
  ctx.fillText("PAID FOR WITH MONEY AND ONE " + weekday(sale.time).toUpperCase(), W / 2, 128);
  ctx.globalAlpha = 1; ctx.font = `italic 400 66px ${SERIF}`;
  wrap(ctx, m.title, W - 180).slice(0, 2).forEach((l, i) => ctx.fillText(l, W / 2, 222 + i * 78));
  drawReceipt(ctx, m, W / 2, H - 70);
}

// 미술관 벽 라벨: 재료(Medium) 칸에 그 사람이 값으로 치른 것들이 적힌다
export function labelModel(sale) {
  const gifts = (sale.receipt || []).filter((x) => x.amount < 0).map((x) => x.label).slice(0, 4);
  const paid = `$${Number(sale.price).toFixed(2)} via PayPal`;
  const medium = sale.burned ? `Light, breath, one ${weekday(sale.time)}, and ${paid}. Receipt burned; gold leaf.`
    : gifts.length ? `${gifts.join("; ")}; and ${paid}` : `one ${weekday(sale.time)} and ${paid}`;
  return {
    artist: "Still Breathing", sub: "a painting that sells itself, b. 2026",
    title: (sale.style && sale.style.title) || "Untitled, today", year: new Date(sale.time * 1000).getFullYear(),
    medium, no: sale.n,
    owner: sale.burned ? "Definitive owner: the person who burned the receipt." : "Collection of the person who said it.",
  };
}

function composeLabel(ctx, glCanvas, sale) {
  const m = labelModel(sale);
  ctx.drawImage(glCanvas, 0, 0, W, H);
  const x = 120, maxW = 640; let y = H - 470;
  ctx.textAlign = "left"; ctx.fillStyle = "#1d1c1a";
  ctx.font = `700 34px ${SANS}`; ctx.fillText(m.artist, x, y); y += 42;
  ctx.font = `400 26px ${SANS}`; ctx.globalAlpha = 0.7; ctx.fillText(m.sub, x, y); ctx.globalAlpha = 1; y += 62;
  ctx.font = `italic 400 34px ${SERIF}`;
  const tl = wrap(ctx, m.title, maxW).slice(0, 2);
  tl.forEach((l, i) => { ctx.fillText(i === tl.length - 1 ? `${l}, ${m.year}` : l, x, y); y += 44; });
  y += 14; ctx.font = `400 25px ${SANS}`;
  wrap(ctx, m.medium, maxW).slice(0, 5).forEach((l) => { ctx.fillText(l, x, y); y += 35; });
  y += 14; ctx.globalAlpha = 0.7;
  ctx.fillText("Dimensions variable. Grows calmer with age.", x, y); y += 35;
  ctx.fillText(m.owner, x, y); y += 35;
  ctx.globalAlpha = 1;
  // 오른쪽 아래: 작품 번호와 주소, 작게
  ctx.textAlign = "right"; ctx.font = `500 22px ${MONO}`; ctx.globalAlpha = 0.55;
  ctx.fillText(`Nº ${String(m.no).padStart(3, "0")}`, W - 120, H - 470);
  ctx.fillText(location.host, W - 120, H - 120);
  ctx.globalAlpha = 1;
}

async function makeRenderer(child, opts = {}) {
  const s = child.sale;
  const glCanvas = document.createElement("canvas");
  const wall = opts.wall ? "#ece9e2" : null;
  const field = createField(glCanvas, { child: true, size: [W, H], childR: wall ? 0.17 : 0.15, childOff: 0, childOffY: wall ? 0.12 : 0.19, wall });
  field.setGold(s.burned ? 1 : 0);
  if (s.piece) field.setPiece(s.piece);
  field.setHistory(s.history);
  field.setSeed(child.seed % 997);
  field.setMood(s.mood, s.hue); field.setStyle(s.style, 1); field.snap();
  field.setAge((Date.now() / 1000 - child.born) % 100000);
  const out = document.createElement("canvas"); out.width = W; out.height = H;
  return { field, glCanvas, out, ctx: out.getContext("2d") };
}

export async function storyImage(child, kind = "label") {
  const r = await makeRenderer(child, { wall: kind === "label" });
  await new Promise((ok) => setTimeout(ok, 300));
  r.field.snapshot(); (kind === "label" ? composeLabel : compose)(r.ctx, r.glCanvas, child.sale);
  return new Promise((ok) => r.out.toBlob((b) => ok(b), "image/png"));
}

export async function storyVideo(child, seconds = 6, onProgress = () => {}) {
  const r = await makeRenderer(child, { wall: true });
  const types = ["video/mp4;codecs=avc1", "video/mp4", "video/webm;codecs=vp9", "video/webm"];
  const mime = types.find((t) => window.MediaRecorder && MediaRecorder.isTypeSupported(t));
  if (!mime) throw new Error("This browser can't record video");
  const stream = r.out.captureStream(30);
  const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 8_000_000 });
  const chunks = []; rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  const done = new Promise((ok) => (rec.onstop = ok));
  const t0 = performance.now(); let raf;
  const loop = () => {
    r.field.snapshot(); composeLabel(r.ctx, r.glCanvas, child.sale);
    const k = (performance.now() - t0) / (seconds * 1000); onProgress(Math.min(1, k));
    if (k < 1) raf = requestAnimationFrame(loop); else rec.stop();
  };
  setTimeout(() => r.field.gesture("bloom"), 1200);  // 영상 중간에 한 번 피어난다
  rec.start(); loop(); await done; cancelAnimationFrame(raf);
  return new Blob(chunks, { type: mime.split(";")[0] });
}

export async function shareOrDownload(blob, filename, title) {
  const file = new File([blob], filename, { type: blob.type });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try { await navigator.share({ files: [file], title }); return "shared"; } catch (e) { if (e.name === "AbortError") return "cancelled"; }
  }
  const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = filename;
  document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  return "downloaded";
}
