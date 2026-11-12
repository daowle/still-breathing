// 그림의 숨소리. 음원 파일 없이 브라우저에서 합성한다.
// 낮은 울림(드론) + 숨결(걸러진 잡음) + 몸짓마다 짧은 소리.
export function createAudio() {
  let ctx = null, master, filt, osc1, osc2, osc3, breathGain, breathLfo, lfoDepth, on = false;
  const mood = { warmth: 0.4, agitation: 0.2, openness: 0.3 };

  function noiseBuffer(sec = 2) {
    const b = ctx.createBuffer(1, ctx.sampleRate * sec, ctx.sampleRate), d = b.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    return b;
  }

  function start() {
    if (ctx) { ctx.resume(); return; }
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    master = ctx.createGain(); master.gain.value = 0; master.connect(ctx.destination);
    filt = ctx.createBiquadFilter(); filt.type = "lowpass"; filt.connect(master);
    const mk = (type, f, g) => {
      const o = ctx.createOscillator(), gg = ctx.createGain();
      o.type = type; o.frequency.value = f; gg.gain.value = g; o.connect(gg).connect(filt); o.start(); return o;
    };
    osc1 = mk("sine", 55, 0.5); osc2 = mk("triangle", 82.4, 0.18); osc3 = mk("sine", 110, 0.12);
    // 숨결
    const n = ctx.createBufferSource(); n.buffer = noiseBuffer(); n.loop = true;
    const bp = ctx.createBiquadFilter(); bp.type = "bandpass"; bp.frequency.value = 700; bp.Q.value = 0.8;
    breathGain = ctx.createGain(); breathGain.gain.value = 0.03;
    n.connect(bp).connect(breathGain).connect(master); n.start();
    breathLfo = ctx.createOscillator(); lfoDepth = ctx.createGain(); lfoDepth.gain.value = 0.03;
    breathLfo.connect(lfoDepth).connect(breathGain.gain); breathLfo.start();
    on = true; apply(); master.gain.setTargetAtTime(0.22, ctx.currentTime, 1.5);
  }

  function apply() {
    if (!ctx) return;
    const t = ctx.currentTime, { warmth, agitation, openness } = mood;
    filt.frequency.setTargetAtTime(160 + 900 * warmth + 500 * openness, t, 0.8);
    filt.Q.setTargetAtTime(2 + agitation * 10, t, 0.8);
    osc2.detune.setTargetAtTime(agitation * 45, t, 0.8);       // 화나면 어긋난 화음
    osc3.frequency.setTargetAtTime(warmth > 0.6 ? 137.5 : 110, t, 1.2);  // 따뜻하면 장3도
    breathLfo.frequency.setTargetAtTime((0.6 + agitation * 2) / (2 * Math.PI), t, 0.5);
    breathGain.gain.setTargetAtTime(0.02 + 0.05 * agitation, t, 0.8);
  }

  function blip(type, f0, f1, dur, gain, when = 0, dest = master) {
    const t = ctx.currentTime + when, o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type; o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(f1, t + dur);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(gain, t + Math.min(0.05, dur / 4));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(dest); o.start(t); o.stop(t + dur + 0.05);
  }
  function burst(dur, freq, gain, when = 0, type = "highpass") {
    const t = ctx.currentTime + when, s = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
    s.buffer = noiseBuffer(dur + 0.1); f.type = type; f.frequency.value = freq;
    g.gain.setValueAtTime(gain, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f).connect(g).connect(ctx.destination); s.start(t); s.stop(t + dur + 0.05);
  }

  const sounds = {
    flinch() { burst(0.35, 1800, 0.35); blip("sawtooth", 220, 50, 0.5, 0.12); },
    bloom() { [1, 1.25, 1.5, 2].forEach((m, i) => blip("sine", 330 * m, 330 * m, 2.6, 0.06, i * 0.12)); },
    turn_away() { blip("sine", 330, 150, 1.4, 0.08); },
    laugh() { for (let i = 0; i < 6; i++) blip("sine", 600 + Math.random() * 300, 500, 0.08, 0.06, i * 0.09); },
    hold_breath() {
      const t = ctx.currentTime;
      master.gain.setTargetAtTime(0.03, t, 0.15); master.gain.setTargetAtTime(0.22, t + 2.4, 0.6);
    },
    shiver() { for (let i = 0; i < 10; i++) burst(0.05, 3000, 0.08, i * 0.12); },
    absorb() { blip("sine", 880, 1320, 0.6, 0.03); },
    detach() {
      burst(0.6, 900, 0.5); blip("sine", 70, 35, 1.2, 0.3);
      blip("sine", 300, 1400, 3.2, 0.05, 0.2); blip("triangle", 450, 2100, 3.2, 0.03, 0.3);
    },
  };

  return {
    start,
    get on() { return on; },
    toggle() {
      if (!ctx) { start(); return true; }
      on = !on; master.gain.setTargetAtTime(on ? 0.22 : 0, ctx.currentTime, 0.4); return on;
    },
    setMood(m) { Object.assign(mood, m); apply(); },
    play(name) { if (ctx && on && sounds[name]) sounds[name](); },
  };
}
