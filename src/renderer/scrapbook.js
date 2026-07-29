const board = document.getElementById('board');
const composer = document.getElementById('composer');

function formatDate(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? ''
    : date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

function button(label, onClick) {
  const el = document.createElement('button');
  el.type = 'button';
  el.textContent = label;
  el.addEventListener('click', onClick);
  return el;
}

async function render() {
  const entries = await window.quackers.scrapbookList();
  board.replaceChildren();
  if (!entries.length) {
    const empty = document.createElement('div');
    empty.className = 'empty';
    empty.textContent = 'The board is waiting for its first ridiculous, lovely little thing.';
    board.appendChild(empty);
    return;
  }
  for (const entry of entries) {
    const card = document.createElement('article');
    card.className = 'card';
    card.dataset.color = entry.color || 'butter';
    const tack = document.createElement('span');
    tack.className = 'tack';
    const kind = document.createElement('div');
    kind.className = 'kind';
    kind.textContent = entry.kind;
    const title = document.createElement('h2');
    title.textContent = entry.title;
    const body = document.createElement('p');
    body.textContent = entry.body;
    const date = document.createElement('div');
    date.className = 'date';
    date.textContent = formatDate(entry.createdAt);
    const actions = document.createElement('div');
    actions.className = 'actions';
    actions.appendChild(button(entry.pinned ? 'unpin' : 'pin forever', async () => {
      await window.quackers.scrapbookPin(entry.id, !entry.pinned);
      render();
    }));
    if (entry.assetPath) {
      actions.appendChild(button('open clip', () => window.quackers.scrapbookOpenAsset(entry.id)));
    }
    actions.appendChild(button('let go', async () => {
      await window.quackers.scrapbookDelete(entry.id);
      render();
    }));
    card.append(tack, kind, title, body, date, actions);
    board.appendChild(card);
  }
}

document.getElementById('toggle-add').addEventListener('click', () => {
  composer.classList.toggle('open');
  if (composer.classList.contains('open')) document.getElementById('title').focus();
});

composer.addEventListener('submit', async (event) => {
  event.preventDefault();
  const title = document.getElementById('title');
  const body = document.getElementById('body');
  if (!title.value.trim() && !body.value.trim()) return;
  await window.quackers.scrapbookAdd({
    kind: 'moment',
    title: title.value,
    body: body.value,
    source: 'scrapbook',
    color: ['butter', 'rose', 'mint', 'sky', 'lilac'][Math.floor(Math.random() * 5)],
  });
  title.value = '';
  body.value = '';
  composer.classList.remove('open');
  render();
});

render();
