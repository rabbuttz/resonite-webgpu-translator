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

const getDirection = () => document.querySelector('input[name="dir"]:checked').value;

let translator = null;
let recognition = null;
let recognizing = false;
let wantRunning = false;
let pendingJob = null;
let workerRunning = false;
let lastTranslatedText = "";

async function loadModel() {
  ui.modelStat.textContent = "ロード中...";
  const onProgress = (p) => {
    if (p?.status === "progress" && p.file) {
      const pct = p.total ? Math.round((p.loaded / p.total) * 100) : 0;
      ui.modelStat.textContent = `ロード中 ${p.file} ${pct}%`;
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
      ui.modelStat.textContent = `Ready (${v.device} / ${v.dtype})`;
      lastErr = null;
      break;
    } catch (e) {
      console.warn(`load failed (${v.device}/${v.dtype}):`, e);
      lastErr = e;
    }
  }
  if (lastErr) {
    ui.modelStat.textContent = "ロード失敗: " + (lastErr.message ?? lastErr);
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
  if (!user) { ui.pubStat.textContent = "ユーザー名未入力"; return; }
  try {
    const r = await fetch("/publish?user=" + encodeURIComponent(user), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!r.ok) { ui.pubStat.textContent = "送信失敗 " + r.status; return; }
    const j = await r.json();
    ui.pubStat.textContent = `${new Date().toLocaleTimeString()}  delivered=${j.delivered}`;
  } catch (e) {
    ui.pubStat.textContent = "送信エラー: " + (e.message ?? e);
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

function buildRecognition() {
  const Ctor = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!Ctor) {
    ui.recStat.textContent = "未対応 (Chrome を使ってください)";
    ui.start.disabled = true;
    return null;
  }
  const r = new Ctor();
  r.continuous = true;
  r.interimResults = true;
  r.lang = getDirection() === "ja2en" ? "ja-JP" : "en-US";

  r.onstart = () => { recognizing = true; ui.recStat.textContent = `認識中 (${r.lang})`; };
  r.onerror = (e) => { ui.recStat.textContent = "エラー: " + e.error; };
  r.onend = () => {
    recognizing = false;
    ui.recStat.textContent = "停止";
    if (wantRunning) {
      setTimeout(() => { try { r.start(); } catch {} }, 250);
    }
  };
  r.onresult = (ev) => {
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
    if (!recognition) recognition = buildRecognition();
    if (!recognition) return;
    recognition.lang = getDirection() === "ja2en" ? "ja-JP" : "en-US";
    try { recognition.start(); } catch {}
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
    if (recognition) recognition.lang = getDirection() === "ja2en" ? "ja-JP" : "en-US";
  });
});

refreshUsers();
setInterval(refreshUsers, 5000);

if (!("gpu" in navigator)) {
  ui.modelStat.textContent = "WebGPU 非対応のブラウザです (Chrome 推奨)";
} else {
  loadModel().catch(() => {});
}
