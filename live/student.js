(function () {
  "use strict";
  const { CFG, Net, U, SFX, confetti } = window.OPP;
  const { $, esc } = U;
  const byId = Object.fromEntries(window.BLOCKS.map((b) => [String(b.id), b]));

  // ---- профиль на этом телефоне ----
  let prof = U.store.get("opp.me2", null);
  if (!prof || !prof.pid) prof = { pid: "p" + U.mid(), name: "", seenEv: [] };
  prof.seenEv = prof.seenEv || [];
  const saveProf = () => U.store.set("opp.me2", prof);
  saveProf();

  let st = null, stAt = 0, me = null, deadline = 0, view = "", resultShown = {};
  const pending = {};   // qid -> {a, t}


  // ---- связь ----
  const net = new Net(CFG.brokers);
  const T_ST = CFG.topic("st"), T_UP = CFG.topic("up"), T_ME = CFG.topic("pl/" + prof.pid);
  net.sub(T_ST); net.sub(T_ME);
  const hostAlive = () => st && Date.now() - st.ts < 40000;
  function netStatus() {
    const on = net.online;
    $("#netdot").classList.toggle("on", on > 0 && hostAlive());
    $("#nettxt").textContent = !on ? "нет интернета" : hostAlive() ? "в игре" : "ждём преподавателя";
  }
  net.onStatus((on) => { netStatus(); if (on && prof.name) hello(); });
  setInterval(netStatus, 3000);

  net.on((topic, msg) => {
    if (topic === T_ST) {
      if (st && msg.ts < st.ts) return;
      const prev = st; st = msg; stAt = Date.now();
      if (st.phase === "question" && typeof st.left === "number") deadline = Date.now() + st.left;
      if (prev && prev.sid !== st.sid && prof.name) { me = null; hello(); }
      netStatus(); render();
    } else if (topic === T_ME) {
      if (me && msg.ts < me.ts) return;
      if (st && msg.sid !== st.sid) return;
      const prevScore = me ? me.score : null;
      me = msg;
      for (const q in pending) if (me.ans && me.ans[q]) delete pending[q];
      if (prevScore !== null && prevScore !== me.score) bump();
      checkEvents(); render();
    }
  });

  function send(o) { o.mid = U.mid(); o.pid = prof.pid; o.name = prof.name; return net.pub(T_UP, o); }
  function hello() { send({ ty: "join" }); }
  setInterval(() => { if (prof.name && net.online) hello(); }, 40000);
  // повтор ответа, если экран преподавателя не подтвердил
  setInterval(() => {
    for (const q in pending) if (Date.now() - pending[q].t > 2500) { pending[q].t = Date.now(); send({ ty: "ans", q, a: pending[q].a }); }
  }, 1000);

  // ---- отрисовка ----
  const main = $("#main");
  function setView(key, html, after) { if (view === key) return false; view = key; main.innerHTML = html; if (after) after(); return true; }
  function bump() { const el = $("#meScore"); el.classList.remove("bump"); void el.offsetWidth; el.classList.add("bump"); }
  function myRank() {
    if (!st || !st.board || !me) return null;
    const i = st.board.findIndex((p) => p.k === me.key);
    return i < 0 ? null : { r: st.board[i].r, of: st.board.length, ahead: i > 0 ? st.board[i - 1] : null, s: st.board[i].s };
  }

  function render() {
    const joined = !!prof.name;
    $("#bottom").hidden = !joined;
    if (joined) {
      $("#meName").textContent = prof.name;
      $("#meAv").innerHTML = U.av(U.normName(prof.name), prof.name);
      $("#meScore").textContent = me ? me.score : 0;
    }
    if (!joined) return renderJoin();
    if (!hostAlive()) { $("#topL").textContent = "Битва коммерсантов"; return setView("wait-host", `<div class="center"><div class="spin"></div><div class="card sticker tilt-l"><h1>Ждём ведущего</h1><p>Как только преподаватель откроет большой экран, ты в игре.</p></div></div>`); }
    const b = st.block ? byId[st.block] : null;
    $("#topL").textContent = b && st.phase !== "lobby" ? `${b.emoji} Слайд ${b.id}` + (st.phase === "intro" || st.phase === "podium" ? "" : ` · вопрос ${st.qi + 1} из ${b.q.length}`) : "Битва коммерсантов";

    switch (st.phase) {
      case "intro":
        return setView("intro" + st.block, `<div class="center"><div class="big wobble">${b.emoji}</div><h1 class="slam">Приготовься!</h1><div class="card sticker tilt-r pop"><p><b>${esc(b.title)}</b><br>${b.q.length} ${U.plural(b.q.length, "вопрос", "вопроса", "вопросов")}. Чем быстрее верный ответ, тем больше очков.</p></div></div>`);
      case "question": return renderQuestion(b);
      case "reveal": return renderResult(b);
      case "board": {
        const r = myRank();
        const key = "board" + st.block + "." + st.qi + "/" + (r ? r.r + ":" + r.s : "");
        return setView(key, `<div class="center"><span class="ribbon w">Твоё место</span><h1 class="slam" style="font-size:4.4rem">${r ? r.r : "—"}</h1>
          <div class="card sticker tilt-l pop"><p><b>${r ? `${r.s} ${U.plural(r.s, "очко", "очка", "очков")}` : ""}</b><br>
          ${r && r.ahead ? `До ${r.ahead.r} места — ${r.ahead.s - r.s + 1} ${U.plural(r.ahead.s - r.s + 1, "очко", "очка", "очков")}` : r && r.r === 1 ? `Ты лидер! Не расслабляйся 👑` : "Смотри на экран"}</p></div></div>`);
      }
      case "podium": {
        const r = myRank();
        const medal = r && r.r <= 3 ? ["🥇", "🥈", "🥉"][r.r - 1] : "🎉";
        return setView("podium" + st.block + "/" + (r ? r.r : ""), `<div class="center"><div class="big wobble">${medal}</div><h1 class="slam">${r ? r.r + " место" : "Финиш!"}</h1><div class="card sticker tilt-r pop"><p>Практика «${esc(b.title)}» завершена. Смотри на экран!</p></div></div>`,
          () => { if (r && r.r <= 3 && !resultShown["pod" + st.block]) { resultShown["pod" + st.block] = 1; confetti(120); } });
      }
      default:
        return setView("lobby", `<div class="center"><span class="ribbon w">Добро пожаловать</span><h1 class="slam">Ты в игре!</h1><div class="card sticker tilt-l pop"><p>Смотри на большой экран. Когда начнётся вопрос, здесь появятся варианты ответа.</p></div></div>`);
    }
  }

  function renderJoin() {
    $("#topL").textContent = "ОПП · Модуль 3";
    if (!setView("join", `<div class="center">
      <div class="logo hero-logo slam">Битва<span>коммерсантов</span></div>
      <form class="join sticker tilt-l rise" id="jf" autocomplete="on">
        <div class="field"><label for="fam">Фамилия</label><input id="fam" autocomplete="family-name" required maxlength="30"></div>
        <div class="field"><label for="nam">Имя</label><input id="nam" autocomplete="given-name" required maxlength="30"></div>
        <button class="btn btn--blue" type="submit">Я в деле!</button>
      </form></div>`)) return;
    if (prof.last) { const [f, ...n] = prof.last.split(" "); $("#fam").value = f || ""; $("#nam").value = n.join(" "); }
    $("#jf").addEventListener("submit", (e) => {
      e.preventDefault(); SFX.unlock();
      const f = U.cleanName($("#fam").value), n = U.cleanName($("#nam").value);
      if (f.length < 2 || n.length < 2) { toast("Напиши фамилию и имя полностью"); return; }
      prof.name = prof.last = f + " " + n; saveProf(); hello(); SFX.join(); view = ""; render();
    });
  }

  let timerRaf = 0;
  function renderQuestion(b) {
    const q = b.q[st.qi], qid = U.qid(b.id, st.qi);
    const mine = (me && me.ans && me.ans[qid]) || pending[qid];
    if (mine) {
      return setView("ans" + qid, `<div class="center"><div class="opt pop" style="font-size:2.4rem;padding:14px;transform:rotate(-6deg)"><span class="L">${U.L[mine.a]}</span></div>
        <h1 class="slam">Ответ принят!</h1><div class="card sticker tilt-r"><p>Ждём остальных… Смотри на экран.</p></div></div>`);
    }
    const left = deadline - Date.now();
    if (left <= 0) return setView("late" + qid, `<div class="center"><div class="big wobble">⏰</div><h1 class="slam">Время вышло</h1></div>`);
    const changed = setView("q" + qid, `
      <div class="tline"><span class="ribbon">Вопрос ${st.qi + 1} из ${b.q.length}</span><span class="timer" id="tsec"></span></div>
      <div class="qtext sticker tilt-l">${esc(q.t)}</div>
      <div class="opts">
        ${q.o.map((o, i) => `<button class="opt pop" style="animation-delay:${i * 70}ms" type="button" data-a="${i}"><span class="L">${U.L[i]}</span><span class="tx">${esc(o)}</span></button>`).join("")}
      </div>`, () => {
      main.querySelectorAll(".opt").forEach((t) => t.addEventListener("click", () => {
        SFX.unlock();
        const a = +t.dataset.a;
        pending[qid] = { a, t: Date.now() };
        send({ ty: "ans", q: qid, a });
        if (navigator.vibrate) try { navigator.vibrate(40); } catch (_) {}
        view = ""; render();
      }));
    });
    if (changed) {
      cancelAnimationFrame(timerRaf);
      const lim = (st.limit || 25) * 1000;
      const tick = () => {
        const l = Math.max(0, deadline - Date.now());
        const s = $("#tsec");
        if (!s || view !== "q" + qid) return;
        s.textContent = Math.ceil(l / 1000); s.classList.toggle("hurry", l < 5000);
        if (l <= 0) { view = ""; render(); return; }
        timerRaf = requestAnimationFrame(tick);
      };
      tick();
    }
  }

  function renderResult(b) {
    const q = b.q[st.qi], qid = U.qid(b.id, st.qi);
    const a = me && me.ans ? me.ans[qid] : null;
    const r = myRank();
    const rankLine = r ? `<div class="rank">${r.r} место из ${r.of}</div>` : "";
    if (a && typeof a.ok === "boolean") {
      const html = a.ok
        ? `<div class="result ok"><div class="stamp slam">Верно!</div><div class="gain pop">+${a.pts}</div>${me.streak > 1 ? `<span class="ribbon w">🔥 ${me.streak} подряд</span>` : ""}${rankLine}</div>`
        : `<div class="result no"><div class="stamp slam">Мимо</div><div class="note sticker tilt-r">Правильный ответ: <b>${U.L[q.c]}. ${esc(q.o[q.c])}</b></div>${rankLine}</div>`;
      return setView("res" + qid + "/" + a.ok + (r ? r.r : ""), html, () => {
        if (resultShown[qid]) return; resultShown[qid] = 1;
        if (a.ok) { SFX.good(); confetti(70); } else { SFX.bad(); main.querySelector(".stamp").classList.add("shake"); if (navigator.vibrate) try { navigator.vibrate([120, 60, 120]); } catch (_) {} }
      });
    }
    if (a || pending[qid]) return setView("res-wait" + qid, `<div class="center"><div class="spin"></div><h1>Считаем…</h1></div>`);
    return setView("res-none" + qid, `<div class="result no"><div class="stamp slam">Проспал</div><div class="note sticker tilt-r">Правильный ответ: <b>${U.L[q.c]}. ${esc(q.o[q.c])}</b></div>${rankLine}</div>`);
  }

  // ---- штрафы и бонусы ----
  const evQ = [];
  function checkEvents() {
    if (!me || !me.ev) return;
    for (const ev of me.ev) {
      if (prof.seenEv.includes(ev.id)) continue;
      prof.seenEv.push(ev.id);
      if (Date.now() - ev.t < 10 * 60000) evQ.push(ev);
    }
    prof.seenEv = prof.seenEv.slice(-80); saveProf(); nextEv();
  }
  function nextEv() {
    const al = $("#alert"); if (!al.hidden || !evQ.length) return;
    const ev = evQ.shift(), neg = ev.d < 0;
    al.className = "alert " + (neg ? "neg" : "pos");
    $("#alertBox").innerHTML = `<div class="em">${ev.e || (neg ? "⚠️" : "🌟")}</div><div class="d">${neg ? "−" + Math.abs(ev.d) : "+" + ev.d}</div>
      <h2>${esc(ev.r)}</h2><p>${neg ? "Преподаватель снял очки. Ещё можно отыграться!" : "Преподаватель начислил бонус!"}</p>
      <button class="btn btn--blue" type="button" id="alOk">Понятно</button>`;
    al.hidden = false;
    neg ? SFX.penalty() : (SFX.bonus(), confetti(60));
    if (navigator.vibrate) try { navigator.vibrate(neg ? [250, 100, 250] : 60); } catch (_) {}
    $("#alOk").onclick = () => { al.hidden = true; nextEv(); };
  }

  function toast(t) { const d = document.createElement("div"); d.className = "toast"; d.textContent = t; $("#toasts").appendChild(d); setTimeout(() => d.remove(), 2600); }
  document.addEventListener("pointerdown", () => SFX.unlock(), { once: true });
  // долгое нажатие на имя — сменить игрока
  let lp = 0;
  $("#bottom").addEventListener("pointerdown", () => { lp = setTimeout(() => { if (confirmSwitch()) { prof.name = ""; me = null; saveProf(); view = ""; render(); } }, 1200); });
  $("#bottom").addEventListener("pointerup", () => clearTimeout(lp));
  function confirmSwitch() { return true; }
  setInterval(() => { if (st && (st.phase === "question")) render(); }, 1000);
  render();
})();
