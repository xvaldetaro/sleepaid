# Sleepaid

Offline PWA for falling asleep: a looping "Old AC" white-noise track plus 55 bedtime-story
narrations from the [heavyeyes](../heavyeyes) project. Built to play on an iPhone with the
screen off (lock-screen controls via the Media Session API) and to work fully offline once
tracks are downloaded.

## Layout

- `index.html` / `style.css` / `app.js` — the player UI (list, filters, player bar, sleep timer)
- `service-worker.js` — caches the app shell and serves cached audio, including 206 Range
  responses (iOS seeks cached audio with Range requests; without this, offline playback fails)
- `manifest.json` — the track list the app reads (built from heavyeyes)
- `manifest.webmanifest` + `icons/` — installability ("Add to Home Screen")
- `audio/` — 55 story mp3s + `white-noise-ac.mp3` (~900 MB, **not** for git)
- `build-library.py` — regenerates `audio/` + `manifest.json` from `~/dev/heavyeyes`

Rebuild the library after adding stories in heavyeyes: `python3 build-library.py`.

## Deploy (free static host)

Audio is ~900 MB — don't commit it to git. Use a host that takes a direct folder upload:

- **Netlify drop (easiest):** drag the whole `sleepaid/` folder onto https://app.netlify.com/drop
  — or `npx netlify deploy --prod --dir .`
- **Cloudflare Pages:** `npx wrangler pages deploy .` (unlimited bandwidth; per-file cap 25 MB — all files here are under 18 MB)

A service worker needs HTTPS; all of the above provide it. (Locally, only `http://localhost` works
— `python3 -m http.server` is fine for a quick look but won't exercise offline caching.)

## Use on iPhone

1. Open the deployed URL in **Safari** → Share → **Add to Home Screen**. Launch it from that icon
   (an installed PWA keeps audio alive in the background; a plain Safari tab can get suspended).
2. While online, tap **Download all for offline** (or the ↓ on individual tracks). Then it works on
   a plane / with no signal.
3. Tap a story to play; tap the AC track for looping white noise (loop is on by default for it).
   Set a sleep timer; lock the phone — playback continues with lock-screen controls.

### iOS caveats

- Safari may evict a PWA's cached storage after ~7 days of no use. Nightly use avoids this; if it
  ever clears, just re-tap Download while online.
- Background audio starts only from a tap (autoplay is blocked) — that's the first play each session.
