const notes = document.getElementById('notes');
let guard = null;

function dueLabel(item) {
  if (item.status === 'hidden') return 'put away';
  const date = new Date(item.dueAt);
  if (Number.isNaN(date.getTime())) return item.status;
  if (date.getTime() <= Date.now()) return 'ready now';
  return `due ${date.toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}`;
}

function action(label, handler, danger = false) {
  const button = document.createElement('button');
  button.className = `secondary${danger ? ' danger' : ''}`;
  button.textContent = label;
  button.addEventListener('click', handler);
  return button;
}

async function renderNotes() {
  const items = await window.quackers.reminderList(false);
  notes.replaceChildren();
  if (!items.length) {
    const empty = document.createElement('div');
    empty.className = 'empty';
    empty.textContent = 'No loose notes. Clean desk!';
    notes.appendChild(empty);
    return;
  }
  for (const item of items) {
    const row = document.createElement('div');
    row.className = 'note';
    const swatch = document.createElement('span');
    swatch.className = `swatch ${item.color || ''}`;
    const copy = document.createElement('div');
    copy.className = 'note-copy';
    const text = document.createElement('div');
    text.textContent = item.text;
    const due = document.createElement('small');
    due.textContent = dueLabel(item);
    copy.append(text, due);
    row.append(
      swatch,
      copy,
      action('show', () => window.quackers.reminderShow(item.id)),
      action('done', async () => { await window.quackers.reminderDone(item.id); renderNotes(); }),
      action('delete', async () => { await window.quackers.reminderDelete(item.id); renderNotes(); }, true)
    );
    notes.appendChild(row);
  }
}

async function renderGuard() {
  guard = await window.quackers.workGuardGet();
  document.getElementById('guard-title').textContent = guard.enabled ? `On · every ${guard.minutes} minutes` : 'Off';
  document.getElementById('guard-minutes').value = guard.minutes || 60;
  document.getElementById('guard-message').value = guard.message || '';
  document.getElementById('guard-toggle').textContent = guard.enabled ? 'turn off' : 'turn on';
}

document.getElementById('create').addEventListener('click', async () => {
  const text = document.getElementById('note-text');
  if (!text.value.trim()) return;
  const dueValue = document.getElementById('note-due').value;
  const created = await window.quackers.reminderAdd({
    text: text.value,
    dueAt: dueValue ? new Date(dueValue).toISOString() : new Date().toISOString(),
    color: document.getElementById('note-color').value,
  });
  if (created) {
    text.value = '';
    document.getElementById('note-due').value = '';
    document.getElementById('create-status').textContent = created.status === 'open' ? 'stuck to your screen.' : 'saved for later.';
    renderNotes();
  }
});

document.getElementById('guard-toggle').addEventListener('click', async () => {
  if (guard && guard.enabled) {
    await window.quackers.workGuardClear();
  } else {
    await window.quackers.workGuardSet({
      minutes: Number(document.getElementById('guard-minutes').value),
      message: document.getElementById('guard-message').value,
    });
  }
  renderGuard();
});

renderNotes();
renderGuard();
window.quackers.onRemindersChanged(() => renderNotes());
