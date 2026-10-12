// Звук: синтезированные эффекты и фоновая музыка (WebAudio, без внешних файлов)
window.SND = (function () {
  const S = { ctx: null, opts: { sfx: 0.8, music: 0.5, mute: false } };
  try { Object.assign(S.opts, JSON.parse(localStorage.getItem('opt_audio') || '{}')); } catch (e) { /* */ }
  let master, sfxBus, musicBus, noiseBuf, scene = null, sceneKey = '', combatLayer = null, pingTimer = 0;

  function ensure() {
    if (S.ctx) { if (S.ctx.state === 'suspended') S.ctx.resume(); return true; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return false;
    S.ctx = new AC();
    master = S.ctx.createGain(); master.connect(S.ctx.destination);
    sfxBus = S.ctx.createGain(); sfxBus.connect(master);
    musicBus = S.ctx.createGain(); musicBus.connect(master);
    noiseBuf = S.ctx.createBuffer(1, S.ctx.sampleRate * 2, S.ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    applyVolumes();
    if (sceneKey) { const k = sceneKey; sceneKey = ''; S.setScene(k); }
    return true;
  }
  // браузер разрешает звук только после действия игрока
  ['pointerdown', 'keydown'].forEach(ev => addEventListener(ev, () => ensure(), { capture: true }));

  function applyVolumes() {
    if (!S.ctx) return;
    const t = S.ctx.currentTime;
    master.gain.setTargetAtTime(S.opts.mute ? 0 : 1, t, 0.05);
    sfxBus.gain.setTargetAtTime(S.opts.sfx, t, 0.05);
    musicBus.gain.setTargetAtTime(S.opts.music * 0.6, t, 0.2);
  }
  S.set = function (k, v) {
    S.opts[k] = v;
    try { localStorage.setItem('opt_audio', JSON.stringify(S.opts)); } catch (e) { /* */ }
    applyVolumes();
  };

  // ---------- примитивы ----------
  const now = () => S.ctx.currentTime;
  function env(g, t, a, peak, d) {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t + a + d);
  }
  function noise(t, dur, { type = 'lowpass', freq = 1000, q = 0.7, peak = 0.5, attack = 0.002, sweepTo = null, out = sfxBus } = {}) {
    const src = S.ctx.createBufferSource(); src.buffer = noiseBuf;
    src.playbackRate.value = 0.8 + Math.random() * 0.4;
    const f = S.ctx.createBiquadFilter(); f.type = type; f.frequency.setValueAtTime(freq, t); f.Q.value = q;
    if (sweepTo) f.frequency.exponentialRampToValueAtTime(sweepTo, t + dur);
    const g = S.ctx.createGain(); env(g, t, attack, peak, dur);
    src.connect(f); f.connect(g); g.connect(out);
    src.start(t, Math.random()); src.stop(t + attack + dur + 0.05);
  }
  function tone(t, freq, dur, { type = 'sine', peak = 0.3, attack = 0.005, to = null, out = sfxBus } = {}) {
    const o = S.ctx.createOscillator(); o.type = type; o.frequency.setValueAtTime(freq, t);
    if (to) o.frequency.exponentialRampToValueAtTime(to, t + dur);
    const g = S.ctx.createGain(); env(g, t, attack, peak, dur);
    o.connect(g); g.connect(out);
    o.start(t); o.stop(t + attack + dur + 0.05);
  }

  const SHOTS = {
    pistol: { dur: 0.22, freq: 1900, thump: 140, peak: 0.7 },
    rifle: { dur: 0.45, freq: 1300, thump: 95, peak: 0.85, tail: true },
    shotgun: { dur: 0.55, freq: 850, thump: 70, peak: 1.0, tail: true },
    ak: { dur: 0.28, freq: 2100, thump: 110, peak: 0.8 },
  };
  const FX = {
    shot(t, o) {
      const s = SHOTS[o.weapon] || SHOTS.pistol, v = o.vol;
      noise(t, s.dur, { type: 'lowpass', freq: s.freq, peak: s.peak * v, sweepTo: 300 });
      noise(t, 0.04, { type: 'highpass', freq: 3000, peak: 0.4 * v });
      tone(t, s.thump, 0.18, { peak: 0.6 * v, to: 40 });
      if (s.tail) noise(t + 0.05, 0.9, { type: 'bandpass', freq: 500, q: 0.5, peak: 0.12 * v, attack: 0.05 });
    },
    swing(t, o) { noise(t, 0.22, { type: 'bandpass', freq: 400, sweepTo: 2200, q: 1.5, peak: 0.35 * o.vol, attack: 0.04 }); },
    hit(t, o) { tone(t, 95, 0.14, { peak: 0.55 * o.vol, to: 45 }); noise(t, 0.06, { type: 'lowpass', freq: 1200, peak: 0.35 * o.vol }); },
    miss(t, o) { noise(t, 0.12, { type: 'bandpass', freq: 4000, sweepTo: 1500, q: 3, peak: 0.12 * o.vol, attack: 0.01 }); },
    step(t, o) { noise(t, 0.05, { type: 'lowpass', freq: 500 + Math.random() * 300, peak: (o.sneak ? 0.06 : 0.14) * o.vol }); },
    reload(t) { tone(t, 2400, 0.03, { type: 'square', peak: 0.08 }); noise(t + 0.18, 0.05, { type: 'highpass', freq: 2500, peak: 0.25 }); tone(t + 0.32, 1800, 0.04, { type: 'square', peak: 0.09 }); },
    lock_try(t) { for (let i = 0; i < 3; i++) tone(t + i * 0.09, 2600 + Math.random() * 600, 0.02, { type: 'triangle', peak: 0.12 }); },
    lock_open(t) { tone(t, 2200, 0.03, { type: 'square', peak: 0.12 }); tone(t + 0.06, 1200, 0.5, { type: 'triangle', peak: 0.1 }); },
    lock_fail(t) { tone(t, 300, 0.12, { type: 'square', peak: 0.08, to: 180 }); noise(t, 0.08, { type: 'lowpass', freq: 800, peak: 0.15 }); },
    pickup(t) { tone(t, 660, 0.08, { type: 'triangle', peak: 0.15 }); tone(t + 0.07, 990, 0.12, { type: 'triangle', peak: 0.15 }); },
    cash(t) { for (let i = 0; i < 3; i++) tone(t + i * 0.06, 2800 + i * 400, 0.12, { type: 'sine', peak: 0.08 }); },
    ui(t) { tone(t, 1400, 0.03, { type: 'square', peak: 0.04 }); },
    dialog(t) { tone(t, 520, 0.06, { type: 'triangle', peak: 0.08 }); tone(t + 0.05, 780, 0.08, { type: 'triangle', peak: 0.07 }); },
    heal(t) { tone(t, 440, 0.3, { peak: 0.12, to: 880, attack: 0.05 }); },
    levelup(t) { [523, 659, 784, 1047].forEach((f, i) => tone(t + i * 0.12, f, 0.35, { type: 'triangle', peak: 0.16 })); },
    quest(t) { [392, 523, 659].forEach((f, i) => tone(t + i * 0.1, f, 0.3, { type: 'triangle', peak: 0.13 })); },
    alert(t) { tone(t, 220, 0.15, { type: 'sawtooth', peak: 0.12 }); tone(t + 0.16, 165, 0.3, { type: 'sawtooth', peak: 0.12 }); },
    death(t) { tone(t, 220, 1.4, { type: 'sawtooth', peak: 0.18, to: 55 }); },
    search(t) { noise(t, 0.35, { type: 'bandpass', freq: 900, q: 0.8, peak: 0.15, attack: 0.05 }); noise(t + 0.3, 0.25, { type: 'bandpass', freq: 1400, q: 0.8, peak: 0.1, attack: 0.04 }); },
  };

  S.play = function (name, o = {}) {
    if (!S.ctx || S.opts.mute || !FX[name]) return;
    try { FX[name](now() + 0.01, { vol: 1, ...o }); } catch (e) { /* */ }
  };
  // громкость по расстоянию до игрока
  S.at = function (name, x, y, o = {}) {
    const p = window.G && G.player;
    const d = p ? Math.max(Math.abs(p.x - x), Math.abs(p.y - y)) : 0;
    S.play(name, { ...o, vol: Math.max(0.2, 1 - d / 28) });
  };

  // ---------- фоновая музыка ----------
  const SCENES = {
    menu: { root: 55, fifth: 1.5, wind: 0.25, ping: 0 },
    camp: { root: 55, fifth: 1.498, wind: 0.18, ping: 1, pingNotes: [440, 523, 659] },
    post: { root: 73.4, fifth: 1.335, wind: 0.22, ping: 1, pingNotes: [370, 440, 554] },
    zarya: { root: 43.65, fifth: 1.414, wind: 0.26, ping: 1, pingNotes: [311, 466, 622] },
    zarya_office: { root: 43.65, fifth: 1.414, wind: 0.08, ping: 0.8, pingNotes: [311, 466] },
    zarya_factory: { root: 41.2, fifth: 1.414, wind: 0.12, ping: 1, pingNotes: [277, 415, 554] },
    zarya_lab: { root: 36.7, fifth: 1.06, wind: 0.05, ping: 1, pingNotes: [740, 784, 1109] },
    bridge: { root: 61.7, fifth: 1.498, wind: 0.35, ping: 0.5, pingNotes: [370, 494] },
    rassvet: { root: 69.3, fifth: 1.498, wind: 0.15, ping: 1, pingNotes: [554, 659, 831] },
    object9: { root: 46.2, fifth: 1.335, wind: 0.28, ping: 1, pingNotes: [349, 415, 523] },
    object9_vault: { root: 34.6, fifth: 1.06, wind: 0.04, ping: 1, pingNotes: [698, 740, 1047] },
    forest: { root: 49, fifth: 1.5, wind: 0.32, ping: 0.6, pingNotes: [392, 466] },
    camp_cellar: { root: 41.2, fifth: 1.06, wind: 0.05, ping: 1, pingNotes: [880, 988] },
    city: { root: 55, fifth: 1.414, wind: 0.3, ping: 0.8, pingNotes: [415, 554, 622] },
    wild: { root: 65.4, fifth: 1.498, wind: 0.3, ping: 0.6, pingNotes: [392, 523] },
    world: { root: 82.4, fifth: 1.498, wind: 0.2, ping: 0.7, pingNotes: [494, 659, 740] },
  };
  function buildScene(cfg) {
    const t = now(), nodes = [];
    const out = S.ctx.createGain(); out.gain.setValueAtTime(0.0001, t); out.gain.exponentialRampToValueAtTime(1, t + 2.5); out.connect(musicBus);
    // гудящий пад
    const lp = S.ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 260; lp.Q.value = 2;
    const lfo = S.ctx.createOscillator(); lfo.frequency.value = 0.05; const lfoG = S.ctx.createGain(); lfoG.gain.value = 120;
    lfo.connect(lfoG); lfoG.connect(lp.frequency); lfo.start(); nodes.push(lfo);
    const padG = S.ctx.createGain(); padG.gain.value = 0.09; lp.connect(padG); padG.connect(out);
    [[cfg.root, 'sawtooth', -6], [cfg.root, 'sawtooth', 7], [cfg.root * cfg.fifth, 'triangle', 0], [cfg.root * 2, 'sine', 3]].forEach(([f, type, det]) => {
      const o = S.ctx.createOscillator(); o.type = type; o.frequency.value = f; o.detune.value = det; o.connect(lp); o.start(); nodes.push(o);
    });
    // ветер
    const w = S.ctx.createBufferSource(); w.buffer = noiseBuf; w.loop = true;
    const wf = S.ctx.createBiquadFilter(); wf.type = 'bandpass'; wf.frequency.value = 450; wf.Q.value = 0.6;
    const wg = S.ctx.createGain(); wg.gain.value = cfg.wind * 0.35;
    const wl = S.ctx.createOscillator(); wl.frequency.value = 0.08; const wlg = S.ctx.createGain(); wlg.gain.value = cfg.wind * 0.25;
    wl.connect(wlg); wlg.connect(wg.gain); wl.start(); nodes.push(wl);
    const wl2 = S.ctx.createOscillator(); wl2.frequency.value = 0.03; const wl2g = S.ctx.createGain(); wl2g.gain.value = 250;
    wl2.connect(wl2g); wl2g.connect(wf.frequency); wl2.start(); nodes.push(wl2);
    w.connect(wf); wf.connect(wg); wg.connect(out); w.start(); nodes.push(w);
    // эхо для металлических «звонов»
    const delay = S.ctx.createDelay(1.5); delay.delayTime.value = 0.45;
    const fb = S.ctx.createGain(); fb.gain.value = 0.45;
    delay.connect(fb); fb.connect(delay); delay.connect(out);
    return { out, nodes, cfg, delay };
  }
  function stopScene(sc) {
    if (!sc) return;
    const t = now();
    sc.out.gain.cancelScheduledValues(t);
    sc.out.gain.setValueAtTime(Math.max(0.0001, sc.out.gain.value), t);
    sc.out.gain.exponentialRampToValueAtTime(0.0001, t + 1.8);
    setTimeout(() => { sc.nodes.forEach(n => { try { n.stop(); } catch (e) { /* */ } }); sc.out.disconnect(); }, 2000);
  }
  S.setScene = function (key) {
    if (key === sceneKey) return;
    sceneKey = key;
    if (!S.ctx) return;
    stopScene(scene);
    scene = buildScene(SCENES[key] || SCENES.wild);
  };
  S.setCombat = function (on) {
    if (!S.ctx) return;
    if (on && !combatLayer) {
      const out = S.ctx.createGain(); out.gain.value = 0.0001; out.connect(musicBus);
      out.gain.exponentialRampToValueAtTime(0.9, now() + 1);
      combatLayer = { out, timer: setInterval(() => {
        if (!S.ctx) return;
        const t = now() + 0.02;
        tone(t, 62, 0.25, { peak: 0.35, to: 38, out });
        tone(t + 0.33, 62, 0.2, { peak: 0.22, to: 38, out });
        noise(t + 0.17, 0.04, { type: 'highpass', freq: 6000, peak: 0.05, out });
      }, 700) };
    } else if (!on && combatLayer) {
      const c = combatLayer; combatLayer = null;
      clearInterval(c.timer);
      c.out.gain.setTargetAtTime(0.0001, now(), 0.4);
      setTimeout(() => c.out.disconnect(), 2000);
    }
  };
  // редкие металлические звоны в тишине
  setInterval(() => {
    if (!S.ctx || !scene || !scene.cfg.ping || S.opts.mute) return;
    if (Date.now() < pingTimer) return;
    pingTimer = Date.now() + 7000 + Math.random() * 9000;
    if (Math.random() > scene.cfg.ping) return;
    const notes = scene.cfg.pingNotes;
    const f = notes[Math.floor(Math.random() * notes.length)] * (Math.random() < 0.3 ? 2 : 1);
    tone(now() + 0.05, f, 2.2, { type: 'sine', peak: 0.05, attack: 0.01, out: scene.delay });
  }, 1000);

  return S;
})();
