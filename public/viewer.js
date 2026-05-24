const $ = (id) => document.getElementById(id);
const ui = {
  user:       $("user"),
  connect:    $("connect"),
  disconnect: $("disconnect"),
  clear:      $("clear"),
  conn:       $("conn"),
  count:      $("count"),
  latest:     $("latest"),
  history:    $("history"),
};

let ws = null;
let received = 0;

const params = new URLSearchParams(location.search);
if (params.get("user")) ui.user.value = params.get("user");

function setState(s) {
  ui.conn.textContent = s;
}

function append(raw) {
  received++;
  ui.count.textContent = String(received);

  const idx = raw.indexOf("\n");
  const o = idx >= 0 ? raw.slice(0, idx) : raw;
  const t = idx >= 0 ? raw.slice(idx + 1) : "";

  if (t) ui.latest.textContent = t;

  const time = new Date().toLocaleTimeString();
  const li = document.createElement("li");
  const small = document.createElement("small");
  small.className = "o";
  small.textContent = ` ${time}`;
  const orig = document.createElement("div");
  orig.className = "o";
  orig.textContent = o;
  const trans = document.createElement("div");
  trans.className = "t";
  trans.textContent = t;
  li.appendChild(trans);
  li.appendChild(orig);
  li.appendChild(small);
  ui.history.prepend(li);
  while (ui.history.children.length > 100) ui.history.lastChild.remove();
}

function connect() {
  const user = ui.user.value.trim();
  if (!user) { setState("ユーザー名を入力してください"); return; }
  if (ws) try { ws.close(); } catch {}
  const proto = location.protocol === "https:" ? "wss:" : "ws:";
  const url = `${proto}//${location.host}/${encodeURIComponent(user)}`;
  setState(`接続中... (${url})`);
  ws = new WebSocket(url);
  ws.addEventListener("open", () => {
    setState(`OPEN (user=${user})`);
    ui.connect.disabled = true;
    ui.disconnect.disabled = false;
  });
  ws.addEventListener("message", (ev) => {
    append(typeof ev.data === "string" ? ev.data : "");
  });
  ws.addEventListener("close", (ev) => {
    setState(`CLOSED (code=${ev.code})`);
    ui.connect.disabled = false;
    ui.disconnect.disabled = true;
  });
  ws.addEventListener("error", () => {
    setState("ERROR");
  });
}

function disconnect() {
  if (ws) try { ws.close(); } catch {}
}

ui.connect.addEventListener("click", connect);
ui.disconnect.addEventListener("click", disconnect);
ui.clear.addEventListener("click", () => {
  ui.history.innerHTML = "";
  ui.latest.textContent = "";
  received = 0;
  ui.count.textContent = "0";
});
ui.user.addEventListener("keydown", (e) => {
  if (e.key === "Enter") connect();
});

if (params.get("user") && params.get("autoconnect") === "1") connect();
