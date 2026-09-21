const API = "https://commercial-quiz-room.egor-lukyanchikov09.chatgpt.site";
const app = document.querySelector("#app");
const toastElement = document.querySelector("#toast");
let pollTimer = 0;
let adminToken = localStorage.getItem("quiz-admin-token") || "";
let selectedRoom = "";

const escapeHtml = (value = "") => String(value).replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[char]));
const qs = (selector, root = document) => root.querySelector(selector);
const qsa = (selector, root = document) => [...root.querySelectorAll(selector)];
const pageUrl = (params = {}) => {
  const search = new URLSearchParams(params);
  return `./${search.size ? `?${search}` : ""}`;
};

function stopPolling() { if (pollTimer) window.clearInterval(pollTimer); pollTimer = 0; }
function startPolling(callback, delay) { stopPolling(); pollTimer = window.setInterval(callback, delay); }
function toast(message, type = "") {
  toastElement.textContent = message;
  toastElement.className = `toast show ${type}`;
  window.setTimeout(() => { toastElement.className = "toast"; }, 2600);
}
function loading() { app.innerHTML = `<main class="center-screen"><div class="loader"></div></main>`; }
function errorBox(message) { return message ? `<div class="error" role="alert">${escapeHtml(message)}</div>` : ""; }
function confetti() {
  const colors = ["#00b8f0", "#0086d9", "#4da9f6", "#fff", "#cdefff"];
  const layer = document.createElement("div"); layer.className = "confetti";
  layer.innerHTML = Array.from({length:34}, (_,i) => `<i style="left:${(i*37)%100}vw;--d:${(i%8)*45}ms;--c:${colors[i%colors.length]}"></i>`).join("");
  document.body.append(layer); window.setTimeout(() => layer.remove(), 2100);
}

async function request(path, options = {}, admin = false) {
  const headers = new Headers(options.headers || {});
  if (options.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  if (admin && adminToken) headers.set("Authorization", `Bearer ${adminToken}`);
  const response = await fetch(`${API}${path}`, { ...options, headers, cache: "no-store" });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (admin && response.status === 401) { adminToken = ""; localStorage.removeItem("quiz-admin-token"); }
    throw new Error(data.error || "Не удалось выполнить действие");
  }
  return data;
}

function brand(compact = false) {
  return `<div class="brand"><div class="brand-mark">🏭</div><div><p class="eyebrow">${compact ? "Учебная викторина" : "Модуль 3 · Учебная викторина"}</p><h1>${compact ? "Коммерческая деятельность" : "Коммерческая деятельность"}</h1></div></div>`;
}

async function route() {
  stopPolling();
  const params = new URLSearchParams(location.search);
  const view = params.get("view");
  if (view === "admin") return renderAdmin();
  if (view === "display") return renderDisplay((params.get("room") || "").toUpperCase());
  return renderStudent((params.get("room") || "").toUpperCase());
}

async function renderStudent(initialCode = "") {
  let player = null;
  if (initialCode) {
    try { player = JSON.parse(localStorage.getItem(`quiz-player:${initialCode}`) || "null"); } catch {}
  }
  if (!initialCode || !player?.playerId) return renderJoin(initialCode);
  loading();
  const refresh = async () => {
    try {
      const state = await request(`/api/room/${encodeURIComponent(initialCode)}/state?playerId=${encodeURIComponent(player.playerId)}`);
      if (!state.player) throw new Error("Участник не найден. Войдите снова.");
      drawStudentState(state, player.playerId);
    } catch (error) { stopPolling(); renderJoin(initialCode, error.message); }
  };
  await refresh(); startPolling(refresh, 1700);
}

