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
# Keep this in lockstep with the package script: the updater must never smuggle
# local secrets, test fixtures, or developer metadata into the installed app.
npx electron-packager . Quackers --platform=darwin --arch=arm64 \
  --app-bundle-id=com.quackers.desktop --icon=assets/icon.icns \
  --ignore='^/(\.env(?:\.[^/]*)?|\.git|\.agents|\.github|\.lab|\.codex|\.claude|\.superpowers|dist|node_modules|test|docs|tools|site)(/|$)' \
  --out=dist --overwrite >/dev/null
node tools/verify-package.js

echo "Swapping code into the granted bundle (no re-sign)…"
pkill -9 -f "Quackers.app" 2>/dev/null || true
sleep 1
cp dist/Quackers-darwin-arm64/Quackers.app/Contents/Resources/app.asar \
   "$APP/Contents/Resources/app.asar"

# Also carry the app icon across. Swapping only app.asar used to leave the
# installed bundle stuck on whatever icon it was FIRST built with (the default
# Electron icon, for any install predating assets/icon.icns) — the code updated,
# the icon never did. Copy from assets/ (the source of truth), NOT from the dist
# build: this update build doesn't pass --icon, so its electron.icns is the
# default. Like the asar, the icns isn't part of the main executable's code
# identity, so the Screen-Recording grant still survives.
cp assets/icon.icns "$APP/Contents/Resources/electron.icns"
touch "$APP" # bump mtime so macOS re-reads the bundle
LSREGISTER="/System/Library/Frameworks/CoreServices.framework/Versions/A/Frameworks/LaunchServices.framework/Versions/A/Support/lsregister"
[ -x "$LSREGISTER" ] && "$LSREGISTER" -f "$APP" 2>/dev/null || true

echo "Relaunching…"
open "$APP"
echo "Done — screen grant preserved, icon refreshed."
