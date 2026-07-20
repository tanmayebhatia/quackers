#!/usr/bin/env node
// Workshop Lab — batch-generate a fixed artifact set and smoke-test headlessly.
// Run BEFORE filming anything: the one-shot success rate is the go/no-go.
//
// Usage: node tools/workshop-lab.js [runs-per-spec]   (default 1)

const fs = require('fs');
const path = require('path');
const os = require('os');

const spine = require('../src/spine');
const workshop = require('../src/workshop');
const { vmSmokeTest } = require('./vm-smoke');

const SPECS = [
  { name: 'tic tac toe', kind: 'game', description: 'Classic 3x3 tic tac toe. He taps a cell to place X; you (the duck) immediately place O with simple sensible strategy. Detect wins and draws, keep an all-time tally in stage.state, reportScore when a game ends, offer a rematch.' },
  { name: 'dots and boxes', kind: 'game', description: 'A small 4x4-dot dots-and-boxes: tap between dots to draw a line, completed boxes get claimed, duck plays the other side simply. Track and report the winner.' },
  { name: 'memory match', kind: 'game', description: 'A 4x3 face-down pair-matching game using stickers. He taps to flip two cards; matches stay revealed; count his tries; celebrate at the end.' },
  { name: 'mood chart of the week', kind: 'viz', description: 'A hand-drawn bar chart of a week, Mon-Sun, with heights from stage.state.moods (default gentle random-looking values), labeled, in crayon colors.' },
  { name: 'haiku board', kind: 'writing', description: 'A framed board that displays a duck-written haiku about living on a computer screen, hand-lettered, with a little sticker decoration. A tap swaps to another haiku (write 3).' },
  { name: 'wizard hat', kind: 'prop', description: 'A pointy purple wizard hat with a gold star, sitting on top of the head.' },
  { name: 'tiny skateboard', kind: 'prop', description: "A little skateboard with wheels under the duck's feet." },
];

(async () => {
  const runs = Math.max(1, Number(process.argv[2]) || 1);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'quackers-wlab-'));
  spine.init(dir);
  workshop.init({
    dir,
    spine,
    loadApiKey: () => {
      if (process.env.OPENAI_API_KEY) return process.env.OPENAI_API_KEY.trim();
      try {
        const txt = fs.readFileSync(path.join(__dirname, '..', '.env'), 'utf8');
        const m = txt.match(/^\s*OPENAI_API_KEY\s*=\s*(.+)\s*$/m);
        return m ? m[1].trim().replace(/^["']|["']$/g, '') : null;
      } catch {
        return null;
      }
    },
    logEvent: () => {},
    sendToDuck: () => {},
    smokeTest: async (code) => vmSmokeTest(code),
  });

  let ok = 0, total = 0;
  for (const spec of SPECS) {
    for (let i = 0; i < runs; i++) {
      total++;
      const t0 = Date.now();
      const result = await workshop.buildOnce({ ...spec, existing: null });
      const secs = ((Date.now() - t0) / 1000).toFixed(1);
      if (result.ok) {
        ok++;
        console.log(`  ✅ ${spec.name} (${spec.kind}) — ${secs}s`);
      } else {
        console.log(`  ❌ ${spec.name} (${spec.kind}) — ${secs}s — ${result.error}`);
      }
    }
  }
  console.log(`\n${ok}/${total} built and passed the bench (${Math.round((ok / total) * 100)}%)`);
  console.log(`artifacts in ${dir}/workshop`);
})().catch((err) => {
  console.error('workshop-lab error:', err.message);
  process.exit(1);
});
