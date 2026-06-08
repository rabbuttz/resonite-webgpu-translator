import {
  AutoProcessor,
  Gemma4ForConditionalGeneration,
} from "https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.2.0/dist/transformers.min.js";

const $ = (id) => document.getElementById(id);
const ui = {
  targetUser: $("target-user"),
  userList:   $("user-list"),
  start:      $("start"),
  stop:       $("stop"),
  refresh:    $("refresh-users"),
  liveMode:   $("live-mode"),
  relayStat:  $("relay-status"),
  modelStat:  $("model-status"),
  recStat:    $("rec-status"),
  pubStat:    $("publish-status"),
  interim:    $("interim"),
  original:   $("original"),
  translated: $("translated"),
  history:    $("history"),
};

const params = new URLSearchParams(location.search);
const MODEL_ID = params.get("model") || "onnx-community/gemma-4-E2B-it-ONNX";
const requestedContextLimit = Number(params.get("context") || 5);
const CONTEXT_LIMIT = Number.isFinite(requestedContextLimit)
  ? Math.max(0, Math.min(10, requestedContextLimit))
  : 5;

const LANGUAGE = (() => {
  const primary = (navigator.languages?.[0] ?? navigator.language ?? "en").toLowerCase();
  return primary.startsWith("ja") ? "ja" : "en";
})();
const DEFAULT_DIRECTION = LANGUAGE === "ja" ? "ja2en" : "en2ja";

