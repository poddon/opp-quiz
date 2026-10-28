/* Общие настройки, связь и мелочи для студента и большого экрана */
(function () {
  "use strict";

  /* ---------- Совместимость со старыми телефонами (iOS 12+, Android Chrome 61+) ---------- */
  if (!Object.hasOwn) Object.hasOwn = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
  if (!Object.fromEntries) Object.fromEntries = (it) => { const o = {}; for (const [k, v] of it) o[k] = v; return o; };
  if (!Array.prototype.flatMap) Object.defineProperty(Array.prototype, "flatMap", { configurable: true, writable: true, value(fn, t) { return [].concat(...this.map(fn, t)); } });

  const qs = new URLSearchParams(location.search);
  // Ссылки без ?room= сохраняют совместимость с первым классом.
  const roomId = qs.get("room") === "class2" ? "class2" : "class1";
  const localMode = qs.get("lan") === "1";
  const brokerNames = { emqx: "EMQX", hivemq: "HiveMQ", eclipse: "Eclipse", mosquitto: "Mosquitto" };
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
    // Публичные брокеры не обмениваются сообщениями между собой, поэтому экран
    // ведущего слушает ВСЕ сразу. Телефон стучится во все одновременно и остаётся
    // на том, через который ПЕРВЫМ пришёл сигнал от экрана ведущего.
    // Eclipse работает на обычном порту 443 — проходит через школьные фильтры.
    brokers: [netId, ...Object.keys(brokerNames).filter((k) => k !== netId)].map((k) => ({
      emqx: "wss://broker.emqx.io:8084/mqtt",
      hivemq: "wss://broker.hivemq.com:8884/mqtt",
      eclipse: "wss://mqtt.eclipseprojects.io:443/mqtt",
      mosquitto: "wss://test.mosquitto.org:8081/mqtt"
    }[k])),
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
      this.lastRx = 0; this.stopped = false;
      this.open();
    }
    stop() {
      this.stopped = true;
      clearTimeout(this.timer); this.timer = null;
      clearTimeout(this.cto); clearInterval(this.ping);
      const ws = this.ws; this.ws = null;
      if (ws) try { ws.close(); } catch (_) {}
      this.setUp(false);
    }
    open() {
      if (this.stopped) return;
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
      }, 6000);
    }
    later() {
      if (this.timer || this.stopped) return;
      const delay = this.retry + Math.round(Math.random() * 400);
      this.timer = setTimeout(() => { this.timer = null; this.open(); }, delay);
      this.retry = Math.min(Math.round(this.retry * 1.6), 12000);
    }
    wake(force = false) {
      if (this.stopped) return;
      if (!force && this.up && this.ws && this.ws.readyState === 1) return;
      const old = this.ws;
      clearTimeout(this.timer); this.timer = null;
      clearTimeout(this.cto); clearInterval(this.ping);
      this.setUp(false);
      this.retry = 900;
      this.open();
      if (old) try { old.close(); } catch (_) {}
    }
    setUp(v) { if (this.up !== v) { this.up = v; this.owner._linkState(this, v); this.owner._status(); } }
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
        this.owner._msg(topic, obj, !!retain, this);
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

  // mode "all": одно соединение с каждым сервером (экран ведущего).
  // mode "race": телефон подключается ко всем серверам сразу и выбирает тот,
  // через который первым пришло состояние от экрана ведущего; остальные закрывает.
  // Если выбранный сервер замолчал — снова «гонка» по всем.
  class Net {
    constructor(urls, mode = "race") {
      this.subs = new Set(); this.handlers = []; this.statusFns = []; this.seen = new Map();
      this.local = CFG.localMode; this.ws = null; this.localUp = false; this.localTimer = null; this.localRx = 0;
      this.links = []; this.urls = urls; this.mode = mode;
      this.hostT = CFG.topic("st"); this.plT = CFG.topic("pl/"); this.active = null; this.activeRx = 0; this.activeDown = 0;
      if (this.local) {
        this.openLocal();
        // Wi-Fi может «молча» оборвать соединение: сервер шлёт ping каждые 15 с.
        setInterval(() => {
          if (this.localUp && Date.now() - this.localRx > 40000) try { this.ws.close(); } catch (_) {}
        }, 5000);
      } else {
        this.links = urls.map((u) => new Link(u, this));
        if (mode === "race" && urls.length > 1) setInterval(() => this.watch(), 2000);
      }
      window.addEventListener("online", () => this.reconnect());
      document.addEventListener("visibilitychange", () => {
        if (!document.hidden) this.reconnect();
      });
    }
    // Выбран сервер: закрываем лишние соединения.
    choose(link) {
      this.active = link; this.activeRx = Date.now(); this.activeDown = 0;
      this.links.forEach((l) => { if (l !== link) l.stop(); });
      this.links = [link];
      this._status();
    }
    // Экран ведущего шлёт состояние минимум раз в 10 с. Тишина 25 с или обрыв 3 с —
    // заново подключаемся ко всем серверам и выбираем самый быстрый.
    watch() {
      const a = this.active;
      if (!a) return;
      const silent = Date.now() - this.activeRx > 25000;
      const down = !a.up && this.activeDown && Date.now() - this.activeDown > 3000;
      if (!silent && !down) return;
      this.active = null;
      this.links = this.urls.map((u) => (u === a.url && !a.stopped ? a : new Link(u, this)));
      this._status();
    }
    _linkState(link, up) {
      if (link === this.active) this.activeDown = up ? 0 : Date.now();
      // Новое соединение во время «гонки»: просим экран ведущего сразу отозваться.
      if (up && this.mode === "race" && !this.active) setTimeout(() => {
        if (!this.active && link.up) link.publish(CFG.topic("up"), enc.encode(JSON.stringify({ ty: "hi", mid: "hi" + Math.random().toString(36).slice(2, 10) })), false);
      }, 50);
    }
    openLocal() {
      if (this.localTimer || (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING))) return;
      let ws;
      try { ws = new WebSocket(CFG.localWsUrl); }
      catch (_) { this.scheduleLocal(); return; }
      this.ws = ws;
      ws.onopen = () => {
        if (this.ws !== ws) return;
        this.localUp = true; this.localRx = Date.now(); this._status();
        if (this.subs.size) this.localSend({ type: "sub", topics: [...this.subs] });
      };
      ws.onmessage = (ev) => {
        if (this.ws !== ws) return;
        this.localRx = Date.now();
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
    // Имя сервера, через который телефон сейчас связан с экраном (для подсказки в интерфейсе).
    get serverName() {
      if (this.local) return "локальная сеть";
      const l = this.active || this.links.find((x) => x.up);
      if (!l) return "";
      const host = new URL(l.url).hostname;
      return host.includes("emqx") ? "EMQX" : host.includes("hivemq") ? "HiveMQ" : host.includes("eclipse") ? "Eclipse" : host.includes("mosquitto") ? "Mosquitto" : host;
    }
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
    _msg(topic, obj, retained, link) {
      if (link && this.mode === "race") {
        if (this.active && link !== this.active) return;
        // Выбираем сервер только по ЖИВОМУ сообщению экрана (не по сохранённому
        // retained — оно могло остаться от прошлого занятия на сервере без ведущего).
        if (!retained && (topic === this.hostT || topic.startsWith(this.plT))) {
          if (!this.active) this.choose(link);
          this.activeRx = Date.now();
        }
      }
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

  /* ---------- SHA-256 ---------- */
  const SUBTLE = !!(window.crypto && crypto.subtle && window.isSecureContext !== false);
  const hex = (buf) => Array.from(new Uint8Array(buf), (x) => (x < 16 ? "0" : "") + x.toString(16)).join("");
  async function sha256(bytes) {
    if (SUBTLE) { try { return new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)); } catch (_) {} }
    return sha256js(bytes);
  }
  const K256 = new Uint32Array([0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2]);
  function sha256js(msg) {
    const l = msg.length, n = ((l + 9 + 63) >> 6) << 6, m = new Uint8Array(n);
    m.set(msg); m[l] = 0x80;
    const dv = new DataView(m.buffer);
    dv.setUint32(n - 8, Math.floor(l / 0x20000000)); dv.setUint32(n - 4, (l << 3) >>> 0);
    const H = new Uint32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);
    const w = new Uint32Array(64);
    const r = (x, c) => (x >>> c) | (x << (32 - c));
    for (let o = 0; o < n; o += 64) {
      for (let i = 0; i < 16; i++) w[i] = dv.getUint32(o + i * 4);
      for (let i = 16; i < 64; i++) {
        const s0 = r(w[i - 15], 7) ^ r(w[i - 15], 18) ^ (w[i - 15] >>> 3), s1 = r(w[i - 2], 17) ^ r(w[i - 2], 19) ^ (w[i - 2] >>> 10);
        w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
      }
      let [a, b, c, d, e, f, g, h] = H;
      for (let i = 0; i < 64; i++) {
        const t1 = (h + (r(e, 6) ^ r(e, 11) ^ r(e, 25)) + ((e & f) ^ (~e & g)) + K256[i] + w[i]) >>> 0;
        const t2 = ((r(a, 2) ^ r(a, 13) ^ r(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) >>> 0;
        h = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = b; b = a; a = (t1 + t2) >>> 0;
      }
      H[0] += a; H[1] += b; H[2] += c; H[3] += d; H[4] += e; H[5] += f; H[6] += g; H[7] += h;
    }
    const out = new Uint8Array(32), ov = new DataView(out.buffer);
    for (let i = 0; i < 8; i++) ov.setUint32(i * 4, H[i]);
    return out;
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
    esc: (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])),
    plural: (n, a, b, c) => { const m10 = n % 10, m100 = n % 100; return m10 === 1 && m100 !== 11 ? a : m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20) ? b : c; },
    store: {
      get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (_) { return d; } },
      set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (_) {} },
      del(k) { try { localStorage.removeItem(k); } catch (_) {} }
    },
    // crypto.subtle есть только на HTTPS. В локальном режиме (http://IP-ноутбука)
    // и в старых браузерах считаем тот же SHA-256/HMAC на чистом JS — результат одинаковый.
    async sha256hex(s) {
      return hex(await sha256(enc.encode(s)));
    },
    async hmacKey(password) {
      return { raw: await sha256(enc.encode("opp-hmac|" + password)) };
    },
    async sign(key, text) {
      const msg = enc.encode(text);
      if (SUBTLE) {
        try {
          if (!key.ck) key.ck = await crypto.subtle.importKey("raw", key.raw, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
          return hex(await crypto.subtle.sign("HMAC", key.ck, msg));
        } catch (_) {}
      }
      const k = new Uint8Array(64); k.set(key.raw);
      const ip = new Uint8Array(64 + msg.length), op = new Uint8Array(96);
      for (let i = 0; i < 64; i++) { ip[i] = k[i] ^ 0x36; op[i] = k[i] ^ 0x5c; }
      ip.set(msg, 64); op.set(sha256js(ip), 64);
      return hex(sha256js(op));
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