function renderJoin(code = "", error = "") {
  stopPolling();
  app.innerHTML = `
    <div class="top-actions"><a class="btn" href="${pageUrl({view:"admin"})}">🔐 Администратор</a></div>
    <main class="center-screen"><section class="card pad pop" style="width:min(570px,100%)">
      ${brand()}
      <p class="sub muted">Войдите по коду комнаты, отвечайте быстрее соперников и поднимайтесь в рейтинге.</p>
      <form id="join-form" class="form">
        <label class="label">Код комнаты<input class="field code" name="code" maxlength="6" value="${escapeHtml(code)}" placeholder="K7M2P" autocomplete="off" required></label>
        <label class="label">Фамилия и имя<input class="field" name="name" placeholder="Иванов Иван" autocomplete="name" required></label>
        <div id="join-error">${errorBox(error)}</div>
        <button class="btn primary wide" type="submit">✨ Войти в игру →</button>
      </form>
    </section></main>`;
  qs("#join-form").addEventListener("submit", async (event) => {
    event.preventDefault(); const form = new FormData(event.currentTarget); const submit = qs("button", event.currentTarget); submit.disabled = true;
    const roomCode = String(form.get("code") || "").trim().toUpperCase(); const name = String(form.get("name") || "").trim();
    try {
      const data = await request(`/api/room/${encodeURIComponent(roomCode)}/join`, {method:"POST", body:JSON.stringify({name})});
      localStorage.setItem(`quiz-player:${data.roomCode}`, JSON.stringify({playerId:data.playerId,name:data.name}));
      history.replaceState({}, "", pageUrl({room:data.roomCode})); await renderStudent(data.roomCode);
    } catch (caught) { qs("#join-error").innerHTML = errorBox(caught.message); submit.disabled = false; }
  });
}

function drawStudentState(state, playerId) {
  const {room, question, players, player, answer} = state;
  const rank = Math.max(1, players.findIndex((item) => item.id === playerId) + 1);
  if (room.status === "lobby") {
    app.innerHTML = `<main class="center-screen"><section class="card pad pop" style="width:min(620px,100%);text-align:center"><div class="brand-mark float" style="margin:0 auto 22px">🏭</div><p class="eyebrow">Вы в комнате ${escapeHtml(room.code)}</p><h1>${escapeHtml(player.name)}</h1><p class="sub muted">Ждём, когда преподаватель запустит первый вопрос</p><div class="dots"><span></span><span></span><span></span></div><div class="chip" style="margin-top:28px">👥 Участников: ${players.length}</div></section></main>`;
    return;
  }
  if (room.status === "finished") {
    app.innerHTML = `<main class="center-screen"><section class="card pad pop" style="width:min(720px,100%);text-align:center"><div class="float" style="font-size:78px">🏆</div><p class="eyebrow">Финиш</p><h1>${Number(player.score)} очков</h1><p class="sub">Ваше место: <b>${rank}</b></p><div class="leader-list" style="text-align:left">${players.slice(0,8).map((item,i)=>leaderRow(item,i,item.id===playerId)).join("")}</div></section></main>`;
    return;
  }
  if (!question) return;
  const progress = Math.round(((question.index + 1) / question.total) * 100);
  app.innerHTML = `<main class="page">
    <header class="quiz-head"><div class="brand"><div class="brand-mark">🏭</div><div><p class="eyebrow">Комната ${escapeHtml(room.code)}</p><h3>${escapeHtml(player.name)}</h3></div></div><div class="chips"><div class="chip rank">👑 ${rank} место</div><div class="chip score">⚡ ${Number(player.score)} очков</div></div></header>
    <section class="card pad pop"><div class="question-meta"><span>${escapeHtml(question.topic)}</span><span>${question.index+1} / ${question.total}</span></div><div class="progress"><i style="width:${progress}%"></i></div><h2 class="question-title">${escapeHtml(question.question)}</h2>
      <div class="answers">${question.options.map((option,i)=>`<button class="answer ${answer && Number(answer.optionIndex)===i?"selected":""} ${answer && i===Number(answer.correctIndex)?"correct":""} ${answer && Number(answer.optionIndex)===i && !Number(answer.isCorrect)?"wrong":""}" data-answer="${i}" ${answer?"disabled":""}><span class="answer-letter">${["А","Б","В","Г"][i]}</span><span>${escapeHtml(option)}</span></button>`).join("")}</div>
      ${answer ? `<div class="feedback"><strong>${Number(answer.isCorrect)?`✅ Верно! +${Number(answer.points)} очков`:`❌ Правильный ответ отмечен зелёным`}</strong><br>${escapeHtml(answer.explanation || "")}</div>` : ""}
    </section></main>`;
  qsa("[data-answer]").forEach((button) => button.addEventListener("click", async () => {
    qsa("[data-answer]").forEach((item)=>item.disabled=true); button.classList.add("selected");
    try {
      const result = await request(`/api/room/${encodeURIComponent(room.code)}/answer`, {method:"POST",body:JSON.stringify({playerId,questionIndex:question.index,optionIndex:Number(button.dataset.answer)})});
      toast(result.correct ? `Точный удар! +${result.points}` : "Следующий вопрос — новый шанс!", result.correct ? "good" : "bad"); if (result.correct) confetti();
      const fresh = await request(`/api/room/${encodeURIComponent(room.code)}/state?playerId=${encodeURIComponent(playerId)}`); drawStudentState(fresh, playerId);
    } catch (error) { toast(error.message,"bad"); qsa("[data-answer]").forEach((item)=>item.disabled=false); }
  }));
}

