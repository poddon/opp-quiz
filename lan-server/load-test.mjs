// Node.js 22+: проверка 50+ одновременных WebSocket-подключений.
// Usage: node lan-server/load-test.mjs wss://YOUR-DOMAIN/ws 50
// Synthetic topics only: no real users, results or room state are touched.
const endpoint = process.argv[2] || "ws://127.0.0.1:8080/ws";
const size = Number(process.argv[3] || 50);
if (!/^wss?:\/\//.test(endpoint) || !Number.isInteger(size) || size < 1 || size > 200)
  throw new Error("Use ws(s)://host/ws and a client count between 1 and 200");
if (typeof WebSocket !== "function")
  throw new Error("Node.js 22+ required: WebSocket is not available");
const base = "opp-load-test/" + Date.now() + "-" + Math.random().toString(36).slice(2);
const joinTopic = base + "/up";
const stateTopic = base + "/state";
const socks = [];
function connect() {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(endpoint);
    socks.push(ws);
    const timer = setTimeout(() => reject(new Error("WebSocket connect timed out")), 20000);
    ws.addEventListener("open", () => { clearTimeout(timer); resolve(ws); }, { once: true });
    ws.addEventListener("error", () => { clearTimeout(timer); reject(new Error("WebSocket connection error")); }, { once: true });
  });
}
function send(ws, data) { ws.send(JSON.stringify(data)); }
function delay(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }
async function main() {
  const host = await connect();
  send(host, { type: "sub", topics: [joinTopic] });
  let joins = new Set();
  let states = new Set();
  let confirms = new Set();
  host.addEventListener("message", (event) => {
    let data; try { data = JSON.parse(event.data); } catch (_) { return; }
    if (data.topic === joinTopic && Number.isInteger(data.obj?.i)) {
      joins.add(data.obj.i);
      send(host, { type: "publish", topic: base + "/pl/" + data.obj.i, obj: { ok: true, i: data.obj.i } });
    }
  });
  const clients = await Promise.all(Array.from({ length: size }, () => connect()));
  clients.forEach((ws, i) => {
    ws.addEventListener("message", (event) => {
      let data; try { data = JSON.parse(event.data); } catch (_) { return; }
      if (data.topic === stateTopic) states.add(i);
      if (data.topic === base + "/pl/" + i) confirms.add(i);
    });
    send(ws, { type: "sub", topics: [stateTopic, base + "/pl/" + i] });
  });
  await delay(700);
  send(host, { type: "publish", topic: stateTopic, obj: { phase: "lobby" }, retain: true });
  clients.forEach((ws, i) => send(ws, { type: "publish", topic: joinTopic, obj: { ty: "join", i } }));
  const until = Date.now() + 25000;
  while (Date.now() < until && (joins.size < size || states.size < size || confirms.size < size)) await delay(200);
  console.log("Connections:", clients.length + 1, "joins:", joins.size, "states:", states.size, "acks:", confirms.size, "of", size);
  if (joins.size !== size || states.size !== size || confirms.size !== size)
    throw new Error("Load test failed: some messages did not arrive");
  console.log("OK: all simulated classmates received their game state and registration acknowledgment.");
}
try { await main(); }
catch (err) { console.error(err.message); process.exitCode = 1; }
finally { for (const ws of socks) try { ws.close(); } catch (_) {} }
