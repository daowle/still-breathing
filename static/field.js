// 살아 있는 빛의 장. 원본 그림(parent)과 새끼 그림(child)이 같은 셰이더를 쓴다.
// - mood: warmth / agitation / openness / hue 가 색·흐름·숨을 정한다
// - gesture: 대화 한 번마다 1~3초짜리 몸짓 (움찔·피어남·등돌림·웃음·숨참음·떨림)
// - holes: 팔려 나간 조각의 빈자리(흉터). 영구히 남는다
// - piece: 지금 손님에게 팔릴 조각. 흥정이 무르익을수록 이음매가 빛나고, 결제하면 떨어져 나간다
const MAX_HOLES = 24;
const TEXTURES = ["smoke", "marble", "watercolor", "ink", "glass", "aurora", "halftone"];
const MOTIONS = ["drift", "pulse", "swirl", "flicker", "still"];
const hexRgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
// 가격 기록 → 테두리 16칸 (-1 뾰족 .. +1 둥글). 내린 값은 구간을 채우고, 올린 값은 가운데 한 점만 판다
export function edgeProfile(history) {
  const out = new Array(16).fill(0);
  const h = (history || []).filter((x) => x > 0);
  const deltas = h.slice(1).map((v, i) => (v - h[i]) / h[i]).slice(-16);
  const m = deltas.length;
  deltas.forEach((dl, j) => {
    const a = Math.floor(j * 16 / m), b = Math.max(a + 1, Math.floor((j + 1) * 16 / m));
    if (dl < -0.005) for (let k = a; k < b; k++) out[k] = Math.max(out[k], Math.min(1, 0.35 - dl * 3));
    else if (dl > 0.005) out[Math.floor((a + b - 1) / 2)] = -Math.min(1, 0.45 + dl * 4);
  });
  return out;
}

// ---- 몸짓의 역학 ----
// 셰이더는 시간 봉투가 아니라 용수철 상태(연속값)만 받는다. 몸짓은 용수철의 목표값 곡선과 "툭" 치는 충격으로 적는다.
// 그래서 관성·오버슈트·여운이 생기고, 몸짓이 겹쳐도 튀지 않는다.
const ss = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const hold = (t, rise, stay, fall) => ss(0, rise, t) * (1 - ss(stay, fall, t));  // 0→1 (rise) … 1→0 (stay~fall)
// 채널: [각진동수 ω, 감쇠비 ζ, 쉬는 값]
const REST = {
  pull: [12, 0.42, 0], pullFar: [6, 0.55, 0],      // 조각 쪽으로 움츠림(+)/다가옴(-). Far 는 바깥이 늦게 따라오는 여운
  twist: [6, 0.7, 0], twistFar: [2.4, 0.8, 0],     // 조각을 축으로 몸을 돌림
  lift: [9, 1, 0], chill: [10, 1, 0],              // 밝기 / 핏기 빠짐
  bloom: [7, 0.9, 0], bloomR: [2.6, 1, 0],         // 빛무리 세기 / 반경(늦게 넓어짐)
  focus: [5, 1, 0], shim: [14, 1, 0], glint: [30, 1, 0],
  gaze: [5, 1, 1], flow: [4, 1, 1],                // 관객을 보는 빛 / 흐름 속도 배율
  inh: [5, 1, 0], draw: [3.4, 1, 0], fill: [8, 0.6, 0],   // 말을 마시는 동안: 빛 / 해류 끌림 / 조각에 차오르는 빛
};
const FOLLOW = { pullFar: "pull", twistFar: "twist", bloomR: "bloom" };
const laughKicks = [[0, 1], [0.25, 0.85], [0.48, 0.65], [0.70, 0.45], [0.90, 0.28]].map(([t, k], i) =>
  [t, { pull: -1.8 * k, lift: 2.2 * k, twist: (i % 2 ? -0.5 : 0.5) * k }]);