function leaderRow(item, index, active = false) {
  return `<div class="leader ${index===0?"first":""}" style="${active?"outline:4px solid rgb(0 134 217 / 22%)":""}"><span class="leader-name">${index===0?"👑":`${index+1}.`} ${escapeHtml(item.name)}</span><b>⚡ ${Number(item.score)}</b></div>`;
}

async function renderAdmin() {
  stopPolling();
  if (!adminToken) return drawAdminLogin();
  loading();
  try { await request("/api/admin/me", {}, true); } catch { return drawAdminLogin(); }
  const refresh = async () => {
    try {
      const {rooms} = await request("/api/admin/rooms", {}, true);
      selectedRoom = selectedRoom || rooms[0]?.code || "";
      const state = selectedRoom ? await request(`/api/admin/room/${encodeURIComponent(selectedRoom)}`, {}, true) : null;
      drawAdmin(rooms, state);
    } catch (error) { if (!adminToken) drawAdminLogin(error.message); else toast(error.message,"bad"); }
  };
  await refresh(); startPolling(refresh, 1500);
}

function drawAdminLogin(error = "") {
  stopPolling();
  app.innerHTML = `<div class="top-actions"><a class="btn" href="${pageUrl()}">← Участникам</a></div><main class="center-screen"><section class="card pad pop" style="width:min(510px,100%)">${brand(true)}<p class="sub muted">Управление комнатами и баллами студентов</p><form id="login-form" class="form"><label class="label">Должность<input class="field" name="username" value="admin" required></label><label class="label">Пароль<input class="field" type="password" name="password" autocomplete="current-password" required></label><div id="login-error">${errorBox(error)}</div><button class="btn primary wide">🔐 Войти</button></form></section></main>`;
  qs("#login-form").addEventListener("submit", async (event) => {
    event.preventDefault(); const form = new FormData(event.currentTarget); const button=qs("button",event.currentTarget); button.disabled=true;
    try { const data=await request("/api/admin/login",{method:"POST",body:JSON.stringify({username:form.get("username"),password:form.get("password")})}); adminToken=data.token; localStorage.setItem("quiz-admin-token",adminToken); await renderAdmin(); }
    catch(error){qs("#login-error").innerHTML=errorBox(error.message);button.disabled=false;}
  });
}

