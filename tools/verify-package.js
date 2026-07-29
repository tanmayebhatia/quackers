// Fail packaging if local/development data leaked into the distributable.

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const app = path.join(root, 'dist', 'Quackers-darwin-arm64', 'Quackers.app');
const archive = path.join(app, 'Contents', 'Resources', 'app.asar');

function digest(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

async function main() {
  const { listPackage } = await import('@electron/asar');
  const files = listPackage(archive);
  const forbidden = files.filter((file) =>
    /(^|\/)(\.env(?:\.|$)|spine\.json$|interactions\.jsonl$|\.agents(?:\/|$)|\.claude(?:\/|$)|\.codex(?:\/|$)|\.github(?:\/|$)|\.superpowers(?:\/|$)|node_modules(?:\/|$)|test(?:\/|$)|docs(?:\/|$)|tools(?:\/|$)|site(?:\/|$))/.test(file)
  );
  if (forbidden.length) {
    throw new Error(`private/development data entered app.asar: ${forbidden.join(', ')}`);
  }

  const sourceIcon = path.join(root, 'assets', 'icon.icns');
  const packagedIcon = path.join(app, 'Contents', 'Resources', 'electron.icns');
  if (digest(sourceIcon) !== digest(packagedIcon)) {
    throw new Error('the packaged app does not contain the Quackers icon');
  }
  console.log(`Package privacy check passed (${files.length} archived files).`);
}

main().catch((err) => {
  console.error(err.message);
  process.exitCode = 1;
});
