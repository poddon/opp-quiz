(function () {
  "use strict";
  const { CFG, Net, U, mascot, SFX, confetti } = window.OPP;
  const { $, esc } = U;
  const BLOCKS = window.BLOCKS;
  const byId = Object.fromEntries(BLOCKS.map((b) => [String(b.id), b]));

  const params = new URLSearchParams(location.search);
  const blockId = params.get("p") && byId[params.get("p")] ? params.get("p") : null;

  // ---- профиль ----
  let prof = U.store.get("opp.me", null);
  if (!prof || !prof.pid) prof = { pid: "p" + U.mid(), name: "" , seenEv: [] };
  prof.seenEv = prof.seenEv || [];
  const saveProf = () => U.store.set("opp.me", prof);
  saveProf();

  let st = null;          // общее состояние от большого экрана
  let stAt = 0;           // когда получили
  let me = null;          // моя карточка от большого экрана
  let pending = U.store.get("opp.pending", {}); // qid -> {a, t}
  let cursor = 0;         // текущий вопрос в блоке
  let viewQ = null;       // какой вопрос сейчас на экране (qid)
  let shownResult = {};   // qid -> показан ли результат анимацией

  // ---- фон ----
  const sh = $(".shavings");
  for (let i = 0; i < 9; i++) {
    const s = document.createElement("span");
    s.style.left = Math.random() * 100 + "%"; s.style.animationDuration = 14 + Math.random() * 14 + "s"; s.style.animationDelay = -Math.random() * 20 + "s";
    sh.appendChild(s);
  }

  // ---- сеть ----
  const net = new Net(CFG.brokers);
  const T_ST = CFG.topic("st"), T_UP = CFG.topic("up"), T_ME = () => CFG.topic("pl/" + prof.pid);
  net.sub(T_ST); net.sub(T_ME());
  net.onStatus((on) => {
    $("#netdot").classList.toggle("on", on > 0 && hostAlive());
    $("#nettxt").textContent = on === 0 ? "нет интернета…" : hostAlive() ? "на связи" : "ждём экран преподавателя";
    if (on > 0 && prof.name) hello();
  });
  function hostAlive() { return st && Date.now() - st.ts < 70000; }
  setInterval(() => net._status(), 5000);

  net.on((topic, msg) => {
    if (topic === T_ST) {
      if (st && msg.ts < st.ts) return;
      const sidChanged = st && st.sid !== msg.sid;
      st = msg; stAt = Date.now(); net._status();
      if (sidChanged && prof.name) { pending = {}; U.store.set("opp.pending", pending); hello(); }
      render();
    } else if (topic === T_ME()) {
      if (me && msg.ts && me.ts && msg.ts < me.ts) return;
      const prevScore = me ? me.score : null;
      me = msg;
      if (st && me.sid !== st.sid) { me = null; hello(); return; }
      // подтверждённые ответы убираем из очереди
      let changed = false;
      for (const q in pending) if (me.ans && me.ans[q]) { delete pending[q]; changed = true; }
      if (changed) U.store.set("opp.pending", pending);
      if (prevScore !== null && prevScore !== me.score) { const el = $("#meScore"); el.classList.remove("bump"); void el.offsetWidth; el.classList.add("bump"); }
      checkEvents();
      render();
    }
  });

  function send(obj) { obj.mid = U.mid(); obj.pid = prof.pid; obj.name = prof.name; obj.sid = st ? st.sid : null; return net.pub(T_UP, obj); }
  function hello() { send({ ty: "join" }); }

  // переотправка неподтверждённых ответов
  setInterval(() => {
    if (!prof.name) return;
    for (const q in pending) { if (Date.now() - (pending[q].t || 0) > 3500) { pending[q].t = Date.now(); send({ ty: "ans", q, a: pending[q].a }); } }
  }, 1500);
  setInterval(() => { if (prof.name && net.online) hello(); }, 45000);

  // ---- вход ----
  $("#joinMascot").innerHTML = mascot("happy");
  if (blockId) {
    const b = byId[blockId];
    const jb = $("#joinBlock"); jb.hidden = false;
    jb.innerHTML = `<span class="em">${b.emoji}</span><div><small>Практика · слайд ${b.id}</small><b>${esc(b.title)}</b></div>`;
  }
  if (prof.name) { const [f, ...n] = prof.name.split(" "); $("#fam").value = f || ""; $("#nam").value = n.join(" "); }

  $("#joinForm").addEventListener("submit", (e) => {
    e.preventDefault(); SFX.unlock();
    const f = U.cleanName($("#fam").value), n = U.cleanName($("#nam").value);
    if (f.length < 2 || n.length < 2) { toast("Введи фамилию и имя полностью"); return; }
    prof.name = f + " " + n; saveProf();
    hello(); SFX.join();
    render();
  });
  $("#logout").addEventListener("click", () => { prof.name = ""; me = null; saveProf(); render(); });

  // ---- перемешивание вариантов (стабильно для ученика) ----
  function order(qid, n) {
    let seed = 0; for (const ch of prof.pid + qid) seed = (seed * 33 + ch.charCodeAt(0)) >>> 0;
    const idx = [...Array(n).keys()];
    if (n <= 2) return idx;     // CAPEX/OPEX и подобные — не мешаем
    for (let i = n - 1; i > 0; i--) { seed = (seed * 1103515245 + 12345) >>> 0; const j = seed % (i + 1); [idx[i], idx[j]] = [idx[j], idx[i]]; }
    return idx;
  }

  // ---- отрисовка ----
  function render() {
    const joined = !!prof.name;
    $("#v-join").hidden = joined;
    $("#v-game").hidden = !joined;
    if (!joined) return;
    $("#meName").textContent = prof.name;
    const av = $("#meAv"); av.textContent = U.initials(prof.name); av.style.setProperty("--h", U.hue(U.normName(prof.name)));
    $("#meScore").textContent = me ? me.score : 0;
    $("#meRank").textContent = me && me.rank ? `${me.rank} место из ${me.of}` : hostAlive() ? "в игре" : "ждём экран преподавателя…";

    const stage = $("#stage");
    const bid = blockId || (st && st.active ? String(st.active) : null);
    if (!bid || !byId[bid]) return renderLobby(stage);
    const b = byId[bid];
    if (st && st.closed && st.closed.includes(b.id)) return renderClosed(stage, b);
    renderBlock(stage, b);
  }

  function answerOf(qid) { return me && me.ans ? me.ans[qid] : null; }

  function renderLobby(stage) {
    if (stage.dataset.v === "lobby" + (me ? me.score + "/" + me.rank : "")) return;
    stage.dataset.v = "lobby" + (me ? me.score + "/" + me.rank : "");
    viewQ = null;
    stage.innerHTML = `<div class="center sticker pop-in">
      <div class="bob">${mascot("happy")}</div>
      <h2>Ты в игре!</h2>
      <p class="muted">Когда на слайде появится QR-код практики — сканируй его, и здесь откроются вопросы.</p>
      <div class="bigstat"><div><b>${me ? me.score : 0}</b><small>${U.plural(me ? me.score : 0, "очко", "очка", "очков")}</small></div><div><b>${me && me.rank ? me.rank : "—"}</b><small>место</small></div></div>
    </div>`;
  }

  function renderClosed(stage, b) {
    stage.dataset.v = "closed" + b.id; viewQ = null;
    stage.innerHTML = `<div class="center sticker pop-in">${mascot("sleep")}<h2>Приём ответов закрыт</h2><p class="muted">Преподаватель закрыл практику «${esc(b.title)}». Жди следующий QR-код.</p></div>`;
  }

  function renderBlock(stage, b) {
    // первый неотвеченный вопрос
    const states = b.q.map((_, i) => { const id = U.qid(b.id, i); const a = answerOf(id); return a ? (a.ok ? "ok" : "no") : pending[id] ? "wait" : ""; });
    // если текущий вопрос на экране уже с результатом — остаёмся на нём, пока ученик не нажмёт «Дальше»
    if (viewQ === null || !viewQ.startsWith(b.id + ".")) {
      cursor = states.findIndex((s) => s === "" || s === "wait");
      if (cursor === -1) cursor = b.q.length;
    }
    const head = `<div class="blockhead"><span class="eyebrow">Слайд ${b.id} · ${esc(b.topic)}</span><h2>${b.emoji} ${esc(b.title)}</h2>
      <div class="dots">${states.map((s, i) => `<i class="${s} ${i === cursor ? "cur" : ""}"></i>`).join("")}</div></div>`;

    if (cursor >= b.q.length) {
      viewQ = null;
      const okN = states.filter((s) => s === "ok").length;
      const pts = b.q.reduce((sum, _, i) => { const a = answerOf(U.qid(b.id, i)); return sum + (a ? a.pts : 0); }, 0);
      const key = "done" + b.id + "/" + (me ? me.score + "/" + me.rank : "");
      if (stage.dataset.v === key) return;
      stage.dataset.v = key;
      stage.innerHTML = head + `<div class="center sticker pop-in" style="margin-top:14px">
        <div class="bob">${mascot(okN >= b.q.length / 2 ? "happy" : "sad")}</div>
        <h2>${okN === b.q.length ? "Идеально! 🏆" : okN >= b.q.length / 2 ? "Блок пройден! 🎉" : "Блок пройден"}</h2>
        <div class="bigstat"><div><b>${okN}/${b.q.length}</b><small>верно</small></div><div><b>+${pts}</b><small>${U.plural(pts, "очко", "очка", "очков")}</small></div><div><b>${me && me.rank ? me.rank : "—"}</b><small>место</small></div></div>
        <p class="muted">Смотри рейтинг на большом экране и жди следующий QR-код на слайде.</p></div>`;
      if (!shownResult["done" + b.id] && okN === b.q.length) { shownResult["done" + b.id] = 1; confetti(90); }
      return;
    }

    const qi = cursor, q = b.q[qi], qid = U.qid(b.id, qi);
    const a = answerOf(qid), p = pending[qid];
    const key = "q" + qid + "/" + (a ? "a" + a.a : p ? "p" + p.a : "-") + "/" + states.join();
    if (stage.dataset.v === key) return;
    stage.dataset.v = key;
    viewQ = qid;
    const ord = order(qid, q.o.length);
    const letters = "АБВГД";
    const picked = a ? a.a : p ? p.a : null;
    const opts = ord.map((oi, k) => {
      let cls = "";
      if (a) { if (oi === q.c) cls = "right"; else if (oi === a.a) cls = "wrong"; }
      else if (picked === oi) cls = "picked";
      return `<button class="opt ${cls}" type="button" data-oi="${oi}"><span class="L">${letters[k]}</span><span>${esc(q.o[oi])}</span></button>`;
    }).join("");
    let verdict = "";
    if (a) {
      verdict = `<div class="verdict ${a.ok ? "ok" : "no"} pop-in"><b>${a.ok ? (a.first ? "Верно! ⚡ Первый!" : "Верно! 👍") : "Мимо 🙈"}</b>${esc(q.x || "")}</div>
        <button class="btn btn--blue" type="button" id="next">${qi + 1 < b.q.length ? "Дальше →" : "Готово"}</button>`;
    } else if (p) {
      verdict = `<div class="verdict wait"><span class="spinner"></span> ${hostAlive() ? "Проверяем ответ…" : "Ждём экран преподавателя — ответ сохранён и отправится сам"}</div>`;
    }
    stage.innerHTML = head + `<div class="qcard sticker pop-in" style="margin-top:14px">
      <div class="qmeta"><span class="eyebrow">Вопрос ${qi + 1} из ${b.q.length}</span><span class="qpts">+${q.p || CFG.defaultPts}</span></div>
      <div class="qtext">${esc(q.t)}</div>
      <div class="opts ${a || p ? "locked" : ""}">${opts}</div>
      ${verdict}
    </div>`;

    if (a && !shownResult[qid]) {
      shownResult[qid] = 1;
      const card = stage.querySelector(".qcard");
      if (a.ok) {
        SFX.good();
        const f = document.createElement("div"); f.className = "float"; f.textContent = "+" + a.pts; card.appendChild(f);
        const r = card.querySelector(".opt.right").getBoundingClientRect(); confetti(50, { x: r.left + r.width / 2, y: r.top });
      } else { SFX.bad(); card.classList.add("shake"); }
    } else if (a) shownResult[qid] = 1;

    stage.querySelectorAll(".opt").forEach((btn) => btn.addEventListener("click", () => {
      if (answerOf(qid) || pending[qid]) return;
      SFX.unlock();
      const oi = +btn.dataset.oi;
      pending[qid] = { a: oi, t: Date.now() }; U.store.set("opp.pending", pending);
      send({ ty: "ans", q: qid, a: oi });
      render();
    }));
    const nx = stage.querySelector("#next");
    if (nx) nx.addEventListener("click", () => { viewQ = null; stage.dataset.v = ""; render(); window.scrollTo({ top: 0, behavior: "smooth" }); });
  }

  // ---- штрафы и бонусы ----
  const evQueue = [];
  function checkEvents() {
    if (!me || !me.ev) return;
    for (const ev of me.ev) {
      if (prof.seenEv.includes(ev.id)) continue;
      prof.seenEv.push(ev.id);
      if (Date.now() - ev.t < 10 * 60000) evQueue.push(ev);
    }
    prof.seenEv = prof.seenEv.slice(-60); saveProf();
    showNextEvent();
  }
  function showNextEvent() {
    const al = $("#alert");
    if (!al.hidden || !evQueue.length) return;
    const ev = evQueue.shift();
    const neg = ev.d < 0;
    al.className = "alert " + (neg ? "neg" : "pos");
    $("#alertBox").innerHTML = `<div class="em">${ev.e || (neg ? "⚠️" : "🌟")}</div>
      <div class="delta">${neg ? "−" + Math.abs(ev.d) : "+" + ev.d}</div>
      <h3>${esc(ev.r)}</h3>
      <p class="muted">${neg ? "Преподаватель снял очки. Соберись — ещё можно отыграться!" : "Преподаватель начислил бонус. Так держать!"}</p>
      <button class="btn ${neg ? "btn--ghost" : ""}" type="button" id="alertOk">Понятно</button>`;
    al.hidden = false;
    const box = $("#alertBox"); box.classList.remove("pop-in"); void box.offsetWidth; box.classList.add("pop-in");
    neg ? SFX.penalty() : (SFX.bonus(), confetti(60));
    if (navigator.vibrate) try { navigator.vibrate(neg ? [200, 100, 200] : 80); } catch (_) {}
    $("#alertOk").onclick = () => { al.hidden = true; showNextEvent(); };
  }

  function toast(text) {
    const t = document.createElement("div"); t.className = "toast sticker"; t.textContent = text;
    $("#toasts").appendChild(t); setTimeout(() => t.remove(), 2600);
  }

  document.addEventListener("pointerdown", () => SFX.unlock(), { once: true });
  render();
})();
