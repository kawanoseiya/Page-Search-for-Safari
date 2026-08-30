#!/usr/bin/env python3
"""
Renders App Store screenshots for Page Search for Safari.

The real content.css / content.js from the extension are loaded into a mock
Safari page, so what gets captured is the actual extension UI, at the exact
App Store pixel sizes:

  iPhone 6.9"  440x956 @3x = 1320x2868
  iPad 13"     516x688 @4x = 2064x2752

Usage: python3 scripts/build_shots.py
"""
import json
import pathlib
import shutil
import subprocess
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
EXT = ROOT / "PageSearchForSafari/PageSearchForSafari Extension/Resources"
OUT = ROOT / "screenshots_raw"
WORK = ROOT / "build/shots"
CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"

DEVICES = {
    "iphone": {"w": 440, "h": 956, "scale": 3},
    "ipad": {"w": 516, "h": 688, "scale": 4},
}

ARTICLE = {
    "ja": {
        "title": "在宅勤務を続けるための小さな習慣",
        "lead": "在宅勤務が定着してからしばらく経ちました。通勤時間が消えた一方で、"
                "仕事と生活の境目が曖昧になったという声もよく聞きます。",
        "paras": [
            "在宅勤務でいちばん難しいのは、始める合図と終える合図をつくることです。"
            "オフィスであれば、席に着いた瞬間が始まりで、席を立った瞬間が終わりでした。",
            "そこで、在宅勤務を始める前に机の上を片付ける、終わったらノートパソコンを閉じて"
            "別の部屋に置く、といった小さな儀式を決めておくと切り替えがうまくいきます。",
            "椅子と机の高さも見直す価値があります。長時間の在宅勤務では、"
            "少しの角度の違いが肩や腰の負担として積み重なっていきます。",
            "休憩は時間で区切るより、作業の区切りで取るほうが戻りやすいという人が多いようです。"
            "在宅勤務では誰も声をかけてくれないので、自分でタイマーを鳴らす工夫が要ります。",
            "同僚との雑談が減ることも、在宅勤務の見落とされがちな課題です。"
            "週に一度、議題のない短い通話を入れておくだけで、相談の心理的な壁は下がります。",
            "最後に、在宅勤務の環境は一度決めて終わりではありません。"
            "季節や仕事の内容が変われば、最適な形も変わっていきます。",
        ],
        "query": "在宅勤務",
        "site": "example.jp",
    },
    "en": {
        "title": "Small habits that make remote work sustainable",
        "lead": "Remote work has settled in for good. The commute disappeared, but so did "
                "the line between the working day and everything else.",
        "paras": [
            "The hardest part of remote work is creating a signal to start and a signal to "
            "stop. In an office, sitting down was the start and standing up was the end.",
            "A small ritual helps: clear the desk before remote work begins, and close the "
            "laptop and carry it to another room when the day is done.",
            "Chair and desk height deserve a second look too. Over a long stretch of remote "
            "work, a few degrees of difference accumulate in your shoulders and back.",
            "Most people find it easier to resume after a break taken at a natural seam in "
            "the work rather than at a fixed time on the clock.",
            "Losing small talk is the overlooked cost of remote work. One short call a week "
            "with no agenda lowers the barrier to asking for help.",
            "Finally, a remote work setup is never finished. As the seasons and the work "
            "itself change, the right arrangement changes with them.",
        ],
        "query": "remote work",
        "site": "example.com",
    },
}

