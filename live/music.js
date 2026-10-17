/* Музыка для экрана ведущего: синтезируется в браузере (WebAudio), без файлов и без авторских треков.
   Треки: lobby — фанковый грув (лобби, заставка, рейтинг); think — напряжённый трек на вопросе;
   джинглы: reveal (показ ответа), fanfare (пьедестал). */
(function () {
  "use strict";
  const mf = (m) => 440 * Math.pow(2, (m - 69) / 12);
  let ctx = null, master = null, comp = null, revIn = null, noiseBuf = null;
  let bus = null, timer = 0, track = null, kind = null, step = 0, nextT = 0, muted = false;
  const VOL = 0.5;

  function init(c) {
    if (ctx === c || !c) return;
    ctx = c;
    comp = c.createDynamicsCompressor();
    comp.threshold.value = -16; comp.knee.value = 10; comp.ratio.value = 4; comp.attack.value = .004; comp.release.value = .2;
    master = c.createGain(); master.gain.value = muted ? 0 : VOL;
    master.connect(comp); comp.connect(c.destination);
    // реверберация из затухающего шума
    const len = c.sampleRate * 1.6, ir = c.createBuffer(2, len, c.sampleRate);
    for (let ch = 0; ch < 2; ch++) { const d = ir.getChannelData(ch); for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3); }
    const conv = c.createConvolver(); conv.buffer = ir;
    revIn = c.createGain(); revIn.gain.value = .22; revIn.connect(conv); conv.connect(master);
    noiseBuf = c.createBuffer(1, c.sampleRate * 2, c.sampleRate);
    const nd = noiseBuf.getChannelData(0); for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;
  }

  // ---------- инструменты ----------
  function env(g, t, a, peak, d, sustain = 0) {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(peak, t + a);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0001, sustain || 0.0001), t + a + d);
  }
  function kick(dst, t, v = 1) {
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.frequency.setValueAtTime(150, t); o.frequency.exponentialRampToValueAtTime(42, t + .12);
    env(g, t, .002, .95 * v, .38); o.connect(g); g.connect(dst); o.start(t); o.stop(t + .45);
  }
  function noise(dst, t, { hp = 0, bp = 0, q = 1, a = .001, peak = .3, d = .1, rev = 0 }) {
    const s = ctx.createBufferSource(); s.buffer = noiseBuf;
    let node = s;
    if (hp) { const f = ctx.createBiquadFilter(); f.type = "highpass"; f.frequency.value = hp; node.connect(f); node = f; }
    if (bp) { const f = ctx.createBiquadFilter(); f.type = "bandpass"; f.frequency.value = bp; f.Q.value = q; node.connect(f); node = f; }
    const g = ctx.createGain(); env(g, t, a, peak, d); node.connect(g); g.connect(dst);
    if (rev) { const r = ctx.createGain(); r.gain.value = rev; g.connect(r); r.connect(revIn); }
    s.start(t, Math.random() * .3); s.stop(t + a + d + .05);
  }
  const snare = (dst, t, v = 1) => { noise(dst, t, { hp: 1200, peak: .38 * v, d: .18, rev: .5 }); tone(dst, t, 190, "triangle", .25 * v, .002, .08); };
  const clap = (dst, t, v = 1) => { [0, .012, .024].forEach((o) => noise(dst, t + o, { bp: 1500, q: .8, peak: .3 * v, d: .09, rev: .6 })); };
  const hat = (dst, t, v = 1, open = false) => noise(dst, t, { hp: 7500, peak: .13 * v, d: open ? .22 : .04 });
  const crash = (dst, t, v = 1) => noise(dst, t, { hp: 4500, peak: .28 * v, d: 1.6, rev: .4 });
  function tone(dst, t, f, type, peak, a, d, sustain) {
    const o = ctx.createOscillator(), g = ctx.createGain(); o.type = type; o.frequency.value = f;
    env(g, t, a, peak, d, sustain); o.connect(g); g.connect(dst); o.start(t); o.stop(t + a + d + .05);
  }
  function bass(dst, t, m, len, v = 1) {
    const o = ctx.createOscillator(), o2 = ctx.createOscillator(), f = ctx.createBiquadFilter(), g = ctx.createGain();
    o.type = "sawtooth"; o2.type = "square"; o.frequency.value = mf(m); o2.frequency.value = mf(m - 12);
    f.type = "lowpass"; f.Q.value = 6; f.frequency.setValueAtTime(1400, t); f.frequency.exponentialRampToValueAtTime(260, t + .16);
    g.gain.setValueAtTime(.0001, t); g.gain.linearRampToValueAtTime(.32 * v, t + .006); g.gain.setValueAtTime(.32 * v, t + len * .8); g.gain.exponentialRampToValueAtTime(.0001, t + len);
    const g2 = ctx.createGain(); g2.gain.value = .5; o2.connect(g2); g2.connect(f);
    o.connect(f); f.connect(g); g.connect(dst); o.start(t); o2.start(t); o.stop(t + len + .02); o2.stop(t + len + .02);
  }
  function stab(dst, t, notes, len, v = 1, cutoff = 2400) {
    const f = ctx.createBiquadFilter(), g = ctx.createGain();
    f.type = "lowpass"; f.frequency.setValueAtTime(cutoff, t); f.frequency.exponentialRampToValueAtTime(cutoff / 3, t + len);
    env(g, t, .004, .11 * v, len);
    notes.forEach((m, i) => { [-7, 7].forEach((det) => { const o = ctx.createOscillator(); o.type = "sawtooth"; o.frequency.value = mf(m); o.detune.value = det; o.connect(f); o.start(t); o.stop(t + len + .05); }); });
    f.connect(g); g.connect(dst); const r = ctx.createGain(); r.gain.value = .35; g.connect(r); r.connect(revIn);
  }
  function pad(dst, t, notes, len, v = 1) {
    const f = ctx.createBiquadFilter(), g = ctx.createGain();
    f.type = "lowpass"; f.frequency.value = 900;
    g.gain.setValueAtTime(.0001, t); g.gain.linearRampToValueAtTime(.06 * v, t + len * .35); g.gain.linearRampToValueAtTime(.0001, t + len);
    notes.forEach((m) => [-9, 9].forEach((det) => { const o = ctx.createOscillator(); o.type = "sawtooth"; o.frequency.value = mf(m); o.detune.value = det; o.connect(f); o.start(t); o.stop(t + len + .05); }));
    f.connect(g); g.connect(dst); const r = ctx.createGain(); r.gain.value = .6; g.connect(r); r.connect(revIn);
  }
  function pluck(dst, t, m, len, v = 1) {
    const o = ctx.createOscillator(), o2 = ctx.createOscillator(), f = ctx.createBiquadFilter(), g = ctx.createGain();
    o.type = "square"; o2.type = "triangle"; o.frequency.value = mf(m); o2.frequency.value = mf(m + 12);
    f.type = "lowpass"; f.frequency.setValueAtTime(3200, t); f.frequency.exponentialRampToValueAtTime(900, t + .25);
    g.gain.setValueAtTime(.0001, t); g.gain.linearRampToValueAtTime(.09 * v, t + .005); g.gain.exponentialRampToValueAtTime(.0001, t + Math.max(.18, len));
    const g2 = ctx.createGain(); g2.gain.value = .35; o2.connect(g2); g2.connect(f);
    o.connect(f); f.connect(g); g.connect(dst); const r = ctx.createGain(); r.gain.value = .5; g.connect(r); r.connect(revIn);
    o.start(t); o2.start(t); o.stop(t + len + .3); o2.stop(t + len + .3);
  }
  function marimba(dst, t, m, v = 1) {
    tone(dst, t, mf(m), "sine", .16 * v, .002, .35);
    tone(dst, t, mf(m) * 4, "sine", .03 * v, .001, .06);
  }
  function brass(dst, t, notes, len, v = 1) {
    const f = ctx.createBiquadFilter(), g = ctx.createGain();
    f.type = "lowpass"; f.Q.value = 2; f.frequency.setValueAtTime(500, t); f.frequency.linearRampToValueAtTime(2600, t + .08); f.frequency.linearRampToValueAtTime(1500, t + len);
    g.gain.setValueAtTime(.0001, t); g.gain.linearRampToValueAtTime(.12 * v, t + .03); g.gain.setValueAtTime(.12 * v, t + len * .85); g.gain.exponentialRampToValueAtTime(.0001, t + len);
    notes.forEach((m) => [-6, 6].forEach((det) => { const o = ctx.createOscillator(); o.type = "sawtooth"; o.frequency.value = mf(m); o.detune.value = det; o.connect(f); o.start(t); o.stop(t + len + .05); }));
    f.connect(g); g.connect(dst); const r = ctx.createGain(); r.gain.value = .5; g.connect(r); r.connect(revIn);
  }

  // ---------- треки ----------
  // Лобби: фанк в фа мажоре, 104 уд/мин, шаффл. Аккорды Fmaj7 – Dm7 – Gm7 – C7, мелодия каждые вторые 8 тактов.
  const LOBBY = (() => {
    const chords = [[53, 57, 60, 64], [50, 53, 57, 60], [55, 58, 62, 65], [48, 52, 55, 58]];
    const roots = [41, 38, 43, 36];
    const bassPat = [[0, 0, 1.5], [3, 0, 1], [6, 12, 1], [7, 10, 1], [10, 0, 1.5], [12, 7, 1], [14, 12, 1]];
    const mel = [
      [[0, 72, 2], [2, 74, 2], [4, 77, 4], [8, 76, 2], [10, 74, 2], [12, 72, 4]],
      [[0, 69, 2], [2, 72, 2], [4, 74, 6], [12, 72, 2], [14, 69, 2]],
      [[0, 70, 2], [2, 74, 2], [4, 77, 4], [8, 79, 2], [10, 77, 2], [12, 74, 4]],
      [[0, 76, 4], [4, 74, 2], [6, 72, 2], [8, 70, 4], [12, 67, 4]],
      [[0, 72, 2], [2, 74, 2], [4, 77, 4], [8, 76, 2], [10, 77, 2], [12, 79, 4]],
      [[0, 81, 4], [4, 79, 2], [6, 77, 2], [8, 74, 8]],
      [[0, 70, 2], [2, 74, 2], [4, 77, 2], [6, 82, 4], [10, 81, 2], [12, 79, 4]],
      [[0, 77, 2], [2, 76, 2], [4, 72, 4], [8, 77, 8]]
    ];
    return {
      bpm: 104, swing: .17,
      step(dst, s, t, sd) {
        const bar = Math.floor(s / 16), st = s % 16, ci = bar % 4, ch = chords[ci], r = roots[ci];
        if ([0, 7, 8, 10].includes(st)) kick(dst, t, st === 0 ? 1 : .8);
        if (st === 4 || st === 12) snare(dst, t);
        if (st === 15 && bar % 2) snare(dst, t, .25);
        if (st % 2 === 0) hat(dst, t, st % 4 === 2 ? .9 : .6, st === 14); else hat(dst, t, .3);
        bassPat.forEach(([p, iv, l]) => { if (p === st) bass(dst, t, r + iv, sd * l * .9); });
        if (st === 2 || st === 10 || (st === 7 && bar % 2)) stab(dst, t, ch.map((m) => m + 12), sd * 1.3, .9);
        if (bar % 16 >= 4 && bar % 16 < 12) { const line = mel[(bar - 4) % 8]; line.forEach(([p, m, l]) => { if (p === st) pluck(dst, t, m, sd * l); }); }
        if (st === 0 && bar % 8 === 0 && bar > 0) crash(dst, t, .6);
      }
    };
  })();

  // Вопрос: ля минор, 112 уд/мин. Am – F – Dm – E. Тикающие часы, пульсирующий бас, маримба.
  const THINK = (() => {
    const chords = [[57, 60, 64], [53, 57, 60], [50, 53, 57], [52, 56, 59]];
    const roots = [45, 41, 38, 40];
    const arp = [0, 1, 2, 1, 0, 2, 1, 2];
    return {
      bpm: 112, swing: 0,
      step(dst, s, t, sd) {
        const bar = Math.floor(s / 16), st = s % 16, ci = bar % 4, ch = chords[ci], r = roots[ci];
        const lvl = Math.min(1, .55 + bar / 24);            // постепенно нарастает
        if (st === 0 || st === 8 || (st === 11 && bar % 2)) kick(dst, t, .85);
        if (st === 12) clap(dst, t, .8 * lvl);
        if (st % 4 === 0) tone(dst, t, st % 8 === 0 ? 1900 : 1400, "sine", .09, .001, .05);   // тик-так
        if (bar >= 4) hat(dst, t, st % 2 ? .25 : .45);
        if (st % 2 === 0) bass(dst, t, r + (st === 14 ? 12 : 0), sd * 1.6, .75);
        if (st % 2 === 0) { const n = ch[arp[(st / 2) % 8]] + (st >= 8 ? 24 : 12); marimba(dst, t, n, .9 * lvl); }
        if (st === 0) pad(dst, t, ch.map((m) => m + 12), sd * 16, .9);
        if (st === 0 && bar % 8 === 0 && bar > 0) crash(dst, t, .4);
      }
    };
  })();

  // ---------- проигрывание ----------
  function schedule() {
    if (!track || !ctx) return;
    const sd = 60 / track.bpm / 4;
    while (nextT < ctx.currentTime + .15) {
      const t = nextT + (step % 2 ? track.swing * sd : 0);
      track.step(bus, step, t, sd);
      nextT += sd; step++;
    }
  }
  function stopLoop(fade = .4) {
    clearInterval(timer); timer = 0; track = null; kind = null;
    if (bus && ctx) { const b = bus; b.gain.setTargetAtTime(0, ctx.currentTime, fade / 3); setTimeout(() => { try { b.disconnect(); } catch (_) {} }, fade * 1000 + 300); }
    bus = null;
  }
  function newBus(level = 1) { const g = ctx.createGain(); g.gain.value = level; g.connect(master); return g; }

  const MUSIC = {
    init,
    play(k) {
      if (!ctx) return;
      if (k === kind) return;
      stopLoop();
      const tr = k === "lobby" ? LOBBY : k === "think" ? THINK : null;
      if (!tr) return;
      kind = k; track = tr; step = 0; nextT = ctx.currentTime + .08; bus = newBus(1);
      timer = setInterval(schedule, 25); schedule();
    },
    stop() { stopLoop(); },
    sting(name) {
      if (!ctx) return;
      const t = ctx.currentTime + .03, b = newBus(1);
      if (name === "reveal") {
        kick(b, t); crash(b, t, .9);
        stab(b, t, [60, 64, 67, 72], .9, 1.6, 3200);
        bass(b, t, 36, .8, 1);
        [72, 76, 79, 84].forEach((m, i) => pluck(b, t + .09 * i, m, .3, .9));
      } else if (name === "fanfare") {
        for (let i = 0; i < 16; i++) snare(b, t + i * .07, .25 + i * .04);
        const s = t + 1.15, q = .3;
        const seq = [[[60, 64, 67], q * .8], [[60, 64, 67], q * .8], [[65, 69, 72], q], [[67, 71, 74], q * 2], [[72, 76, 79], q * 4.5]];
        let tt = s; seq.forEach(([n, l], i) => { brass(b, tt, n, l * .95, 1.2); bass(b, tt, n[0] - 24, l * .9); if (i >= 3) crash(b, tt, .7); kick(b, tt, .9); tt += l; });
      } else if (name === "whoosh") {
        noise(b, t, { bp: 900, q: .7, a: .25, peak: .25, d: .25 });
      }
      setTimeout(() => { try { b.disconnect(); } catch (_) {} }, 5000);
    },
    setMuted(m) { muted = m; if (master && ctx) master.gain.setTargetAtTime(m ? 0 : VOL, ctx.currentTime, .05); },
    get kind() { return kind; },
    // проверка: отрисовать трек офлайн и вернуть пиковый и средний уровень
    async _probe(k, secs = 12) {
      const saved = ctx, off = new OfflineAudioContext(2, 44100 * secs, 44100);
      ctx = null; init(off);
      const tr = k === "think" ? THINK : LOBBY, sd = 60 / tr.bpm / 4, b = newBus(1);
      if (k === "reveal" || k === "fanfare") { this.sting(k); }
      else for (let i = 0, t = .05; t < secs - .5; i++, t += sd) tr.step(b, i, t + (i % 2 ? tr.swing * sd : 0), sd);
      const buf = await off.startRendering(); ctx = null; if (saved) init(saved);
      if (this._wantWav) { const d0 = buf.getChannelData(0), n = d0.length, ab = new ArrayBuffer(44 + n * 2), v = new DataView(ab), w = (o, str) => [...str].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
        w(0, "RIFF"); v.setUint32(4, 36 + n * 2, true); w(8, "WAVEfmt "); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true); v.setUint32(24, 44100, true); v.setUint32(28, 88200, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); w(36, "data"); v.setUint32(40, n * 2, true);
        for (let i = 0; i < n; i++) v.setInt16(44 + i * 2, Math.max(-1, Math.min(1, d0[i])) * 32767, true);
        let bin = ""; const u = new Uint8Array(ab); for (let i = 0; i < u.length; i += 32768) bin += String.fromCharCode.apply(null, u.subarray(i, i + 32768)); return btoa(bin); }
      const d = buf.getChannelData(0); let pk = 0, sum = 0; for (let i = 0; i < d.length; i++) { const v = Math.abs(d[i]); if (v > pk) pk = v; sum += v * v; }
      return { peak: +pk.toFixed(3), rms: +Math.sqrt(sum / d.length).toFixed(3) };
    }
  };
  window.MUSIC = MUSIC;
})();
