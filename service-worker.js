const SHELL_CACHE = "sleepaid-shell-v4";
const AUDIO_CACHE = "sleepaid-audio-v1";
const SHELL = [
  "./", "index.html", "style.css", "app.js",
  "manifest.json", "manifest.webmanifest",
  "icons/icon-192.png", "icons/icon-512.png",
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(SHELL_CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== SHELL_CACHE && k !== AUDIO_CACHE).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;

  const isAudio = url.pathname.includes("/audio/");
  if (isAudio) {
    e.respondWith(serveAudio(req));
    return;
  }
  // app shell: cache-first, fall back to network
  e.respondWith(
    caches.match(req).then((hit) => hit || fetch(req).catch(() => caches.match("index.html")))
  );
});

// iOS <audio> seeks with Range requests. The Cache API stores a full 200
// response, so we must slice it ourselves and return a 206, or playback of
// cached files fails offline.
async function serveAudio(req) {
  const cache = await caches.open(AUDIO_CACHE);
  const cached = await cache.match(req.url, { ignoreSearch: true });

  if (!cached) {
    // not downloaded — go to network (and stash it for next time)
    try {
      const net = await fetch(req);
      return net;
    } catch {
      return new Response("offline", { status: 504 });
    }
  }

  const range = req.headers.get("range");
  if (!range) return cached;

  const buf = await cached.arrayBuffer();
  const total = buf.byteLength;
  const m = /bytes=(\d*)-(\d*)/.exec(range);
  let start = m[1] ? parseInt(m[1], 10) : 0;
  let end = m[2] ? parseInt(m[2], 10) : total - 1;
  if (isNaN(start)) start = 0;
  if (isNaN(end) || end >= total) end = total - 1;
  if (start > end || start >= total) {
    return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${total}` } });
  }

  const slice = buf.slice(start, end + 1);
  return new Response(slice, {
    status: 206,
    statusText: "Partial Content",
    headers: {
      "Content-Type": cached.headers.get("Content-Type") || "audio/mpeg",
      "Content-Range": `bytes ${start}-${end}/${total}`,
      "Content-Length": String(slice.byteLength),
      "Accept-Ranges": "bytes",
    },
  });
}