function drawAdmin(rooms, state) {
  const room = state?.room; const question = state?.question; const players = state?.players || [];
  app.innerHTML = `<main class="page wide"><header class="admin-head">${brand(true)}<div class="chips"><button class="btn primary" id="create-room">＋ Новая комната</button><button class="btn" id="logout">↪ Выйти</button></div></header>
    ${!room ? `<section class="card pad pop" style="max-width:620px;margin:70px auto;text-align:center"><div style="font-size:65px">👥</div><h2>Создайте комнату</h2><p class="sub muted">Появятся QR-код, управление игрой и общий рейтинг.</p><button class="btn primary" id="empty-create">＋ Создать комнату</button></section>` : `
    <div class="admin-grid">
      <aside class="stack"><section class="card panel pop" style="text-align:center"><span class="status">${room.status==="lobby"?"Сбор участников":room.status==="live"?"Викторина идёт":"Завершено"}</span><p class="eyebrow" style="margin-top:14px">Код комнаты</p><div class="room-code">${escapeHtml(room.code)}</div><img class="qr" src="${API}/api/qr?room=${encodeURIComponent(room.code)}" alt="QR-код"><button class="btn wide" id="copy-link">📋 Скопировать ссылку</button><a class="btn primary wide" style="margin-top:10px" target="_blank" href="${pageUrl({view:"display",room:room.code})}">🖥 Большой экран</a></section>
      ${rooms.length>1?`<section class="card panel"><p class="eyebrow">Комнаты</p><div class="room-tabs">${rooms.map(item=>`<button class="room-tab ${item.code===room.code?"active":""}" data-room="${escapeHtml(item.code)}"><span>${escapeHtml(item.code)}</span><span>👥 ${Number(item.playerCount)}</span></button>`).join("")}</div></section>`:""}</aside>
      <section class="card panel pop"><div style="display:flex;justify-content:space-between;gap:12px;align-items:center"><div><p class="eyebrow">Управление игрой</p><h2>${escapeHtml(room.title)}</h2></div><div class="chip">👥 ${players.length}</div></div>
        ${question?`<div class="question-box"><div class="question-meta"><span>${escapeHtml(question.topic)}</span><span>${question.index+1}/${question.total}</span></div><h3>${escapeHtml(question.question)}</h3><div class="options">${question.options.map((item,i)=>`<div class="option ${i===Number(question.correctIndex)?"correct":""}"><b>${i+1}.</b> ${escapeHtml(item)}</div>`).join("")}</div><p class="muted" style="line-height:1.45">${escapeHtml(question.explanation)}</p></div>`:`<div class="question-box" style="min-height:300px;display:grid;place-items:center;text-align:center"><div><div style="font-size:62px">🚀</div><h2>Всё готово</h2><p class="muted">Соберите участников и запускайте первый вопрос.</p></div></div>`}
        <div class="controls">${room.status==="lobby"?`<button class="btn cyan" data-control="start" style="grid-column:span 2">▶ Начать</button>`:`<button class="btn" data-control="previous">← Назад</button>`}${room.status==="live"?`<button class="btn primary" data-control="next">Дальше →</button>`:""}${room.status!=="finished"?`<button class="btn danger" data-control="finish">■ Завершить</button>`:`<button class="btn sky" data-control="lobby">↻ В лобби</button>`}</div>
      </section>
      <section class="card panel pop ranking"><p class="eyebrow">Рейтинг</p><h2>Участники 🏆</h2><div class="table">${players.length?players.map((person,i)=>`<div class="player"><b>${i+1}</b><div><b>${escapeHtml(person.name)}</b>${person.lastReason?`<div class="event ${Number(person.lastDelta)<0?"minus":""}">${Number(person.lastDelta)>0?"+":""}${Number(person.lastDelta)} · ${escapeHtml(person.lastReason)}</div>`:""}</div><div class="player-score">${Number(person.score)}</div><div class="score-actions"><button class="btn small" data-score="-50" data-player="${escapeHtml(person.id)}" data-reason="Сон на занятии">😴 −50</button><button class="btn small" data-score="-30" data-player="${escapeHtml(person.id)}" data-reason="Телефон на занятии">📱 −30</button><button class="btn small" data-score="-20" data-player="${escapeHtml(person.id)}" data-reason="Нарушение дисциплины">⚠ −20</button><button class="btn small sky" data-score="50" data-player="${escapeHtml(person.id)}" data-reason="Активность на занятии">⭐ +50</button></div></div>`).join(""):`<p class="muted" style="text-align:center;padding:32px 8px">Студенты появятся после входа по QR-коду</p>`}</div></section>
    </div>`}</main>`;
  const create = async () => { try { const data=await request("/api/admin/rooms",{method:"POST",body:JSON.stringify({})},true); selectedRoom=data.room.code; toast(`Комната ${selectedRoom} создана`,"good"); await renderAdmin(); } catch(error){toast(error.message,"bad");} };
  qs("#create-room")?.addEventListener("click",create); qs("#empty-create")?.addEventListener("click",create);
  qs("#logout")?.addEventListener("click",()=>{adminToken="";localStorage.removeItem("quiz-admin-token");drawAdminLogin();});
  qs("#copy-link")?.addEventListener("click",async()=>{await navigator.clipboard.writeText(new URL(pageUrl({room:room.code}),location.href).href);toast("Ссылка скопирована","good");});
  qsa("[data-room]").forEach(button=>button.addEventListener("click",()=>{selectedRoom=button.dataset.room;renderAdmin();}));
  qsa("[data-control]").forEach(button=>button.addEventListener("click",async()=>{button.disabled=true;try{await request(`/api/admin/room/${encodeURIComponent(room.code)}/control`,{method:"POST",body:JSON.stringify({action:button.dataset.control})},true);await renderAdmin();}catch(error){toast(error.message,"bad");button.disabled=false;}}));
  qsa("[data-score]").forEach(button=>button.addEventListener("click",async()=>{button.disabled=true;try{await request(`/api/admin/room/${encodeURIComponent(room.code)}/score`,{method:"POST",body:JSON.stringify({playerId:button.dataset.player,delta:Number(button.dataset.score),reason:button.dataset.reason})},true);toast(`${button.dataset.score>0?"Начислено":"Списано"} ${Math.abs(Number(button.dataset.score))} баллов`,button.dataset.score>0?"good":"bad");await renderAdmin();}catch(error){toast(error.message,"bad");button.disabled=false;}}));
}

