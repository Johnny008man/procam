/* ProCam — web camera with resolution modes, quality filters, pro controls and assistant */
"use strict";

const $ = (id) => document.getElementById(id);
const video = $("viewfinder");
const gridCanvas = $("grid");
const gctx = gridCanvas.getContext("2d");
const flash = $("flash");

let stream = null;
let track = null;
let facing = "environment";
let currentFilter = "none";
let shots = [];

/* ---------- camera start / resolution negotiation ---------- */

async function startCamera() {
  stopStream();
  const target = Number($("resSelect").value);
  const constraints = {
    audio: false,
    video: {
      facingMode: facing,
      width: { ideal: target },
      height: { ideal: target * 3 / 4 },
      frameRate: { ideal: 30 },
    },
  };
  try {
    stream = await navigator.mediaDevices.getUserMedia(constraints);
  } catch (e) {
    // fall back once at 1080p before giving up
    if (target > 1920) {
      $("resSelect").value = "1920";
      return startCamera();
    }
    return showError(e);
  }
  video.srcObject = stream;
  track = stream.getVideoTracks()[0];
  const s = track.getSettings();
  $("resBadge").textContent = `${s.width}×${s.height}${s.width >= 7680 ? " 8K" : s.width >= 3840 ? " 4K" : ""}`;
  applyCapabilities();
  startAssistants();
}

function stopStream() {
  if (stream) stream.getTracks().forEach((t) => t.stop());
  stream = null; track = null;
}

function showError(e) {
  $("resBadge").textContent = "no camera";
  $("hintBar").hidden = false;
  $("hintBar").textContent =
    "Camera access needed. Allow the camera permission, or open this page over HTTPS on your phone.";
  console.error(e);
}

$("resSelect").addEventListener("change", startCamera);
$("switchBtn").addEventListener("click", () => {
  facing = facing === "environment" ? "user" : "environment";
  startCamera();
});

/* ---------- pro mode: apply track capabilities ---------- */

function applyCapabilities() {
  if (!track) return;
  const caps = track.getCapabilities ? track.getCapabilities() : {};
  const setRange = (id, cap) => {
    const el = $(id);
    if (!cap || cap.min === undefined || cap.max === undefined) { el.disabled = true; return; }
    el.min = cap.min; el.max = cap.max; el.step = cap.step || 1; el.disabled = false;
  };
  setRange("ev", caps.exposureCompensation);
  setRange("iso", caps.iso);
  setRange("zoom", caps.zoom);
  if (!caps.colorTemperature) $("wb").disabled = true;
  if (!("torch" in caps)) $("torch").disabled = true;
  if (!("focusDistance" in caps)) $("infFocus").disabled = true;
}

$("ev").addEventListener("input", (e) => {
  const v = Number(e.target.value);
  $("evVal").textContent = v;
  track && tryApply({ exposureCompensation: v });
});
$("iso").addEventListener("input", (e) => {
  const v = Number(e.target.value);
  $("isoVal").textContent = v === 0 ? "auto" : v;
  track && tryApply(v ? { iso: v } : {});
});
$("zoom").addEventListener("input", (e) => {
  const v = Number(e.target.value) / 100;
  $("zoomVal").textContent = v.toFixed(1) + "×";
  track && tryApply({ zoom: v });
});
$("wb").addEventListener("input", (e) => {
  const v = Number(e.target.value);
  $("wbVal").textContent = v === 0 ? "auto" : `${v}K`;
  track && tryApply(v ? { whiteBalanceMode: "manual", colorTemperature: v } : { whiteBalanceMode: "continuous" });
});
$("infFocus").addEventListener("change", (e) => {
  track && tryApply(e.target.checked ? { focusMode: "manual", focusDistance: 100 } : { focusMode: "continuous" });
});
$("torch").addEventListener("change", (e) => track && tryApply({ torch: e.target.checked }));
$("gridToggle").addEventListener("change", drawGrid);
$("levelToggle").addEventListener("change", () => ($("levelBubble").style.display = $("levelToggle").checked ? "" : "none"));

