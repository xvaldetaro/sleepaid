const AUDIO_CACHE = "sleepaid-audio-v1";
const $ = (s) => document.querySelector(s);

let tracks = [];
let view = [];          // filtered list currently shown
let current = -1;       // index into `tracks`
let filterCat = "all";

const audio = $("#audio");          // main player (stories), an <audio> element
const noiseEl = $("#noise");        // ambient layer, also an <audio> element
noiseEl.volume = 0.7;

// ambient noise uses a plain <audio> element played straight through (no loop
// attribute): on iOS only a media element keeps playing when the screen locks,
// and a *looping* element gets suspended in the background — so the file is 2h
// of internally-seamless AC that just plays through, exactly like a story.
const Noise = {
  track: null,
  get playing() { return !noiseEl.paused; },
  get vol() { return noiseEl.volume; },
  start(track) {
    if (this.track !== track) { this.track = track; noiseEl.src = track.file; }
    return noiseEl.play();
  },
  stop() { noiseEl.pause(); },
  setVolume(v) { noiseEl.volume = v; },
};

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
    const isNoise = t.category === "noise";
    const active = isNoise ? (Noise.playing && Noise.track === t) : (tracks[current] === t && !audio.paused);
    li.className = `row cat-${t.category}` + (active ? " playing" : "");
    const downloaded = have.has(t.file);
    li.innerHTML = `
      <div class="meta">
        <div class="t">${escapeHtml(t.title)}</div>
        <div class="sub">${isNoise ? "ambient layer · loops · " : ""}${fmt(t.duration)}${downloaded ? ' · <span class="badge">offline</span>' : ""}</div>
      </div>
      <button class="dl ${downloaded ? "done" : ""}" data-file="${t.file}">${downloaded ? "✓" : "↓"}</button>`;
    li.querySelector(".meta").onclick = () => isNoise ? toggleNoise(t) : playTrack(tracks.indexOf(t));
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

// manual skip only (no auto-advance); skips the ambient noise entries
function step(dir) {
  const pos = view.indexOf(tracks[current]);
  if (pos < 0) return;
  for (let i = pos + dir; i >= 0 && i < view.length; i += dir) {
    if (view[i].category !== "noise") { playTrack(tracks.indexOf(view[i])); return; }
  }
}
function next() { step(1); }
function prev() { step(-1); }

// no auto-advance — when a story ends, just stop (don't start the next one)
audio.addEventListener("ended", () => render());
audio.addEventListener("play", () => { $("#playpause").textContent = "⏸"; syncMS("playing"); render(); });
audio.addEventListener("pause", () => { $("#playpause").textContent = "▶"; syncMS("paused"); render(); });
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

// ---------- ambient noise layer (plays independently, under the story) ----------
function defaultNoise() {
  return Noise.track || tracks.find((t) => t.category === "noise");
}
async function toggleNoise(t) {
  const track = t || defaultNoise();
  if (!track) return;
  $("#player").hidden = false;
  if (Noise.playing && Noise.track === track) {
    Noise.stop();
  } else {
    try { await Noise.start(track); } catch {}
    updateMediaSession(track, noiseEl); // noise owns the now-playing / lock screen
  }
  render();
}
noiseEl.addEventListener("play", () => { $("#noiseToggle").classList.add("on"); render(); });
noiseEl.addEventListener("pause", () => { $("#noiseToggle").classList.remove("on"); render(); });
$("#noiseToggle").onclick = () => toggleNoise();
$("#noiseVol").addEventListener("input", (e) => Noise.setVolume(e.target.value / 100));

// ---------- media session (lock screen / background) ----------
function updateMediaSession(t, el = audio) {
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
  navigator.mediaSession.setActionHandler("play", () => el.play());
  navigator.mediaSession.setActionHandler("pause", () => el.pause());
  // skip controls only make sense for stories
  navigator.mediaSession.setActionHandler("nexttrack", el === audio ? next : null);
  navigator.mediaSession.setActionHandler("previoustrack", el === audio ? prev : null);
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
  // fade out and stop BOTH the story and the ambient noise layer
  clearInterval(timerStatusId);
  const aBase = audio.volume, nBase = Noise.vol;
  let k = 1;
  fadeId = setInterval(() => {
    k -= 0.05;
    if (k <= 0) {
      clearInterval(fadeId);
      audio.pause(); audio.volume = aBase;     // restore for next session
      Noise.stop(); Noise.setVolume(nBase);
      $("#noiseToggle").classList.remove("on");
      $("#timerStatus").textContent = "Sleep timer ended";
      $("#timer").value = "0";
      render();
    } else {
      audio.volume = aBase * k;
      Noise.setVolume(nBase * k);
    }
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