const GDEF = {
  // 움찔: 순식간에 움츠렸다가(2~3번 잦아드는 반동) 핏기는 가장 늦게 돌아온다
  flinch: { dur: 2.8, spring: { pull: [15, 0.3], pullFar: [7, 0.5], twist: [12, 0.45], chill: [14, 1], lift: [14, 1], flow: [10, 1] },
    kicks: [[0, { pull: 2.3, twist: 0.9 }]],
    tgt: (t) => ({ chill: 0.8 * hold(t, 0.08, 0.5, 2.6), lift: -0.24 * hold(t, 0.06, 0.3, 1.9), gaze: 1 - 0.85 * hold(t, 0.1, 0.7, 2.4),
      flow: 1 - 0.92 * hold(t, 0.05, 0.45, 1.8), glint: hold(t, 0.03, 0.1, 0.7) }) },
  // 피어남: 조각이 먼저 밝아지고 → 몸이 다가오고 → 빛무리가 넓게 번진 뒤 천천히 가라앉는다
  bloom: { dur: 3.8, spring: { pull: [5, 0.5], pullFar: [3, 0.6] },
    tgt: (t) => ({ pull: -0.065 * hold(t, 0.9, 1.7, 3.6), bloom: hold(t, 0.6, 1.5, 3.4), lift: 0.14 * hold(t, 0.8, 1.9, 3.7),
      flow: 1 + 1.3 * hold(t, 0.5, 1.6, 3.6), fill: 0.35 * hold(t, 0.3, 1.0, 2.6) }) },
  // 등돌림: 시선을 거두고, 안쪽부터 천천히 몸을 돌린다. 바깥은 한참 뒤에 따라 감긴다. 마지못해 돌아온다
  turn_away: { dur: 4.6, spring: { twist: [4.5, 0.8], twistFar: [2.0, 0.85], pull: [4, 0.9] },
    tgt: (t) => { const h = hold(t, 1.0, 2.8, 4.6);
      return { twist: 0.46 * hold(t, 1.2, 2.6, 4.4), pull: 0.035 * h, lift: -0.2 * h, chill: 0.35 * h, focus: 0.3 * h,
        gaze: 1 - hold(t, 0.5, 3.0, 4.6), flow: 1 - 0.55 * h }; } },
  // 웃음: 하-하-하. 점점 작아지는 통통 튀는 반동, 빛이 같이 반짝이고 흐름이 잠깐 빨라진다
  laugh: { dur: 2.8, spring: { pull: [20, 0.38], pullFar: [9, 0.5], twist: [10, 0.5], lift: [16, 0.5] },
    kicks: laughKicks,
    tgt: (t) => ({ lift: 0.1 * hold(t, 0.15, 1.0, 2.4), bloom: 0.3 * hold(t, 0.2, 1.0, 2.4), flow: 1 + 2.6 * hold(t, 0.15, 1.1, 2.6) }) },
  // 숨 참기: 흐름이 멎고, 빛이 조각으로 모이며 천천히 들이쉰다 … 그리고 내쉰다 (살짝 넘쳤다 돌아옴)
  hold_breath: { dur: 4.6, spring: { pull: [6, 0.42], pullFar: [3.5, 0.55], flow: [3.5, 1] },
    tgt: (t) => ({ pull: 0.075 * hold(t, 1.2, 2.5, 2.85), focus: 0.7 * hold(t, 1.1, 2.5, 3.4),
      flow: 1 - 0.97 * hold(t, 0.7, 2.5, 3.2) + 0.9 * hold(t - 2.9, 0.5, 0.8, 1.6),
      lift: 0.1 * hold(t - 2.6, 0.4, 0.6, 1.7), glint: 0.45 * hold(t, 1.2, 2.5, 3.0) }) },
  // 떨림: 한기가 두 번 훑고 지나간다 (브르르… 브르)
  shiver: { dur: 2.6, spring: { pull: [14, 0.4] },
    kicks: [[0, { pull: 0.7 }], [1.0, { pull: 0.4 }]],
    tgt: (t) => ({ shim: hold(t, 0.1, 0.4, 1.0) + 0.55 * hold(t - 1.0, 0.1, 0.35, 1.0), chill: 0.36 * hold(t, 0.2, 1.3, 2.5),
      lift: -0.07 * hold(t, 0.2, 1.3, 2.5), flow: 1 - 0.5 * hold(t, 0.1, 0.5, 1.5) }) },
};
const STEP = 1 / 240;
function createDynamics() {
  const S = {}; for (const k in REST) S[k] = { x: REST[k][2], v: 0, t: REST[k][2], w: REST[k][0], z: REST[k][1] };
  let g = null, inhaling = false, inT = 0, inDur = 1.9, acc = 0, shimPh = 0, inPh = 0;
  const start = (name) => {
    const def = GDEF[name]; if (!def) return;
    for (const k in REST) { const p = (def.spring && def.spring[k]) || REST[k]; S[k].w = p[0]; S[k].z = p[1]; }
    g = { def, t: 0, i: 0 };
  };
  const step = (h) => {
    let tg = null;
    if (g) {
      const ks = g.def.kicks || [];
      while (g.i < ks.length && ks[g.i][0] <= g.t) { const imp = ks[g.i++][1]; for (const k in imp) S[k].v += imp[k]; }
      tg = g.def.tgt(g.t); g.t += h;
      if (g.t > g.def.dur) g = null;
    }
    for (const k in REST) S[k].t = tg && k in tg ? tg[k] : REST[k][2];
    for (const k in FOLLOW) S[k].t = S[FOLLOW[k]].x;
    // 말을 마시는 숨: 글자가 다가올수록 끌림이 세진다 (중력처럼 가속)
    if (inhaling) inT += h;
    const it = inhaling ? Math.pow(Math.min(1, inT / inDur), 1.7) : 0;
    S.inh.t = it; S.draw.t = it; S.draw.w = inhaling ? 3.4 : 1.5;   // 풀릴 때는 긴 날숨처럼 느리게
    S.fill.t = Math.max(S.fill.t, 0.6 * it);
    for (const k in S) { const s = S[k]; s.v += (s.w * s.w * (s.t - s.x) - 2 * s.z * s.w * s.v) * h; s.x += s.v * h; }
    shimPh += h * 46; inPh += h * (0.4 + 1.6 * S.inh.x);
  };
  return {
    S, start,
    advance(dt) { acc += dt; while (acc >= STEP) { step(STEP); acc -= STEP; } },
    // 정지 화면용: 쉬는 자세에서 그 몸짓을 gt 초까지 그대로 돌려 본 상태 (결정적)
    simulate(name, gt) {
      for (const k in S) Object.assign(S[k], { x: REST[k][2], v: 0, t: REST[k][2] });
      g = null; inhaling = false; acc = 0; shimPh = 0; inPh = 0;
      start(name); for (let n = Math.round(gt / STEP); n > 0; n--) step(STEP);
    },
    run(sec) { for (let n = Math.round(sec / STEP); n > 0; n--) step(STEP); },
    inhale(dur) { inhaling = true; inT = 0; inDur = Math.max(0.6, dur); },
    absorb() { inhaling = false; S.pull.v += 1.1; S.fill.v += 4.5; },   // 꿀꺽: 한 번 움츠렸다 부풀며 가라앉는다
    get shimPh() { return shimPh; }, get inPh() { return inPh; },
  };
}
const GESTURES = { none: 0, flinch: 1, bloom: 2, turn_away: 3, laugh: 4, hold_breath: 5, shiver: 6 };

