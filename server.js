import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocketServer } from "ws";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, "public");
const PORT = Number(process.env.PORT ?? 8080);

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js":   "text/javascript; charset=utf-8",
  ".css":  "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg":  "image/svg+xml",
  ".ico":  "image/x-icon",
};

const channels = new Map();

function addClient(user, ws) {
  let set = channels.get(user);
  if (!set) {
    set = new Set();
    channels.set(user, set);
  }
  set.add(ws);
}

function removeClient(user, ws) {
  const set = channels.get(user);
  if (!set) return;
  set.delete(ws);
  if (set.size === 0) channels.delete(user);
}

function broadcast(user, text) {
  const set = channels.get(user);
  if (!set || set.size === 0) return 0;
  let n = 0;
  for (const ws of set) {
    if (ws.readyState === 1) {
      ws.send(text);
      n++;
    }
  }
  return n;
}

function readBody(req, limit = 64 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    req.on("data", (c) => {
      total += c.length;
      if (total > limit) {
        reject(new Error("body too large"));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function sendJson(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body),
    "cache-control": "no-store",
  });
  res.end(body);
}

function serveStatic(req, res) {
  const url = new URL(req.url, "http://localhost");
  let rel = decodeURIComponent(url.pathname);
  if (rel === "/") rel = "/index.html";
  const filePath = path.join(PUBLIC_DIR, rel);
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403); res.end("forbidden"); return;
  }
  fs.stat(filePath, (err, st) => {
    if (err || !st.isFile()) { res.writeHead(404); res.end("not found"); return; }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, {
      "content-type": MIME[ext] ?? "application/octet-stream",
      "content-length": st.size,
      "cache-control": "no-cache",
    });
    fs.createReadStream(filePath).pipe(res);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");

  if (req.method === "GET" && url.pathname === "/users") {
    sendJson(res, 200, [...channels.keys()].sort());
    return;
  }

  if (req.method === "POST" && url.pathname === "/publish") {
    const user = url.searchParams.get("user");
    if (!user) { sendJson(res, 400, { error: "user required" }); return; }
    try {
      const raw = await readBody(req);
      let data;
      try { data = JSON.parse(raw); }
      catch { sendJson(res, 400, { error: "invalid json" }); return; }
      const original   = typeof data.original   === "string" ? data.original   : "";
      const translated = typeof data.translated === "string" ? data.translated : "";
      const text = `${original}\n${translated}`;
      const delivered = broadcast(user, text);
      sendJson(res, 200, { delivered });
    } catch (e) {
      sendJson(res, 400, { error: String(e.message ?? e) });
    }
    return;
  }

  if (req.method === "GET") {
    serveStatic(req, res);
    return;
  }

  res.writeHead(405); res.end("method not allowed");
});

const wss = new WebSocketServer({ noServer: true });

server.on("upgrade", (req, socket, head) => {
  const url = new URL(req.url, "http://localhost");
  const user = decodeURIComponent(url.pathname.replace(/^\/+/, ""));
  if (!user) {
    socket.write("HTTP/1.1 400 Bad Request\r\n\r\n");
    socket.destroy();
    return;
  }
  wss.handleUpgrade(req, socket, head, (ws) => {
    ws.resoniteUser = user;
    addClient(user, ws);
    ws.on("close", () => removeClient(user, ws));
    ws.on("error", () => removeClient(user, ws));
  });
});

server.listen(PORT, () => {
  console.log(`[resonite-translator] http+ws listening on :${PORT}`);
  console.log(`  open      http://localhost:${PORT}/`);
  console.log(`  resonite  ws://<host>:${PORT}/<resonite-username>`);
});
