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

const LANGUAGE = (() => {
  const primary = (navigator.languages?.[0] ?? navigator.language ?? "en").toLowerCase();
  return primary.startsWith("ja") ? "ja" : "en";
})();

const TEXT = {
  ja: {
    documentTitle: "Resonite Translator — 受信テスト",
    title: "Viewer (Resonite側の代わり)",
    subtitle: "指定ユーザー名の WebSocket チャンネルを購読して、受信メッセージを表示します。",
    userLabel: "受信するユーザー名",
    userPlaceholder: "例: alice",
    clear: "クリア",
    connectionLabel: "接続",
    disconnected: "未接続",
    countLabel: "受信件数",
    logTitle: "受信ログ",
    latestLabel: "最新 訳文",
    senderLink: "← 認識・送信ページへ",
    userMissing: "ユーザー名を入力してください",
    connecting: "接続中... ({url})",
    open: "OPEN (user={user})",
    closed: "CLOSED (code={code})",
    error: "ERROR",
  },
  en: {
    documentTitle: "Resonite Translator — Receiver test",
    title: "Viewer (Resonite receiver test)",
    subtitle: "Subscribe to a WebSocket channel by username and show received messages.",
    userLabel: "Username to receive",
    userPlaceholder: "e.g. alice",
    clear: "Clear",
    connectionLabel: "Connection",
    disconnected: "Disconnected",
    countLabel: "Received",
    logTitle: "Receive log",
    latestLabel: "Latest translation",
    senderLink: "← Recognition and sender page",
    userMissing: "Enter a username",
    connecting: "Connecting... ({url})",
    open: "OPEN (user={user})",
    closed: "CLOSED (code={code})",
    error: "ERROR",
  },
};

function t(key, vars = {}) {
  let text = TEXT[LANGUAGE][key] ?? TEXT.en[key] ?? key;
  for (const [name, value] of Object.entries(vars)) {
    text = text.replaceAll(`{${name}}`, String(value));
  }
  return text;
}

function applyLocale() {
  document.documentElement.lang = LANGUAGE;
  document.title = t("documentTitle");
  document.querySelectorAll("[data-i18n]").forEach((el) => {
    el.textContent = t(el.dataset.i18n);
  });
  document.querySelectorAll("[data-i18n-placeholder]").forEach((el) => {
    el.placeholder = t(el.dataset.i18nPlaceholder);
  });
}

applyLocale();

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
  if (!user) { setState(t("userMissing")); return; }
  if (ws) try { ws.close(); } catch {}
  const proto = location.protocol === "https:" ? "wss:" : "ws:";
  const url = `${proto}//${location.host}/${encodeURIComponent(user)}`;
  setState(t("connecting", { url }));
  ws = new WebSocket(url);
  ws.addEventListener("open", () => {
    setState(t("open", { user }));
    ui.connect.disabled = true;
    ui.disconnect.disabled = false;
  });
  ws.addEventListener("message", (ev) => {
    append(typeof ev.data === "string" ? ev.data : "");
  });
  ws.addEventListener("close", (ev) => {
    setState(t("closed", { code: ev.code }));
    ui.connect.disabled = false;
    ui.disconnect.disabled = true;
  });
  ws.addEventListener("error", () => {
    setState(t("error"));
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
