"use strict";

// Бесплатный локальный сервер викторины: сайт + обмен сообщениями по WebSocket.
// Только для учебной локальной сети. Не публикуйте порт 8080 в интернете.

const http = require("http");
const fs = require("fs");
const path = require("path");
const os = require("os");
const crypto = require("crypto");

const PORT = Number(process.env.PORT || 8080);
const WEB_ROOT = path.resolve(__dirname, "..", "live");
const WS_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";
const MAX_FRAME = 1024 * 1024;
const clients = new Set();
const retained = new Map();

const mime = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2"
};

function sendHttp(res, status, text) {
  res.writeHead(status, { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" });
  res.end(text);
}

const server = http.createServer((req, res) => {
  let pathname;
  try { pathname = decodeURIComponent(new URL(req.url, "http://localhost").pathname); }
  catch (_) { return sendHttp(res, 400, "Bad request"); }

  let file = path.resolve(WEB_ROOT, "." + pathname);
  if (file !== WEB_ROOT && !file.startsWith(WEB_ROOT + path.sep)) return sendHttp(res, 403, "Forbidden");
  try {
    if (fs.statSync(file).isDirectory()) file = path.join(file, "index.html");
  } catch (_) {}
  fs.readFile(file, (err, data) => {
    if (err) return sendHttp(res, 404, "Not found");
    res.writeHead(200, {
      "Content-Type": mime[path.extname(file).toLowerCase()] || "application/octet-stream",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff"
    });
    res.end(data);
  });
});

function frame(opcode, data) {
  const payload = Buffer.isBuffer(data) ? data : Buffer.from(data || "");
  let header;
  if (payload.length < 126) {
    header = Buffer.from([0x80 | opcode, payload.length]);
  } else if (payload.length <= 0xffff) {
    header = Buffer.alloc(4);
    header[0] = 0x80 | opcode; header[1] = 126; header.writeUInt16BE(payload.length, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x80 | opcode; header[1] = 127; header.writeBigUInt64BE(BigInt(payload.length), 2);
  }
  return Buffer.concat([header, payload]);
}

function send(ws, obj) {
  if (ws.destroyed || !ws.writable) return;
  try { ws.write(frame(1, JSON.stringify(obj))); } catch (_) { closeClient(ws); }
}

function closeClient(ws) {
  for (const c of clients) {
    if (c.socket === ws) { clients.delete(c); break; }
  }
  try { ws.destroy(); } catch (_) {}
}

function publish(client, msg) {
  if (typeof msg.topic !== "string" || msg.topic.length > 240 || !Object.prototype.hasOwnProperty.call(msg, "obj")) return;
  let encoded;
  try { encoded = JSON.stringify({ type: "message", topic: msg.topic, obj: msg.obj, retained: false }); }
  catch (_) { return; }
  if (Buffer.byteLength(encoded) > MAX_FRAME) return;
  if (msg.retain) {
    if (msg.obj === null) retained.delete(msg.topic);
    else {
      retained.set(msg.topic, msg.obj);
      if (retained.size > 1000) retained.delete(retained.keys().next().value);
    }
  }
  for (const c of clients) {
    if (c.subs.has(msg.topic)) send(c.socket, { type: "message", topic: msg.topic, obj: msg.obj, retained: false });
  }
}

function handleMessage(client, payload) {
  let msg;
  try { msg = JSON.parse(payload.toString("utf8")); } catch (_) { return; }
  if (!msg || typeof msg !== "object") return;
  if (msg.type === "sub" && Array.isArray(msg.topics)) {
    for (const topic of msg.topics.slice(0, 100)) {
      if (typeof topic !== "string" || topic.length > 240) continue;
      client.subs.add(topic);
      if (retained.has(topic)) send(client.socket, { type: "message", topic, obj: retained.get(topic), retained: true });
    }
  } else if (msg.type === "publish") {
    publish(client, msg);
  }
}

function parseFrames(client, chunk) {
  client.buffer = Buffer.concat([client.buffer, chunk]);
  if (client.buffer.length > MAX_FRAME + 14) return closeClient(client.socket);

  while (client.buffer.length >= 2) {
    const b0 = client.buffer[0], b1 = client.buffer[1];
    const opcode = b0 & 0x0f, masked = (b1 & 0x80) !== 0;
    let len = b1 & 0x7f, offset = 2;
    if (len === 126) {
      if (client.buffer.length < 4) return;
      len = client.buffer.readUInt16BE(2); offset = 4;
    } else if (len === 127) {
      if (client.buffer.length < 10) return;
      const big = client.buffer.readBigUInt64BE(2);
      if (big > BigInt(MAX_FRAME)) return closeClient(client.socket);
      len = Number(big); offset = 10;
    }
    if (!masked) return closeClient(client.socket);
    if (len > MAX_FRAME) return closeClient(client.socket);
    if (client.buffer.length < offset + 4 + len) return;
    const mask = client.buffer.subarray(offset, offset + 4); offset += 4;
    const data = Buffer.from(client.buffer.subarray(offset, offset + len));
    for (let i = 0; i < data.length; i++) data[i] ^= mask[i & 3];
    client.buffer = client.buffer.subarray(offset + len);

    if (opcode === 8) return closeClient(client.socket);
    if (opcode === 9) { try { client.socket.write(frame(10, data)); } catch (_) {} continue; }
    if (opcode === 1) handleMessage(client, data);
    // Приложение отправляет небольшие JSON-сообщения одним WebSocket-кадром.
  }
}

server.on("upgrade", (req, socket, head) => {
  let pathname;
  try { pathname = new URL(req.url, "http://localhost").pathname; } catch (_) { socket.destroy(); return; }
  if (pathname !== "/ws" || !req.headers["sec-websocket-key"]) { socket.destroy(); return; }
  const accept = crypto.createHash("sha1").update(req.headers["sec-websocket-key"] + WS_GUID).digest("base64");
  socket.write(
    "HTTP/1.1 101 Switching Protocols\r\n" +
    "Upgrade: websocket\r\n" +
    "Connection: Upgrade\r\n" +
    "Sec-WebSocket-Accept: " + accept + "\r\n\r\n"
  );
  const client = { socket, subs: new Set(), buffer: Buffer.alloc(0) };
  clients.add(client);
  socket.on("data", (chunk) => parseFrames(client, chunk));
  socket.on("error", () => closeClient(socket));
  socket.on("close", () => { clients.delete(client); });
  if (head && head.length) parseFrames(client, head);
});

server.listen(PORT, "0.0.0.0", () => {
  console.log("\nВикторина запущена в локальной сети. Порт: " + PORT);
  console.log("Оставьте это окно открытым на всё время занятия.\n");
  const nets = os.networkInterfaces();
  for (const entries of Object.values(nets)) {
    for (const n of entries || []) {
      if (n.family === "IPv4" && !n.internal) {
        console.log("Учебный класс 1: http://" + n.address + ":" + PORT + "/?room=class1&lan=1");
        console.log("Учебный класс 2: http://" + n.address + ":" + PORT + "/?room=class2&lan=1");
        console.log("Экран ведущего 1: http://" + n.address + ":" + PORT + "/screen.html?room=class1&lan=1");
        console.log("Экран ведущего 2: http://" + n.address + ":" + PORT + "/screen.html?room=class2&lan=1\n");
      }
    }
  }
});