function tryApply(params) {
  if (!track) return;
  track.applyConstraints({ advanced: [params] }).catch(() => {});
}

/* Tap-to-focus + exposure where supported */
video.addEventListener("pointerdown", (e) => {
  if (!track || !track.getCapabilities) return;
  const caps = track.getCapabilities();
  if (!caps.pointsOfInterest) return;
  const r = video.getBoundingClientRect();
  track.applyConstraints({
    advanced: [{ pointsOfInterest: [{ x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height }] }],
  }).catch(() => {});
});

/* ---------- grids, level, assistant ---------- */

function drawGrid() {
  const show = $("gridToggle").checked;
  gridCanvas.width = window.innerWidth;
  gridCanvas.height = window.innerHeight;
  gctx.clearRect(0, 0, gridCanvas.width, gridCanvas.height);
  if (!show) return;
  gctx.strokeStyle = "rgba(255,255,255,.45)";
  gctx.lineWidth = 1;
  for (let i = 1; i <= 2; i++) {
    gctx.beginPath();
    gctx.moveTo((gridCanvas.width * i) / 3, 0); gctx.lineTo((gridCanvas.width * i) / 3, gridCanvas.height);
    gctx.moveTo(0, (gridCanvas.height * i) / 3); gctx.lineTo(gridCanvas.width, (gridCanvas.height * i) / 3);
    gctx.stroke();
  }
}
window.addEventListener("resize", drawGrid);

function startAssistants() {
  if ("DeviceOrientationEvent" in window && DeviceOrientationEvent.requestPermission) {
    DeviceOrientationEvent.requestPermission().catch(() => {});
  }
  window.addEventListener("deviceorientation", (e) => {
    if (!$("levelToggle").checked) return;
    const roll = Math.max(-30, Math.min(30, e.gamma || 0));
    const bubble = $("levelBubble");
    bubble.style.setProperty("--x", `${33 + roll * 1.6}px`);
    bubble.classList.toggle("flat", Math.abs(roll) < 2);
  });
  hintLoop();
}

function hintLoop() {
  const hint = $("hintBar");
  const hour = new Date().getHours();
  const tips = [];
  if (hour >= 6 && hour < 8) tips.push("🌅 Golden hour — perfect light, go shoot!");
  if (hour >= 17 && hour < 19) tips.push("🌇 Golden hour light now — photos will glow.");
  if (hour >= 20 || hour < 5) tips.push("🌙 Low light: use 1080p and hold very steady.");
  const s = track ? track.getSettings() : {};
  if (s.width >= 3840 && (hour >= 20 || hour < 5)) tips.push("8K/4K in the dark will be noisy — switch to 1080p.");
  if (tips.length) {
    hint.textContent = tips[0];
    hint.hidden = false;
  } else {
    hint.hidden = true;
  }
  const scene = $("sceneAdvice");
  scene.innerHTML =
    `<b>Right now (${new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}):</b> ` +
    (tips.length ? tips.join(" ") : "Good general light. Tap to focus, keep the sun behind you, and stay on the grid lines.");
}

/* ---------- filters + capture ---------- */

const CSS_FILTERS = {
  none: "",
  enhance: "saturate(1.25) contrast(1.12) brightness(1.03)",
  vivid: "saturate(1.6) contrast(1.2)",
  warm: "sepia(.35) saturate(1.3) hue-rotate(-12deg)",
  cool: "saturate(1.1) hue-rotate(18deg) brightness(1.02)",
  mono: "grayscale(1) contrast(1.25)",
  fade: "saturate(.75) contrast(.9) brightness(1.08)",
  hdr: "saturate(1.35) contrast(1.3)",
};
$("filterSelect").addEventListener("change", (e) => {
  currentFilter = e.target.value;
  video.style.filter = CSS_FILTERS[currentFilter] || "";
});

$("shutter").addEventListener("click", takePhoto);

