import { pipeline, env } from "https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.2.0/dist/transformers.min.js";

env.allowLocalModels = false;

const MODEL_ID = "onnx-community/LFM2-350M-ENJP-MT-ONNX";

const $ = (id) => document.getElementById(id);
const ui = {
  targetUser: $("target-user"),
  userList:   $("user-list"),
  start:      $("start"),
  stop:       $("stop"),
  refresh:    $("refresh-users"),
  liveMode:   $("live-mode"),
  modelStat:  $("model-status"),
  recStat:    $("rec-status"),
  pubStat:    $("publish-status"),
  interim:    $("interim"),
  original:   $("original"),
  translated: $("translated"),
  history:    $("history"),
};

const LANGUAGE = (() => {
  const primary = (navigator.languages?.[0] ?? navigator.language ?? "en").toLowerCase();
  return primary.startsWith("ja") ? "ja" : "en";
})();
const DEFAULT_DIRECTION = LANGUAGE === "ja" ? "ja2en" : "en2ja";

const TEXT = {
  ja: {
    documentTitle: "Resonite Translator (JP<->EN)",
    subtitle: "Web Speech API + LFM2-350M-ENJP-MT (WebGPU)",
    viewerLink: "受信テストページ →",
    targetUserLabel: "送信先 Resonite ユーザー名",
    targetUserPlaceholder: "例: alice",
    directionLegend: "翻訳方向",
    liveModeLabel: "リアルタイム翻訳テスト機能 (interim も逐次翻訳して送る)",
    refreshUsers: "接続中ユーザー再取得",
    modelLabel: "モデル",
    recognitionLabel: "認識",
    publishLabel: "最終配信",
    modelInitial: "未ロード",
    recStopped: "停止",
    liveTitle: "ライブ",
    interimLabel: "途中 (interim)",
    originalLabel: "原文",
    translatedLabel: "訳文",
    historyTitle: "履歴",
    modelLoading: "ロード中...",
    modelLoadingFile: "ロード中 {file} {pct}%",
    modelReady: "Ready ({device} / {dtype})",
    modelLoadFailed: "ロード失敗: {message}",
    userMissing: "ユーザー名未入力",
    publishStatus: "{time}  delivered={delivered}",
    publishFailed: "送信失敗 {status}",
    publishError: "送信エラー: {message}",
    recognitionUnsupported: "未対応 (Chrome を使ってください)",
    recognitionRunning: "認識中 ({lang}, restarts={count})",
    recognitionError: "エラー: {message}",
    recognitionRestartWait: "再起動中 ({delay}ms 待機, fails={count})",
    recognitionRestarting: "再起動中 (restarts={count})",
    webgpuUnsupported: "WebGPU 非対応のブラウザです (Chrome 推奨)",
  },
  en: {
    documentTitle: "Resonite Translator (EN<->JP)",
    subtitle: "Web Speech API + LFM2-350M-ENJP-MT (WebGPU)",
    viewerLink: "Receiver test page →",
    targetUserLabel: "Target Resonite username",
    targetUserPlaceholder: "e.g. alice",
    directionLegend: "Translation direction",
    liveModeLabel: "Experimental real-time translation (also translates and sends interim results)",
    refreshUsers: "Refresh connected users",
    modelLabel: "Model",
    recognitionLabel: "Recognition",
    publishLabel: "Last publish",
    modelInitial: "Not loaded",
    recStopped: "Stopped",
    liveTitle: "Live",
    interimLabel: "Interim",
    originalLabel: "Original",
    translatedLabel: "Translation",
    historyTitle: "History",
    modelLoading: "Loading...",
    modelLoadingFile: "Loading {file} {pct}%",
    modelReady: "Ready ({device} / {dtype})",
    modelLoadFailed: "Load failed: {message}",
    userMissing: "Username is required",
    publishStatus: "{time}  delivered={delivered}",
    publishFailed: "Publish failed {status}",
    publishError: "Publish error: {message}",
    recognitionUnsupported: "Not supported (use Chrome)",
    recognitionRunning: "Recognizing ({lang}, restarts={count})",
    recognitionError: "Error: {message}",
    recognitionRestartWait: "Restarting ({delay}ms wait, fails={count})",
    recognitionRestarting: "Restarting (restarts={count})",
    webgpuUnsupported: "This browser does not support WebGPU (Chrome recommended)",
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
  const radio = document.querySelector(`input[name="dir"][value="${DEFAULT_DIRECTION}"]`);
  if (radio) radio.checked = true;
}

applyLocale();

const getDirection = () => document.querySelector('input[name="dir"]:checked').value;

(function prefillUserFromURL() {
  const qUser = new URLSearchParams(location.search).get("user");
  if (qUser) { ui.targetUser.value = qUser; return; }
  const path = decodeURIComponent(location.pathname).replace(/^\/+|\/+$/g, "");
  if (path && path !== "index.html") ui.targetUser.value = path;
})();

let translator = null;
let recognition = null;
let recognizing = false;
let wantRunning = false;
let pendingJob = null;
let workerRunning = false;
let lastTranslatedText = "";

async function loadModel() {
  ui.modelStat.textContent = t("modelLoading");
  const onProgress = (p) => {
    if (p?.status === "progress" && p.file) {
      const pct = p.total ? Math.round((p.loaded / p.total) * 100) : 0;
      ui.modelStat.textContent = t("modelLoadingFile", { file: p.file, pct });
    } else if (p?.status) {
      ui.modelStat.textContent = `${p.status}${p.file ? " " + p.file : ""}`;
    }
  };
  const variants = [
    { device: "webgpu", dtype: "q4" },
    { device: "webgpu", dtype: "fp16" },
    { device: "webgpu", dtype: "q8" },
    { device: "wasm",   dtype: "q4" },
  ];
  let lastErr = null;
  for (const v of variants) {
    try {
      translator = await pipeline("text-generation", MODEL_ID, {
        ...v,
        progress_callback: onProgress,
      });
      ui.modelStat.textContent = t("modelReady", v);
      lastErr = null;
      break;
    } catch (e) {
      console.warn(`load failed (${v.device}/${v.dtype}):`, e);
      lastErr = e;
    }
  }
  if (lastErr) {
    ui.modelStat.textContent = t("modelLoadFailed", { message: lastErr.message ?? lastErr });
    throw lastErr;
  }
  ui.start.disabled = false;
}

async function translateText(text, direction) {
  const systemPrompt = direction === "ja2en" ? "Translate to English." : "Translate to Japanese.";
  const messages = [
    { role: "system", content: systemPrompt },
    { role: "user",   content: text },
  ];
  const out = await translator(messages, {
    max_new_tokens: 256,
    do_sample: false,
    temperature: 0,
    repetition_penalty: 1.15,
    no_repeat_ngram_size: 3,
    return_full_text: false,
  });
  return extractText(out);
}

function extractText(out) {
  if (!out) return "";
  const first = Array.isArray(out) ? out[0] : out;
  if (typeof first === "string") return first.trim();
  const g = first?.generated_text;
  if (typeof g === "string") return g.trim();
  if (Array.isArray(g)) {
    const last = g[g.length - 1];
    return (last?.content ?? "").trim();
  }
  return (first?.text ?? "").trim();
}

async function publish(payload) {
  const user = ui.targetUser.value.trim();
  if (!user) { ui.pubStat.textContent = t("userMissing"); return; }
  try {
    const r = await fetch("/publish?user=" + encodeURIComponent(user), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!r.ok) { ui.pubStat.textContent = t("publishFailed", { status: r.status }); return; }
    const j = await r.json();
    ui.pubStat.textContent = t("publishStatus", {
      time: new Date().toLocaleTimeString(),
      delivered: j.delivered,
    });
  } catch (e) {
    ui.pubStat.textContent = t("publishError", { message: e.message ?? e });
  }
}

function appendHistory(original, translated, direction) {
  const li = document.createElement("li");
  li.innerHTML = `<span class="o"></span> <br><span class="t"></span> <small class="o"></small>`;
  li.querySelector(".o").textContent = original;
  li.querySelector(".t").textContent = translated;
  li.querySelector("small").textContent = ` [${direction}]`;
  ui.history.prepend(li);
  while (ui.history.children.length > 50) ui.history.lastChild.remove();
}

function enqueueLive(text, isFinal, direction) {
  if (!text) return;
  pendingJob = { text, isFinal, direction };
  runWorker();
}

async function runWorker() {
  if (workerRunning) return;
  workerRunning = true;
  try {
    while (pendingJob) {
      const job = pendingJob;
      pendingJob = null;

      if (!job.isFinal && job.text === lastTranslatedText) continue;

      ui.original.textContent = job.text;
      ui.translated.textContent = "...";
      let translated = "";
      try {
        translated = await translateText(job.text, job.direction);
      } catch (e) {
        translated = "[error] " + (e.message ?? e);
      }
      lastTranslatedText = job.text;
      ui.translated.textContent = translated;

      if (job.isFinal) {
        appendHistory(job.text, translated, job.direction);
        lastTranslatedText = "";
      }

      await publish({
        original: job.text,
        translated,
        direction: job.direction,
        partial: !job.isFinal,
      });
    }
  } finally {
    workerRunning = false;
  }
}

let restartCount = 0;
let lastEndAt = 0;
let consecutiveFastFails = 0;
let gotResultSinceStart = false;
let restartTimer = null;

function buildRecognition() {
  const Ctor = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!Ctor) {
    ui.recStat.textContent = t("recognitionUnsupported");
    ui.start.disabled = true;
    return null;
  }
  const r = new Ctor();
  r.continuous = true;
  r.interimResults = true;
  r.lang = getDirection() === "ja2en" ? "ja-JP" : "en-US";

  r.onstart = () => {
    recognizing = true;
    gotResultSinceStart = false;
    ui.recStat.textContent = t("recognitionRunning", { lang: r.lang, count: restartCount });
    console.log("[recognition] start", r.lang);
  };

  r.onerror = (e) => {
    console.warn("[recognition] error", e.error);
    ui.recStat.textContent = t("recognitionError", { message: e.error });
    if (e.error === "not-allowed" || e.error === "audio-capture" || e.error === "service-not-allowed") {
      wantRunning = false;
      ui.start.disabled = false;
      ui.stop.disabled  = true;
    }
  };

  r.onend = () => {
    recognizing = false;
    const now = Date.now();
    const sinceLast = now - lastEndAt;
    lastEndAt = now;

    if (gotResultSinceStart || sinceLast > 1500) {
      consecutiveFastFails = 0;
    } else {
      consecutiveFastFails++;
    }
    console.log(`[recognition] end (sinceLastEnd=${sinceLast}ms, gotResult=${gotResultSinceStart}, fastFails=${consecutiveFastFails})`);

    if (!wantRunning) {
      ui.recStat.textContent = t("recStopped");
      return;
    }

    const delay = consecutiveFastFails === 0
      ? 250
      : Math.min(500 * Math.pow(2, consecutiveFastFails - 1), 5000);
    ui.recStat.textContent = consecutiveFastFails > 0
      ? t("recognitionRestartWait", { delay, count: consecutiveFastFails })
      : t("recognitionRestarting", { count: restartCount + 1 });

    if (restartTimer) clearTimeout(restartTimer);
    restartTimer = setTimeout(() => {
      restartTimer = null;
      if (!wantRunning || recognizing) return;
      restartCount++;
      recognition = buildRecognition();
      if (!recognition) return;
      try { recognition.start(); }
      catch (err) { console.error("[recognition] start failed", err); }
    }, delay);
  };

  r.onresult = (ev) => {
    gotResultSinceStart = true;
    const live = ui.liveMode.checked;
    const direction = getDirection();
    const last = ev.results[ev.results.length - 1];
    const text = last[0].transcript.trim();
    ui.interim.textContent = last.isFinal ? "" : text;
    if (!text) return;
    if (last.isFinal) {
      enqueueLive(text, true, direction);
    } else if (live) {
      enqueueLive(text, false, direction);
    }
  };
  return r;
}

