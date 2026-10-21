#!/usr/bin/env bash
# Builds the Windows app (build/MaMaDoX-TvPlayer-Windows.zip) from Linux or Windows (Git Bash).
# Needs node and Python 3 with Pillow (for the .ico); downloads Electron the first time.
set -euo pipefail
cd "$(dirname "$0")/.."
node web/build.mjs --desktop
(cd desktop && npm install --omit=dev)
W=build/windows
mkdir -p "$W"
python3 -c "from PIL import Image; Image.open('desktop/icon.png').convert('RGBA').save('$W/icon.ico', sizes=[(16,16),(24,24),(32,32),(48,48),(64,64),(128,128),(256,256)])"
npx --yes @electron/packager@18 desktop "MaMaDoX TvPlayer" --platform=win32 --arch=x64 --electron-version=33.4.11 \
  --out="$W" --overwrite --asar --ignore='^/(run-local\.js|build-windows\.sh|set-icon\.mjs|\.data)'
(cd "$W" && npm install --no-save resedit@2 >/dev/null && node ../../desktop/set-icon.mjs "MaMaDoX TvPlayer-win32-x64/MaMaDoX TvPlayer.exe" icon.ico)
rm -rf "$W/MaMaDoX TvPlayer"
mv "$W/MaMaDoX TvPlayer-win32-x64" "$W/MaMaDoX TvPlayer"
(cd "$W" && zip -qr -9 ../MaMaDoX-TvPlayer-Windows.zip "MaMaDoX TvPlayer")
echo "== done: build/MaMaDoX-TvPlayer-Windows.zip"
