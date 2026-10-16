/* Общие настройки, связь и мелочи для студента и большого экрана */
(function () {
  "use strict";

  const qs = new URLSearchParams(location.search);

  const CFG = {
    room: "m3-a7k2",                                 // комната урока: все устройства должны совпадать
    base: "poddon-opp/live/v1",
    joinUrl: new URL("./", location.href).href.split("?")[0].replace(/screen\.html$/, ""),
    loginHash: "c6b4a57fd3fb3d03ab3830d1355f7947ccd3df81717ed8f0c6d87ef5b9ba7967",
    brokers: [
      "wss://broker.emqx.io:8084/mqtt",
      "wss://broker.hivemq.com:8884/mqtt",
      "wss://test.mosquitto.org:8081/mqtt"
    ],
    defaultPts: 10,
    firstBonus: 5
  };
  if (qs.get("broker")) CFG.brokers = qs.get("broker").split(",");
  CFG.topic = (s) => `${CFG.base}/${CFG.room}/${s}`;

  /* ---------- Минимальный MQTT 3.1.1 клиент поверх WebSocket ---------- */
  const enc = new TextEncoder(), dec = new TextDecoder();
  function strBytes(s) { const b = enc.encode(s); return [b.length >> 8, b.length & 255, ...b]; }
  function remLen(n) { const out = []; do { let d = n % 128; n = Math.floor(n / 128); if (n > 0) d |= 128; out.push(d); } while (n > 0); return out; }
  function packet(type, body) { return new Uint8Array([type, ...remLen(body.length), ...body]); }

  class Link {
    constructor(url, owner) {
      this.url = url; this.owner = owner; this.ws = null; this.up = false;
      this.buf = new Uint8Array(0); this.pid = 1; this.retry = 1000; this.timer = null;
      this.open();
    }
    open() {
      let ws;
      try { ws = new WebSocket(this.url, ["mqtt"]); } catch (e) { return this.later(); }
      this.ws = ws; ws.binaryType = "arraybuffer";
      const cid = "opp" + Math.random().toString(36).slice(2, 12);
      ws.onopen = () => {
        const body = [...strBytes("MQTT"), 4, 2, 0, 40, ...strBytes(cid)];
        ws.send(packet(0x10, body));
      };
      ws.onmessage = (ev) => this.feed(new Uint8Array(ev.data));
      ws.onclose = () => { this.setUp(false); this.later(); };
      ws.onerror = () => { try { ws.close(); } catch (_) {} };
      clearTimeout(this.cto);
      this.cto = setTimeout(() => { if (!this.up) { try { ws.close(); } catch (_) {} } }, 9000);
    }
    later() {
      clearInterval(this.ping);
      if (this.timer) return;
      this.timer = setTimeout(() => { this.timer = null; this.open(); }, this.retry);
      this.retry = Math.min(this.retry * 1.7, 15000);
    }
    setUp(v) { if (this.up !== v) { this.up = v; this.owner._status(); } }
    feed(chunk) {
      const b = new Uint8Array(this.buf.length + chunk.length); b.set(this.buf); b.set(chunk, this.buf.length); this.buf = b;
      for (;;) {
        if (this.buf.length < 2) return;
        let mul = 1, len = 0, i = 1, byte;
        do { if (i >= this.buf.length) return; byte = this.buf[i++]; len += (byte & 127) * mul; mul *= 128; } while (byte & 128);
        if (this.buf.length < i + len) return;
        const type = this.buf[0], body = this.buf.slice(i, i + len);
        this.buf = this.buf.slice(i + len);
        this.handle(type, body);
      }
    }
    handle(type, body) {
      const t = type >> 4;
      if (t === 2) { // CONNACK
        if (body[1] === 0) {
          this.retry = 1000; this.setUp(true);
          const topics = [...this.owner.subs];
          if (topics.length) this.subscribe(topics);
          clearInterval(this.ping);
          this.ping = setInterval(() => this.raw(new Uint8Array([0xC0, 0])), 20000);
        } else { try { this.ws.close(); } catch (_) {} }
      } else if (t === 3) { // PUBLISH
        const qos = (type >> 1) & 3, retain = type & 1;
        const tl = (body[0] << 8) | body[1];
        const topic = dec.decode(body.slice(2, 2 + tl));
        let off = 2 + tl; if (qos > 0) off += 2;
        const payload = body.slice(off);
        if (!payload.length) return;
        let obj = null; try { obj = JSON.parse(dec.decode(payload)); } catch (_) { return; }
        this.owner._msg(topic, obj, !!retain);
      }
    }
    raw(bytes) { if (this.ws && this.ws.readyState === 1) { try { this.ws.send(bytes); return true; } catch (_) {} } return false; }
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
      this.links = urls.map((u) => new Link(u, this));
    }
    get online() { return this.links.filter((l) => l.up).length; }
    get total() { return this.links.length; }
    sub(topic) { if (this.subs.has(topic)) return; this.subs.add(topic); this.links.forEach((l) => l.subscribe([topic])); }
    pub(topic, obj, retain = false) {
      const payload = enc.encode(JSON.stringify(obj));
      let ok = 0; this.links.forEach((l) => { if (l.publish(topic, payload, retain)) ok++; });
      return ok;
    }
    on(fn) { this.handlers.push(fn); }
    onStatus(fn) { this.statusFns.push(fn); fn(this.online, this.total); }
    _status() { this.statusFns.forEach((f) => f(this.online, this.total)); }
    _msg(topic, obj, retained) {
      if (obj && obj.mid) {           // одно и то же сообщение приходит с нескольких брокеров
        if (this.seen.has(obj.mid)) return;
        this.seen.set(obj.mid, Date.now());
        if (this.seen.size > 3000) { const cut = Date.now() - 600000; for (const [k, v] of this.seen) if (v < cut) this.seen.delete(k); }
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
      return `<svg viewBox="0 0 ${n + 2 * m} ${n + 2 * m}" shape-rendering="crispEdges" role="img" aria-label="QR-код"><rect width="100%" height="100%" fill="#fff"/><path d="${d}" fill="#172036"/></svg>`;
    },
    blockUrl: (id) => CFG.joinUrl + (id ? "?p=" + id : ""),
    qid: (b, i) => b + "." + i,
    totalQ: (b) => b.q.length,
    maxPts: (b) => b.q.reduce((s, q) => s + (q.p || CFG.defaultPts), 0)
  };

  /* ---------- Маскот «Поддоша» — деревянный поддон ---------- */
  function mascot(mood = "happy") {
    const eyes = {
      happy: `<ellipse cx="44" cy="44" rx="7" ry="9" fill="#172036"/><ellipse cx="76" cy="44" rx="7" ry="9" fill="#172036"/><circle cx="46" cy="40" r="2.6" fill="#fff"/><circle cx="78" cy="40" r="2.6" fill="#fff"/>`,
      wow: `<circle cx="44" cy="43" r="9" fill="#fff" stroke="#172036" stroke-width="3"/><circle cx="76" cy="43" r="9" fill="#fff" stroke="#172036" stroke-width="3"/><circle cx="45" cy="44" r="4.5" fill="#172036"/><circle cx="77" cy="44" r="4.5" fill="#172036"/>`,
      sleep: `<path d="M36 45q8 7 16 0M68 45q8 7 16 0" fill="none" stroke="#172036" stroke-width="3.5" stroke-linecap="round"/>`,
      sad: `<ellipse cx="44" cy="46" rx="6" ry="7" fill="#172036"/><ellipse cx="76" cy="46" rx="6" ry="7" fill="#172036"/><path d="M34 34l14 5M86 34l-14 5" stroke="#172036" stroke-width="3.5" stroke-linecap="round"/>`
    }[mood] || "";
    const mouth = {
      happy: `<path d="M50 58q10 11 20 0" fill="#ff7a6b" stroke="#172036" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"/>`,
      wow: `<ellipse cx="60" cy="62" rx="6" ry="7" fill="#7a2a22" stroke="#172036" stroke-width="3"/>`,
      sleep: `<path d="M54 61q6 3 12 0" fill="none" stroke="#172036" stroke-width="3.5" stroke-linecap="round"/>`,
      sad: `<path d="M50 65q10 -9 20 0" fill="none" stroke="#172036" stroke-width="3.5" stroke-linecap="round"/>`
    }[mood];
    const zzz = mood === "sleep" ? `<g class="zzz" fill="#2A5BFF" font-family="Rubik,sans-serif" font-weight="900"><text x="98" y="22" font-size="16">z</text><text x="108" y="10" font-size="12">z</text></g>` : "";
    return `<svg class="mascot mascot--${mood}" viewBox="0 0 120 104" aria-hidden="true">
      <g stroke="#172036" stroke-width="3.5" stroke-linejoin="round">
        <rect x="14" y="78" width="20" height="18" rx="4" fill="#C98545"/><rect x="50" y="78" width="20" height="18" rx="4" fill="#C98545"/><rect x="86" y="78" width="20" height="18" rx="4" fill="#C98545"/>
        <rect x="6" y="70" width="108" height="11" rx="4" fill="#DE9A55"/>
        <rect x="6" y="18" width="108" height="54" rx="10" fill="#F2B56B"/>
      </g>
      <path d="M10 36h100M10 54h100" stroke="#C98545" stroke-width="2.5" stroke-dasharray="14 6 30 8"/>
      <circle cx="30" cy="57" r="6" fill="#ff8f80" opacity=".55"/><circle cx="90" cy="57" r="6" fill="#ff8f80" opacity=".55"/>
      ${eyes}${mouth}${zzz}
    </svg>`;
  }

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
    join() { this.tone([[880, .08], [1175, .15]], "sine", .12); }
  };

  /* ---------- Конфетти ---------- */
  function confetti(n = 60, origin) {
    const box = document.createElement("div"); box.className = "confetti"; document.body.appendChild(box);
    const colors = ["#2A5BFF", "#FFC83D", "#22C58B", "#FF5B4A", "#F2B56B", "#9DB8FF"];
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

  window.OPP = { CFG, Net, U, mascot, SFX, confetti };
})();
