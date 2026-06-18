#!/usr/bin/env python3
"""Assemble the sleepaid audio library from the heavyeyes project.

Copies each story's final audio.mp3 into ./audio/<slug>.mp3, pulls a human
title from the story's youtube.json, probes duration, and writes manifest.json
which the PWA reads to render the browseable list.
"""
import json, os, re, shutil, subprocess, sys
from pathlib import Path

HEAVYEYES = Path.home() / "dev" / "heavyeyes"
SRC_DIRS = [HEAVYEYES / "output", HEAVYEYES / "uploaded", HEAVYEYES]  # last = wind-lilies sits here
OUT = Path(__file__).parent
AUDIO_OUT = OUT / "audio"
AUDIO_OUT.mkdir(exist_ok=True)

# story folders to skip (tests / junk)
SKIP = {"parallel-test", "# Polished Alleyways"}

def prettify(slug):
    return re.sub(r"\s+", " ", slug.replace("-", " ")).strip().title()

def title_from(story_dir, slug):
    yj = story_dir / "youtube.json"
    if yj.exists():
        try:
            t = json.loads(yj.read_text())["snippet"]["title"]
            # strip the "| ASMR Sleep Story ..." marketing suffix
            return t.split("|")[0].strip() or prettify(slug)
        except Exception:
            pass
    return prettify(slug)

def duration(path):
    try:
        out = subprocess.run(
            ["ffprobe", "-v", "error", "-show_entries", "format=duration",
             "-of", "csv=p=0", str(path)],
            capture_output=True, text=True, check=True).stdout.strip()
        return round(float(out))
    except Exception:
        return None

# discover story dirs: any dir containing audio.mp3
story_dirs = {}
for base in SRC_DIRS:
    if not base.exists():
        continue
    for child in sorted(base.iterdir()):
        if not child.is_dir():
            continue
        if child.name in SKIP:
            continue
        audio = child / "audio.mp3"
        if audio.exists():
            story_dirs.setdefault(child.name, child)  # dedupe by slug, first wins

tracks = []
for slug, d in sorted(story_dirs.items()):
    dest = AUDIO_OUT / f"{slug}.mp3"
    shutil.copy2(d / "audio.mp3", dest)
    dur = duration(dest)
    tracks.append({
        "id": slug,
        "title": title_from(d, slug),
        "file": f"audio/{slug}.mp3",
        "duration": dur,
        "category": "story",
    })
    print(f"  story  {slug:30s} {dur or '?':>5}s  {title_from(d, slug)}")

# white noise — a single seamless loop period (see /tmp/makeloop.py), WAV so it
# loops gaplessly via Web Audio (no MP3 encoder padding at the seam)
wn = AUDIO_OUT / "white-noise-ac.wav"
noise = []
if wn.exists():
    noise.append({
        "id": "white-noise-ac",
        "title": "Old AC White Noise",
        "file": "audio/white-noise-ac.wav",
        "duration": duration(wn),
        "category": "noise",
        "loop": True,
    })
    print(f"  noise  white-noise-ac  {duration(wn)}s")
else:
    print("  (white noise not downloaded yet — rerun after download finishes)")

manifest = {"tracks": noise + tracks}
(OUT / "manifest.json").write_text(json.dumps(manifest, indent=2, ensure_ascii=False))
print(f"\nWrote manifest.json: {len(noise)} noise + {len(tracks)} stories")