const TEXT = {
  ja: {
    documentTitle: "Resonite Translator (JP<->EN)",
    subtitle: "Web Speech API + Gemma 4 E2B (WebGPU)",
    viewerLink: "受信テストページ →",
    targetUserLabel: "送信先 Resonite ユーザー名",
    targetUserPlaceholder: "例: alice",
    directionLegend: "翻訳方向",
    liveModeLabel: "リアルタイム翻訳テスト機能 (interim も逐次翻訳して送る)",
    refreshUsers: "接続中ユーザー再取得",
    relayLabel: "中継",
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
    modelReady: "Ready ({model} / WebGPU / context={context})",
    modelLoadFailed: "ロード失敗: {message}",
    translateFailed: "翻訳失敗: {message}",
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
    relaySameOrigin: "同一オリジン",
  },
  en: {
    documentTitle: "Resonite Translator (EN<->JP)",
    subtitle: "Web Speech API + Gemma 4 E2B (WebGPU)",
    viewerLink: "Receiver test page →",
    targetUserLabel: "Target Resonite username",
    targetUserPlaceholder: "e.g. alice",
    directionLegend: "Translation direction",
    liveModeLabel: "Experimental real-time translation (also translates and sends interim results)",
    refreshUsers: "Refresh connected users",
    relayLabel: "Relay",
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
    modelReady: "Ready ({model} / WebGPU / context={context})",
    modelLoadFailed: "Load failed: {message}",
    translateFailed: "Translation failed: {message}",
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
    relaySameOrigin: "same origin",
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

const DEFAULT_RELAY_BASE =
  location.protocol === "file:" || location.hostname.endsWith("github.io")
    ? "http://localhost:8080"
    : location.origin;

function normalizeRelayBase(value) {
  return value.replace(/\/+$/, "");
}

const RELAY_BASE = normalizeRelayBase(params.get("relay") || DEFAULT_RELAY_BASE);

function relayUrl(path) {
  return new URL(path, RELAY_BASE);
}

ui.relayStat.textContent = RELAY_BASE === location.origin ? t("relaySameOrigin") : RELAY_BASE;

const getDirection = () => document.querySelector('input[name="dir"]:checked').value;

(function prefillUserFromURL() {
  const qUser = params.get("user");
  if (qUser) { ui.targetUser.value = qUser; return; }
  const path = decodeURIComponent(location.pathname).replace(/^\/+|\/+$/g, "");
  if (path && path !== "index.html") ui.targetUser.value = path;
})();

let recognition = null;
let recognizing = false;
let wantRunning = false;
let pendingJob = null;
let workerRunning = false;
let lastTranslatedText = "";
let contextHistory = [];
let processor = null;
let model = null;

function recentContext() {
  return CONTEXT_LIMIT === 0 ? [] : contextHistory.slice(-CONTEXT_LIMIT);
}

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

  try {
    processor = await AutoProcessor.from_pretrained(MODEL_ID, {
      progress_callback: onProgress,
    });
    model = await Gemma4ForConditionalGeneration.from_pretrained(MODEL_ID, {
      dtype: "q4f16",
      device: "webgpu",
      progress_callback: onProgress,
    });
    ui.modelStat.textContent = t("modelReady", { model: MODEL_ID, context: CONTEXT_LIMIT });
    ui.start.disabled = false;
  } catch (e) {
    ui.modelStat.textContent = t("modelLoadFailed", { message: e.message ?? e });
    throw e;
  }
}

function buildTranslationMessages(text, direction) {
  const target = direction === "ja2en" ? "English" : "Japanese";
  const source = direction === "ja2en" ? "Japanese" : "English";
  const recent = recentContext()
    .map((item, i) => {
      const itemDirection = item.direction === "en2ja" ? "English to Japanese" : "Japanese to English";
      return `${i + 1}. Direction: ${itemDirection}\nSource: ${item.original}\nTranslation: ${item.translated}`;
    })
    .join("\n\n");

  const instructions = [
    `You are a live ${source}-to-${target} speech translator for VR subtitles.`,
    `Translate only into ${target}.`,
    "Use the recent context to preserve names, pronouns, terminology, and topic continuity.",
    "Return only the translated text. Do not explain, label, romanize, quote, or add alternatives.",
  ].join("\n");

  const userText = recent
    ? `Recent context, oldest to newest:\n${recent}\n\nTranslate this ${source} text into ${target}:\n${text}`
    : `Translate this ${source} text into ${target}:\n${text}`;

  return [
    { role: "system", content: instructions },
    { role: "user", content: userText },
  ];
}

function cleanTranslation(text) {
  return String(text || "")
    .trim()
    .replace(/^["'「『]+|["'」』]+$/g, "")
    .trim();
}

async function encodePrompt(prompt) {
  try {
    return await processor(prompt, null, null, { add_special_tokens: false });
  } catch {
    return await processor(prompt, { add_special_tokens: false });
  }
}

async function translateText(text, direction) {
  if (!processor || !model) throw new Error("model not loaded");
  const messages = buildTranslationMessages(text, direction);
  const prompt = processor.apply_chat_template(messages, {
    enable_thinking: false,
    add_generation_prompt: true,
  });
  const inputs = await encodePrompt(prompt);
  const output = await model.generate({
    ...inputs,
    max_new_tokens: 256,
    do_sample: false,
  });
  const inputLength = inputs.input_ids.dims.at(-1);
  const generated = output.slice(null, [inputLength, null]);
  const decoded = processor.batch_decode(generated, { skip_special_tokens: true });
  return cleanTranslation(decoded[0]);
}

async function publish(payload) {
  const user = ui.targetUser.value.trim();
  if (!user) { ui.pubStat.textContent = t("userMissing"); return; }
  try {
    const url = relayUrl("/publish");
    url.searchParams.set("user", user);
    const r = await fetch(url, {
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
      let translatedOk = false;
      try {
        translated = await translateText(job.text, job.direction);
        translatedOk = true;
      } catch (e) {
        translated = "[error] " + t("translateFailed", { message: e.message ?? e });
      }
      lastTranslatedText = job.text;
      ui.translated.textContent = translated;

      if (job.isFinal) {
        appendHistory(job.text, translated, job.direction);
        if (translatedOk) {
          contextHistory.push({
            original: job.text,
            translated,
            direction: job.direction,
          });
          contextHistory = recentContext();
        }
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
    const r = await fetch(relayUrl("/users"));
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
} else if (!(window.SpeechRecognition || window.webkitSpeechRecognition)) {
  ui.recStat.textContent = t("recognitionUnsupported");
} else {
  loadModel().catch(() => {});
}
