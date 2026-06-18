const AUDIO_CACHE = "sleepaid-audio-v1";
const $ = (s) => document.querySelector(s);

let tracks = [];
let view = [];          // filtered list currently shown
let current = -1;       // index into `tracks`
let filterCat = "all";

const audio = $("#audio");

// ---------- load + render ----------
async function init() {
  const res = await fetch("manifest.json", { cache: "no-cache" });
  tracks = (await res.json()).tracks;
  await render();
  refreshStorage();
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("service-worker.js").catch(() => {});
  }
}

async function cachedSet() {
  if (!("caches" in window)) return new Set();
  try {
    const c = await caches.open(AUDIO_CACHE);
    const keys = await c.keys();
    return new Set(keys.map((r) => new URL(r.url).pathname.replace(/^\//, "")));
  } catch { return new Set(); }
}

function fmt(sec) {
  if (sec == null || isNaN(sec)) return "0:00";
  sec = Math.round(sec);
  const m = Math.floor(sec / 60), s = sec % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

async function render() {
  const have = await cachedSet();
  const list = $("#list");
  list.innerHTML = "";
  view = tracks.filter((t) => {
    if (filterCat === "all") return true;
    if (filterCat === "offline") return have.has(t.file);
    return t.category === filterCat;
  });
  for (const t of view) {
    const li = document.createElement("li");
    li.className = `row cat-${t.category}` + (tracks[current] === t ? " playing" : "");
    const downloaded = have.has(t.file);
    li.innerHTML = `
      <div class="meta">
        <div class="t">${escapeHtml(t.title)}</div>
        <div class="sub">${t.category === "noise" ? "loops · " : ""}${fmt(t.duration)}${downloaded ? ' · <span class="badge">offline</span>' : ""}</div>
      </div>
      <button class="dl ${downloaded ? "done" : ""}" data-file="${t.file}">${downloaded ? "✓" : "↓"}</button>`;
    li.querySelector(".meta").onclick = () => playTrack(tracks.indexOf(t));
    li.querySelector(".dl").onclick = (e) => { e.stopPropagation(); downloadTrack(t, e.currentTarget); };
    list.appendChild(li);
  }
}

function escapeHtml(s) {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}

// ---------- playback ----------
function playTrack(idx) {
  if (idx < 0 || idx >= tracks.length) return;
  current = idx;
  const t = tracks[idx];
  audio.src = t.file;
  audio.loop = !!t.loop;
  $("#loop").classList.toggle("on", audio.loop);
  audio.play().catch(() => {});
  $("#player").hidden = false;
  $("#nowTitle").textContent = t.title;
  updateMediaSession(t);
  document.querySelectorAll(".row").forEach((r) => r.classList.remove("playing"));
  render();
}

function next() {
  // advance within the current filtered view, skip nothing
  const pos = view.indexOf(tracks[current]);
  if (pos > -1 && pos + 1 < view.length) playTrack(tracks.indexOf(view[pos + 1]));
}
function prev() {
  const pos = view.indexOf(tracks[current]);
  if (pos > 0) playTrack(tracks.indexOf(view[pos - 1]));
}

audio.addEventListener("ended", () => { if (!audio.loop) next(); });
audio.addEventListener("play", () => { $("#playpause").textContent = "⏸"; syncMS("playing"); });
audio.addEventListener("pause", () => { $("#playpause").textContent = "▶"; syncMS("paused"); });
audio.addEventListener("timeupdate", () => {
  const d = audio.duration || tracks[current]?.duration || 0;
  $("#nowTime").textContent = `${fmt(audio.currentTime)} / ${fmt(d)}`;
  if (!seeking && d) $("#seek").value = Math.round((audio.currentTime / d) * 1000);
});

let seeking = false;
$("#seek").addEventListener("input", () => { seeking = true; });
$("#seek").addEventListener("change", () => {
  const d = audio.duration || tracks[current]?.duration || 0;
  if (d) audio.currentTime = ($("#seek").value / 1000) * d;
  seeking = false;
});

$("#playpause").onclick = () => (audio.paused ? audio.play() : audio.pause());
$("#next").onclick = next;
$("#prev").onclick = prev;
$("#loop").onclick = () => { audio.loop = !audio.loop; $("#loop").classList.toggle("on", audio.loop); };

// ---------- media session (lock screen / background) ----------
function updateMediaSession(t) {
  if (!("mediaSession" in navigator)) return;
  navigator.mediaSession.metadata = new MediaMetadata({
    title: t.title,
    artist: t.category === "noise" ? "Sleepaid" : "Bedtime Story",
    album: "Sleepaid",
    artwork: [
      { src: "icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "icons/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
  });
  navigator.mediaSession.setActionHandler("play", () => audio.play());
  navigator.mediaSession.setActionHandler("pause", () => audio.pause());
  navigator.mediaSession.setActionHandler("nexttrack", next);
  navigator.mediaSession.setActionHandler("previoustrack", prev);
}
function syncMS(state) {
  if ("mediaSession" in navigator) navigator.mediaSession.playbackState = state;
}

// ---------- sleep timer (with fade) ----------
let timerId = null, fadeId = null, timerStatusId = null;
$("#timer").addEventListener("change", (e) => {
  clearTimeout(timerId); clearInterval(fadeId); clearInterval(timerStatusId);
  const mins = +e.target.value;
  $("#timerStatus").textContent = "";
  if (!mins) return;
  const endAt = Date.now() + mins * 60000;
  const tick = () => {
    const left = Math.max(0, endAt - Date.now());
    $("#timerStatus").textContent = left > 0 ? `Sleep timer: ${fmt(left / 1000)} left` : "";
  };
  tick();
  timerStatusId = setInterval(tick, 1000);
  timerId = setTimeout(fadeOut, mins * 60000);
});
function fadeOut() {
  clearInterval(timerStatusId);
  let v = audio.volume;
  fadeId = setInterval(() => {
    v -= 0.05;
    if (v <= 0) { clearInterval(fadeId); audio.pause(); audio.volume = 1; $("#timerStatus").textContent = "Sleep timer ended"; $("#timer").value = "0"; }
    else audio.volume = v;
  }, 400);
}

// ---------- offline download ----------
async function downloadTrack(t, btn) {
  if (!("caches" in window)) return;
  btn.textContent = "…"; btn.disabled = true;
  try {
    const c = await caches.open(AUDIO_CACHE);
    if (!(await c.match(t.file))) await c.add(t.file);
    btn.textContent = "✓"; btn.classList.add("done", "dl");
  } catch { btn.textContent = "↓"; }
  btn.disabled = false;
  render(); refreshStorage();
}

$("#downloadAll").onclick = async () => {
  const b = $("#downloadAll");
  b.disabled = true;
  const c = await caches.open(AUDIO_CACHE);
  let done = 0;
  for (const t of tracks) {
    b.textContent = `Downloading ${++done}/${tracks.length}…`;
    try { if (!(await c.match(t.file))) await c.add(t.file); } catch {}
    refreshStorage();
  }
  b.textContent = "Download all for offline"; b.disabled = false;
  render();
};

async function refreshStorage() {
  if (!navigator.storage?.estimate) return;
  const { usage } = await navigator.storage.estimate();
  const have = await cachedSet();
  $("#storage").textContent = `${have.size}/${tracks.length} offline · ${(usage / 1e6).toFixed(0)} MB`;
}

// ---------- filters ----------
document.querySelectorAll(".filter").forEach((b) => {
  b.onclick = () => {
    document.querySelectorAll(".filter").forEach((x) => x.classList.remove("active"));
    b.classList.add("active");
    filterCat = b.dataset.cat;
    render();
  };
});

init();