PAGE = """<!DOCTYPE html>
<html lang="{lang}"><head><meta charset="utf-8">
<style>
  html {{ color-scheme: light !important; }}
  * {{ box-sizing: border-box; margin: 0; padding: 0; }}
  body {{
    width: {w}px; height: {h}px; overflow: hidden; background: #fff;
    font-family: -apple-system, "Hiragino Sans", "Helvetica Neue", sans-serif;
    color: #1c1c1e;
  }}
  /* --- iOS status bar --- */
  .status {{
    height: 54px; display: flex; align-items: center; justify-content: space-between;
    padding: 14px 30px 0; font-size: 15px; font-weight: 600; position: relative;
  }}
  .island {{
    position: absolute; left: 50%; transform: translateX(-50%); top: 10px;
    width: 125px; height: 36px; border-radius: 18px; background: #000;
  }}
  .status .icons {{ display: flex; gap: 5px; align-items: center; }}
  .bar {{ width: 17px; height: 11px; border: 1.5px solid #000; border-radius: 3px; position: relative; }}
  .bar::after {{ content: ""; position: absolute; inset: 1.5px; background: #000; border-radius: 1px; }}
  /* --- article --- */
  .page {{ height: {content_h}px; overflow: hidden; padding: 12px 20px 0; }}
  .page.offset {{ margin-top: -{offset}px; }}
  h1 {{ font-size: 26px; line-height: 1.35; font-weight: 700; margin-bottom: 14px; letter-spacing: -0.2px; }}
  .lead {{ font-size: 16px; line-height: 1.75; color: #3a3a3c; margin-bottom: 18px; }}
  p.body {{ font-size: 16px; line-height: 1.85; margin-bottom: 16px; }}
  .byline {{ font-size: 13px; color: #8e8e93; margin-bottom: 16px; }}
  /* --- Safari bottom bar --- */
  .safari {{
    position: absolute; left: 0; right: 0; bottom: 0; height: 108px;
    background: #f7f7f8; border-top: 1px solid rgba(0,0,0,.12);
    display: flex; flex-direction: column; align-items: center; padding-top: 9px;
  }}
  .addr {{
    width: 88%; height: 42px; border-radius: 12px; background: #fff;
    box-shadow: 0 1px 3px rgba(0,0,0,.14); display: flex; align-items: center;
    justify-content: center; gap: 8px; font-size: 15px; color: #1c1c1e; position: relative;
  }}
  .addr .left {{ position: absolute; left: 12px; display: flex; gap: 12px; color: #6b6b70; font-size: 15px; }}
  .addr .right {{ position: absolute; right: 14px; color: #6b6b70; }}
  .tools {{ width: 100%; display: flex; justify-content: space-around; align-items: center;
            margin-top: 10px; font-size: 20px; color: #0a84ff; }}
  .tools .dim {{ color: #c2c2c7; }}
  .home {{ position: absolute; bottom: 8px; left: 50%; transform: translateX(-50%);
           width: 140px; height: 5px; border-radius: 3px; background: #1c1c1e; }}
  /* --- iPad: status bar + toolbar at the top, nothing at the bottom --- */
  .pad-status {{ height: 26px; display: flex; align-items: center; justify-content: space-between;
                 padding: 0 22px; font-size: 13px; font-weight: 600; }}
  .pad-bar {{ height: 56px; background: #f7f7f8; border-bottom: 1px solid rgba(0,0,0,.12);
              display: flex; align-items: center; gap: 14px; padding: 0 16px; }}
  .pad-bar .nav {{ color: #c2c2c7; font-size: 19px; }}
  .pad-bar .field {{ flex: 1; height: 36px; border-radius: 10px; background: #fff;
                     box-shadow: 0 1px 2px rgba(0,0,0,.12); display: flex; align-items: center;
                     justify-content: center; font-size: 14px; }}
  .pad-bar .act {{ color: #0a84ff; font-size: 18px; }}
  .pad-tabs {{ height: 40px; background: #eeeef0; display: flex; align-items: flex-end;
               padding: 0 10px; gap: 6px; }}
  .pad-tabs .tab {{ height: 32px; flex: 0 0 190px; background: #fff; border-radius: 9px 9px 0 0;
                    display: flex; align-items: center; justify-content: center;
                    font-size: 13px; color: #1c1c1e; }}
  .pad-tabs .tab.off {{ background: #e2e2e6; color: #8e8e93; }}
</style>
<link rel="stylesheet" href="content.css">
<script>
  var msgs = {msgs};
  window.__handlers = [];
  window.browser = {{
    runtime: {{ onMessage: {{ addListener: function (f) {{ window.__handlers.push(f); }} }} }},
    i18n: {{ getMessage: function (k) {{ return msgs[k] || ""; }} }}
  }};
</script>
</head>
<body>
  {chrome_top}
  <div class="page">
    <div class="{offset_class}">
      <h1>{title}</h1>
      <div class="byline">{site}</div>
      <p class="lead">{lead}</p>
      {paras}
    </div>
  </div>
  {chrome_bottom}
  <script>
    // The status bar and the Safari bars are browser chrome, not page content.
    var CHROME_PARTS = {chrome_parts};
    // Moving them into shadow roots keeps them out of the extension's search,
    // exactly as they are out of reach in the real Safari.
    CHROME_PARTS.forEach(function (cls) {{
      var el = document.querySelector("." + cls);
      if (!el) {{ return; }}
      var host = document.createElement("div");
      el.parentNode.insertBefore(host, el);
      var root = host.attachShadow({{ mode: "open" }});
      var style = document.createElement("style");
      style.textContent = document.querySelector("head style").textContent;
      root.appendChild(style);
      root.appendChild(el);
    }});
  </script>
  <script src="content.js"></script>
  <script>
    function send(msg) {{ var out; window.__handlers[0](msg, null, function (r) {{ out = r; }}); return out; }}
    window.__ready = (async function () {{
      send({{ type: "open" }});
      var root = document.getElementById("__page-search-for-safari__").shadowRoot;
      var panel = root.querySelector(".panel");
      // Headless Chrome inherits the host's dark appearance; the App Store shots
      // should show the light look most users see.
      var light = document.createElement("style");
      light.textContent = ".panel{{background:#fff!important;color:#1c1c1e!important;"
        + "box-shadow:0 6px 28px rgba(0,0,0,.28)!important}}"
        + "input{{background:#f2f2f7!important}}"
        + ".counter,.hit .s,.hit .n{{color:#6b6b70!important}}"
        + ".hit{{border-bottom-color:rgba(60,60,67,.10)!important}}"
        + ".list{{border-top-color:rgba(60,60,67,.18)!important}}"
        + ".hit .s b{{color:#1c1c1e!important}}"
        + ".hit.active .s{{color:#1c1c1e!important}}";
      root.appendChild(light);
      var state = {state!r};
      if (state !== "bubble") {{
        panel.classList.remove("collapsed");
        var input = root.querySelector("input");
        input.value = {query!r};
        input.dispatchEvent(new Event("input", {{ bubbles: true }}));
        await new Promise(function (r) {{ setTimeout(r, 400); }});
        if (state === "list") {{ root.querySelector(".toggle").click(); }}
        if ({step} > 0) {{
          for (var i = 0; i < {step}; i++) {{ root.querySelector(".next").click(); }}
        }}
      }}
      panel.style.left = {panel_x!r};
      panel.style.top = {panel_y!r};
      {custom_js}
      document.title = "ready";
      return true;
    }})();
  </script>
</body></html>
"""


