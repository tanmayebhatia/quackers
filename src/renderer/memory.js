// Memory dashboard — everything Quackers knows, visible, editable, deletable.
// Trust is the feature: nothing hidden, nothing uneditable.

const STAGE_LABELS = {
  egg: '🥚 still an egg',
  duckling: '🐣 duckling',
  fledgling: '🐤 fledgling',
  companion: '🦆 companion',
};

const SECTIONS = [
  { key: 'facts', title: 'About you', text: (x) => x.statement, meta: (x) => x.category, editable: true },
  { key: 'open_loops', title: 'Things to follow up on', text: (x) => x.description, meta: (x) => (x.status === 'open' ? x.dueHint || '' : 'resolved') },
  { key: 'relationship', title: 'Your running bits', text: (x) => x.note, meta: () => '' },
  { key: 'duck_self', title: "Quackers' own quirks (it grew these)", text: (x) => x.trait, meta: () => '' },
  { key: 'tricks', title: 'Tricks you taught it', text: (x) => `${x.name} — ${x.goal}`, meta: (x) => `${x.steps.length} steps · performed ${x.timesPerformed}×` },
  { key: 'diary', title: "Quackers' diary", text: (x) => x.note, meta: (x) => new Date(x.date).toLocaleDateString() },
  { key: 'episodes', title: 'Conversations', text: (x) => x.summary, meta: (x) => new Date(x.date).toLocaleDateString() + (x.tone ? ` · ${x.tone}` : '') },
];

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

function renderHeader(root, spine) {
  const stage = STAGE_LABELS[spine.meta.stage] || spine.meta.stage;
  const head = el('div', 'stagebar');
  head.appendChild(el('span', 'stage', `${stage}`));
  head.appendChild(el('span', 'depth', `${spine.meta.sessionsCount || 0} conversations · relationship depth ${spine.meta.depth}`));
  if (spine.meta.lastDreamAt) {
    head.appendChild(el('span', 'depth', `last dreamed ${new Date(spine.meta.lastDreamAt).toLocaleString()}`));
  }
  root.appendChild(head);
}

function renderUnderstanding(root, spine) {
  if (spine.understanding && (spine.understanding.who || spine.understanding.us)) {
    root.appendChild(el('h2', null, 'What Quackers understands'));
    const box = el('div', 'prose');
    if (spine.understanding.who) box.appendChild(el('p', null, spine.understanding.who));
    if (spine.understanding.us) box.appendChild(el('p', 'us', spine.understanding.us));
    box.appendChild(el('p', 'note', 'Rewritten while Quackers sleeps, from the memories below. Edit or delete those and this follows.'));
    root.appendChild(box);
  }
  if (spine.user_state) {
    root.appendChild(el('h2', null, 'Current read on you'));
    const box = el('div', 'prose faded');
    box.appendChild(el('p', null, spine.user_state.text));
    box.appendChild(el('p', 'note', `A hypothesis from ${new Date(spine.user_state.at).toLocaleString()} — it fades after a few days.`));
    root.appendChild(box);
  }
}

function renderScores(root, spine) {
  const keys = Object.keys(spine.game_scores || {});
  if (!keys.length) return;
  root.appendChild(el('h2', null, 'All-time scores'));
  for (const k of keys) {
    const s = spine.game_scores[k];
    const row = el('div', 'item');
    row.appendChild(el('span', null, k));
    row.appendChild(el('em', 'meta', `Quackers ${s.duck} — you ${s.user}`));
    root.appendChild(row);
  }
}

function startEdit(row, span, item) {
  const input = document.createElement('input');
  input.value = item.statement;
  input.className = 'edit-input';
  row.replaceChild(input, span);
  input.focus();
  input.select();

  let done = false;
  const finish = async (save) => {
    if (done) return;
    done = true;
    if (save && input.value.trim() && input.value.trim() !== item.statement) {
      await window.quackers.spineEdit(item.id, input.value.trim());
    }
    render();
  };
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') finish(true);
    if (e.key === 'Escape') finish(false);
  });
  input.addEventListener('blur', () => finish(true));
}

async function render() {
  const spine = await window.quackers.spineGet();
  const root = document.getElementById('content');
  root.innerHTML = '';

  const h1 = document.querySelector('h1');
  if (h1 && spine.meta.duckName) h1.textContent = `🥚 What ${spine.meta.duckName} remembers`;

  renderHeader(root, spine);
  renderUnderstanding(root, spine);

  for (const section of SECTIONS) {
    root.appendChild(el('h2', null, section.title));

    let items = (spine[section.key] || []).slice().reverse();
    if (section.key === 'facts') items = items.filter((x) => !x.invalidAt);
    if (!items.length) {
      root.appendChild(el('div', 'empty', 'nothing yet'));
      continue;
    }

    for (const item of items) {
      const row = el('div', 'item');
      const span = el('span', null, section.text(item));
      row.appendChild(span);

      const metaText = section.meta(item);
      if (metaText) row.appendChild(el('em', 'meta', metaText));

      if (section.editable) {
        const edit = el('button', 'edit', 'fix');
        edit.onclick = () => startEdit(row, span, item);
        row.appendChild(edit);
      }

      const del = el('button', null, 'forget');
      del.onclick = async () => {
        await window.quackers.spineDelete(section.key, item.id);
        render();
      };
      row.appendChild(del);

      root.appendChild(row);
    }
  }

  renderScores(root, spine);
}

render();
