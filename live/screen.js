(function () {
  "use strict";
  const { CFG, Net, U, mascot, SFX, confetti } = window.OPP;
  const { $, $$, esc } = U;
  const BLOCKS = window.BLOCKS, VIOL = window.VIOLATIONS;
  const byId = Object.fromEntries(BLOCKS.map((b) => [String(b.id), b]));

  const T_ST = CFG.topic("st"), T_UP = CFG.topic("up"), T_ADM = CFG.topic("adm");
  const T_PL = (pid) => CFG.topic("pl/" + pid);

  let role = null, password = null, hkey = null, net = null;

  $("#loginMascot").innerHTML = mascot("wow");
  $("#hostMascot").innerHTML = mascot("happy");
  $("#emptyMascot").innerHTML = mascot("sleep");

  // ======================= ВХОД =======================
  const sess = (() => { try { return JSON.parse(sessionStorage.getItem("opp.adm") || "null"); } catch (_) { return null; } })();
  if (sess && sess.pw) { password = sess.pw; checkPw(password).then((ok) => ok ? (sess.role ? start(sess.role) : showRoles()) : null); }

  async function checkPw(pw) { return (await U.sha256hex("opp-login|" + pw)) === CFG.loginHash; }
  $("#loginForm").addEventListener("submit", async (e) => {
    e.preventDefault(); SFX.unlock();
    const lg = $("#lg").value.trim().toLowerCase(), pw = $("#pw").value;
    if (lg !== "admin" || !(await checkPw(pw))) { $("#lgErr").textContent = "Неверный логин или пароль"; $("#loginForm").classList.remove("shake"); void $("#loginForm").offsetWidth; $("#loginForm").classList.add("shake"); return; }
    password = pw; saveSess(null); showRoles();
  });
  function saveSess(r) { try { sessionStorage.setItem("opp.adm", JSON.stringify({ pw: password, role: r })); } catch (_) {} }
  function showRoles() {
    $("#loginForm").hidden = true; $("#roleCard").hidden = false;
    $$(".role").forEach((b) => b.onclick = () => { SFX.unlock(); saveSess(b.dataset.role); start(b.dataset.role); });
  }
  function logout() { try { sessionStorage.removeItem("opp.adm"); } catch (_) {} location.reload(); }

  async function start(r) {
    role = r; hkey = await U.hmacKey(password);
    $("#v-login").hidden = true;
    net = new Net(CFG.brokers);
    if (role === "host") startHost(); else startPult();
  }

  // shavings
  const sh = $(".shavings");
  for (let i = 0; i < 8; i++) { const s = document.createElement("span"); s.style.left = Math.random() * 100 + "%"; s.style.animationDuration = 16 + Math.random() * 14 + "s"; s.style.animationDelay = -Math.random() * 20 + "s"; sh.appendChild(s); }

  function toast(text) { const t = document.createElement("div"); t.className = "toast sticker"; t.textContent = text; $("#toasts").appendChild(t); setTimeout(() => t.remove(), 2600); }
  function fmtD(d) { return d < 0 ? "−" + Math.abs(d) : "+" + d; }

  // =================== МОДАЛКА ИГРОКА (общая) ===================
  function openPlayer(p, { onAdj, onDelete, history }) {
    const m = $("#modal"), box = $("#modalBox");
    const neg = VIOL.filter((v) => v.delta < 0), pos = VIOL.filter((v) => v.delta > 0);
    box.innerHTML = `
      <div class="mhead"><div class="avatar" style="--h:${U.hue(p.k)}">${esc(U.initials(p.n))}</div>
        <div><b>${esc(p.n)}</b><span class="muted" style="font-weight:800;color:var(--muted)">${p.s} ${U.plural(p.s, "очко", "очка", "очков")}</span></div>
        <button class="x" type="button" id="mx" aria-label="Закрыть">✕</button></div>
      <span class="eyebrow">Нарушения</span>
      <div class="vgrid">${neg.map((v) => `<button class="vbtn" type="button" data-v="${v.id}"><span class="e">${v.emoji}</span>${esc(v.label)}<span class="d">${fmtD(v.delta)}</span></button>`).join("")}</div>
      <span class="eyebrow">Бонусы</span>
      <div class="vgrid">${pos.map((v) => `<button class="vbtn pos" type="button" data-v="${v.id}"><span class="e">${v.emoji}</span>${esc(v.label)}<span class="d">${fmtD(v.delta)}</span></button>`).join("")}</div>
      <span class="eyebrow">Своё значение</span>
      <div class="custom"><input id="cD" type="number" step="1" value="5" aria-label="Очки"><input id="cR" type="text" maxlength="60" placeholder="Причина, например «вышел к доске»" aria-label="Причина"></div>
      <div class="mfoot"><button class="btn btn--sm btn--red" type="button" id="cMinus">− Снять</button><button class="btn btn--sm" type="button" id="cPlus">+ Начислить</button></div>
      ${history && history.length ? `<span class="eyebrow">История</span><div class="hist">${history.slice().reverse().map((e) => `<div><span>${e.e || ""} ${esc(e.r)}</span><b>${fmtD(e.d)}</b></div>`).join("")}</div>` : ""}
      ${onDelete ? `<div class="mfoot"><span></span><button class="btn btn--sm btn--ghost" type="button" id="mDel">Убрать из рейтинга</button></div>` : ""}`;
    m.hidden = false;
    const close = () => { m.hidden = true; };
    $("#mx").onclick = close;
    m.onclick = (e) => { if (e.target === m) close(); };
    box.querySelectorAll(".vbtn").forEach((b) => b.onclick = () => { const v = VIOL.find((x) => x.id === b.dataset.v); onAdj(v.delta, v.label, v.emoji); close(); });
    const custom = (sign) => { const d = Math.abs(parseInt($("#cD").value, 10) || 0); if (!d) return; const r = $("#cR").value.trim() || (sign < 0 ? "Нарушение" : "Бонус"); onAdj(sign * d, r, sign < 0 ? "⚠️" : "⭐"); close(); };
    $("#cMinus").onclick = () => custom(-1); $("#cPlus").onclick = () => custom(1);
    if (onDelete) $("#mDel").onclick = (ev) => {
      const b = ev.currentTarget;
      if (b.dataset.sure) { onDelete(); close(); } else { b.dataset.sure = 1; b.textContent = "Точно убрать? Нажмите ещё раз"; b.classList.add("btn--red"); }
    };
  }
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") $("#modal").hidden = true; });

  // =========================== БОЛЬШОЙ ЭКРАН ===========================
  function startHost() {
    const HOST_ID = "h" + U.mid(), started = Date.now();
    const LS = "opp.host." + CFG.room;
    const fresh = () => ({ sid: "s" + U.mid(), players: {}, pidKey: {}, closed: [], active: null, feed: [], first: {} });
    let S = U.store.get(LS, null) || fresh();
    let saveT = null; const save = () => { clearTimeout(saveT); saveT = setTimeout(() => U.store.set(LS, S), 250); };
    let presenting = U.store.get("opp.presenting", false);
    const usedNonces = new Map();

    $("#v-host").hidden = false;
    document.body.classList.toggle("presenting", presenting);

    net.onStatus((on, tot) => {
      $("#hNetDot").classList.toggle("on", on > 0);
      $("#hNet").textContent = on ? `на связи ${on}/${tot}` : "нет связи";
      if (on) { broadcast(true); }
    });
    net.sub(T_UP); net.sub(T_ADM); net.sub(T_ST);

    net.on(async (topic, msg) => {
      if (topic === T_UP) handleUp(msg);
      else if (topic === T_ADM) handleAdm(msg);
      else if (topic === T_ST) {
        if (msg.host && msg.host !== HOST_ID && msg.ts > started + 3000) showBanner("Открыт ещё один большой экран! Оставьте только один, иначе очки разойдутся.");
      }
    });

    // ---------- модель ----------
    function ranked() {
      const arr = Object.values(S.players).sort((a, b) => b.score - a.score || a.name.localeCompare(b.name, "ru"));
      let r = 0, prev = null; arr.forEach((p, i) => { if (p.score !== prev) { r = i + 1; prev = p.score; } p._rank = r; });
      return arr;
    }
    function ensure(name, pid) {
      const key = U.normName(name);
      if (!key || key.length < 3) return null;
      let p = S.players[key];
      if (!p) {
        if (Object.keys(S.players).length >= 300) return null;
        p = S.players[key] = { key, name: U.cleanName(name).slice(0, 60), score: 0, ans: {}, ev: [], pids: [], joined: Date.now() };
        feed({ ty: "join", k: key, n: p.name, e: "👋", r: "в игре" });
        SFX.join();
      }
      if (pid && typeof pid === "string" && pid.length < 40) {
        if (!p.pids.includes(pid)) { p.pids.push(pid); if (p.pids.length > 4) p.pids.shift(); }
        S.pidKey[pid] = key;
      }
      p.seen = Date.now();
      return p;
    }
    function feed(item) { item.t = Date.now(); item.id = U.mid(); S.feed.push(item); S.feed = S.feed.slice(-30); renderTicker(item); }

    function handleUp(m) {
      if (!m || typeof m !== "object" || typeof m.name !== "string") return;
      const p = ensure(m.name, m.pid);
      if (!p) return;
      if (m.ty === "ans" && typeof m.q === "string") {
        const [bid, qi] = m.q.split("."); const b = byId[bid]; const q = b && b.q[+qi];
        const a = Number.isInteger(m.a) ? m.a : -1;
        if (q && a >= 0 && a < q.o.length && !p.ans[m.q] && !S.closed.includes(b.id)) {
          const ok = a === q.c; let pts = ok ? (q.p || CFG.defaultPts) : 0, first = false;
          if (ok && !S.first[m.q]) { S.first[m.q] = p.key; first = true; pts += CFG.firstBonus; }
          p.ans[m.q] = { a, ok, pts, first };
          p.score += pts;
          if (first) feed({ ty: "first", k: p.key, n: p.name, e: "⚡", r: `первым верно ответил(а) — слайд ${bid}, вопрос ${+qi + 1}` });
          if (pts) flashRow(p.key, pts);
        }
      }
      save(); publishPlayer(p); broadcast(); renderAll();
    }

    function adjust(key, d, r, e) {
      const p = S.players[key]; if (!p || !d) return;
      d = Math.max(-1000, Math.min(1000, Math.round(d)));
      p.score += d;
      const ev = { id: "e" + U.mid(), d, r: String(r).slice(0, 60), e: e || "", t: Date.now() };
      p.ev.push(ev); p.ev = p.ev.slice(-30);
      feed({ ty: d < 0 ? "neg" : "pos", k: key, n: p.name, e, r, d });
      save(); publishPlayer(p); broadcast(); renderAll();
      flashRow(key, d);
      eventPop(p, ev);
    }
    function removePlayer(key) {
      const p = S.players[key]; if (!p) return;
      delete S.players[key];
      for (const pid in S.pidKey) if (S.pidKey[pid] === key) delete S.pidKey[pid];
      save(); broadcast(); renderAll(); toast("Убран из рейтинга: " + p.name);
    }
    function setActive(id) { S.active = id ? +id : null; save(); broadcast(); renderAll(); }
    function setClosed(id, closed) { id = +id; S.closed = S.closed.filter((x) => x !== id); if (closed) S.closed.push(id); save(); broadcast(); renderAll(); }

    // ---------- рассылка ----------
    function playerPayload(p) {
      return { ts: Date.now(), sid: S.sid, key: p.key, name: p.name, score: p.score, rank: p._rank, of: Object.keys(S.players).length, ans: p.ans, ev: p.ev.slice(-8) };
    }
    function publishPlayer(p) {
      ranked();
      const pl = playerPayload(p); p._pubRank = p._rank; p._pubOf = pl.of;
      p.pids.forEach((pid) => net.pub(T_PL(pid), pl, true));
    }
    // раз в 8 секунд досылаем изменившиеся места в рейтинге
    setInterval(() => {
      const arr = ranked(), n = arr.length;
      arr.forEach((p) => { if (p._pubRank !== p._rank || p._pubOf !== n) publishPlayer(p); });
    }, 8000);

    let bT = null, lastB = 0;
    function broadcast(now) {
      clearTimeout(bT);
      const go = () => {
        lastB = Date.now();
        const arr = ranked();
        net.pub(T_ST, {
          mid: U.mid(), ts: Date.now(), host: HOST_ID, sid: S.sid, active: S.active, closed: S.closed,
          n: arr.length, board: arr.map((p) => ({ k: p.key, n: p.name, s: p.score, r: p._rank }))
        }, true);
      };
      if (now) go(); else bT = setTimeout(go, Math.max(0, 600 - (Date.now() - lastB)));
    }
    setInterval(() => broadcast(true), 15000);

    // ---------- пульт ----------
    async function handleAdm(m) {
      if (!m || !m.cmd || !m.sig || !m.n || !m.ts) return;
      if (Math.abs(Date.now() - m.ts) > 5 * 60000 || usedNonces.has(m.n)) return;
      const sig = await U.sign(hkey, m.ts + "|" + m.n + "|" + JSON.stringify(m.cmd));
      if (sig !== m.sig) return;
      usedNonces.set(m.n, Date.now());
      const c = m.cmd;
      if (c.op === "adj") adjust(c.k, +c.d, c.r, c.e);
      else if (c.op === "active") setActive(c.id);
      else if (c.op === "close") setClosed(c.id, !!c.v);
    }

    // ---------- отрисовка ----------
    const shown = {}; // key -> показанный счёт (для анимации чисел)
    function avatar(p) { return `<div class="avatar" style="--h:${U.hue(p.key)}">${esc(U.initials(p.name))}</div>`; }
    function okCount(p) { return Object.values(p.ans).filter((a) => a.ok).length; }

    function renderAll() { renderBoard(); renderQR(); renderAdminBar(); $("#hCount").textContent = Object.keys(S.players).length; }

    function flip(container, build) {
      const before = new Map();
      container.querySelectorAll("[data-k]").forEach((el) => before.set(el.dataset.k, el.getBoundingClientRect()));
      build();
      container.querySelectorAll("[data-k]").forEach((el) => {
        const b = before.get(el.dataset.k); if (!b) { el.classList.add("pop-in"); return; }
        const a = el.getBoundingClientRect(); const dx = b.left - a.left, dy = b.top - a.top;
        if (dx || dy) { el.animate([{ transform: `translate(${dx}px,${dy}px)` }, { transform: "none" }], { duration: 650, easing: "cubic-bezier(.2,1.2,.4,1)" }); }
      });
    }
    function countUp(el, key, to) {
      const from = shown[key] ?? to; shown[key] = to;
      if (from === to) { el.textContent = to; return; }
      const t0 = performance.now(), dur = 700;
      const step = (t) => { const k = Math.min(1, (t - t0) / dur); el.textContent = Math.round(from + (to - from) * (1 - Math.pow(1 - k, 3))); if (k < 1) requestAnimationFrame(step); };
      requestAnimationFrame(step);
    }

    function renderBoard() {
      const arr = ranked();
      $("#boardEmpty").hidden = arr.length > 0;
      $("#podium").hidden = arr.length === 0;
      const top = [arr[1], arr[0], arr[2]], cls = ["p2", "p1", "p3"], medal = ["🥈", "👑", "🥉"];
      flip($("#podium"), () => {
        $("#podium").innerHTML = top.map((p, i) => p
          ? `<div class="pod ${cls[i]}" data-k="${esc(p.key)}"><span class="medal">${medal[i]}</span>${avatar(p)}<div class="nm">${esc(p.name)}</div><div class="sc" data-sc>${p.score}</div><div class="sm">${p._rank} место · ✓ ${okCount(p)}</div></div>`
          : `<div class="pod ${cls[i]} empty"><span class="medal">${medal[i]}</span><div class="nm">—</div><div class="sc">0</div></div>`).join("");
      });
      const rest = arr.slice(3);
      const rowsEl = $("#rows");
      rowsEl.style.gridTemplateRows = window.innerWidth > 900 ? `repeat(${Math.max(1, Math.ceil(rest.length / 2))}, auto)` : "";
      flip(rowsEl, () => {
        rowsEl.innerHTML = rest.map((p) => `<div class="row" data-k="${esc(p.key)}"><span class="rk">${p._rank}</span>${avatar(p)}<span class="nm">${esc(p.name)}</span><span class="ok">✓ ${okCount(p)}</span><span class="sc" data-sc>${p.score}</span></div>`).join("");
      });
      $$("[data-k]", $(".board")).forEach((el) => {
        const p = S.players[el.dataset.k]; if (!p) return;
        const sc = el.querySelector("[data-sc]"); if (sc) countUp(sc, p.key, p.score);
        el.onclick = () => openPlayer({ k: p.key, n: p.name, s: p.score }, { history: p.ev, onAdj: (d, r, e) => adjust(p.key, d, r, e), onDelete: () => removePlayer(p.key) });
      });
    }

    function flashRow(key, d) {
      requestAnimationFrame(() => {
        const el = $(`.board [data-k="${CSS.escape(key)}"]`); if (!el) return;
        el.classList.remove("flash-neg", "flash-pos"); void el.offsetWidth; el.classList.add(d < 0 ? "flash-neg" : "flash-pos");
        const b = document.createElement("span"); b.className = "delta-badge " + (d < 0 ? "neg" : "pos"); b.textContent = fmtD(d); el.appendChild(b);
        setTimeout(() => b.remove(), 1700);
      });
    }

    function blockStats(b) {
      const players = Object.values(S.players);
      const done = players.filter((p) => b.q.every((_, i) => p.ans[U.qid(b.id, i)])).length;
      const per = b.q.map((_, i) => { const qid = U.qid(b.id, i); const as = players.map((p) => p.ans[qid]).filter(Boolean); return { n: as.length, ok: as.filter((a) => a.ok).length }; });
      return { done, total: players.length, per };
    }

    let qrKey = "";
    function renderQR() {
      const panel = $("#qrpanel");
      const b = S.active ? byId[S.active] : null;
      const url = U.blockUrl(b ? b.id : null);
      const closed = b && S.closed.includes(b.id);
      let html;
      if (b) {
        const st = blockStats(b);
        const pct = st.total ? Math.round(100 * st.done / st.total) : 0;
        html = `<span class="eyebrow">Практика · слайд ${b.id} · ${esc(b.topic)}</span>
          <h2>${b.emoji} ${esc(b.title)}</h2>
          <div class="qrbox">${U.qrSvg(url)}</div>
          <div class="qrurl">${esc(url.replace(/^https?:\/\//, ""))}</div>
          ${closed ? `<div class="pill" style="align-self:center;color:var(--ink)">🔒 Приём ответов закрыт</div>` : ""}
          <div class="prog"><div class="lbl"><span>Прошли блок</span><span>${st.done} из ${st.total}</span></div><div class="bar"><i style="width:${pct}%"></i></div></div>
          <div class="qstats">${st.per.map((x, i) => `<div class="qstat"><span>В${i + 1}</span><div class="b"><i style="width:${x.n ? Math.round(100 * x.ok / x.n) : 0}%"></i></div><span>${x.n ? Math.round(100 * x.ok / x.n) + "%" : "—"}</span></div>`).join("")}</div>
          <div class="qradm"><button class="btn btn--sm ${closed ? "" : "btn--red"}" type="button" id="qClose">${closed ? "🔓 Открыть приём" : "🔒 Закрыть приём"}</button><button class="btn btn--sm btn--ghost" type="button" id="qHide">Общий QR</button></div>`;
      } else {
        html = `<span class="eyebrow">Присоединяйтесь</span>
          <h2>Сканируй — и в бой! 📲</h2>
          <div class="qrbox">${U.qrSvg(url)}</div>
          <div class="qrurl">${esc(url.replace(/^https?:\/\//, ""))}</div>
          <p style="margin:0;font-weight:800">Введи фамилию и имя. Вопросы откроются по QR-коду на слайде с практикой.</p>`;
      }
      if (html === qrKey) return; qrKey = html;
      panel.innerHTML = html;
      const qc = $("#qClose"); if (qc) qc.onclick = () => setClosed(b.id, !closed);
      const qh = $("#qHide"); if (qh) qh.onclick = () => setActive(null);
    }

    function renderAdminBar() {
      const bar = $("#adminbar");
      bar.innerHTML = `<b>На экране:</b><button class="chip ${!S.active ? "on" : ""}" data-a="">📲 Общий QR</button>` +
        BLOCKS.map((b) => `<button class="chip ${S.active === b.id ? "on" : ""} ${S.closed.includes(b.id) ? "closed" : ""}" data-a="${b.id}" title="${esc(b.title)}">${b.emoji} ${b.id}</button>`).join("");
      bar.querySelectorAll("[data-a]").forEach((c) => c.onclick = () => setActive(c.dataset.a || null));
    }

    function renderTicker(item) {
      const tk = $("#ticker");
      const el = document.createElement("span");
      el.className = "tick " + (item.ty === "neg" ? "neg" : item.ty === "pos" ? "pos" : item.ty === "first" ? "first" : "");
      el.innerHTML = `${item.e || ""} <b>${esc(item.n)}</b> ${esc(item.r || "")}${item.d ? " " + fmtD(item.d) : ""}`;
      tk.insertBefore(el, tk.children[1] || null);
      while (tk.children.length > 9) tk.lastChild.remove();
    }

    // ---------- событие на весь экран ----------
    const popQ = []; let popping = false;
    function eventPop(p, ev) { popQ.push({ p, ev }); if (!popping) nextPop(); }
    function nextPop() {
      const it = popQ.shift(); if (!it) { popping = false; return; }
      popping = true;
      const { p, ev } = it, neg = ev.d < 0;
      const mood = neg ? (/сон|сп/i.test(ev.r) ? "sleep" : "sad") : "wow";
      const el = document.createElement("div");
      el.className = "epop " + (neg ? "neg" : "pos");
      el.innerHTML = `<div class="box sticker">${mascot(mood)}<div><div class="em">${ev.e || (neg ? "⚠️" : "🌟")}</div><div class="nm">${esc(p.name)}</div><div class="rs">${esc(ev.r)}</div><div class="dl">${fmtD(ev.d)}</div></div></div>`;
      document.body.appendChild(el);
      neg ? SFX.penalty() : (SFX.bonus(), confetti(110));
      setTimeout(() => { el.classList.add("out"); setTimeout(() => { el.remove(); nextPop(); }, 400); }, 3200);
    }

    function showBanner(text) {
      if ($(".banner")) return;
      const b = document.createElement("div"); b.className = "banner"; b.textContent = text; document.body.appendChild(b);
      setTimeout(() => b.remove(), 12000);
    }

    // ---------- кнопки ----------
    function togglePresent() { presenting = !presenting; U.store.set("opp.presenting", presenting); document.body.classList.toggle("presenting", presenting); }
    $("#bPresent").onclick = togglePresent;
    document.addEventListener("keydown", (e) => {
      if (e.target.matches("input,textarea,select")) return;
      if (e.key === "p" || e.key === "P" || e.key === "з" || e.key === "З") togglePresent();
    });
    $("#bOut").onclick = logout;
    $("#bCsv").onclick = () => {
      const rows = [["Место", "Фамилия Имя", "Очки", "Верных ответов", "Всего ответов", "Штрафы", "Бонусы"]];
      ranked().forEach((p) => {
        const a = Object.values(p.ans);
        rows.push([p._rank, p.name, p.score, a.filter((x) => x.ok).length, a.length,
          p.ev.filter((e) => e.d < 0).reduce((s, e) => s + e.d, 0), p.ev.filter((e) => e.d > 0).reduce((s, e) => s + e.d, 0)]);
      });
      const csv = "﻿" + rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(";")).join("\r\n");
      const a = document.createElement("a");
      a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
      a.download = "Рейтинг_Модуль3_" + new Date().toLocaleDateString("ru-RU").replace(/\./g, "-") + ".csv";
      document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
    };
    $("#bReset").onclick = () => {
      const m = $("#modal"), box = $("#modalBox");
      box.innerHTML = `<div class="mhead"><div style="width:90px">${mascot("wow")}</div><div><b>Начать новый урок?</b><span style="font-weight:700;color:var(--muted)">Все очки и ответы обнулятся. Таблицу лучше скачать заранее.</span></div></div>
        <div class="mfoot"><button class="btn btn--ghost" type="button" id="rNo">Отмена</button><button class="btn btn--red" type="button" id="rYes">Да, обнулить</button></div>`;
      m.hidden = false;
      $("#rNo").onclick = () => m.hidden = true;
      $("#rYes").onclick = () => {
        const old = Object.values(S.players).flatMap((p) => p.pids);
        S = fresh(); save(); m.hidden = true;
        old.forEach((pid) => net.pub(T_PL(pid), { ts: Date.now(), sid: S.sid, key: "", name: "", score: 0, ans: {}, ev: [] }, true));
        Object.keys(shown).forEach((k) => delete shown[k]);
        $("#ticker").querySelectorAll(".tick").forEach((t) => t.remove());
        broadcast(true); renderAll(); toast("Новый урок начат");
      };
    };
    window.addEventListener("resize", () => renderBoard());

    S.feed.slice(-8).forEach(renderTicker);
    renderAll();
    broadcast(true);
  }

  // =============================== ПУЛЬТ ===============================
  function startPult() {
    $("#v-pult").hidden = false;
    let st = null;
    net.sub(T_ST);
    const alive = () => st && Date.now() - st.ts < 70000;
    const upd = () => {
      const on = net.online;
      $("#pNetDot").classList.toggle("on", on > 0 && alive());
      $("#pNet").textContent = !on ? "нет связи" : alive() ? "экран на связи" : "большой экран не отвечает";
    };
    net.onStatus(upd); setInterval(upd, 4000);
    net.on((topic, msg) => { if (topic === T_ST) { if (st && msg.ts < st.ts) return; st = msg; upd(); render(); } });

    const sel = $("#pActive");
    sel.innerHTML = `<option value="">📲 Общий QR</option>` + BLOCKS.map((b) => `<option value="${b.id}">${b.emoji} Слайд ${b.id} — ${esc(b.title)}</option>`).join("");
    sel.onchange = () => cmd({ op: "active", id: sel.value ? +sel.value : null }, "Экран переключён");
    $("#pSearch").oninput = render;
    $("#pOut").onclick = logout;

    async function cmd(c, okText) {
      const ts = Date.now(), n = U.mid();
      const sig = await U.sign(hkey, ts + "|" + n + "|" + JSON.stringify(c));
      const sent = net.pub(T_ADM, { mid: U.mid(), ts, n, cmd: c, sig });
      toast(sent ? (alive() ? okText : okText + " (экран пока не отвечает)") : "Нет связи — команда не ушла");
    }

    function render() {
      if (!st) { $("#plist").innerHTML = `<p class="muted">Ждём данные с большого экрана…</p>`; return; }
      if (document.activeElement !== sel) sel.value = st.active ? String(st.active) : "";
      const q = U.normName($("#pSearch").value);
      const list = (st.board || []).filter((p) => !q || p.k.includes(q));
      $("#plist").innerHTML = list.length ? list.map((p) => `<div class="row" data-k="${esc(p.k)}"><span class="rk">${p.r}</span><div class="avatar" style="--h:${U.hue(p.k)}">${esc(U.initials(p.n))}</div><span class="nm">${esc(p.n)}</span><span class="sc">${p.s}</span></div>`).join("")
        : `<p class="muted">${st.board && st.board.length ? "Никого не нашли" : "Пока никто не присоединился"}</p>`;
      $$("#plist .row").forEach((el) => el.onclick = () => {
        const p = st.board.find((x) => x.k === el.dataset.k);
        openPlayer(p, { onAdj: (d, r, e) => cmd({ op: "adj", k: p.k, d, r, e }, `${p.n}: ${fmtD(d)}`) });
      });
    }
    render();
  }
})();
