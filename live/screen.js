(function () {
  "use strict";
  const { CFG, Net, U, SHAPES, SFX, confetti } = window.OPP;
  const { $, $$, esc } = U;
  const BLOCKS = window.BLOCKS, VIOL = window.VIOLATIONS;
  const byId = Object.fromEntries(BLOCKS.map((b) => [String(b.id), b]));
  const T_ST = CFG.topic("st"), T_UP = CFG.topic("up"), T_ADM = CFG.topic("adm");
  const T_PL = (pid) => CFG.topic("pl/" + pid);
  const isPult = new URLSearchParams(location.search).has("pult");
  const fmtD = (d) => (d < 0 ? "−" + Math.abs(d) : "+" + d);
  const pts = (n) => n + " " + U.plural(Math.abs(n), "очко", "очка", "очков");

  let password = null, hkey = null, net = null;

  // фон
  const fl = document.querySelector(".floaters");
  for (let i = 0; i < 8; i++) { const e = document.createElement("i"); e.innerHTML = SHAPES[i % 4].svg; e.style.left = (i * 12.5 + Math.random() * 6) + "%"; e.style.animationDelay = (-i * 3.5) + "s"; e.style.animationDuration = 24 + i * 3 + "s"; fl.appendChild(e); }

  function toast(t) { const d = document.createElement("div"); d.className = "toast"; d.textContent = t; $("#toasts").appendChild(d); setTimeout(() => d.remove(), 2600); }

  // ============================ ВХОД ============================
  if (isPult) $("#loginSub").textContent = "Пульт ведущего (телефон)";
  async function okPw(pw) { return (await U.sha256hex("opp-login|" + pw)) === CFG.loginHash; }
  (async () => {
    const saved = U.store.get("opp.adm2", null);
    if (saved && await okPw(saved)) { password = saved; start(); }
  })();
  $("#loginForm").addEventListener("submit", async (e) => {
    e.preventDefault(); SFX.unlock();
    if ($("#lg").value.trim().toLowerCase() !== "admin" || !(await okPw($("#pw").value))) {
      $("#lgErr").textContent = "Неверный логин или пароль";
      const f = $("#loginForm"); f.classList.remove("shake"); void f.offsetWidth; f.classList.add("shake"); return;
    }
    password = $("#pw").value; U.store.set("opp.adm2", password); start();
  });
  function logout() { U.store.del("opp.adm2"); location.href = location.pathname + (isPult ? "?pult=1" : ""); }

  async function start() {
    hkey = await U.hmacKey(password);
    $("#v-login").hidden = true;
    net = new Net(CFG.brokers);
    isPult ? startPult() : startHost();
  }

  // ============== окно ученика: штрафы и бонусы (общее для экрана и пульта) ==============
  function openPlayer(p, onAdj, extra = {}) {
    const m = $("#modal"), box = $("#modalBox");
    const vb = (v) => `<button class="vb ${v.delta > 0 ? "pos" : ""}" type="button" data-v="${v.id}"><span class="e">${v.emoji}</span>${esc(v.label)}<span class="d">${fmtD(v.delta)}</span></button>`;
    box.innerHTML = `
      <div class="mhead"><div class="avatar" style="--h:${U.hue(p.k)}">${esc(U.initials(p.n))}</div><div><b>${esc(p.n)}</b><small>${pts(p.s)}${p.r ? " · " + p.r + " место" : ""}</small></div><button class="x" type="button" id="mx" aria-label="Закрыть">✕</button></div>
      <span class="lbl">Нарушение</span><div class="vgrid">${VIOL.filter((v) => v.delta < 0).map(vb).join("")}</div>
      <span class="lbl">Бонус</span><div class="vgrid">${VIOL.filter((v) => v.delta > 0).map(vb).join("")}</div>
      <span class="lbl">Своё значение</span>
      <div class="custom"><input id="cD" type="number" step="50" min="0" value="100" aria-label="Очки"><input id="cR" type="text" maxlength="60" placeholder="Причина" aria-label="Причина"></div>
      <div class="mrow"><button class="btn btn--sm btn--red" type="button" id="cM">− Снять</button><button class="btn btn--sm btn--go" type="button" id="cP">+ Начислить</button></div>
      ${extra.history && extra.history.length ? `<span class="lbl">История</span><div class="hist">${extra.history.slice().reverse().map((e) => `<div><span>${e.e || ""} ${esc(e.r)}</span><b>${fmtD(e.d)}</b></div>`).join("")}</div>` : ""}
      ${extra.onDelete ? `<div class="mrow"><span></span><button class="btn btn--sm btn--glass" style="color:var(--ink);background:#F0EBFA" type="button" id="mDel">Убрать из игры</button></div>` : ""}`;
    m.hidden = false;
    const close = () => { m.hidden = true; };
    $("#mx").onclick = close; m.onclick = (e) => { if (e.target === m) close(); };
    box.querySelectorAll(".vb").forEach((b) => b.onclick = () => { const v = VIOL.find((x) => x.id === b.dataset.v); onAdj(v.delta, v.label, v.emoji); close(); });
    const custom = (sg) => { const d = Math.abs(parseInt($("#cD").value, 10) || 0); if (!d) return; onAdj(sg * d, $("#cR").value.trim() || (sg < 0 ? "Нарушение" : "Бонус"), sg < 0 ? "⚠️" : "⭐"); close(); };
    $("#cM").onclick = () => custom(-1); $("#cP").onclick = () => custom(1);
    if (extra.onDelete) $("#mDel").onclick = (ev) => { const b = ev.currentTarget; if (b.dataset.sure) { extra.onDelete(); close(); } else { b.dataset.sure = 1; b.textContent = "Точно? Нажмите ещё раз"; } };
  }

  // ============================ ВЕДУЩИЙ (большой экран) ============================
  function startHost() {
    const HOST_ID = "h" + U.mid(), started = Date.now();
    const LS = "opp.host2." + CFG.room;
    const fresh = () => ({ sid: "s" + U.mid(), players: {}, pidKey: {}, done: {}, g: { phase: "lobby", block: null, qi: 0, qStart: 0, limit: 25, prev: {}, prevOrder: [] } });
    let S = U.store.get(LS, null) || fresh();
    let saveT = 0; const save = () => { clearTimeout(saveT); saveT = setTimeout(() => U.store.set(LS, S), 200); };
    const usedN = new Map();
    SFX.muted = U.store.get("opp.muted", false);
    $("#bSound").textContent = SFX.muted ? "🔇" : "🔊";
    $("#v-host").hidden = false;

    net.onStatus((on, tot) => { $("#hNetDot").classList.toggle("on", on > 0); $("#hNet").textContent = on ? `связь ${on}/${tot}` : "нет связи"; if (on) broadcast(true); });
    net.sub(T_UP); net.sub(T_ADM); net.sub(T_ST);
    net.on((topic, m) => {
      if (topic === T_UP) onUp(m);
      else if (topic === T_ADM) onAdm(m);
      else if (topic === T_ST && m.host && m.host !== HOST_ID && m.ts > started + 3000) banner("Открыт второй экран ведущего! Закройте лишний, иначе очки разойдутся.");
    });

    // ---------- модель ----------
    const G = () => S.g;
    const curBlock = () => (G().block ? byId[G().block] : null);
    const curQ = () => { const b = curBlock(); return b ? b.q[G().qi] : null; };
    const curQid = () => U.qid(G().block, G().qi);
    function ranked() {
      const arr = Object.values(S.players).sort((a, b) => b.score - a.score || a.name.localeCompare(b.name, "ru"));
      let r = 0, prev = null; arr.forEach((p, i) => { if (p.score !== prev) { r = i + 1; prev = p.score; } p._r = r; });
      return arr;
    }
    function ensure(name, pid) {
      const key = U.normName(name); if (!key || key.length < 3) return null;
      let p = S.players[key];
      if (!p) {
        if (Object.keys(S.players).length >= 300) return null;
        p = S.players[key] = { key, name: U.cleanName(name).slice(0, 60), score: 0, ans: {}, ev: [], pids: [], streak: 0 };
        SFX.join(); newName = key;
      }
      if (pid && typeof pid === "string" && pid.length < 40) { if (!p.pids.includes(pid)) { p.pids.push(pid); if (p.pids.length > 4) p.pids.shift(); } S.pidKey[pid] = key; }
      return p;
    }
    let newName = null;

    function onUp(m) {
      if (!m || typeof m !== "object" || typeof m.name !== "string") return;
      const p = ensure(m.name, m.pid); if (!p) return;
      if (m.ty === "ans" && G().phase === "question" && m.q === curQid() && !p.ans[m.q]) {
        const q = curQ(), a = Number.isInteger(m.a) ? m.a : -1;
        const el = (Date.now() - G().qStart) / 1000;
        if (a >= 0 && a < q.o.length && el <= G().limit + 1.5) {
          const ok = a === q.c;
          const base = ok ? Math.round(CFG.maxPts * (1 - 0.5 * Math.min(1, el / G().limit))) : 0;
          p.ans[m.q] = { a, ok, base, t: Math.round(el * 10) / 10 };
          const n = answeredCount();
          if (n >= Object.keys(S.players).length) setTimeout(() => { if (G().phase === "question") reveal(); }, 700);
        }
      }
      save(); publishPlayer(p); broadcast(); render();
    }
    const answeredCount = () => Object.values(S.players).filter((p) => p.ans[curQid()]).length;

    function adjust(key, d, r, e) {
      const p = S.players[key]; if (!p || !d) return;
      d = Math.max(-5000, Math.min(5000, Math.round(d)));
      p.score += d;
      const ev = { id: "e" + U.mid(), d, r: String(r || "").slice(0, 60), e: e || "", t: Date.now() };
      p.ev.push(ev); p.ev = p.ev.slice(-30);
      save(); publishPlayer(p); broadcast(true); render(); eventPop(p, ev);
      if (!$("#ov").hidden && ovKind) openOverlay(ovKind);
    }
    function removePlayer(key) {
      const p = S.players[key]; if (!p) return;
      delete S.players[key]; for (const pid in S.pidKey) if (S.pidKey[pid] === key) delete S.pidKey[pid];
      save(); broadcast(true); render(); if (ovKind) openOverlay(ovKind); toast("Убран из игры: " + p.name);
    }

    // ---------- ход игры ----------
    let qTimer = 0;
    function nextUndone() { return BLOCKS.find((b) => !S.done[b.id]) || BLOCKS[0]; }
    function nextLabel() {
      const g = G(), b = curBlock();
      switch (g.phase) {
        case "lobby": return `Начать: слайд ${nextUndone().id} ▶`;
        case "intro": return "Первый вопрос ▶";
        case "question": return "Показать ответ ▶";
        case "reveal": return "Рейтинг ▶";
        case "board": return g.qi + 1 < b.q.length ? "Следующий вопрос ▶" : "Итоги практики ▶";
        case "podium": return "К выбору практики ▶";
      }
      return "Далее ▶";
    }
    function next() {
      const g = G();
      if (g.phase === "lobby") return openBlock(nextUndone().id);
      if (g.phase === "intro") return startQuestion(0);
      if (g.phase === "question") return reveal();
      if (g.phase === "reveal") return toBoard();
      if (g.phase === "board") return g.qi + 1 < curBlock().q.length ? startQuestion(g.qi + 1) : toPodium();
      if (g.phase === "podium") { S.done[g.block] = true; return toLobby(); }
    }
    function setPhase(ph) { G().phase = ph; save(); broadcast(true); render(true); music(); }
    function toLobby() { clearInterval(qTimer); G().block = null; setPhase("lobby"); }
    function openBlock(id) { if (!byId[id]) return; clearInterval(qTimer); Object.assign(G(), { block: +id, qi: 0 }); setPhase("intro"); }
    function startQuestion(i) {
      const g = G(), b = curBlock();
      g.qi = i; g.qStart = Date.now(); g.limit = CFG.limit(b.q[i]);
      g.prev = Object.fromEntries(Object.values(S.players).map((p) => [p.key, p.score]));
      g.prevOrder = ranked().map((p) => p.key);
      setPhase("question");
      runTimer();
    }
    function runTimer() {
      clearInterval(qTimer);
      let lastSec = -1;
      qTimer = setInterval(() => {
        const g = G(); if (g.phase !== "question") return clearInterval(qTimer);
        const left = g.limit - (Date.now() - g.qStart) / 1000;
        const sec = Math.max(0, Math.ceil(left));
        if (sec !== lastSec) { lastSec = sec; updTimer(sec); if (sec <= 5 && sec > 0) SFX.tick(sec <= 3); }
        if (left <= -0.3) reveal();
      }, 200);
    }
    function reveal() {
      const g = G(); if (g.phase !== "question") return;
      clearInterval(qTimer);
      const qid = curQid();
      Object.values(S.players).forEach((p) => {
        const a = p.ans[qid];
        if (a && a.ok) { p.streak = (p.streak || 0) + 1; a.pts = a.base + Math.min(500, CFG.streakBonus * (p.streak - 1)); p.score += a.pts; }
        else { p.streak = 0; if (a) a.pts = 0; }
      });
      SFX.music(null); SFX.gong();
      setPhase("reveal");
      Object.values(S.players).forEach(publishPlayer);
    }
    function toBoard() { setPhase("board"); }
    function toPodium() { setPhase("podium"); SFX.roll(); setTimeout(() => confetti(180), 1500); }
    function music() {
      const ph = G().phase;
      SFX.music(ph === "question" ? "question" : ph === "lobby" || ph === "intro" ? "lobby" : null);
    }

    // ---------- рассылка ----------
    function publishPlayer(p) {
      ranked();
      const qid = G().phase === "question" ? curQid() : null;
      const ans = {};
      for (const k in p.ans) { const a = p.ans[k]; ans[k] = k === qid ? { a: a.a } : { a: a.a, ok: a.ok, pts: a.pts || 0 }; }
      const pl = { ts: Date.now(), sid: S.sid, key: p.key, name: p.name, score: p.score, streak: p.streak || 0, ans, ev: p.ev.slice(-8) };
      p.pids.forEach((pid) => net.pub(T_PL(pid), pl, true));
    }
    let bT = 0, lastB = 0;
    function broadcast(now) {
      clearTimeout(bT);
      const go = () => {
        lastB = Date.now();
        const g = G(), arr = ranked();
        net.pub(T_ST, {
          mid: U.mid(), ts: Date.now(), host: HOST_ID, sid: S.sid,
          phase: g.phase, block: g.block, qi: g.qi, limit: g.limit,
          left: g.phase === "question" ? Math.max(0, g.limit * 1000 - (Date.now() - g.qStart)) : null,
          answered: g.phase === "question" ? answeredCount() : null, next: nextLabel(),
          board: arr.map((p) => ({ k: p.key, n: p.name, s: p.score, r: p._r }))
        }, true);
      };
      if (now) go(); else bT = setTimeout(go, Math.max(0, 500 - (Date.now() - lastB)));
    }
    setInterval(() => broadcast(true), 10000);

    async function onAdm(m) {
      if (!m || !m.cmd || !m.sig || !m.n || !m.ts) return;
      if (Math.abs(Date.now() - m.ts) > 5 * 60000 || usedN.has(m.n)) return;
      if ((await U.sign(hkey, m.ts + "|" + m.n + "|" + JSON.stringify(m.cmd))) !== m.sig) return;
      usedN.set(m.n, 1);
      const c = m.cmd;
      if (c.op === "adj") adjust(c.k, +c.d, c.r, c.e);
      else if (c.op === "next" && c.phase === G().phase) next();
      else if (c.op === "open") openBlock(c.id);
      else if (c.op === "lobby") toLobby();
    }

    // ---------- отрисовка ----------
    const stage = $("#stage");
    let shownKey = "";
    function render(force) {
      $("#hCount").textContent = Object.keys(S.players).length;
      const nb = $("#next"); nb.hidden = false; nb.innerHTML = esc(nextLabel()) + "<kbd>пробел</kbd>";
      nb.className = "btn nextbtn " + (G().phase === "question" ? "btn--glass" : "btn--go");
      const g = G(), key = g.phase + "/" + g.block + "/" + g.qi;
      if (force || key !== shownKey) { shownKey = key; full(); } else live();
    }
    function full() {
      const g = G(), b = curBlock();
      if (g.phase === "lobby") return drawLobby();
      if (g.phase === "intro") return drawIntro(b);
      if (g.phase === "question") return drawQuestion(b);
      if (g.phase === "reveal") return drawReveal(b);
      if (g.phase === "board") return drawBoard(b);
      if (g.phase === "podium") return drawPodium(b);
    }
    // частичные обновления без перерисовки всего экрана
    function live() {
      const g = G();
      if (g.phase === "lobby") updNames();
      if (g.phase === "question") { const a = $("#ansN"); if (a) a.textContent = answeredCount(); const t = $("#ansT"); if (t) t.textContent = "из " + Object.keys(S.players).length; }
      if (g.phase === "intro") { const c = $("#introN"); if (c) c.textContent = Object.keys(S.players).length; }
    }

    function joinQR() { return U.qrSvg(U.joinUrl()); }
    function drawLobby() {
      const nx = nextUndone();
      stage.innerHTML = `<div class="lobby">
        <div class="joincard card rise"><h2>Заходи в игру!</h2><div class="qr">${joinQR()}</div><div class="url">${esc(U.joinUrl().replace(/^https?:\/\//, ""))}</div>
          <div class="cnt"><span id="lobN">${Object.keys(S.players).length}</span><small>игроков в комнате</small></div><div class="names" id="names"></div></div>
        <div class="practices"><h2>Выберите практику</h2><div class="pgrid">
          ${BLOCKS.map((b, i) => `<button class="pt rise ${S.done[b.id] ? "done" : ""} ${b === nx ? "next" : ""}" style="animation-delay:${i * 30}ms" type="button" data-b="${b.id}"><span class="e">${b.emoji}</span><b>${esc(b.title)}</b><small>Слайд ${b.id} · ${b.q.length} ${U.plural(b.q.length, "вопрос", "вопроса", "вопросов")}${S.done[b.id] ? " · ✓ пройдено" : ""}</small></button>`).join("")}
        </div></div></div>`;
      stage.querySelectorAll("[data-b]").forEach((t) => t.onclick = () => openBlock(t.dataset.b));
      updNames(true);
    }
    function updNames(all) {
      const box = $("#names"); if (!box) return;
      const arr = Object.values(S.players);
      $("#lobN").textContent = arr.length;
      if (all || newName) {
        box.innerHTML = arr.slice(-40).reverse().map((p) => `<span>${esc(p.name)}</span>`).join("");
        newName = null;
      }
    }
    function drawIntro(b) {
      stage.innerHTML = `<div class="intro"><div class="e pop">${b.emoji}</div><div class="eb rise">Практика · слайд ${b.id} · ${esc(b.topic)}</div>
        <h1 class="rise" style="animation-delay:.1s">${esc(b.title)}</h1>
        <p class="rise" style="animation-delay:.2s">${b.q.length} ${U.plural(b.q.length, "вопрос", "вопроса", "вопросов")} · до 1000 очков за ответ · чем быстрее, тем больше</p>
        <p class="rise" style="animation-delay:.3s">👥 <b id="introN">${Object.keys(S.players).length}</b> в игре</p></div>
        <div class="cornerqr card"><div class="qr">${joinQR()}</div><div><b>Ещё не в игре?</b><span>Сканируй и входи</span></div></div>`;
    }
    function tilesHTML(q, rev) {
      return `<div class="htiles ${q.o.length === 2 ? "two" : ""}">${q.o.map((o, i) => `<div class="tile ${SHAPES[i].cls} pop ${rev && i !== q.c ? "dim" : ""}" style="animation-delay:${i * 70}ms"><span class="sh">${SHAPES[i].svg}</span><span class="tx">${esc(o)}</span>${rev && i === q.c ? '<span class="mark">✔</span>' : ""}</div>`).join("")}</div>`;
    }
    function drawQuestion(b) {
      const q = curQ(), g = G();
      const R = 46, C = 2 * Math.PI * R;
      stage.innerHTML = `<div class="qbar pop">${esc(q.t)}</div>
        <div class="qmid">
          <div class="timer" id="timer"><svg viewBox="0 0 100 100"><circle cx="50" cy="50" r="${R}" fill="none" stroke="rgba(255,255,255,.15)" stroke-width="7"/><circle class="fg" id="tArc" cx="50" cy="50" r="${R}" fill="none" stroke="#fff" stroke-width="7" stroke-linecap="round" stroke-dasharray="${C}" stroke-dashoffset="0"/></svg><span id="tNum">${g.limit}</span></div>
          <div class="qcenter"><div class="e">${b.emoji}</div><div class="n">Вопрос ${g.qi + 1} из ${b.q.length}${q.p === 15 ? " · задача на расчёт" : ""}</div></div>
          <div class="answered"><b id="ansN">${answeredCount()}</b><span id="ansT">из ${Object.keys(S.players).length}</span><br><span>ответили</span></div>
        </div>${tilesHTML(q, false)}`;
      stage.dataset.c = C;
      updTimer(Math.max(0, Math.ceil(g.limit - (Date.now() - g.qStart) / 1000)));
    }
    function updTimer(sec) {
      const n = $("#tNum"), arc = $("#tArc"); if (!n) return;
      n.textContent = sec;
      const C = +stage.dataset.c; arc.style.transition = "stroke-dashoffset .9s linear";
      arc.style.strokeDashoffset = C * (1 - sec / G().limit);
      $("#timer").classList.toggle("hurry", sec <= 5);
    }
    function drawReveal(b) {
      const q = curQ(), qid = curQid();
      const counts = q.o.map(() => 0); Object.values(S.players).forEach((p) => { const a = p.ans[qid]; if (a) counts[a.a]++; });
      const max = Math.max(1, ...counts);
      const okN = counts[q.c], tot = Object.keys(S.players).length;
      stage.innerHTML = `<div class="qbar">${esc(q.t)}</div>
        <div class="qmid" style="grid-template-columns:minmax(0,1fr) minmax(0,1.2fr)">
          <div class="chart">${q.o.map((_, i) => `<div class="col ${SHAPES[i].cls} ${i !== q.c ? "dim" : ""}"><div class="lab"><span class="sh">${SHAPES[i].svg}</span>${counts[i]}${i === q.c ? " ✔" : ""}</div><div class="bar" style="height:0" data-h="${Math.round(100 * counts[i] / max)}"></div></div>`).join("")}</div>
          <div class="explain rise"><b>${okN} из ${tot} ответили верно.</b><br>${esc(q.x || "")}</div>
        </div>${tilesHTML(q, true)}`;
      requestAnimationFrame(() => requestAnimationFrame(() => stage.querySelectorAll(".chart .bar").forEach((el) => el.style.height = Math.max(.3, +el.dataset.h / 100 * 10.5) + "em")));
    }
    function drawBoard(b) {
      const g = G(), arr = ranked(), top = arr.slice(0, 5), qid = curQid();
      stage.innerHTML = `<div class="board"><h1 class="pop">Рейтинг</h1><div class="brows" id="brows">
        ${top.map((p, i) => { const a = p.ans[qid]; const gain = a && a.pts ? a.pts : 0;
          return `<div class="brow ${i === 0 ? "lead" : ""}" data-k="${esc(p.key)}"><span class="r">${p._r}</span><div class="avatar" style="--h:${U.hue(p.key)}">${esc(U.initials(p.name))}</div><span class="nm">${esc(p.name)}</span>${p.streak > 1 ? `<span class="st">🔥${p.streak}</span>` : ""}${gain ? `<span class="gain">+${gain}</span>` : ""}<span class="s" data-from="${g.prev[p.key] ?? p.score}" data-to="${p.score}">${g.prev[p.key] ?? p.score}</span></div>`; }).join("")}
        </div>${arr.length > 5 ? `<div class="bmore">и ещё ${arr.length - 5} ${U.plural(arr.length - 5, "игрок", "игрока", "игроков")} — нажмите «🏆 Рейтинг», чтобы увидеть всех</div>` : arr.length ? "" : `<div class="bmore">Пока никто не играет</div>`}</div>`;
      // анимация: строки едут с прежних мест, очки дорастают
      const rows = $$("#brows .brow"), h = rows[0] ? rows[0].getBoundingClientRect().height + 8 : 0;
      rows.forEach((el, i) => {
        const was = g.prevOrder.indexOf(el.dataset.k);
        const from = was < 0 ? 5 : Math.min(was, 6);
        el.animate([{ transform: `translateY(${(from - i) * h}px)`, opacity: was < 0 || was > 5 ? 0 : 1 }, { transform: "none", opacity: 1 }], { duration: 900, delay: 300, easing: "cubic-bezier(.2,1.1,.4,1)", fill: "backwards" });
        const s = el.querySelector(".s"), f = +s.dataset.from, t = +s.dataset.to, t0 = performance.now() + 250;
        const step = (now) => { const k = Math.max(0, Math.min(1, (now - t0) / 900)); s.textContent = Math.round(f + (t - f) * (1 - Math.pow(1 - k, 3))); if (k < 1) requestAnimationFrame(step); };
        requestAnimationFrame(step);
      });
    }
    function drawPodium(b) {
      const arr = ranked(), top = [arr[1], arr[0], arr[2]], cls = ["p2", "p1", "p3"], num = [2, 1, 3], delay = [0.9, 1.6, 0.3];
      stage.innerHTML = `<div class="intro" style="flex:none;padding-top:.4em"><div class="eb">Итоги · ${esc(b.title)}</div></div>
        <div class="podium">${top.map((p, i) => `<div class="pcol ${cls[i]}">${p ? `<div class="avatar" style="--h:${U.hue(p.key)};width:3.4em;height:3.4em;font-size:1.2em;animation:pop .5s ${delay[i] + .6}s both">${esc(U.initials(p.name))}</div><div class="who" style="animation-delay:${delay[i] + .7}s">${esc(p.name)}</div><div class="pts" style="animation-delay:${delay[i] + .8}s">${pts(p.score)}</div>` : ""}<div class="blk" style="animation-delay:${delay[i]}s">${num[i]}</div></div>`).join("")}</div>`;
    }

    // ---------- событие (штраф/бонус) на весь экран ----------
    const popQ = []; let popping = false;
    function eventPop(p, ev) { popQ.push({ p, ev }); if (!popping) nextPop(); }
    function nextPop() {
      const it = popQ.shift(); if (!it) { popping = false; return; } popping = true;
      const { p, ev } = it, neg = ev.d < 0;
      const el = document.createElement("div"); el.className = "epop " + (neg ? "neg" : "pos");
      el.innerHTML = `<div class="box card"><div class="em">${ev.e || (neg ? "⚠️" : "🌟")}</div><div class="nm">${esc(p.name)}</div><div class="rs">${esc(ev.r)}</div><div class="dl">${fmtD(ev.d)}</div></div>`;
      document.body.appendChild(el);
      neg ? SFX.penalty() : (SFX.bonus(), confetti(120));
      setTimeout(() => { el.classList.add("out"); setTimeout(() => { el.remove(); nextPop(); }, 400); }, 2800);
    }
    function banner(t) { if ($(".banner")) return; const b = document.createElement("div"); b.className = "banner"; b.textContent = t; document.body.appendChild(b); setTimeout(() => b.remove(), 12000); }

    // ---------- оверлеи: рейтинг, штрафы, пульт ----------
    let ovKind = null;
    function openOverlay(kind) {
      ovKind = kind;
      const ov = $("#ov"); ov.hidden = false;
      if (kind === "pult") {
        const url = CFG.joinUrl + "screen.html?pult=1";
        ov.innerHTML = `<div class="ovhead"><h2>📱 Пульт на телефоне</h2><button class="btn" type="button" data-close>Закрыть</button></div>
          <div class="ovbody" style="display:grid;place-items:center;text-align:center;gap:1em"><div class="card" style="padding:1em;width:min(80vw,22em)">${U.qrSvg(url)}</div>
          <p style="max-width:40ch;font-weight:700;color:var(--dim);margin:0">Отсканируйте своим телефоном и войдите тем же логином и паролем. С пульта можно листать вопросы («Далее»), открывать практики и ставить штрафы и бонусы, не подходя к компьютеру.</p></div>`;
      } else {
        const rating = kind === "rating";
        ov.innerHTML = `<div class="ovhead"><h2>${rating ? "🏆 Общий рейтинг" : "⚠️ Кому штраф или бонус?"}</h2><input type="search" id="ovQ" placeholder="Поиск по фамилии" aria-label="Поиск по фамилии"><button class="btn" type="button" data-close>Закрыть</button></div><div class="ovbody"><div class="plgrid" id="ovList"></div></div>`;
        const list = () => {
          const q = U.normName($("#ovQ").value);
          let arr = ranked(); if (!rating) arr = arr.slice().sort((a, b) => a.name.localeCompare(b.name, "ru"));
          arr = arr.filter((p) => !q || p.key.includes(q));
          $("#ovList").innerHTML = arr.length ? arr.map((p) => `<button class="plb" type="button" data-k="${esc(p.key)}"><span class="r">${p._r}</span><div class="avatar" style="--h:${U.hue(p.key)}">${esc(U.initials(p.name))}</div><span class="nm">${esc(p.name)}</span><span class="s">${p.score}</span></button>`).join("")
            : `<div class="empty">${Object.keys(S.players).length ? "Никого не нашли" : "Пока никто не зашёл в игру"}</div>`;
          $$("#ovList .plb").forEach((b) => b.onclick = () => { const p = S.players[b.dataset.k]; openPlayer({ k: p.key, n: p.name, s: p.score, r: p._r }, (d, r, e) => adjust(p.key, d, r, e), { history: p.ev, onDelete: () => removePlayer(p.key) }); });
        };
        $("#ovQ").oninput = list; list();
        if (!rating) setTimeout(() => $("#ovQ").focus(), 50);
      }
      ov.querySelector("[data-close]").onclick = closeOverlay;
    }
    function closeOverlay() { $("#ov").hidden = true; ovKind = null; if (document.activeElement) document.activeElement.blur(); }

    // ---------- кнопки и клавиши ----------
    $("#next").onclick = () => { SFX.unlock(); next(); };
    $("#bRating").onclick = () => openOverlay("rating");
    $("#bPen").onclick = () => openOverlay("pen");
    $("#bPult").onclick = () => openOverlay("pult");
    $("#bSound").onclick = () => { SFX.unlock(); SFX.muted = !SFX.muted; U.store.set("opp.muted", SFX.muted); $("#bSound").textContent = SFX.muted ? "🔇" : "🔊"; music(); };
    $("#bMenu").onclick = (e) => { e.stopPropagation(); $("#menu").hidden = !$("#menu").hidden; };
    document.addEventListener("click", () => { $("#menu").hidden = true; });
    $("#mLobby").onclick = toLobby;
    $("#mOut").onclick = logout;
    $("#mCsv").onclick = () => {
      const rows = [["Место", "Фамилия Имя", "Очки", "Верных ответов", "Всего ответов", "Штрафы", "Бонусы"]];
      ranked().forEach((p) => { const a = Object.values(p.ans); rows.push([p._r, p.name, p.score, a.filter((x) => x.ok).length, a.length, p.ev.filter((e) => e.d < 0).reduce((s, e) => s + e.d, 0), p.ev.filter((e) => e.d > 0).reduce((s, e) => s + e.d, 0)]); });
      const csv = "﻿" + rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(";")).join("\r\n");
      const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
      a.download = "Битва_коммерсантов_" + new Date().toLocaleDateString("ru-RU").replace(/\./g, "-") + ".csv";
      document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
    };
    $("#mReset").onclick = () => {
      const m = $("#modal"), box = $("#modalBox");
      box.innerHTML = `<div class="mhead"><div style="font-size:2.6rem">♻️</div><div><b>Начать новый урок?</b><small>Все очки и ответы обнулятся. Таблицу результатов лучше скачать заранее.</small></div></div>
        <div class="mrow"><button class="btn btn--sm" style="background:#F0EBFA" type="button" id="rNo">Отмена</button><button class="btn btn--sm btn--red" type="button" id="rYes">Да, обнулить</button></div>`;
      m.hidden = false;
      $("#rNo").onclick = () => m.hidden = true;
      $("#rYes").onclick = () => {
        const old = Object.values(S.players).flatMap((p) => p.pids);
        S = fresh(); save(); m.hidden = true; clearInterval(qTimer);
        old.forEach((pid) => net.pub(T_PL(pid), { ts: Date.now(), sid: S.sid, key: "", name: "", score: 0, ans: {}, ev: [], streak: 0 }, true));
        broadcast(true); render(true); music(); toast("Новый урок начат");
      };
    };
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") { if (!$("#modal").hidden) $("#modal").hidden = true; else closeOverlay(); return; }
      if (e.target.matches("input,textarea,select")) return;
      if (!$("#modal").hidden || !$("#ov").hidden) return;
      if (e.key === " " || e.key === "Enter" || e.key === "ArrowRight" || e.key === "PageDown") { e.preventDefault(); SFX.unlock(); next(); }
      if (e.key === "r" || e.key === "к") openOverlay("rating");
    });
    window.addEventListener("resize", () => render(true));

    // восстановление после перезагрузки
    if (G().phase === "question") { if (Date.now() - G().qStart > G().limit * 1000) reveal(); else runTimer(); }
    render(true); broadcast(true);
    document.addEventListener("pointerdown", () => { SFX.unlock(); music(); }, { once: true });
  }

  // ============================ ПУЛЬТ (телефон) ============================
  function startPult() {
    $("#v-pult").hidden = false;
    document.body.style.overflow = "auto";
    let st = null;
    net.sub(T_ST);
    const alive = () => st && Date.now() - st.ts < 40000;
    const upd = () => { const on = net.online; $("#pNetDot").classList.toggle("on", on > 0 && alive()); $("#pNet").textContent = !on ? "нет связи" : alive() ? "экран на связи" : "экран не отвечает"; };
    net.onStatus(upd); setInterval(upd, 3000);
    net.on((t, m) => { if (t === T_ST) { if (st && m.ts < st.ts) return; st = m; upd(); render(); } });
    $("#pSearch").oninput = renderList; $("#pOut").onclick = logout;

    async function cmd(c, okText) {
      const ts = Date.now(), n = U.mid();
      const sig = await U.sign(hkey, ts + "|" + n + "|" + JSON.stringify(c));
      const sent = net.pub(T_ADM, { mid: U.mid(), ts, n, cmd: c, sig });
      if (navigator.vibrate) try { navigator.vibrate(30); } catch (_) {}
      toast(!sent ? "Нет связи — команда не ушла" : alive() ? okText : okText + " (экран пока не отвечает)");
    }
    const PH = { lobby: "Выбор практики", intro: "Заставка практики", question: "Идёт вопрос", reveal: "Правильный ответ", board: "Рейтинг", podium: "Итоги практики" };
    let lastKey = "";
    function render() {
      if (!st) { $("#pNow").innerHTML = `<div class="ph">Ждём большой экран…</div><p style="margin:0;font-weight:700;color:var(--ink-2)">Откройте экран ведущего на компьютере у проектора.</p>`; return; }
      const b = st.block ? byId[st.block] : null, q = b && st.phase !== "intro" && st.phase !== "podium" ? b.q[st.qi] : null;
      const key = [st.phase, st.block, st.qi, st.answered, st.next].join("|");
      if (key !== lastKey) {
        lastKey = key;
        $("#pNow").innerHTML = `<div class="ph">${PH[st.phase] || ""}${b ? ` · слайд ${b.id}${q ? ` · вопрос ${st.qi + 1}/${b.q.length}` : ""}` : ""}</div>
          ${q ? `<div class="qt">${esc(q.t)}</div><div style="font-weight:800;color:var(--good)">Ответ: ${esc(q.o[q.c])}</div>` : b ? `<div class="qt">${b.emoji} ${esc(b.title)}</div>` : ""}
          ${st.phase === "question" ? `<div style="font-weight:800;color:var(--ink-2)">Ответили: ${st.answered} из ${st.board.length}</div>` : ""}
          <button class="btn btn--go big" type="button" id="pNext">${esc(st.next || "Далее ▶")}</button>
          ${st.phase !== "lobby" ? `<button class="btn btn--sm" style="background:#F0EBFA" type="button" id="pLobby">🏠 К выбору практики</button>` : ""}`;
        $("#pNext").onclick = () => cmd({ op: "next", phase: st.phase }, "Готово");
        const pl = $("#pLobby"); if (pl) pl.onclick = () => cmd({ op: "lobby" }, "Открыт выбор практики");
        $("#pBlocks").innerHTML = st.phase === "lobby" ? `<div class="pblocks">${BLOCKS.map((b) => `<button class="pt" type="button" data-b="${b.id}"><span class="e">${b.emoji}</span><b>${esc(b.title)}</b><small>Слайд ${b.id}</small></button>`).join("")}</div>` : "";
        $$("#pBlocks [data-b]").forEach((t) => t.onclick = () => cmd({ op: "open", id: +t.dataset.b }, "Практика открыта"));
      }
      renderList();
    }
    function renderList() {
      if (!st) return;
      const q = U.normName($("#pSearch").value);
      const arr = (st.board || []).filter((p) => !q || p.k.includes(q));
      $("#plist").innerHTML = arr.length ? arr.map((p) => `<button class="plb" type="button" data-k="${esc(p.k)}"><span class="r">${p.r}</span><div class="avatar" style="--h:${U.hue(p.k)}">${esc(U.initials(p.n))}</div><span class="nm">${esc(p.n)}</span><span class="s">${p.s}</span></button>`).join("")
        : `<div class="empty">${st.board && st.board.length ? "Никого не нашли" : "Пока никто не зашёл в игру"}</div>`;
      $$("#plist .plb").forEach((el) => el.onclick = () => { const p = st.board.find((x) => x.k === el.dataset.k); openPlayer(p, (d, r, e) => cmd({ op: "adj", k: p.k, d, r, e }, `${p.n}: ${fmtD(d)}`)); });
    }
    render();
  }
})();
