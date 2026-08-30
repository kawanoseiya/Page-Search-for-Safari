#!/usr/bin/env python3
"""
Frames the raw renders with captions and a device bezel.

  iPhone 6.9"  1320 x 2868
  iPad 13"     2064 x 2752

Background is amber/orange: the strongest competitor for this keyword owns blue,
and amber is the product's own highlight colour.
"""
import pathlib

from PIL import Image, ImageDraw, ImageFont

ROOT = pathlib.Path(__file__).resolve().parent.parent
RAW = ROOT / "screenshots_raw"
OUT = ROOT / "screenshots_framed"

CANVAS = {
    "iphone": {"w": 1320, "h": 2868, "title": 132, "sub": 86, "bezel": 18,
               "radius": 60, "device_ratio": 0.72},
    "ipad": {"w": 2064, "h": 2752, "title": 142, "sub": 92, "bezel": 14,
             "radius": 38, "device_ratio": 0.75},
}

GRADIENTS = {
    "01_search": ((255, 176, 32), (240, 106, 20)),
    "02_list": ((255, 150, 40), (214, 74, 36)),
    "03_bubble": ((255, 196, 60), (240, 130, 24)),
}

FONTS = {
    "ja": ("/System/Library/Fonts/ヒラギノ角ゴシック W8.ttc",
           "/System/Library/Fonts/ヒラギノ角ゴシック W3.ttc"),
    "en": ("/System/Library/Fonts/Supplemental/Arial Bold.ttf",
           "/System/Library/Fonts/Supplemental/Arial.ttf"),
}

CAPTIONS = {
    "ja": {
        "01_search": ("探している言葉が、\nすぐ光る。", "入力するそばからページ内を検索"),
        "02_list": ("一致した場所を、\n一覧から選ぶ。", "タップすればその行までスクロール"),
        "03_bubble": ("普段は、\n小さな虫眼鏡だけ。", "読んでいるページを邪魔しない"),
    },
    "en": {
        "01_search": ("Find the word.\nWatch it light up.", "Searches the page as you type"),
        "02_list": ("Jump straight to\nany match.", "Pick from the list of every hit"),
        "03_bubble": ("Out of the way\nuntil you need it.", "A draggable bubble, not a full screen"),
    },
}

# Guideline 2.3.7: captions must never mention price.
BANNED = ("無料", "free", "gratis", "gratuit", "kostenlos", "무료", "免费", "免費",
          "割引", "discount", "sale", "0円")


def check_captions():
    for lang, shots in CAPTIONS.items():
        for name, texts in shots.items():
            joined = " ".join(texts).lower()
            for word in BANNED:
                if word.lower() in joined:
                    raise SystemExit(f"price wording in {lang}/{name}: {word!r}")


def gradient(size, top, bottom):
    w, h = size
    base = Image.new("RGB", (1, h))
    draw = ImageDraw.Draw(base)
    for y in range(h):
        t = y / max(1, h - 1)
        draw.point((0, y), fill=tuple(int(top[i] + (bottom[i] - top[i]) * t) for i in range(3)))
    return base.resize((w, h))


def fit(draw, text, font_path, size, max_width):
    """Shrinks the font until every line fits the canvas width."""
    while size > 40:
        font = ImageFont.truetype(font_path, size)
        widest = max(draw.textlength(line, font=font) for line in text.split("\n"))
        if widest <= max_width:
            return font
        size -= 4
    return ImageFont.truetype(font_path, size)


def draw_block(draw, text, font, y, canvas_w, spacing):
    for line in text.split("\n"):
        width = draw.textlength(line, font=font)
        box = font.getbbox(line)
        draw.text(((canvas_w - width) / 2, y), line, font=font, fill=(255, 255, 255))
        y += (box[3] - box[1]) + spacing
    return y


def rounded_mask(size, radius):
    mask = Image.new("L", size, 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, size[0] - 1, size[1] - 1], radius, fill=255)
    return mask


def frame(device, lang, name):
    cfg = CANVAS[device]
    raw_path = RAW / device / lang / f"{name}.png"
    if not raw_path.exists():
        print(f"SKIP (not found) {raw_path}")
        return

    shot = Image.open(raw_path).convert("RGB")
    canvas_w, canvas_h = cfg["w"], cfg["h"]
    top, bottom = GRADIENTS[name]
    canvas = gradient((canvas_w, canvas_h), top, bottom)
    draw = ImageDraw.Draw(canvas)

    bold, regular = FONTS[lang]
    title, subtitle = CAPTIONS[lang][name]
    margin = int(canvas_w * 0.07)
    max_text = canvas_w - margin * 2

    title_font = fit(draw, title, bold, cfg["title"], max_text)
    sub_font = fit(draw, subtitle, regular, cfg["sub"], max_text)

    y = int(canvas_h * 0.06)
    y = draw_block(draw, title, title_font, y, canvas_w, 18)
    y += int(canvas_h * 0.012)
    y = draw_block(draw, subtitle, sub_font, y, canvas_w, 18)

    device_y = y + int(canvas_h * 0.03)

    # The frame is derived from the screenshot's own ratio — never the other way.
    ss_ratio = shot.width / shot.height
    inner_h = int(canvas_h * cfg["device_ratio"])
    inner_w = int(inner_h * ss_ratio)
    max_inner_w = canvas_w - margin - cfg["bezel"] * 2
    if inner_w > max_inner_w:
        inner_w = max_inner_w
        inner_h = int(inner_w / ss_ratio)

    inner = shot.resize((inner_w, inner_h), Image.LANCZOS)
    bezel = cfg["bezel"]
    device_w, device_h = inner_w + bezel * 2, inner_h + bezel * 2
    body = Image.new("RGB", (device_w, device_h), (0, 0, 0))
    body.paste(inner, (bezel, bezel), rounded_mask(inner.size, cfg["radius"] - bezel))

    device_x = (canvas_w - device_w) // 2
    shadow = Image.new("RGBA", canvas.size, (0, 0, 0, 0))
    ImageDraw.Draw(shadow).rounded_rectangle(
        [device_x + 10, device_y + 14, device_x + device_w + 10, device_y + device_h + 14],
        cfg["radius"], fill=(0, 0, 0, 70))
    canvas = Image.alpha_composite(canvas.convert("RGBA"), shadow).convert("RGB")
    canvas.paste(body, (device_x, device_y), rounded_mask(body.size, cfg["radius"]))

    out_dir = OUT / lang
    out_dir.mkdir(parents=True, exist_ok=True)
    prefix = "" if device == "iphone" else "ipad_"
    out = out_dir / f"{prefix}{name}.png"
    canvas.convert("RGB").save(out)
    print(f"{out.relative_to(ROOT)}  {canvas.width}x{canvas.height}")


if __name__ == "__main__":
    check_captions()
    for device in ("iphone", "ipad"):
        for lang in ("ja", "en"):
            for name in ("01_search", "02_list", "03_bubble"):
                frame(device, lang, name)
