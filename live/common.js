/* Общие настройки, связь и мелочи для студента и большого экрана */
(function () {
  "use strict";

  const qs = new URLSearchParams(location.search);
  // Ссылки без ?room= сохраняют совместимость с первым классом.
  const roomId = qs.get("room") === "class2" ? "class2" : "class1";
  const localMode = qs.get("lan") === "1";
  const brokerNames = { emqx: "EMQX", hivemq: "HiveMQ", mosquitto: "Mosquitto" };
  const requestedNet = qs.get("net");
  const netId = Object.hasOwn(brokerNames, requestedNet) ? requestedNet : "emqx";
  const roomUrl = (page, id = roomId, pult = false) => {
    const url = new URL(page, new URL("./", location.href));
    url.searchParams.set("room", id === "class2" ? "class2" : "class1");
    if (localMode) {
      url.searchParams.set("lan", "1");
      url.searchParams.delete("net");
    } else {
      url.searchParams.set("net", netId);
      url.searchParams.delete("lan");
    }
    if (pult) url.searchParams.set("pult", "1");
    return url.href;
  };

  const CFG = {
    roomId,
    localMode,
    localWsUrl: (location.protocol === "https:" ? "wss://" : "ws://") + location.host + "/ws",
    netId,
    netName: localMode ? "Локальная сеть" : brokerNames[netId],
    roomName: roomId === "class2" ? "Учебный класс 2" : "Учебный класс 1",
    room: roomId === "class2" ? "m3-b8k3" : "m3-a7k2",
    base: "poddon-opp/live/v1",
    joinUrl: roomUrl(""),
    studentUrl: (id = roomId) => roomUrl("", id),
    screenUrl: (id = roomId, pult = false) => roomUrl("screen.html", id, pult),
    loginHash: "839471ac87f97a9ae4668ec270ef0a42f2f85c1befca094e6ae2998bc84ca324",
    // Один общий сервер для всех учеников и ведущего. Несвязанные публичные
    // брокеры не обмениваются сообщениями между собой.
    brokers: [{
      emqx: "wss://broker.emqx.io:8084/mqtt",
      hivemq: "wss://broker.hivemq.com:8884/mqtt",
      mosquitto: "wss://test.mosquitto.org:8081/mqtt"
    }[netId]],
    maxPts: 1000,                 // за верный ответ: от 500 (в последнюю секунду) до 1000 (мгновенно)
    streakBonus: 100,             // +100 за каждый верный подряд, максимум +500
    limit: (q) => (q.p === 15 ? 45 : 25)   // секунд на вопрос: расчётные — дольше
  };
  // Резервный публичный брокер выбирается ведущим; QR код передаёт тот же net.
  CFG.topic = (s) => `${CFG.base}/${CFG.room}/${s}`;

  /* ---------- Минимальный MQTT 3.1.1 клиент поверх WebSocket ---------- */
  const enc = new TextEncoder(), dec = new TextDecoder();
  function strBytes(s) { const b = enc.encode(s); return [b.length >> 8, b.length & 255, ...b]; }
  function remLen(n) { const out = []; do { let d = n % 128; n = Math.floor(n / 128); if (n > 0) d |= 128; out.push(d); } while (n > 0); return out; }
  function packet(type, body) { return new Uint8Array([type, ...remLen(body.length), ...body]); }

  class Link {
    constructor(url, owner) {
      this.url = url; this.owner = owner; this.ws = null; this.up = false;
      this.buf = new Uint8Array(0); this.pid = 1;
      this.retry = 900; this.timer = null; this.cto = null; this.ping = null;
      this.lastRx = 0;
      this.open();
    }
    open() {
      clearTimeout(this.timer); this.timer = null;
      clearTimeout(this.cto); clearInterval(this.ping);
      let ws;
      try { ws = new WebSocket(this.url, ["mqtt"]); }
      catch (_) { this.later(); return; }
      this.ws = ws; ws.binaryType = "arraybuffer";
      this.buf = new Uint8Array(0);
      const cid = "opp" + Math.random().toString(36).slice(2, 12);
      ws.onopen = () => {
        if (this.ws !== ws) return;
        try {
          const body = [...strBytes("MQTT"), 4, 2, 0, 45, ...strBytes(cid)];
          ws.send(packet(0x10, body));
        } catch (_) { ws.close(); }
      };
      ws.onmessage = (ev) => {
        if (this.ws !== ws) return;
        this.lastRx = Date.now();
        this.feed(new Uint8Array(ev.data));
      };
      ws.onclose = () => {
        if (this.ws !== ws) return;
        clearTimeout(this.cto); clearInterval(this.ping);
        this.setUp(false);
        this.later();
      };
      ws.onerror = () => { try { ws.close(); } catch (_) {} };
      this.cto = setTimeout(() => {
        if (this.ws === ws && !this.up) try { ws.close(); } catch (_) {}
      }, 7000);
    }
    later() {
      if (this.timer) return;
      const delay = this.retry + Math.round(Math.random() * 400);
      this.timer = setTimeout(() => { this.timer = null; this.open(); }, delay);
      this.retry = Math.min(Math.round(this.retry * 1.6), 12000);
    }
    wake(force = false) {
      if (!force && this.up && this.ws && this.ws.readyState === 1) return;
      const old = this.ws;
      clearTimeout(this.timer); this.timer = null;
      clearTimeout(this.cto); clearInterval(this.ping);
      this.setUp(false);
      this.retry = 900;
      this.open();
      if (old) try { old.close(); } catch (_) {}
    }
    setUp(v) { if (this.up !== v) { this.up = v; this.owner._status(); } }
    feed(chunk) {
      if (this.buf.length + chunk.length > 1048576) {
        try { this.ws.close(); } catch (_) {}
        return;
      }
      const b = new Uint8Array(this.buf.length + chunk.length);
      b.set(this.buf); b.set(chunk, this.buf.length); this.buf = b;
      for (;;) {
        if (this.buf.length < 2) return;
        let mul = 1, len = 0, i = 1, byte;
        do {
          if (i >= this.buf.length) return;
          byte = this.buf[i++]; len += (byte & 127) * mul; mul *= 128;
          if (i > 5) { try { this.ws.close(); } catch (_) {} return; }
        } while (byte & 128);
        if (this.buf.length < i + len) return;
        const type = this.buf[0], body = this.buf.slice(i, i + len);
        this.buf = this.buf.slice(i + len);
        this.handle(type, body);
      }
    }
    handle(type, body) {
      const t = type >> 4;
      if (t === 2) {
        if (body.length >= 2 && body[1] === 0) {
          clearTimeout(this.cto);
          this.retry = 900; this.setUp(true);
          const topics = [...this.owner.subs];
          if (topics.length) this.subscribe(topics);
          clearInterval(this.ping);
          this.ping = setInterval(() => {
            if (Date.now() - this.lastRx > 65000) {
              try { this.ws.close(); } catch (_) {}
            } else this.raw(new Uint8Array([0xC0, 0]));
          }, 18000);
        } else { try { this.ws.close(); } catch (_) {} }
      } else if (t === 3) {
        if (body.length < 2) return;
        const qos = (type >> 1) & 3, retain = type & 1;
        const tl = (body[0] << 8) | body[1];
        if (body.length < 2 + tl) return;
        const topic = dec.decode(body.slice(2, 2 + tl));
        let off = 2 + tl; if (qos > 0) off += 2;
        const payload = body.slice(off);
        if (!payload.length) return;
        let obj = null; try { obj = JSON.parse(dec.decode(payload)); } catch (_) { return; }
        this.owner._msg(topic, obj, !!retain);
      }
    }
    raw(bytes) {
      if (this.ws && this.ws.readyState === 1 && this.up) {
        try { this.ws.send(bytes); return true; } catch (_) {}
      }
      return false;
    }
    subscribe(topics) {
      if (!this.up) return;
      const id = this.pid++ & 0xffff || 1;
      const body = [id >> 8, id & 255];
      topics.forEach((tp) => body.push(...strBytes(tp), 0));
      this.raw(packet(0x82, body));
    }
    publish(topic, payload, retain) {
      if (!this.up) return false;
      return this.raw(packet(0x30 | (retain ? 1 : 0), [...strBytes(topic), ...payload]));
    }
  }

  class Net {
    constructor(urls) {
      this.subs = new Set(); this.handlers = []; this.statusFns = []; this.seen = new Map();
      this.local = CFG.localMode; this.ws = null; this.localUp = false; this.localTimer = null;
      this.links = [];
      if (this.local) this.openLocal();
      else this.links = urls.map((u) => new Link(u, this));
      window.addEventListener("online", () => this.reconnect());
      document.addEventListener("visibilitychange", () => {
        if (!document.hidden) this.reconnect();
      });
    }
    openLocal() {
      if (this.localTimer || (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING))) return;
      let ws;
      try { ws = new WebSocket(CFG.localWsUrl); }
      catch (_) { this.scheduleLocal(); return; }
      this.ws = ws;
      ws.onopen = () => {
        if (this.ws !== ws) return;
        this.localUp = true; this._status();
        if (this.subs.size) this.localSend({ type: "sub", topics: [...this.subs] });
      };
      ws.onmessage = (ev) => {
        if (this.ws !== ws) return;
        let m; try { m = JSON.parse(ev.data); } catch (_) { return; }
        if (m.type === "message" && typeof m.topic === "string") this._msg(m.topic, m.obj, !!m.retained);
      };
      ws.onclose = () => {
        if (this.ws !== ws) return;
        this.localUp = false; this._status(); this.scheduleLocal();
      };
      ws.onerror = () => { try { ws.close(); } catch (_) {} };
    }
    scheduleLocal() {
      if (this.localTimer) return;
      this.localTimer = setTimeout(() => { this.localTimer = null; this.openLocal(); }, 1200 + Math.round(Math.random() * 800));
    }
    localSend(message) {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return false;
      try { this.ws.send(JSON.stringify(message)); return true; } catch (_) { return false; }
    }
    get online() { return this.local ? (this.localUp ? 1 : 0) : this.links.filter((l) => l.up).length; }
    get total() { return this.local ? 1 : this.links.length; }
    sub(topic) {
      if (this.subs.has(topic)) return;
      this.subs.add(topic);
      if (this.local) { if (this.localUp) this.localSend({ type: "sub", topics: [topic] }); }
      else this.links.forEach((l) => l.subscribe([topic]));
    }
    pub(topic, obj, retain = false) {
      if (this.local) return this.localSend({ type: "publish", topic, obj, retain }) ? 1 : 0;
      const payload = enc.encode(JSON.stringify(obj));
      let ok = 0; this.links.forEach((l) => { if (l.publish(topic, payload, retain)) ok++; });
      return ok;
    }
    reconnect() {
      if (this.local) { if (!this.localUp) this.openLocal(); }
      else this.links.forEach((l) => l.wake());
    }
    on(fn) { this.handlers.push(fn); }
    onStatus(fn) { this.statusFns.push(fn); fn(this.online, this.total); }
    _status() { this.statusFns.forEach((f) => f(this.online, this.total)); }
    _msg(topic, obj, retained) {
      if (obj && obj.mid) {
        if (this.seen.has(obj.mid)) return;
        this.seen.set(obj.mid, Date.now());
        if (this.seen.size > 500) {
          const cut = Date.now() - 120000;
          for (const [k, v] of this.seen) if (v < cut) this.seen.delete(k);
        }
      }
      this.handlers.forEach((h) => h(topic, obj, retained));
    }
  }

  /* ---------- Утилиты ---------- */
  const U = {
    $: (s, r = document) => r.querySelector(s),
    $$: (s, r = document) => [...r.querySelectorAll(s)],
    mid: () => Date.now().toString(36) + Math.random().toString(36).slice(2, 9),
    normName: (s) => (s || "").toLowerCase().replace(/ё/g, "е").replace(/[^a-zа-я0-9 -]/gi, " ").replace(/\s+/g, " ").trim(),
    cleanName: (s) => (s || "").replace(/\s+/g, " ").trim().split(" ").map((w) => w ? w[0].toUpperCase() + w.slice(1).toLowerCase() : "").join(" "),
    initials: (n) => (n || "?").split(" ").filter(Boolean).slice(0, 2).map((w) => w[0]).join("").toUpperCase(),
    hue: (s) => { let h = 0; for (const ch of s || "") h = (h * 31 + ch.charCodeAt(0)) % 360; return h; },
    esc: (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])),
    plural: (n, a, b, c) => { const m10 = n % 10, m100 = n % 100; return m10 === 1 && m100 !== 11 ? a : m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20) ? b : c; },
    store: {
      get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (_) { return d; } },
      set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (_) {} },
      del(k) { try { localStorage.removeItem(k); } catch (_) {} }
    },
    async sha256hex(s) {
      const b = await crypto.subtle.digest("SHA-256", enc.encode(s));
      return [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");
    },
    async hmacKey(password) {
      const raw = await crypto.subtle.digest("SHA-256", enc.encode("opp-hmac|" + password));
      return crypto.subtle.importKey("raw", raw, { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
    },
    async sign(key, text) {
      const s = await crypto.subtle.sign("HMAC", key, enc.encode(text));
      return [...new Uint8Array(s)].map((x) => x.toString(16).padStart(2, "0")).join("");
    },
    qrSvg(text, opts = {}) {
      const q = window.qrcode(0, opts.ecc || "M"); q.addData(text); q.make();
      const n = q.getModuleCount(), m = 2; let d = "";
      for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (q.isDark(r, c)) d += `M${c + m} ${r + m}h1v1h-1z`;
      return `<svg viewBox="0 0 ${n + 2 * m} ${n + 2 * m}" shape-rendering="crispEdges" role="img" aria-label="QR-код"><rect width="100%" height="100%" fill="#fff"/><path d="${d}" fill="#071A5C"/></svg>`;
    },
    joinUrl: () => CFG.joinUrl,
    av(key, name, extra = "") { let h = 0; for (const ch of key || "") h = (h * 31 + ch.charCodeAt(0)) >>> 0; return `<span class="av k${h % 6} ${extra}">${U.esc(U.initials(name))}</span>`; },
    L: "АБВГД",
    qid: (b, i) => b + "." + i
  };

  /* ---------- Фигуры вариантов ответа ---------- */
  const SHAPES = [
    { cls: "c0", svg: '<svg viewBox="0 0 32 32" aria-hidden="true"><path d="M16 3 30 28H2z" fill="currentColor"/></svg>', name: "треугольник" },
    { cls: "c1", svg: '<svg viewBox="0 0 32 32" aria-hidden="true"><path d="M16 2 30 16 16 30 2 16z" fill="currentColor"/></svg>', name: "ромб" },
    { cls: "c2", svg: '<svg viewBox="0 0 32 32" aria-hidden="true"><circle cx="16" cy="16" r="13" fill="currentColor"/></svg>', name: "круг" },
    { cls: "c3", svg: '<svg viewBox="0 0 32 32" aria-hidden="true"><rect x="4" y="4" width="24" height="24" rx="2" fill="currentColor"/></svg>', name: "квадрат" }
  ];

  /* ---------- Звуки (WebAudio, без файлов) ---------- */
  let actx = null;
  const SFX = {
    unlock() { try { actx = actx || new (window.AudioContext || window.webkitAudioContext)(); if (actx.state === "suspended") actx.resume(); } catch (_) {} },
    tone(seq, type = "triangle", vol = 0.18) {
      if (!actx) return;
      let t = actx.currentTime;
      seq.forEach(([f, d]) => {
        const o = actx.createOscillator(), g = actx.createGain();
        o.type = type; o.frequency.setValueAtTime(f, t);
        g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + d);
        o.connect(g); g.connect(actx.destination); o.start(t); o.stop(t + d); t += d * 0.85;
      });
    },
    good() { this.tone([[660, .12], [880, .12], [1320, .25]]); },
    bad() { this.tone([[300, .18], [220, .3]], "sawtooth", .08); },
    penalty() { this.tone([[392, .22], [370, .22], [349, .22], [330, .55]], "square", .07); },
    bonus() { this.tone([[523, .1], [659, .1], [784, .1], [1047, .3]]); },
    join() { this.tone([[880, .08], [1175, .15]], "sine", .12); },
    tick(hi) { this.tone([[hi ? 1400 : 1000, .05]], "square", .05); },
    gong() { this.tone([[196, .9]], "triangle", .25); this.tone([[392, .7]], "sine", .12); },
    roll() { if (!actx) return; for (let i = 0; i < 18; i++) setTimeout(() => this.tone([[140 + i * 6, .06]], "square", .04 + i * .004), i * 70); setTimeout(() => this.tone([[523, .15], [659, .15], [784, .15], [1047, .6]], "triangle", .2), 1300); },
    muted: false,
    _mus: null,
    music(kind) {
      if (!actx || !window.MUSIC) return;
      window.MUSIC.init(actx); window.MUSIC.setMuted(this.muted);
      if (kind) window.MUSIC.play(kind); else window.MUSIC.stop();
    },
    sting(name) { if (actx && window.MUSIC && !this.muted) { window.MUSIC.init(actx); window.MUSIC.sting(name); } }
  };
  const _tone = SFX.tone.bind(SFX);
  SFX.tone = (seq, type, vol) => { if (!SFX.muted) _tone(seq, type, vol); };

  /* ---------- Конфетти ---------- */
  function confetti(n = 60, origin) {
    const box = document.createElement("div"); box.className = "confetti"; document.body.appendChild(box);
    const colors = ["#FFFFFF", "#5C8DFF", "#071A5C", "#DCE7FF", "#1F50FF", "#FFFFFF"];
    const ox = origin ? origin.x : innerWidth / 2, oy = origin ? origin.y : innerHeight / 3;
    for (let i = 0; i < n; i++) {
      const p = document.createElement("i");
      const a = Math.random() * Math.PI * 2, v = 120 + Math.random() * 320;
      p.style.cssText = `left:${ox}px;top:${oy}px;background:${colors[i % colors.length]};--dx:${Math.cos(a) * v}px;--dy:${Math.sin(a) * v - 160}px;--r:${Math.random() * 720 - 360}deg;animation-delay:${Math.random() * 80}ms`;
      if (i % 3 === 0) p.style.borderRadius = "50%";
      box.appendChild(p);
    }
    setTimeout(() => box.remove(), 1800);
  }

  window.OPP = { CFG, Net, U, SHAPES, SFX, confetti };
})();
