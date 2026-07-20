# Building & running the packaged app

Screen Recording permission only works on the **packaged, signed** app — the raw
`npm start` dev binary has a churning ad-hoc signature that macOS won't hold a
TCC grant against. For voice/memory/games alone, `npm start` is fine; for
screen vision, use the packaged app.

## Build

```bash
npm run package      # builds dist/Quackers-darwin-<arch>/Quackers.app + signs it
```

Then copy to `~/Applications` and launch:

```bash
cp -R dist/Quackers-darwin-*/Quackers.app ~/Applications/
codesign --force --deep --sign - ~/Applications/Quackers.app
open ~/Applications/Quackers.app
```

## First run

- The app reads `OPENAI_API_KEY` from `~/Library/Application Support/quackers/.env`
  (copy your `.env` there once).
- macOS will prompt for **microphone** on first talk and **Screen Recording**
  on first look — grant both. Because the bundle id (`com.quackers.desktop`) is
  stable, the grants persist across rebuilds.