function setRunning(on) {
  wantRunning = on;
  if (on) {
    restartCount = 0;
    if (!recognition) recognition = buildRecognition();
    if (!recognition) return;
    recognition.lang = getDirection() === "ja2en" ? "ja-JP" : "en-US";
    try { recognition.start(); }
    catch (e) { console.warn("initial start failed", e); }
    ui.start.disabled = true;
    ui.stop.disabled = false;
  } else {
    if (recognition && recognizing) {
      try { recognition.stop(); } catch {}
    }
    ui.start.disabled = false;
    ui.stop.disabled = true;
  }
}


async function refreshUsers() {
  try {
    const r = await fetch("/users");
    const list = await r.json();
    ui.userList.innerHTML = "";
    for (const u of list) {
      const opt = document.createElement("option");
      opt.value = u;
      ui.userList.appendChild(opt);
    }
  } catch (e) {
    console.warn("refresh users failed", e);
  }
}

ui.start.addEventListener("click", () => setRunning(true));
ui.stop.addEventListener("click",  () => setRunning(false));
ui.refresh.addEventListener("click", refreshUsers);
document.querySelectorAll('input[name="dir"]').forEach((el) => {
  el.addEventListener("change", () => {
    if (!recognition) return;
    recognition.lang = getDirection() === "ja2en" ? "ja-JP" : "en-US";
    if (recognizing) {
      console.log("[recognition] direction changed, restarting to apply lang");
      try { recognition.stop(); } catch {}
    }
  });
});

refreshUsers();
setInterval(refreshUsers, 5000);

if (!("gpu" in navigator)) {
  ui.modelStat.textContent = t("webgpuUnsupported");
} else {
  loadModel().catch(() => {});
}
