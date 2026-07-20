#!/bin/bash
# Update the installed Quackers.app WITHOUT re-signing, so the macOS
# Screen Recording grant survives. We rebuild only the code bundle
# (app.asar) and swap it into the already-granted app; the main
# executable's code identity never changes, so TCC keeps honoring it.
set -e
cd "$(dirname "$0")/.."

APP="$HOME/Applications/Quackers.app"
if [ ! -d "$APP" ]; then
  echo "No installed app at $APP — run 'npm run install-app' first."
  exit 1
fi

echo "Building fresh app.asar…"
npx electron-packager . Quackers --platform=darwin --arch=arm64 \
  --app-bundle-id=com.quackers.desktop --out=dist --overwrite >/dev/null

echo "Swapping code into the granted bundle (no re-sign)…"
pkill -9 -f "Quackers.app" 2>/dev/null || true
sleep 1
cp dist/Quackers-darwin-arm64/Quackers.app/Contents/Resources/app.asar \
   "$APP/Contents/Resources/app.asar"

echo "Relaunching…"
open "$APP"
echo "Done — screen grant preserved."
