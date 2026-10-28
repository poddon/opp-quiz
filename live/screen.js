(function () {
  "use strict";
  const { CFG, Net, U, SFX, confetti } = window.OPP;
  const { $, $$, esc } = U;
  const BLOCKS = window.BLOCKS, VIOL = window.VIOLATIONS;
  const byId = Object.fromEntries(BLOCKS.map((b) => [String(b.id), b]));
  const T_ST = CFG.topic("st"), T_UP = CFG.topic("up"), T_ADM = CFG.topic("adm"), T_BD = CFG.topic("bd");
  const T_PL = (pid) => CFG.topic("pl/" + pid);
  const isPult = new URLSearchParams(location.search).has("pult");
  const fmtD = (d) => (d < 0 ? "−" + Math.abs(d) : "+" + d);
  const pts = (n) => n + " " + U.plural(Math.abs(n), "очко", "очка", "очков");

  let hkey = null, net = null;

  function toast(t) { const d = document.createElement("div"); d.className = "toast"; d.textContent = t; $("#toasts").appendChild(d); setTimeout(() => d.remove(), 2600); }

  // Вход ведущего и пульта без логина и пароля.
  // Общий ключ нужен только для совместимости команд пульта с большим экраном:
  // доступ к управлению теперь публичный и не защищён авторизацией.
  function logout() { location.href = CFG.studentUrl(); }
  function bindNetworkSelect() {
    const select = $("#hostNetwork");
    if (!select) return;
    if (CFG.localMode) { select.hidden = true; return; }
    select.value = CFG.netId;
    select.addEventListener("change", () => {
      if (select.value === CFG.netId) return;
      if (!confirm("При смене сервера связи студенты должны заново открыть QR-код. Переключить сервер?")) {
        select.value = CFG.netId;
        return;
      }
      const url = new URL(CFG.screenUrl(CFG.roomId, false));
      url.searchParams.set("net", select.value);
      location.href = url.href;
    });
  }
  function bindRoomSelect(selector, usePult) {
    const el = $(selector);
    if (!el) return;
    el.value = CFG.roomId;
    el.addEventListener("change", () => {
      if (el.value === CFG.roomId) return;
      location.href = CFG.screenUrl(el.value, usePult);
    });
  }

  async function start() {
    hkey = await U.hmacKey("opp-public-host-v1");
    $("#v-login").hidden = true;
    // Большой экран слушает все серверы сразу, пульт — один с автопереключением.
    net = new Net(CFG.brokers, isPult ? "failover" : "all");
    isPult ? startPult() : startHost();
  }

  document.addEventListener("pointerdown", () => SFX.unlock(), { once: true });
  start().catch((err) => {
    console.error("Ошибка запуска экрана ведущего:", err);
    const el = $("#loadingStatus");
    if (el) el.textContent = "Не удалось открыть экран. Обновите страницу.";
  });

  // ============== окно ученика: штрафы и бонусы (общее для экрана и пульта) ==============
  function openPlayer(p, onAdj, extra = {}) {
    const m = $("#modal"), box = $("#modalBox");
    const vb = (v) => `<button class="vb ${v.delta > 0 ? "pos" : ""}" type="button" data-v="${v.id}"><span class="e">${v.emoji}</span>${esc(v.label)}<span class="d">${fmtD(v.delta)}</span></button>`;
    box.innerHTML = `
      <div class="mhead">${U.av(p.k, p.n)}<div><b>${esc(p.n)}</b><small>${pts(p.s)}${p.r ? " · " + p.r + " место" : ""}</small></div><button class="x" type="button" id="mx" aria-label="Закрыть">✕</button></div>
      <span class="lbl">Нарушение</span><div class="vgrid">${VIOL.filter((v) => v.delta < 0).map(vb).join("")}</div>
      <span class="lbl">Бонус</span><div class="vgrid">${VIOL.filter((v) => v.delta > 0).map(vb).join("")}</div>
      <span class="lbl">Своё значение</span>
      <div class="custom"><input id="cD" type="number" step="50" min="0" value="100" aria-label="Очки"><input id="cR" type="text" maxlength="60" placeholder="Причина" aria-label="Причина"></div>
      <div class="mrow"><button class="btn btn--sm btn--navy" type="button" id="cM">− Снять</button><button class="btn btn--sm btn--blue" type="button" id="cP">+ Начислить</button></div>
      ${extra.history && extra.history.length ? `<span class="lbl">История</span><div class="hist">${extra.history.slice().reverse().map((e) => `<div><span>${e.e || ""} ${esc(e.r)}</span><b>${fmtD(e.d)}</b></div>`).join("")}</div>` : ""}
      ${extra.onDelete ? `<div class="mrow"><span></span><button class="btn btn--sm" type="button" id="mDel">Убрать из игры</button></div>` : ""}`;
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
    bindRoomSelect("#hostRoom", false);
    bindNetworkSelect();
    const HOST_ID = "h" + U.mid(), started = Date.now();
    const LS = "opp.host2." + CFG.room;
    const fresh = () => ({ sid: "s" + U.mid(), players: {}, pidKey: {}, done: {}, g: { phase: "lobby", block: null, qi: 0, qStart: 0, limit: 25, prev: {}, prevOrder: [] } });
    let S = U.store.get(LS, null) || fresh();
    // Сохраняем очки, завершённые темы и текущий экран после перенумерации слайдов.
    if (!S.slideNumbers51) {
      const slideMap = { 9: 5, 13: 14, 15: 16, 19: 21, 22: 24, 24: 25, 27: 28, 34: 41, 44: 45, 46: 47, 49: 50 };
      const mapSlide = (id) => Object.hasOwn(slideMap, id) ? slideMap[id] : id;
      if (S.g && S.g.block != null) S.g.block = mapSlide(S.g.block);
      S.done = Object.fromEntries(Object.entries(S.done || {}).map(([id, val]) => [mapSlide(id), val]));
      for (const p of Object.values(S.players || {})) {
        p.ans = Object.fromEntries(Object.entries(p.ans || {}).map(([qid, val]) => {
          const parts = qid.split(".");
          return [parts.length === 2 ? mapSlide(parts[0]) + "." + parts[1] : qid, val];
        }));
      }
      S.slideNumbers51 = true;
      U.store.set(LS, S);
    }
    let saveT = 0; const save = () => { clearTimeout(saveT); saveT = setTimeout(() => U.store.set(LS, S), 200); };
    const usedN = new Map();
    SFX.muted = U.store.get("opp.muted", false);
    $("#bSound").textContent = SFX.muted ? "🔇" : "🔊";
    $("#v-host").hidden = false;

    net.onStatus((on, tot) => { $("#hNetDot").classList.toggle("on", on > 0); $("#hNet").textContent = !on ? "нет связи" : CFG.localMode ? "Локальная сеть · подключено" : `серверов на связи: ${on} из ${tot}`; if (on) broadcast(true); });
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
      const key = U.normName(m.name);
      const before = S.players[key];
      const hadPid = !!(before && (!m.pid || before.pids.includes(m.pid)));
      const p = ensure(m.name, m.pid);
      if (!p) return;
      let changed = !before || (!!m.pid && !hadPid);

      // Повторные сигналы присутствия не должны перерисовывать весь экран.
      if (m.ty === "join") {
        publishPlayer(p);
        if (changed) { save(); broadcast(); render(); }
        return;
      }

      if (m.ty === "ans") {
        // Подтверждаем уже принятый ответ, чтобы телефон прекратил повторную отправку.
        if (p.ans[m.q]) { publishPlayer(p); return; }
        if (G().phase === "question" && m.q === curQid()) {
          const q = curQ(), answer = Number.isInteger(m.a) ? m.a : -1;
          const elapsed = (Date.now() - G().qStart) / 1000;
          if (q && answer >= 0 && answer < q.o.length) {
            const ok = answer === q.c;
            const base = ok ? Math.max(CFG.maxPts / 2, Math.round(CFG.maxPts - 10 * elapsed)) : 0;
            p.ans[m.q] = { a: answer, ok, base, t: Math.round(elapsed * 10) / 10 };
            changed = true;
            if (answeredCount() >= Object.keys(S.players).length) {
              say("Все ответили! Жмите «Показать ответ».");
              SFX.join();
            }
          }
        }
      }
      if (!changed) return;
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
      const first = p.name.split(" ")[1] || p.name;
      say(pick(d < 0 ? (/сон/i.test(ev.r) ? Q.sleep : Q.neg) : Q.pos).replace("{n}", first));
      if (!$("#ov").hidden && ovKind) openOverlay(ovKind);
    }
    function removePlayer(key) {
      const p = S.players[key]; if (!p) return;
      delete S.players[key]; for (const pid in S.pidKey) if (S.pidKey[pid] === key) delete S.pidKey[pid];
      save(); broadcast(true); render(); if (ovKind) openOverlay(ovKind); toast("Убран из игры: " + p.name);
    }

    // ---------- ведущий шутит ----------
    const Q = {
      lobby: ["Заходим, не стесняемся! Телефон — ваш пульт.", "Кто последний зайдёт — тот сегодня считает НДС вручную.", "Пока все подтягиваются: калькулятор уже открыли?"],
      join: ["{n} в игре! Добро пожаловать в бизнес.", "О, {n}! Свежий коммерсант на рынке.", "{n} заходит в комнату. Поставщики нервничают.", "{n} с нами. Делаем ставки!"],
      intro: ["Включаем мозг коммерсанта.", "НДС сам себя не вычтет. Поехали!", "Помните: дешевле — не значит выгоднее."],
      question: ["Тик-так… Время — деньги.", "Думайте как коммерсант, а не как покупатель.", "Списывать у соседа — минус 500. Я всё вижу.", "Кто ответит первым, тот и молодец."],
      revealHi: ["Вот это коммерсанты! Почти все правы.", "Красота! Директор доволен.", "Так держать — премия близко."],
      revealMid: ["Половина группы в прибыли, половина — в техотходе.", "Неплохо, но склад ещё не полон.", "Кто-то явно пролистал этот слайд."],
      revealLo: ["Ой. Кажется, кто-то купил дешёвую доску.", "Тут без претензии к поставщику не обойтись.", "Ничего, на ошибках учатся. Даже в Алабуге."],
      board: ["{n} рвётся в лидеры!", "{n} на первом месте. Остальные, догоняйте!", "Таблица лидеров горячее сушильной камеры."],
      podium: ["Аплодисменты лучшим коммерсантам!", "Вот они — будущие технологические предприниматели!"],
      sleep: ["{n}, проснись! Поддоны сами себя не посчитают.", "Тсс… {n} уехал в сушильную камеру."],
      neg: ["{n} теряет очки. Экономика суровая.", "Штраф по пункту 5.3 договора, {n}."],
      pos: ["{n} получает премию!", "Браво, {n}! Это в рейтинг."]
    };
    const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
    let sayT = 0;
    function say(text) {
      const el = $("#hostSay");
      el.innerHTML = `<div class="mic">🎤</div><div class="say">${esc(text)}</div>`;
      clearTimeout(sayT); sayT = setTimeout(() => { el.innerHTML = ""; }, 9000);
    }
    function phaseSay() {
      const g = G(), arr = ranked();
      if (g.phase === "lobby") say(pick(Q.lobby));
      else if (g.phase === "intro") say(pick(Q.intro));
      else if (g.phase === "question") say(pick(Q.question));
      else if (g.phase === "board" && arr[0]) say(pick(Q.board).replace("{n}", arr[0].name));
      else if (g.phase === "podium") say(pick(Q.podium));
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
    function setPhase(ph) { G().phase = ph; save(); broadcast(true); render(true); music(); phaseSay(); }
    function toLobby() {  G().block = null; setPhase("lobby"); }
    function openBlock(id) { if (!byId[id]) return;  Object.assign(G(), { block: +id, qi: 0 }); setPhase("intro"); }
    function startQuestion(i) {
      const g = G(), b = curBlock();
      g.qi = i; g.qStart = Date.now();
      g.prev = Object.fromEntries(Object.values(S.players).map((p) => [p.key, p.score]));
      g.prevOrder = ranked().map((p) => p.key);
      setPhase("question");
    }
    function reveal() {
      const g = G(); if (g.phase !== "question") return;
      
      const qid = curQid();
      Object.values(S.players).forEach((p) => {
        const a = p.ans[qid];
        if (a && a.ok) { p.streak = (p.streak || 0) + 1; a.pts = a.base + Math.min(500, CFG.streakBonus * (p.streak - 1)); p.score += a.pts; }
        else { p.streak = 0; if (a) a.pts = 0; }
      });
      SFX.music(null); SFX.sting("reveal");
      setPhase("reveal");
      Object.values(S.players).forEach(publishPlayer);
    }
    function toBoard() { setPhase("board"); }
    function toPodium() { setPhase("podium"); SFX.sting("fanfare"); setTimeout(() => { if (G().phase === "podium") SFX.music("lobby"); }, 4500); setTimeout(() => confetti(180), 1500); }
    function music() {
      const ph = G().phase;
      if (ph === "podium") { SFX.music(null); return; }
      SFX.music(ph === "question" ? "think" : ph === "reveal" ? null : "lobby");
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
    // Состояние игры уходит на каждый телефон, поэтому держим его маленьким:
    // полный рейтинг нужен студентам только на экранах результата.
    // Пульт получает список игроков отдельным сообщением (T_BD).
    let bT = 0, lastB = 0, bdT = 0, lastBd = 0;
    const RANK_PHASES = { reveal: 1, board: 1, podium: 1 };
    function boardList() { return ranked().map((p) => ({ k: p.key, n: p.name, s: p.score, r: p._r })); }
    function broadcast(now) {
      clearTimeout(bT);
      const go = () => {
        lastB = Date.now();
        const g = G(), arr = ranked();
        const msg = {
          mid: U.mid(), ts: Date.now(), host: HOST_ID, sid: S.sid,
          phase: g.phase, block: g.block, qi: g.qi, n: arr.length,
          answered: g.phase === "question" ? answeredCount() : null, next: nextLabel()
        };
        if (RANK_PHASES[g.phase]) msg.board = boardList();
        net.pub(T_ST, msg, true);
        pubBoard(now);
      };
      if (now) go(); else bT = setTimeout(go, Math.max(0, 1000 - (Date.now() - lastB)));
    }
    function pubBoard(now) {
      clearTimeout(bdT);
      const go = () => { lastBd = Date.now(); net.pub(T_BD, { ts: Date.now(), sid: S.sid, board: boardList() }, true); };
      if (now) go(); else bdT = setTimeout(go, Math.max(0, 1500 - (Date.now() - lastBd)));
    }
    setInterval(() => broadcast(true), 10000);

    async function onAdm(m) {
      if (!m || !m.cmd || !m.sig || !m.n || !m.ts) return;
      if (usedN.has(m.n)) return;   // часы телефона и компьютера могут расходиться — время не сверяем
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
      nb.className = "btn nextbtn " + (G().phase === "question" ? "" : "btn--navy");
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
        <div class="joincol"><div class="logo slam">Битва<span>коммерсантов</span></div>
          <div class="joincard sticker tilt-l rise"><span class="ribbon">Наведи камеру</span><div class="qr">${joinQR()}</div></div></div>
        <div class="rightcol">
          <div class="phead"><span class="ribbon w">Игроки: <span id="lobN">0</span></span></div>
          <div class="slots" id="slots"></div>
          <div class="phead"><h2>Выберите практику</h2></div>
          <div class="pgrid">${BLOCKS.map((b, i) => `<button class="pt rise ${S.done[b.id] ? "done" : ""} ${b === nx ? "next" : ""}" style="animation-delay:${i * 30}ms" type="button" data-b="${b.id}"><span class="e">${b.emoji}</span><b>${esc(b.title)}</b><small>Слайд ${b.id} · ${b.q.length} вопр.${S.done[b.id] ? " · ✓" : ""}</small></button>`).join("")}</div>
        </div></div>`;
      stage.querySelectorAll("[data-b]").forEach((t) => t.onclick = () => openBlock(t.dataset.b));
      updNames(true);
    }
    function updNames(all) {
      const box = $("#slots"); if (!box) return;
      const arr = Object.values(S.players);
      $("#lobN").textContent = arr.length;
      if (!all && !newName) return;
      const show = arr.slice(-11).reverse();
      const empty = Math.max(0, Math.min(12, 6 - show.length));
      box.innerHTML = show.map((p) => `<div class="slot on">${U.av(p.key, p.name)}<span class="nm">${esc(p.name)}</span></div>`).join("")
        + (arr.length > 11 ? `<div class="slot on" style="justify-content:center"><span class="more">+${arr.length - 11}</span></div>` : "")
        + Array.from({ length: empty }, () => `<div class="slot">ждём игрока…</div>`).join("");
      if (newName && S.players[newName]) say(pick(Q.join).replace("{n}", S.players[newName].name.split(" ")[1] || S.players[newName].name));
      newName = null;
    }
    function drawIntro(b) {
      stage.innerHTML = `<div class="intro"><div class="sunburst"></div><div class="e wobble">${b.emoji}</div>
        <span class="ribbon w rise">Практика · слайд ${b.id} · ${esc(b.topic)}</span>
        <h1 class="slam" style="animation-delay:.1s">${esc(b.title)}</h1>
        <div class="facts sticker tilt-r rise" style="animation-delay:.3s">${b.q.length} ${U.plural(b.q.length, "вопрос", "вопроса", "вопросов")} · до 1000 очков · кто быстрее, тот богаче · 👥 <b id="introN">${Object.keys(S.players).length}</b></div></div>
        <div class="cornerqr sticker tilt-r"><div class="qr">${joinQR()}</div><div><b>Опоздал?</b><span>Сканируй и заходи</span></div></div>`;
    }
    function optsHTML(q, rev, voters) {
      return `<div class="hopts ${q.o.length === 2 ? "two" : ""}">${q.o.map((o, i) => {
        const v = voters ? voters[i] : null;
        return `<div class="opt pop ${rev ? (i === q.c ? "right" : "dim") : ""}" style="animation-delay:${i * 80}ms"><span class="L">${U.L[i]}</span><span class="tx">${esc(o)}</span>${v ? `<span class="hcount">${v.length}</span><div class="voters">${v.slice(0, 18).map((p, k) => U.av(p.key, p.name).replace('class="av', `style="animation-delay:${400 + k * 40}ms" class="av`)).join("")}${v.length > 18 ? `<span class="nmore">+${v.length - 18}</span>` : ""}</div>` : ""}</div>`;
      }).join("")}</div>`;
    }
    function drawQuestion(b) {
      const q = curQ(), g = G();
      stage.innerHTML = `<div class="qtop"><div class="qbar sticker tilt-l slam">${esc(q.t)}</div></div>
        <div class="qmeta"><span class="ribbon">${b.emoji} Вопрос ${g.qi + 1} из ${b.q.length}${q.p === 15 ? " · расчёт" : ""}</span><span class="cnt"><b id="ansN">${answeredCount()}</b> <span id="ansT">из ${Object.keys(S.players).length}</span> ответили</span></div>
        ${optsHTML(q, false)}`;
    }
    function drawReveal(b) {
      const q = curQ(), qid = curQid();
      const voters = q.o.map(() => []);
      Object.values(S.players).forEach((p) => { const a = p.ans[qid]; if (a) voters[a.a].push(p); });
      const okN = voters[q.c].length, tot = Object.keys(S.players).length, share = tot ? okN / tot : 0;
      stage.innerHTML = `<div class="qtop"><div class="qbar sticker tilt-l">${esc(q.t)}</div></div>
        <div class="explain sticker tilt-r rise"><b>${okN} из ${tot} ${U.plural(tot, "ответил", "ответили", "ответили")} верно.</b> ${esc(q.x || "")}</div>
        <div style="height:1.2em"></div>${optsHTML(q, true, voters)}`;
      say(pick(share >= .7 ? Q.revealHi : share >= .35 ? Q.revealMid : Q.revealLo));
    }
    function drawBoard(b) {
      const g = G(), arr = ranked(), top = arr.slice(0, 5), qid = curQid();
      stage.innerHTML = `<div class="board"><h1 class="pop">Рейтинг</h1><div class="brows" id="brows">
        ${top.map((p, i) => { const a = p.ans[qid]; const gain = a && a.pts ? a.pts : 0;
          return `<div class="brow ${i === 0 ? "lead" : ""}" data-k="${esc(p.key)}"><span class="r">${p._r}</span>${U.av(p.key, p.name)}<span class="nm">${esc(p.name)}</span>${p.streak > 1 ? `<span class="st">🔥${p.streak}</span>` : ""}${gain ? `<span class="gain">+${gain}</span>` : ""}<span class="s" data-from="${g.prev[p.key] ?? p.score}" data-to="${p.score}">${g.prev[p.key] ?? p.score}</span></div>`; }).join("")}
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
      stage.innerHTML = `<div style="text-align:center;padding-top:.6em"><span class="ribbon w slam">🏁 Итоги · ${esc(b.title)}</span></div>
        <div class="podium">${top.map((p, i) => `<div class="pcol ${cls[i]}">${p ? `${U.av(p.key, p.name).replace('class="av', `style="animation:pop .5s ${delay[i] + .6}s both" class="av`)}<div class="who" style="animation-delay:${delay[i] + .7}s">${esc(p.name)}</div><div class="pts" style="animation-delay:${delay[i] + .8}s">${pts(p.score)}</div>` : ""}<div class="blk" style="animation-delay:${delay[i]}s">${num[i]}</div></div>`).join("")}</div>`;
    }

    // ---------- событие (штраф/бонус) на весь экран ----------
    const popQ = []; let popping = false;
    function eventPop(p, ev) { popQ.push({ p, ev }); if (!popping) nextPop(); }
    function nextPop() {
      const it = popQ.shift(); if (!it) { popping = false; return; } popping = true;
      const { p, ev } = it, neg = ev.d < 0;
      const el = document.createElement("div"); el.className = "epop " + (neg ? "neg" : "pos");
      el.innerHTML = `<div class="box sticker"><div class="em">${ev.e || (neg ? "⚠️" : "🌟")}</div><div class="nm">${esc(p.name)}</div><div class="rs">${esc(ev.r)}</div><div class="dl">${fmtD(ev.d)}</div></div>`;
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
        const url = CFG.screenUrl(CFG.roomId, true);
        ov.innerHTML = `<div class="ovhead"><h2>📱 Пульт на телефоне</h2><button class="btn" type="button" data-close>Закрыть</button></div>
          <div class="ovbody" style="display:grid;place-items:center;text-align:center;gap:1em"><div class="card" style="padding:1em;width:min(80vw,22em)">${U.qrSvg(url)}</div>
          <p style="max-width:40ch;font-weight:700;color:var(--dim);margin:0">Пульт управления: ${esc(CFG.roomName)}. Отсканируйте QR-код телефоном. Пароль не нужен. Можно листать вопросы и управлять баллами именно этого класса.</p></div>`;
      } else {
        const rating = kind === "rating";
        ov.innerHTML = `<div class="ovhead"><h2>${rating ? "🏆 Общий рейтинг" : "⚠️ Кому штраф или бонус?"}</h2><input type="search" id="ovQ" placeholder="Поиск по фамилии" aria-label="Поиск по фамилии"><button class="btn" type="button" data-close>Закрыть</button></div><div class="ovbody"><div class="plgrid" id="ovList"></div></div>`;
        const list = () => {
          const q = U.normName($("#ovQ").value);
          let arr = ranked(); if (!rating) arr = arr.slice().sort((a, b) => a.name.localeCompare(b.name, "ru"));
          arr = arr.filter((p) => !q || p.key.includes(q));
          $("#ovList").innerHTML = arr.length ? arr.map((p) => `<button class="plb" type="button" data-k="${esc(p.key)}"><span class="r">${p._r}</span>${U.av(p.key, p.name)}<span class="nm">${esc(p.name)}</span><span class="s">${p.score}</span></button>`).join("")
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
    $("#bSound").onclick = () => { SFX.unlock(); SFX.muted = !SFX.muted; U.store.set("opp.muted", SFX.muted); if (window.MUSIC) window.MUSIC.setMuted(SFX.muted); $("#bSound").textContent = SFX.muted ? "🔇" : "🔊"; music(); };
    $("#bMenu").onclick = (e) => { e.stopPropagation(); $("#menu").hidden = !$("#menu").hidden; };
    document.addEventListener("click", () => { $("#menu").hidden = true; });
    $("#mLobby").onclick = toLobby;
    $("#mOut").onclick = logout;
    $("#mCsv").onclick = () => {
      const rows = [["Место", "Фамилия Имя", "Очки", "Верных ответов", "Всего ответов", "Штрафы", "Бонусы"]];
      ranked().forEach((p) => { const a = Object.values(p.ans); rows.push([p._r, p.name, p.score, a.filter((x) => x.ok).length, a.length, p.ev.filter((e) => e.d < 0).reduce((s, e) => s + e.d, 0), p.ev.filter((e) => e.d > 0).reduce((s, e) => s + e.d, 0)]); });
      const csv = "﻿" + rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(";")).join("\r\n");
      const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
      a.download = "Битва_коммерсантов_" + CFG.roomName.replace(/ /g, "_") + "_" + new Date().toLocaleDateString("ru-RU").replace(/\./g, "-") + ".csv";
      document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
    };
    $("#mReset").onclick = () => {
      const m = $("#modal"), box = $("#modalBox");
      box.innerHTML = `<div class="mhead"><div style="font-size:2.6rem">♻️</div><div><b>Начать новый урок?</b><small>Все очки и ответы обнулятся. Таблицу результатов лучше скачать заранее.</small></div></div>
        <div class="mrow"><button class="btn btn--sm" type="button" id="rNo">Отмена</button><button class="btn btn--sm btn--navy" type="button" id="rYes">Да, обнулить</button></div>`;
      m.hidden = false;
      $("#rNo").onclick = () => m.hidden = true;
      $("#rYes").onclick = () => {
        const old = Object.values(S.players).flatMap((p) => p.pids);
        S = fresh(); save(); m.hidden = true; 
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
    render(true); broadcast(true); phaseSay();
    document.addEventListener("pointerdown", () => { SFX.unlock(); music(); }, { once: true });
  }

  // ============================ ПУЛЬТ (телефон) ============================
  function startPult() {
    bindRoomSelect("#pultRoom", true);
    $("#v-pult").hidden = false;
    document.body.style.overflow = "auto";
    let st = null, bd = null;
    net.sub(T_ST); net.sub(T_BD);
    let stAt = 0; const alive = () => st && Date.now() - stAt < 35000;
    const upd = () => { const on = net.online; $("#pNetDot").classList.toggle("on", on > 0 && alive()); $("#pNet").textContent = !on ? "нет связи" : alive() ? "экран на связи" : "экран не отвечает"; };
    net.onStatus(upd); setInterval(upd, 3000);
    net.on((t, m) => {
      if (t === T_ST) { if (st && m.ts < st.ts) return; st = m; stAt = Date.now(); upd(); render(); }
      else if (t === T_BD) { if (bd && m.ts < bd.ts) return; bd = m; renderList(); }
    });
    const board = () => (bd && bd.board) || (st && st.board) || [];
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
      if (!st) { $("#pNow").innerHTML = `<div class="ph">Ждём большой экран…</div><p style="margin:0;font-weight:700">Откройте экран ведущего на компьютере у проектора.</p>`; return; }
      const b = st.block ? byId[st.block] : null, q = b && st.phase !== "intro" && st.phase !== "podium" ? b.q[st.qi] : null;
      const key = [st.phase, st.block, st.qi, st.answered, st.next].join("|");
      if (key !== lastKey) {
        lastKey = key;
        $("#pNow").innerHTML = `<div class="ph">${PH[st.phase] || ""}${b ? ` · слайд ${b.id}${q ? ` · вопрос ${st.qi + 1}/${b.q.length}` : ""}` : ""}</div>
          ${q ? `<div class="qt">${esc(q.t)}</div><div class="ans">✔ Ответ: ${U.L[q.c]}. ${esc(q.o[q.c])}</div>` : b ? `<div class="qt">${b.emoji} ${esc(b.title)}</div>` : ""}
          ${st.phase === "question" ? `<div style="font-weight:800">Ответили: ${st.answered} из ${st.n ?? board().length}</div>` : ""}
          <button class="btn btn--blue big" type="button" id="pNext">${esc(st.next || "Далее ▶")}</button>
          ${st.phase !== "lobby" ? `<button class="btn btn--sm" type="button" id="pLobby">🏠 К выбору практики</button>` : ""}`;
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
      const all = board(), arr = all.filter((p) => !q || p.k.includes(q));
      $("#plist").innerHTML = arr.length ? arr.map((p) => `<button class="plb" type="button" data-k="${esc(p.k)}"><span class="r">${p.r}</span>${U.av(p.k, p.n)}<span class="nm">${esc(p.n)}</span><span class="s">${p.s}</span></button>`).join("")
        : `<div class="empty">${all.length ? "Никого не нашли" : "Пока никто не зашёл в игру"}</div>`;
      $$("#plist .plb").forEach((el) => el.onclick = () => { const p = all.find((x) => x.k === el.dataset.k); openPlayer(p, (d, r, e) => cmd({ op: "adj", k: p.k, d, r, e }, `${p.n}: ${fmtD(d)}`)); });
    }
    render();
  }
})();