async function renderDisplay(code) {
  stopPolling();
  if (!code) {
    app.innerHTML=`<main class="center-screen"><section class="card pad" style="width:min(520px,100%)"><h2>Большой экран</h2><p class="sub muted">Введите код комнаты</p><form id="display-form" class="form"><input class="field code" name="code" maxlength="6" required><button class="btn primary">Открыть</button></form></section></main>`;
    qs("#display-form").addEventListener("submit",event=>{event.preventDefault();const value=String(new FormData(event.currentTarget).get("code")||"").toUpperCase();history.replaceState({},"",pageUrl({view:"display",room:value}));renderDisplay(value);});return;
  }
  loading();
  const refresh=async()=>{try{const state=await request(`/api/room/${encodeURIComponent(code)}/state`);drawDisplay(state);}catch(error){app.innerHTML=`<main class="center-screen"><section class="card pad"><h2>${escapeHtml(error.message)}</h2></section></main>`;}};
  await refresh(); startPolling(refresh,1400);
}

function drawDisplay(state) {
  const {room,question,players}=state; const leaderScore=Math.max(1,Number(players[0]?.score||0));
  if(room.status==="finished"){
    app.innerHTML=`<main class="page wide"><header class="quiz-head">${brand(true)}<div class="float" style="font-size:75px">🏆</div></header><section><p class="eyebrow">Итоги викторины</p><h1>Таблица лидеров</h1><div class="podium">${players.slice(0,3).map((item,i)=>`<div class="card pop"><div class="place">${i===0?"👑":"🏅"} ${i+1}</div><h2>${escapeHtml(item.name)}</h2><div class="points">${Number(item.score)}</div></div>`).join("")}</div><div class="leader-list" style="margin-top:30px">${players.slice(3,12).map((item,i)=>leaderRow(item,i+3)).join("")}</div></section></main>`;return;
  }
  app.innerHTML=`<main class="page wide"><header class="quiz-head">${brand(true)}<div class="chips"><div class="chip ${room.status==="live"?"score":""}">${room.status==="live"?"🔥 Гонка идёт":"⚡ Готовьтесь"}</div><div class="chip">👥 ${players.length}</div></div></header><div class="display-grid"><section class="card display-main pop">${room.status==="lobby"||!question?`<div style="min-height:60vh;display:grid;place-items:center;text-align:center"><div><p class="eyebrow">Код комнаты</p><div class="giant-code">${escapeHtml(room.code)}</div><h3 class="muted">Сканируйте QR-код и вводите фамилию и имя</h3></div></div>`:`<div class="question-meta"><span>${escapeHtml(question.topic)}</span><span>${question.index+1}/${question.total}</span></div><div class="progress"><i style="width:${((question.index+1)/question.total)*100}%"></i></div><h2 class="display-question">${escapeHtml(question.question)}</h2><div class="display-options">${question.options.map((item,i)=>`<div class="display-option"><span class="answer-letter">${i+1}</span>${escapeHtml(item)}</div>`).join("")}</div>`}</section><aside class="display-side stack"><section class="card panel" style="text-align:center"><img class="qr" src="${API}/api/qr?room=${encodeURIComponent(room.code)}" alt="QR-код"><p class="eyebrow">Код комнаты</p><div class="room-code">${escapeHtml(room.code)}</div></section><section class="card panel"><p class="eyebrow">В прямом эфире</p><h2>Гонка лидеров</h2><div class="leader-list" style="margin-top:16px">${players.length?players.slice(0,10).map((item,i)=>`<div class="leader ${i===0?"first":""}" style="display:block"><div style="display:flex;justify-content:space-between;gap:10px"><span class="leader-name">${i===0?"👑":`${i+1}.`} ${escapeHtml(item.name)}</span><b>⚡${Number(item.score)}</b></div><div class="race"><i style="width:${Number(item.score)>0?Math.max(7,Math.round(Number(item.score)/leaderScore*100)):0}%"></i></div></div>`).join(""):`<p class="muted" style="text-align:center;padding:30px 0">Пока никого нет</p>`}</div></section></aside></div></main>`;
}

window.addEventListener("popstate", route);
route();
