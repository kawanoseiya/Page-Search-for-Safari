#!/usr/bin/env bash
#
# Regenerates every icon from icon-source.svg.
#   ./generate_icons.sh
#
set -euo pipefail
cd "$(dirname "$0")"

SRC_SVG="icon-source.svg"
MASTER="icon-1024.png"
APPICON="PageSearchForSafari/Assets.xcassets/AppIcon.appiconset"
EXT_IMAGES="PageSearchForSafari Extension/Resources/images"
GUIDE_ICON="PageSearchForSafari/Resources/Icon.png"

command -v rsvg-convert >/dev/null || { echo "ERROR: rsvg-convert が必要です (brew install librsvg)"; exit 1; }

# 1024の元画像（App Store用は透過不可なので背景を白で合成）
rsvg-convert -w 1024 -h 1024 -b white "${SRC_SVG}" -o "${MASTER}"

render() { rsvg-convert -w "$1" -h "$1" -b white "${SRC_SVG}" -o "$2"; }

# iOS AppIcon
mkdir -p "${APPICON}"
for spec in "20 2 40" "20 3 60" "29 2 58" "29 3 87" "40 2 80" "40 3 120" "60 2 120" "60 3 180"; do
  read -r pt scale px <<<"${spec}"
  render "${px}" "${APPICON}/Icon-${pt}@${scale}x-${px}.png"
done
for spec in "20 1 20" "20 2 40" "29 1 29" "29 2 58" "40 1 40" "40 2 80" "76 1 76" "76 2 152" "83.5 2 167"; do
  read -r pt scale px <<<"${spec}"
  render "${px}" "${APPICON}/Icon-ipad-${pt}@${scale}x-${px}.png"
done
cp "${MASTER}" "${APPICON}/Icon-ios-marketing-1024.png"

# Safari Web Extension のアイコン（manifest.json の "icons" が参照）
mkdir -p "${EXT_IMAGES}"
for px in 48 64 96 128 256 512; do
  render "${px}" "${EXT_IMAGES}/icon-${px}.png"
done

# アプリ内ガイドページのアイコン
render 256 "${GUIDE_ICON}"

echo "✅ アイコンを生成しました"