IPHONE_TOP = """<div class="status">
    <div class="island"></div>
    <span>9:41</span>
    <span class="icons"><span>&#9679;&#9679;&#9679;&#9679;</span><span>&#9663;</span><span class="bar"></span></span>
  </div>"""

IPHONE_BOTTOM = """<div class="safari">
    <div class="addr">
      <span class="left">&#9776; &#9634;</span>
      <span>{site}</span>
      <span class="right">&#8635;</span>
    </div>
    <div class="tools"><span class="dim">&#8249;</span><span class="dim">&#8250;</span>
      <span>&#9053;</span><span>&#9776;</span><span>&#9723;</span></div>
    <div class="home"></div>
  </div>"""

IPAD_TOP = """<div class="pad-status">
    <span>9:41</span>
    <span>&#9663; &#9632;</span>
  </div>
  <div class="pad-tabs">
    <div class="tab">{title_short}</div>
    <div class="tab off">&#43;</div>
  </div>
  <div class="pad-bar">
    <span class="nav">&#9776;</span><span class="nav">&#8249;</span><span class="nav">&#8250;</span>
    <span class="field">{site}</span>
    <span class="act">&#9053;</span><span class="act">&#9723;</span>
  </div>"""


def render(name, device, lang, state, panel_x, panel_y, offset=0, step=0,
           custom_js="", out_path=None, size=None):
    cfg = dict(DEVICES[device])
    if size:
        cfg.update(size)
    art = ARTICLE[lang]
    msgs = {}
    loc = EXT / "_locales" / lang / "messages.json"
    for key, value in json.loads(loc.read_text()).items():
        msgs[key] = value["message"]

    if device == "ipad":
        chrome_top = IPAD_TOP.format(site=art["site"], title_short=art["title"][:18])
        chrome_bottom = ""
        chrome_parts = ["pad-status", "pad-tabs", "pad-bar"]
        content_h = cfg["h"] - 26 - 40 - 56
    else:
        chrome_top = IPHONE_TOP
        chrome_bottom = IPHONE_BOTTOM.format(site=art["site"])
        chrome_parts = ["status", "safari"]
        content_h = cfg["h"] - 54 - 108

    html = PAGE.format(
        lang=lang, w=cfg["w"], h=cfg["h"], content_h=content_h,
        chrome_top=chrome_top, chrome_bottom=chrome_bottom,
        chrome_parts=json.dumps(chrome_parts),
        offset=offset, offset_class="offset" if offset else "",
        msgs=json.dumps(msgs, ensure_ascii=False),
        title=art["title"], lead=art["lead"], site=art["site"],
        paras="\n".join(f'<p class="body">{p}</p>' for p in art["paras"]),
        state=state, query=art["query"], step=step,
        panel_x=panel_x, panel_y=panel_y, custom_js=custom_js,
    )
    WORK.mkdir(parents=True, exist_ok=True)
    for asset in ("content.js", "content.css"):
        shutil.copy(EXT / asset, WORK / asset)
    page = WORK / f"{name}.html"
    page.write_text(html)

    if out_path:
        out = pathlib.Path(out_path)
        out.parent.mkdir(parents=True, exist_ok=True)
    else:
        out_dir = OUT / device / lang
        out_dir.mkdir(parents=True, exist_ok=True)
        out = out_dir / f"{name}.png"
    subprocess.run([
        CHROME, "--headless", "--disable-gpu", "--hide-scrollbars",
        f"--force-device-scale-factor={cfg['scale']}",
        f"--window-size={cfg['w']},{cfg['h']}",
        "--virtual-time-budget=3000",
        f"--screenshot={out}", f"file://{page}",
    ], check=True, capture_output=True)
    size = subprocess.run(["sips", "-g", "pixelWidth", "-g", "pixelHeight", str(out)],
                          capture_output=True, text=True).stdout
    dims = [l.split(":")[-1].strip() for l in size.splitlines() if ":" in l and "pixel" in l]
    print(f"{device}/{lang}/{name}.png  {'x'.join(dims)}")


SHOTS = [
    # name,          state,    panel x/y,           scroll offset, step
    ("01_search",   "search",  ("12px", "200px"),   0,   0),
    ("02_list",     "list",    ("12px", "150px"),   150, 2),
    ("03_bubble",   "bubble",  ("300px", "600px"),  240, 0),
]

if __name__ == "__main__":
    devices = sys.argv[1:] or ["iphone", "ipad"]
    for device in devices:
        for lang in ("ja", "en"):
            for name, state, (px, py), offset, step in SHOTS:
                render(name, device, lang, state, px, py, offset, step)
