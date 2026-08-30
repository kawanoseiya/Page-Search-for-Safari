#!/usr/bin/env python3
"""
Builds the App Store App Preview video (iPhone 6.9", 886x1920, ~16s).

Each beat of the demo is rendered as one real frame by the same pipeline that
produces the screenshots, then ffmpeg holds each frame for its own duration —
a UI demo is static between actions anyway.
"""
import pathlib
import subprocess
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
import build_shots  # noqa: E402

ROOT = pathlib.Path(__file__).resolve().parent.parent
FRAMES = ROOT / "build/preview_frames"
OUT = ROOT / "app_preview"

# 443 x 960 @2x = 886 x 1920, an accepted 6.9" App Preview size.
SIZE = {"w": 443, "h": 960, "scale": 2}

PANEL = ("12px", "150px")
BUBBLE = ("300px", "620px")

# (label, seconds, state, panel position, extra JS run after the standard setup)
BEATS = [
    ("01_bubble",    2.4, "bubble", BUBBLE, ""),
    ("02_open",      0.7, "search", PANEL, "root.querySelector('input').value='';"
                                           "root.querySelector('.counter').textContent='';"),
    ("03_type1",     0.45, "search", PANEL, "typeTo(1);"),
    ("04_type2",     0.45, "search", PANEL, "typeTo(2);"),
    ("05_type3",     0.45, "search", PANEL, "typeTo(3);"),
    ("06_hits",      2.6, "search", PANEL, ""),
    ("07_next1",     1.1, "search", PANEL, "root.querySelector('.next').click();"),
    ("08_next2",     1.1, "search", PANEL, "root.querySelector('.next').click();"
                                           "root.querySelector('.next').click();"),
    ("09_list",      2.8, "list",   PANEL, ""),
    ("10_jump",      2.4, "list",   PANEL, "root.querySelectorAll('.hit')[5].click();"),
    ("11_closing",   1.2, "search", PANEL, ""),
    ("12_bubble",    1.6, "bubble", BUBBLE, ""),
]

# Types a prefix of the query, so the counter climbs as the user types.
TYPE_HELPER = """
      window.typeTo = function (n) {
        var input = root.querySelector("input");
        input.value = input.value.slice(0, n) || {query!r}.slice(0, n);
        input.value = {query!r}.slice(0, n);
        input.dispatchEvent(new Event("input", { bubbles: true }));
      };
"""


def build(lang="ja"):
    frames_dir = FRAMES / lang
    if frames_dir.exists():
        for old in frames_dir.iterdir():
            old.unlink()

    query = build_shots.ARTICLE[lang]["query"]
    helper = TYPE_HELPER.replace("{query!r}", repr(query))

    for label, _seconds, state, (px, py), extra in BEATS:
        js = helper + extra
        if extra.startswith("typeTo"):
            js += "\n      await new Promise(function (r) { setTimeout(r, 300); });"
        build_shots.render(
            label, "iphone", lang, state, px, py,
            custom_js=js,
            out_path=frames_dir / f"{label}.png",
            size=SIZE,
        )

    listing = frames_dir / "list.txt"
    lines = []
    for label, seconds, *_ in BEATS:
        lines.append(f"file '{frames_dir / f'{label}.png'}'")
        lines.append(f"duration {seconds}")
    lines.append(f"file '{frames_dir / f'{BEATS[-1][0]}.png'}'")
    listing.write_text("\n".join(lines) + "\n")

    OUT.mkdir(parents=True, exist_ok=True)
    out = OUT / f"preview_{lang}_886x1920.mp4"
    subprocess.run([
        "ffmpeg", "-y", "-f", "concat", "-safe", "0", "-i", str(listing),
        "-vf", "fps=30,format=yuv420p,scale=886:1920",
        "-c:v", "libx264", "-profile:v", "high", "-level", "4.0",
        "-preset", "slow", "-crf", "20", "-movflags", "+faststart",
        str(out),
    ], check=True, capture_output=True)

    probe = subprocess.run(
        ["ffprobe", "-v", "error", "-select_streams", "v:0",
         "-show_entries", "stream=width,height,r_frame_rate,duration",
         "-of", "default=noprint_wrappers=1", str(out)],
        capture_output=True, text=True).stdout.strip()
    print(f"{out.relative_to(ROOT)}\n{probe}")


if __name__ == "__main__":
    for lang in (sys.argv[1:] or ["ja", "en"]):
        build(lang)