function takePhoto() {
  if (!track) return;
  const s = track.getSettings();
  const w = s.width || 1920, h = s.height || 1080;
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  const ctx = c.getContext("2d", { willReadFrequently: true });
  ctx.filter = CSS_FILTERS[currentFilter] || "";
  ctx.drawImage(video, 0, 0, w, h);
  ctx.filter = "none";
  if (currentFilter === "enhance" || currentFilter === "hdr") enhance(ctx, w, h, currentFilter === "hdr");

  flash.className = "on";
  requestAnimationFrame(() => (flash.className = "off"));

  c.toBlob((blob) => {
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    shots.unshift({ url, label: `${c.width}×${c.height} · ${currentFilter}` });
    const img = $("lastShot");
    img.src = url; img.hidden = false;
    renderGallery();
  }, "image/jpeg", 0.95);
}

/* Auto image-quality boost: auto levels + contrast + saturation + sharpening pass */
function enhance(ctx, w, h, strong) {
  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;
  const hist = new Array(256).fill(0);
  for (let i = 0; i < d.length; i += 4) {
    const l = (d[i] * 299 + d[i + 1] * 587 + d[i + 2] * 114) / 1000;
    hist[l | 0]++;
  }
  const clip = (d.length / 4) * (strong ? 0.005 : 0.003);
  let lo = 0, hi = 255, acc = 0;
  for (let i = 0; i < 256; i++) { acc += hist[i]; if (acc > clip) { lo = i; break; } }
  acc = 0;
  for (let i = 255; i >= 0; i--) { acc += hist[i]; if (acc > clip) { hi = i; break; } }
  if (hi - lo < 30) { lo = 0; hi = 255; }
  const scale = 255 / (hi - lo);
  const sat = strong ? 1.28 : 1.16;
  const contrast = strong ? 1.12 : 1.06;
  for (let i = 0; i < d.length; i += 4) {
    for (let ch = 0; ch < 3; ch++) {
      let v = (d[i + ch] - lo) * scale;
      v = 128 + (v - 128) * contrast;
      d[i + ch] = Math.max(0, Math.min(255, v * sat));
    }
  }
  ctx.putImageData(img, 0, 0);
  // unsharp mask: overlay an inverted blurred copy for perceived sharpness
  ctx.globalCompositeOperation = "overlay";
  ctx.globalAlpha = strong ? 0.35 : 0.22;
  ctx.filter = "blur(1px) invert(1)";
  ctx.drawImage(ctx.canvas, 0, 0);
  ctx.filter = "none";
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = "source-over";
}

/* ---------- gallery ---------- */

$("galleryBtn").addEventListener("click", () => { renderGallery(); $("gallery").hidden = false; });
$("closeGallery").addEventListener("click", () => ($("gallery").hidden = true));

function renderGallery() {
  $("shots").innerHTML = shots
    .map((s, i) =>
      `<figure><img src="${s.url}" alt="Shot ${i + 1}">
       <figcaption>${s.label}</figcaption>
       <a download="procam-${Date.now()}-${i}.jpg" href="${s.url}">Download</a></figure>`)
    .join("");
}

/* ---------- panels ---------- */

$("proBtn").addEventListener("click", () => {
  $("proPanel").hidden = !$("proPanel").hidden;
  $("tipsPanel").hidden = true;
  $("proBtn").classList.toggle("active", !$("proPanel").hidden);
});
$("tipsBtn").addEventListener("click", () => {
  $("tipsPanel").hidden = !$("tipsPanel").hidden;
  $("proPanel").hidden = true;
  $("proBtn").classList.remove("active");
});
$("closePro").addEventListener("click", () => { $("proPanel").hidden = true; $("proBtn").classList.remove("active"); });
$("closeTips").addEventListener("click", () => ($("tipsPanel").hidden = true));

/* ---------- boot ---------- */
drawGrid();
setInterval(hintLoop, 10 * 60 * 1000);
if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
  startCamera();
} else {
  showError(new Error("getUserMedia unsupported — open over HTTPS"));
}