const FRAG = `
precision highp float;
uniform vec2 uRes; uniform float uTime;
uniform float uWarmth, uAgit, uOpen, uHue, uSeed;
uniform vec4 uHoles[${MAX_HOLES}]; uniform float uHoleHue[${MAX_HOLES}]; uniform int uHoleCount;
uniform vec4 uPiece; uniform float uPieceGlow, uDetach, uInhale, uDraw, uFill, uInPh, uAbT;
// 몸짓은 JS 쪽 용수철이 계산한 연속값으로 들어온다 (끊김·튐 없이 서로 겹친다)
uniform float uPull, uPullFar, uTwist, uTwistFar, uLift, uChill, uBloom, uBloomR, uFocus, uShim, uShimPh, uGlint, uGaze;
uniform float uFlow, uBreath, uPulse, uAgitS; uniform vec2 uDrift;
uniform vec2 uMouse; uniform float uChild, uChildR, uChildOff;
uniform sampler2D uEdge; uniform float uChildOffY;
uniform float uGold, uWallOn; uniform vec3 uWall;
uniform vec3 uPal0, uPal1, uPal2; uniform float uTex, uMotion, uStyleMix;

vec3 hsv(float h, float s, float v){
  vec3 k = clamp(abs(mod(h*6.0+vec3(0.,4.,2.),6.)-3.)-1.,0.,1.);
  return v*mix(vec3(1.),k,s);
}
float hash(vec2 p){ return fract(sin(dot(p,vec2(127.1,311.7))+uSeed)*43758.5453); }
float noise(vec2 p){
  vec2 i=floor(p), f=fract(p); f=f*f*(3.-2.*f);
  return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x),f.y);
}
// 모양 전용 잡음: 시드와 무관해야 새끼 그림이 원본의 흉터와 같은 모양이 된다
float hash0(vec2 p){ return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453); }
float noise0(vec2 p){
  vec2 i=floor(p), f=fract(p); f=f*f*(3.-2.*f);
  return mix(mix(hash0(i),hash0(i+vec2(1,0)),f.x),mix(hash0(i+vec2(0,1)),hash0(i+vec2(1,1)),f.x),f.y);
}
float fbm(vec2 p){ float v=0., a=.5; for(int i=0;i<5;i++){ v+=a*noise(p); p=p*2.03+17.; a*=.5; } return v; }
float rs(float a, float b, float x){ return 1.0 - smoothstep(b, a, x); }  // a>b 인 smoothstep
mat2 rot(float a){ float c=cos(a), s=sin(a); return mat2(c,-s,s,c); }
vec2 toP(vec2 uv){ return (uv-0.5)*vec2(uRes.x/uRes.y,1.0); }

// 조각 모양: 불규칙한 파편. d<0 이면 안쪽
// 흥정 궤적 테두리: 값이 내려간 구간은 둥글게 부풀고, 올라간 구간은 뾰족하게 파인다
float edgeAt(float i, float row){ return texture2D(uEdge, vec2((mod(i, 16.0)+0.5)/16.0, (row+0.5)/32.0)).r*2.0 - 1.0; }
float edgeMod(float a, float row){
  float k = (a/6.28318 + 0.5)*16.0, i0 = floor(k), f = fract(k);
  float e0 = edgeAt(i0, row), e1 = edgeAt(i0+1.0, row);
  float bulge = mix(max(e0, 0.0), max(e1, 0.0), smoothstep(0.0, 1.0, f));
  float notch = max(-e0, 0.0)*max(0.0, 1.0-f*2.6) + max(-e1, 0.0)*max(0.0, 1.0-(1.0-f)*2.6);
  return 0.16*bulge - 0.30*notch;
}
float shapeD(vec2 p, vec2 c, float r, float s, float row){
  vec2 d = p-c; float a = atan(d.y, d.x);
  if (length(d) > r*1.8) return length(d) - r*1.3;
  float k1 = 2.0 + mod(floor(s), 4.0);            // 2~5갈래
  float k2 = k1 + 2.0 + mod(floor(s*1.7), 4.0);
  float rr = r*(1.0 + 0.22*sin(k1*a+s) + 0.11*sin(k2*a+s*2.3) + 0.05*sin(13.0*a+s*0.7) + 0.03*sin(29.0*a+s*1.9)
               + 0.10*(noise0(vec2(a*2.0+s, s)) - 0.5));
  if (row >= 0.0) rr *= 1.0 + edgeMod(a, row);
  return length(d) - rr;
}
vec3 glowCol(){ return hsv(uHue/360.0 + 0.08*uWarmth, 0.25, 1.0); }

vec3 field(vec2 p, float t){
  float breath = 0.5+0.5*sin(uBreath);
  vec2 drift = uDrift;                                  // 한 줄기 해류: 방향이 아주 천천히 굽이친다
  vec2 q = vec2(fbm(p*1.4 + drift), fbm(p*1.4 + drift + vec2(5.2, 1.3)));
  vec2 r = vec2(fbm(p*1.8 + 2.6*q + vec2(1.7, 9.2) + 0.7*drift + 0.12*t), fbm(p*1.8 + 2.6*q + vec2(8.3, 2.8) + 0.7*drift + 0.09*t));
  float f = fbm(p*1.3 + (2.0 + 1.3*uAgitS)*r + 0.5*drift);
  float h = uHue/360.0;
  vec3 deep = hsv(h+0.55, 0.6, 0.07+0.07*uWarmth);
  vec3 mid  = hsv(h, 0.55+0.3*uWarmth, 0.5+0.1*uWarmth);
  vec3 col = mix(deep, mid, smoothstep(0.25, 0.75, f));
  col = mix(col, glowCol(), smoothstep(0.62-0.18*uOpen, 0.95, f+0.12*breath*uOpen));
  // 관객을 바라본다: 커서 쪽으로 빛이 모인다
  col += glowCol() * (0.08+0.22*uOpen) * exp(-length(p-uMouse)*4.0) * (0.5+f) * uGaze;
  return col;
}
vec3 voidCol(vec2 p, float hue){
  float dust = step(0.996, hash(floor(p*260.0))) * (0.5+0.5*sin(uTime*2.0+hash(floor(p*260.0))*30.0));
  return hsv(hue+0.5, 0.5, 0.025) + vec3(dust*0.35);
}

// ---- 취향 유전자로 그린 조각: 팔레트 3색 × 질감 7종 × 움직임 5종 ----
vec3 pal3(float v){ v = clamp(v, 0.0, 1.0); return v < 0.5 ? mix(uPal0, uPal1, v*2.0) : mix(uPal1, uPal2, (v-0.5)*2.0); }
vec3 styled(vec2 p){
  int tx = int(uTex+0.5), mo = int(uMotion+0.5);
  float T = uTime, sp = 1.0;
  if (mo == 0) p += vec2(T*0.025, T*0.01);                       // drift
  if (mo == 1) p *= 1.0 + 0.07*sin(T*1.6);                        // pulse
  if (mo == 2) p = rot(length(p)*1.6*sin(T*0.12) + T*0.05) * p;   // swirl
  if (mo == 4) sp = 0.25;                                         // still
  float t = T*0.06*sp;
  vec3 col;
  if (tx == 0) {          // smoke
    vec2 q = vec2(fbm(p*1.8+t), fbm(p*1.8-t+5.2));
    col = pal3(smoothstep(0.2, 0.85, fbm(p*1.5+2.5*q+t)));
  } else if (tx == 1) {   // marble
    float f = fbm(p*2.0+t);
    float v = 0.5+0.5*sin(p.x*5.0 + p.y*3.0 + 7.0*f + t*2.0);
    float vein = pow(1.0-abs(sin(p.x*3.0 - p.y*4.0 + 9.0*fbm(p*1.3-t))), 18.0);
    col = mix(pal3(0.5+0.5*v), uPal0, vein*0.85);
  } else if (tx == 2) {   // watercolor
    float f = fbm(p*2.2 + 0.7*vec2(fbm(p*3.0+t), fbm(p*3.0-t+3.0)));
    float bands = floor(f*5.0)/5.0, edge = smoothstep(0.75, 1.0, fract(f*5.0));
    vec3 paper = mix(uPal2, vec3(1.0), 0.5);
    col = mix(paper, pal3(bands*1.3-0.1), 0.78) * (1.0 - 0.25*edge);
    col *= 0.93 + 0.07*noise(p*90.0);
  } else if (tx == 3) {   // ink on paper
    float f = fbm(p*2.6 + 0.8*fbm(p*4.0+t) + t*0.5);
    float ink = smoothstep(0.57, 0.61, f), bleed = smoothstep(0.50, 0.57, f)*(1.0-ink);
    vec3 paper = mix(uPal2, vec3(0.98, 0.96, 0.92), 0.6);
    col = mix(mix(paper, uPal1, bleed*0.65), uPal0 + 0.06, ink);
    col *= 0.95 + 0.05*noise(p*120.0);
  } else if (tx == 4) {   // glass facets
    vec2 cp = p*4.5; vec2 ip = floor(cp), fq = fract(cp); float F1 = 8.0, F2 = 8.0; vec2 id = vec2(0.0);
    for (int j=-1;j<=1;j++) for (int i=-1;i<=1;i++) {
      vec2 o = vec2(float(i), float(j));
      vec2 rn = 0.5 + 0.4*sin(t*6.0 + 6.2831*vec2(hash0(ip+o), hash0(ip+o+19.0)));
      float dd = length(o+rn-fq);
      if (dd < F1) { F2 = F1; F1 = dd; id = ip+o; } else if (dd < F2) { F2 = dd; }
    }
    col = pal3(hash0(id*1.7)) * (0.75 + 0.5*(1.0-F1));
    col += hsv(F1*1.5 + t*2.0, 0.5, 0.22);
    col = mix(uPal0*0.4, col, smoothstep(0.02, 0.07, F2-F1));
  } else if (tx == 5) {   // aurora
    col = uPal0*0.6;
    for (int i=0;i<3;i++) {
      float fi = float(i);
      float y = 0.15*sin(p.x*2.0+t*3.0+fi*2.0) + 0.25*(fbm(vec2(p.x*1.5+fi*3.0, t*2.0))-0.5) + (fi-1.0)*0.12;
      float band = exp(-pow((p.y-y)*5.0, 2.0)) * (0.55+0.45*sin(p.x*25.0 + fbm(p*3.0+fi)*8.0 + t*4.0));
      col += mix(uPal1, uPal2, fi/2.0) * band * 0.85;
    }
    col += vec3(step(0.997, hash0(floor(p*200.0)))*0.5);
  } else {                // halftone (two-ink riso)
    vec2 q = vec2(fbm(p*1.8+t), fbm(p*1.8-t+5.2));
    float f = smoothstep(0.25, 0.8, fbm(p*1.5+2.5*q+t));
    vec3 paper = mix(uPal2, vec3(1.0), 0.55);
    float d1 = length(fract(rot(0.4)*p*55.0)-0.5), r1 = 0.55*sqrt(f);
    float d2 = length(fract(rot(1.1)*(p+0.004)*55.0)-0.5), r2 = 0.45*sqrt(1.0-f);
    col = paper * mix(vec3(1.0), uPal1, rs(r2, r2-0.08, d2)*0.9);
    col *= mix(vec3(1.0), min(uPal0*1.4, vec3(1.0)), rs(r1, r1-0.08, d1));
  }
  if (mo == 3) col *= 0.85 + 0.3*noise(vec2(T*9.0, p.x*3.0));  // flicker
  return col;
}

void main(){
  vec2 p = (gl_FragCoord.xy-.5*uRes)/uRes.y;
  float t = uFlow;

  // ---- 좌표 비틀기 (몸짓) ----
  vec2 fp = p;
  if (uChild > 0.5) {
    float wob = 1.0 + 0.035*sin(uTime*0.8);
    fp = toP(uPiece.xy) + rot(0.06*sin(uTime*0.21)) * (p - vec2(uChildOff, uChildOffY)) * (uPiece.z/uChildR) / wob;
  }
  // 몸짓은 모두 조각을 중심으로 한 몸의 움직임이다. 안쪽이 먼저 움직이고 바깥이 늦게 따라온다
  vec2 gc0 = uPiece.z > 0.0 ? toP(uPiece.xy) : vec2(0.0);
  vec2 lc = uChild > 0.5 ? vec2(uChildOff, uChildOffY) : gc0;   // 빛의 중심 (화면 좌표)
  float L0 = length(p - lc);
  {
    vec2 gd = fp - gc0; float gL = length(gd);
    float kN = exp(-gL*2.6), kF = exp(-gL*0.9) - kN;
    // 떨림: 조각에서 바깥으로 번지는 잔물결 같은 전율 (접선 방향이라 비단처럼 일렁인다)
    if (uShim > 0.001) {
      vec2 rd = gd/(gL+1e-3), tn = vec2(-rd.y, rd.x);
      float m = (0.5 + 0.5*noise0(fp*2.3 + 3.1)) * smoothstep(0.0, 0.08, gL) * exp(-gL*0.8);
      gd += (tn*sin(uShimPh - gL*11.0) + rd*0.45*sin(uShimPh*1.31 - gL*7.0 + 1.7)) * 0.0052*uShim*m;
    }
    gd = rot(uTwist*kN + uTwistFar*kF) * gd * (1.0 + uPull*kN + uPullFar*kF);
    fp = gc0 + gd;
  }

  // 말이 날아오는 동안: 조각은 가만히 있고, 둘레의 해류가 중력에 끌리듯 나선으로 감겨 든다
  float abG = 0.0, swell = 0.0, wisp = 0.0;
  vec2 hp = fp;   // 흉터는 해류에 쓸려 가지 않는다: 물살이 바위를 돌아 흐르듯
  if (uChild < 0.5 && uPiece.z > 0.0) {
    vec2 dv = fp - gc0; float L = length(dv);
    float w = smoothstep(uPiece.z*1.0, uPiece.z*2.8, L);
    fp = gc0 + rot(uDraw*0.62*w*exp(-L*2.1)) * dv * (1.0 + uDraw*0.7*w*exp(-L*1.7));
    if (uInhale > 0.002) {   // 빨려 드는 빛의 실
      vec2 dh = rot(3.2*L0) * (p - gc0)/(L0+1e-3);   // 곧은 살이 아니라 나선으로 감겨 든다
      float A = noise0(dh*2.6 + 4.0);
      float wv = noise0(vec2(L0*5.0 + uInPh, A*9.0));
      wisp = wv*wv*wv * uInhale * smoothstep(uPiece.z*0.9, uPiece.z*2.4, L0) * exp(-L0*2.3);
    }
    if (uAbT < 5.0) {        // 닿는 순간: 넓고 부드러운 빛의 너울이 한 번 번져 나간다
      float R = 0.06 + 0.8*(1.0 - exp(-uAbT*1.4));
      float x = (L0 - R)/(0.09 + 0.3*R);
      swell = exp(-x*x) * exp(-uAbT*1.5) * smoothstep(0.0, 0.12, uAbT);
      abG = exp(-uAbT*2.0) * smoothstep(0.0, 0.07, uAbT);
    }
  }

  vec3 col = uChild > 0.5 ? styled(p*1.3) : field(fp, t);
  vec3 gc = mix(glowCol(), uPal2, uStyleMix*0.8);
  float voidM = 0.0;   // 빈자리에는 빛이 고이지 않는다
  if (uChild < 0.5) {
    col *= 1.0 + 1.5*wisp + 0.5*swell;
    col += gc * (0.10*wisp + 0.06*swell + 0.10*uInhale*exp(-L0*3.6));
  }

  if (uChild < 0.5) {
    // ---- 팔려 나간 자리들 ----
    for (int i=0; i<${MAX_HOLES}; i++) {
      if (i >= uHoleCount) break;
      vec4 hl = uHoles[i]; float hh = uHoleHue[i]/360.0; float hg = step(1.0, hh); hh = fract(hh);  // hg: 영수증을 태운 자리
      float d = shapeD(hp, toP(hl.xy), hl.z, hl.w, float(i));
      float vm = rs(0.003, -0.004, d); voidM = max(voidM, vm);
      col = mix(col, voidCol(hp, hh), vm);
      col += mix(hsv(hh, 0.75, 1.0), vec3(1.0, 0.78, 0.38)*1.6, hg) * 0.0035/(abs(d)+0.0035) * (0.45+0.15*sin(uTime*1.3+float(i)*1.7));
      col += hg * vec3(1.0, 0.8, 0.4) * step(0.985, hash0(floor(hp*180.0))) * rs(0.0, -0.01, d) * (0.5+0.5*sin(uTime*2.0+hash0(floor(hp*180.0))*40.0));  // 구멍 속 금가루
    }
    // ---- 지금 팔릴 조각 ----
    if (uPiece.z > 0.0) {
      vec2 c = toP(uPiece.xy);
      float d = shapeD(fp, c, uPiece.z, uPiece.w, 31.0);
      if (uDetach <= 0.0) {
        col = mix(col, styled(fp*1.6), uStyleMix * rs(0.0, -0.004, d) * (0.75 + 0.25*sin(uTime*0.9)));
        float pulse = 0.6 + 0.4*sin(uPulse);
        float inside = rs(0.004, -0.004, d);
        // 말을 마실수록 이음매에서 안쪽으로 빛이 차오른다
        float fillM = inside * smoothstep(-(0.012 + uFill*uPiece.z*1.3), 0.0, d);
        float seam = 0.003/(abs(d)+0.003) * (0.15 + 1.1*uPieceGlow*pulse + 0.9*abG + 0.9*uFill);
        col += gc * seam * 0.8 + mix(gc, vec3(1.0), 0.65) * 0.004/(abs(d)+0.004) * uGlint * 1.3;
        col *= 1.0 + (0.25*uPieceGlow*pulse + 0.22*abG) * inside + 0.55*uFill*fillM;
        col += gc * 0.16*uFill*fillM;
      } else {
        float k = smoothstep(0.0, 1.0, uDetach);
        // 남은 자리: 빈 구멍과 타는 가장자리
        float holeIn = rs(0.003, -0.004, d) * min(1.0, uDetach*4.0);
        col = mix(col, voidCol(fp, uHue/360.0), holeIn);
        col += hsv(uHue/360.0, 0.75, 1.0) * 0.0035/(abs(d)+0.0035) * min(1.0, uDetach*3.0) * (1.0+2.0*(1.0-k));
        // 떨어져 날아가는 조각
        vec2 off = vec2(0.18, 0.85) * k*k + vec2(0.0, 0.03)*sin(uDetach*12.0)*(1.0-k);
        float sc = 1.0 - 0.6*k;
        vec2 local = c + rot(-0.7*k) * (fp - c - off) / sc;
        float dl = shapeD(local, c, uPiece.z, uPiece.w, 31.0);
        float a = rs(0.003, -0.003, dl) * (1.0 - k*k*k);
        col = mix(col, mix(field(local, t)*1.5, styled(local*1.6)*1.15, uStyleMix) + gc*0.15, a);
        col += gc * 0.005/(abs(dl)+0.005) * (1.0-k*k) * 1.2;
      }
    }
  } else {
    // ---- 새끼 그림: 떼어 낸 그 조각만 허공에 떠서 숨 쉰다 ----
    float d = shapeD(fp, toP(uPiece.xy), uPiece.z, uPiece.w, 31.0);
    float inside = rs(0.004, -0.004, d);
    // 영수증을 태운 조각: 이브 클랭처럼 금박이 앉는다
    if (uGold > 0.0) {
      // 네모난 금박을 겹쳐 붙인 것처럼: 찢긴 가장자리 + 이음매 + 장마다 다른 광택
      float leaf = smoothstep(0.55, 0.58, fbm(fp*12.0 + 7.0) + 0.10*noise0(fp*140.0));
      vec2 gq = fp*95.0 + 0.3*vec2(noise0(fp*20.0), noise0(fp*20.0+9.0)); vec2 gi = floor(gq), gf = fract(gq);
      float seam = smoothstep(0.0, 0.05, min(min(gf.x, gf.y), min(1.0-gf.x, 1.0-gf.y)));
      vec3 gold = vec3(0.93, 0.74, 0.36) * (0.82 + 0.3*hash0(gi) + 0.18*sin(uTime*1.1 + gi.x*0.9 + gi.y*0.4)) * (0.8 + 0.2*seam);
      col = mix(col, gold, leaf * uGold);
    }
    if (uWallOn > 0.5) {
      // 흰 벽에 걸린 작품: 아래로 떨어지는 부드러운 그림자
      float k = uPiece.z/uChildR;
      float ds = shapeD(fp + vec2(-0.012, 0.034)*k, toP(uPiece.xy), uPiece.z, uPiece.w, 31.0);
      float sh = 1.0 - smoothstep(-0.01*k, 0.06*k, ds);
      vec3 wall = uWall * (1.0 - 0.22*sh) * (0.985 + 0.03*noise(p*220.0));
      col = mix(wall, col * (1.0 - 0.25*rs(0.0, -0.006*k, -abs(d))), inside);
    } else {
      col = mix(voidCol(p, uHue/360.0), col, inside);
      col += mix(hsv(uHue/360.0, 0.7, 1.0), uPal2, 0.7) * 0.0025/(abs(d)+0.0025) * 0.45;
    }
  }

  // ---- 몸짓의 빛: 피어남·시선·핏기 ----
  {
    float bk = uChild > 0.5 ? 0.3 : 1.0;
    float R = 0.15 + 0.62*uBloomR;                         // 빛무리는 밝기보다 늦게 넓어진다
    float halo = exp(-L0*L0/(R*R));
    float cx = (L0 - R*1.1)/(0.12 + 0.16*R); float crest = exp(-cx*cx);
    col *= 1.0 + uBloom*0.32*halo*bk;
    col += gc * uBloom * (0.19*halo + 0.10*crest) * bk * (1.0 - 0.85*voidM);
    col *= max(0.0, 1.0 + uLift*(0.65 + 0.35*exp(-L0*1.4)));
    col *= 1.0 - 0.62*uFocus*smoothstep(0.10, 0.95, L0);   // 숨을 모으면 조각만 남기고 어두워진다
    float lum = dot(col, vec3(0.30, 0.59, 0.11));
    col = mix(col, lum*vec3(0.90, 0.97, 1.08), clamp(uChill*(0.55 + 0.45*exp(-L0*1.6)), 0.0, 1.0));
  }

  // 차가울수록 거칠어지는 결 + 비네트
  float grain = (uWallOn > 0.5 ? 0.02 : 0.035 + 0.17*uAgit*(1.0-uWarmth)) + 0.02*uShim;
  col += (hash(gl_FragCoord.xy+fract(uTime)) - .5) * grain;
  col *= 1.0 - (uWallOn > 0.5 ? 0.10 : 0.55)*length(p)*(1.2-uOpen*0.6);
  gl_FragColor = vec4(pow(max(col,0.), vec3(0.9)), 1.0);
}`;

