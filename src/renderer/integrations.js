const definitions = {
  codex: { label: 'Codex', icon: '⌘', detail: 'Turn finished · needs attention' },
  claude: { label: 'Claude Code', icon: 'C', detail: 'Turn finished · API failure · needs attention' },
};

async function render() {
  const cards = document.getElementById('cards');
  const statuses = await window.quackers.integrationStatus();
  cards.replaceChildren();
  for (const status of statuses) {
    const def = definitions[status.kind];
    const card = document.createElement('section');
    card.className = 'card';
    const icon = document.createElement('div');
    icon.className = `icon ${status.kind}`;
    icon.textContent = def.icon;
    const copy = document.createElement('div');
    const title = document.createElement('h2');
    title.textContent = def.label;
    const detail = document.createElement('div');
    detail.className = 'detail';
    detail.textContent = status.error || def.detail;
    if (status.error) detail.classList.add('error');
    const state = document.createElement('span');
    state.className = `state ${status.installed ? '' : 'off'}`;
    state.textContent = status.installed ? 'connected' : 'not connected';
    copy.append(title, detail, state);
    const action = document.createElement('button');
    action.className = status.installed ? 'remove' : '';
    action.textContent = status.installed ? 'disconnect' : 'connect';
    action.addEventListener('click', async () => {
      action.disabled = true;
      const result = status.installed
        ? await window.quackers.integrationRemove(status.kind)
        : await window.quackers.integrationInstall(status.kind);
      if (result && result.error) {
        detail.textContent = result.error;
        detail.classList.add('error');
        action.disabled = false;
      } else {
        render();
      }
    });
    card.append(icon, copy, action);
    cards.appendChild(card);
  }
}

render();