export function createField(canvas, { child = false, size = null, childR = 0.28, childOff = null, childOffY = 0, wall = null } = {}) {
  const gl = canvas.getContext("webgl", { antialias: false, preserveDrawingBuffer: true });
  if (!gl) throw new Error("WebGL not supported");
  const sh = (type, src) => {
    const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
    return s;
  };
  const prog = gl.createProgram();
  gl.attachShader(prog, sh(gl.VERTEX_SHADER, "attribute vec2 a;void main(){gl_Position=vec4(a,0,1);}"));
  gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FRAG));
  gl.linkProgram(prog); gl.useProgram(prog);
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  const U = {};
  const u = (n) => (U[n] ??= gl.getUniformLocation(prog, n));

  const target = { warmth: 0.4, agitation: 0.2, openness: 0.3, hue: 210, glow: 0.1 };
  const cur = { ...target };
  let holes = [], piece = null, seed = 0, gold = 0;
  const edgeData = new Uint8Array(16 * 32).fill(128);
  const edgeTex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, edgeTex);
  for (const [k, v] of [[gl.TEXTURE_MIN_FILTER, gl.NEAREST], [gl.TEXTURE_MAG_FILTER, gl.NEAREST],
                        [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_2D, k, v);
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
  const writeRow = (row, prof) => { for (let i = 0; i < 16; i++) edgeData[row * 16 + i] = Math.round(128 + 127 * Math.max(-1, Math.min(1, (prof && prof[i]) || 0))); };
  const uploadEdges = () => { gl.bindTexture(gl.TEXTURE_2D, edgeTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.LUMINANCE, 16, 32, 0, gl.LUMINANCE, gl.UNSIGNED_BYTE, edgeData); };
  uploadEdges();
  const style = { pal: [[.05, .07, .14], [.25, .4, .6], [.85, .9, 1]], tpal: null, tex: 0, motion: 0, mix: 0, tmix: 0 };
  let simTime = 0, absorbAt = -1e9, detachAt = null;
  // 위상은 프레임마다 적분한다: 기분이 바뀌어 속도가 달라져도 무늬가 건너뛰지 않는다
  let flowT = 0, driftX = 0, driftY = 0, breathPh = 0, pulsePh = 0, agitS = target.agitation;
  const dyn = createDynamics();
  const mouse = { x: 0.3, y: 0.1, tx: 0.3, ty: 0.1 };

  const scale = 0.5;  // 부드러운 장이라 반 해상도로 그리고 CSS로 늘린다
  function resize() {
    if (size) { canvas.width = size[0]; canvas.height = size[1]; gl.viewport(0, 0, size[0], size[1]); return; }
    canvas.width = Math.round(innerWidth * scale); canvas.height = Math.round(innerHeight * scale);
    gl.viewport(0, 0, canvas.width, canvas.height);
  }
  addEventListener("resize", resize); resize();
  addEventListener("pointermove", (ev) => {
    mouse.tx = (ev.clientX - innerWidth / 2) / innerHeight;
    mouse.ty = -(ev.clientY - innerHeight / 2) / innerHeight;
  });

  let freeze = null;  // 캡처 확인용: {gesture, gt, detach}
  let last = performance.now(), lastDraw = 0;
  function frame(now) {
    requestAnimationFrame(frame);
    if (now - lastDraw < 15) return;  // 60fps: 흐름이 끊기지 않게
    lastDraw = now;
    const dt = Math.min(0.1, (now - last) / 1000); last = now;
    if (!freeze) dyn.advance(dt);
    const D = dyn.S, k = (r) => 1 - Math.exp(-dt * r);   // 프레임 속도와 무관한 감쇠
    const fl = Math.max(0, D.flow.x);
    simTime += dt * Math.min(1, Math.max(0.04, fl));     // 숨을 참거나 놀라면 시간이 멎는다
    for (const key of ["warmth", "agitation", "openness", "glow"]) cur[key] += (target[key] - cur[key]) * k(2.4);
    const dh = ((target.hue - cur.hue + 540) % 360) - 180; cur.hue = (cur.hue + dh * k(2.0) + 360) % 360;
    agitS += (cur.agitation - agitS) * k(0.7);           // 무늬의 굽이는 기분보다 훨씬 천천히 바뀐다 (끓지 않게)
    const fdt = dt * fl * (0.04 + 0.25 * cur.agitation);
    flowT += fdt;
    const da = 0.38 + 0.5 * Math.sin(flowT * 0.37) + 0.2 * Math.sin(flowT * 0.83 + 1.3);
    driftX += fdt * 0.6 * Math.cos(da); driftY += fdt * 0.6 * Math.sin(da);
    breathPh += dt * Math.min(1.5, fl) * (0.6 + cur.agitation * 2.0);
    pulsePh += dt * (2.0 + 3.0 * cur.glow);
    mouse.x += (mouse.tx - mouse.x) * k(3.2); mouse.y += (mouse.ty - mouse.y) * k(3.2);
    if (style.tpal) style.pal = style.pal.map((c, i) => c.map((v, j) => v + (style.tpal[i][j] - v) * k(2.4)));
    style.mix += (style.tmix - style.mix) * k(1.8);
    draw(now);
  }
  function draw(now) {

    if (freeze && freeze.detach != null) detachAt = now - freeze.detach * 3800;
    if (freeze && freeze.absorb != null) absorbAt = now - freeze.absorb * 1000;
    const D = dyn.S;
    for (const [n, key] of [["uPull", "pull"], ["uPullFar", "pullFar"], ["uTwist", "twist"], ["uTwistFar", "twistFar"], ["uLift", "lift"],
      ["uChill", "chill"], ["uBloom", "bloom"], ["uBloomR", "bloomR"], ["uFocus", "focus"], ["uShim", "shim"], ["uGlint", "glint"],
      ["uGaze", "gaze"], ["uInhale", "inh"], ["uDraw", "draw"], ["uFill", "fill"]]) gl.uniform1f(u(n), D[key].x);
    gl.uniform1f(u("uShimPh"), dyn.shimPh); gl.uniform1f(u("uInPh"), dyn.inPh);
    gl.uniform1f(u("uFlow"), flowT); gl.uniform2f(u("uDrift"), driftX, driftY);
    gl.uniform1f(u("uBreath"), breathPh); gl.uniform1f(u("uPulse"), pulsePh); gl.uniform1f(u("uAgitS"), agitS);
    gl.uniform2f(u("uRes"), canvas.width, canvas.height);
    gl.uniform1f(u("uTime"), simTime);
    gl.uniform1f(u("uWarmth"), cur.warmth); gl.uniform1f(u("uAgit"), cur.agitation);
    gl.uniform1f(u("uOpen"), cur.openness); gl.uniform1f(u("uHue"), cur.hue);
    gl.uniform1f(u("uSeed"), seed); gl.uniform1f(u("uChild"), child ? 1 : 0);
    gl.uniform2f(u("uMouse"), mouse.x, mouse.y);
    const hv = new Float32Array(MAX_HOLES * 4), hh = new Float32Array(MAX_HOLES);
    holes.forEach((h, i) => { hv.set([h.x, h.y, h.r, h.seed], i * 4); hh[i] = h.hue; });
    gl.uniform4fv(u("uHoles"), hv); gl.uniform1fv(u("uHoleHue"), hh);
    gl.uniform1i(u("uHoleCount"), Math.min(holes.length, MAX_HOLES));
    gl.uniform4f(u("uPiece"), ...(piece ? [piece.x, piece.y, piece.r, piece.seed] : [0, 0, 0, 0]));
    gl.uniform1f(u("uPieceGlow"), cur.glow);
    gl.uniform1f(u("uAbT"), (now - absorbAt) / 1000);
    gl.uniform1f(u("uDetach"), detachAt === null ? 0 : Math.min(1, (now - detachAt) / 3800));
    gl.uniform3fv(u("uPal0"), style.pal[0]); gl.uniform3fv(u("uPal1"), style.pal[1]); gl.uniform3fv(u("uPal2"), style.pal[2]);
    gl.uniform1f(u("uTex"), style.tex); gl.uniform1f(u("uMotion"), style.motion);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, edgeTex); gl.uniform1i(u("uEdge"), 0);
    gl.uniform1f(u("uChildOffY"), childOffY); gl.uniform1f(u("uGold"), gold);
    gl.uniform1f(u("uWallOn"), wall ? 1 : 0); gl.uniform3fv(u("uWall"), wall ? hexRgb(wall) : [0, 0, 0]);
    gl.uniform1f(u("uStyleMix"), child ? 1 : style.mix); gl.uniform1f(u("uChildR"), childR);
    // 넓은 화면에서는 조각을 오른쪽으로 비켜 글자와 겹치지 않게
    gl.uniform1f(u("uChildOff"), childOff ?? (canvas.width / canvas.height > 1.2 ? 0.28 * canvas.width / canvas.height - 0.2 : 0));
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }
  requestAnimationFrame(frame);

  return {
    setMood(m, hue) { Object.assign(target, m); if (hue != null) target.hue = hue; },
    setGlow(v) { target.glow = Math.max(0, Math.min(1, v)); },
    setHoles(sales) {
      // 흉터 테두리는 그 사람 팔레트의 가운데 색으로 탄다
      const hueOf = (hex) => {
        const [r, g, b] = hexRgb(hex), mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
        if (!d) return null;
        const h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
        return (h * 60 + 360) % 360;
      };
      holes = sales.filter((s) => s.piece).slice(-MAX_HOLES).map((s) => ({
        ...s.piece, hue: s.burned ? 402 : (s.style && s.style.palette && hueOf(s.style.palette[1])) ?? s.hue, history: s.history }));
      for (let i = 0; i < MAX_HOLES; i++) writeRow(i, holes[i] ? edgeProfile(holes[i].history) : null);
      uploadEdges();
    },
    setPiece(p) { piece = p; detachAt = null; },
    // 흥정한 값의 흐름이 조각 테두리를 깎는다
    setGold(v) { gold = v; },
    setHistory(h) { writeRow(31, edgeProfile(h)); uploadEdges(); },
    gesture(name) { if (GESTURES[name]) dyn.start(name); },
    // 말이 날아오기 시작. dur = 마지막 글자가 닿을 때까지 걸리는 초 (끌림이 그 박자에 맞춰 세진다)
    inhale(dur = 1.9) { dyn.inhale(dur); },
    absorb() { absorbAt = performance.now(); dyn.absorb(); },  // 말이 닿음
    detach() { detachAt = performance.now(); return new Promise((ok) => setTimeout(ok, 3900)); },
    setSeed(s) { seed = s; },
    snap() { Object.assign(cur, target); agitS = cur.agitation; if (style.tpal) style.pal = style.tpal; style.mix = style.tmix; },
    // 취향 유전자: {palette:[hex×3], texture, motion}. strength 0~1 = 조각이 얼마나 그 사람으로 물들었나
    setStyle(st, strength = 1) {
      if (!st) return;
      if (st.palette && st.palette.length === 3) style.tpal = st.palette.map(hexRgb);
      style.tex = Math.max(0, TEXTURES.indexOf(st.texture)); style.motion = Math.max(0, MOTIONS.indexOf(st.motion));
      style.tmix = strength;
    },
    snapshot() { draw(performance.now()); return canvas.toDataURL("image/png"); },
    freeze(f) {
      freeze = f; this.snap();
      if (!f) return;
      dyn.simulate(f.gesture, f.gesture ? f.gt || 0 : 0);
      // {inhale: s} = 말이 날아온 지 s초 (전체 1.9초) / {absorb: s} = 닿은 지 s초
      if (f.inhale != null || f.absorb != null) { dyn.inhale(1.9); dyn.run(f.absorb != null ? 1.9 : f.inhale); }
      if (f.absorb != null) { dyn.absorb(); dyn.run(f.absorb); }
    },
    setAge(seconds) { simTime = seconds; },
    // uv(0..1, 아래가 0) → 화면 px
    toScreen(x, y) { return { x: x * innerWidth, y: (1 - y) * innerHeight }; },
    pieceScreen() {
      if (!piece) return { x: innerWidth * 0.6, y: innerHeight * 0.5, r: 60 };
      return { ...this.toScreen(piece.x, piece.y), r: piece.r * innerHeight };
    },
  };
}
