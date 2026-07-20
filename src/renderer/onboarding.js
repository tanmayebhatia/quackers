// Pick-your-Quacker onboarding — runs exactly once, before the first egg drop.

const { SKINS, SKIN_ORDER, drawSkinPreview } = window.QUACKERS_SKINS;

let selected = 'classic';
const grid = document.getElementById('grid');
const nameInput = document.getElementById('name');

const PXS = 4; // preview pixel size
const PREVIEW_W = 14 * PXS + 8;
const PREVIEW_H = 18 * PXS + 6; // headroom for tall hats (rows down to -4)

for (const id of SKIN_ORDER) {
  const skin = SKINS[id];
  const card = document.createElement('div');
  card.className = 'card' + (id === selected ? ' selected' : '');
  card.dataset.skin = id;

  const canvas = document.createElement('canvas');
  canvas.width = PREVIEW_W;
  canvas.height = PREVIEW_H;
  const ctx = canvas.getContext('2d');
  drawSkinPreview(ctx, id, PXS, 4, 4 * PXS + 2);
  card.appendChild(canvas);

  const label = document.createElement('div');
  label.className = 'label';
  label.textContent = skin.name;
  card.appendChild(label);

  const tag = document.createElement('div');
  tag.className = 'tag';
  tag.textContent = skin.tagline;
  card.appendChild(tag);

  card.addEventListener('click', () => {
    selected = id;
    document.querySelectorAll('.card').forEach((c) => c.classList.toggle('selected', c.dataset.skin === id));
    nameInput.focus();
  });
  grid.appendChild(card);
}

function confirm() {
  const name = nameInput.value.trim() || 'Quackers';
  window.quackers.onboardComplete(selected, name);
}

document.getElementById('go').addEventListener('click', confirm);
window.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') confirm();
  // arrow keys walk the grid
  if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key) && document.activeElement !== nameInput) {
    e.preventDefault();
    const i = SKIN_ORDER.indexOf(selected);
    const cols = 4;
    const delta = e.key === 'ArrowLeft' ? -1 : e.key === 'ArrowRight' ? 1 : e.key === 'ArrowUp' ? -cols : cols;
    const next = Math.max(0, Math.min(SKIN_ORDER.length - 1, i + delta));
    selected = SKIN_ORDER[next];
    document.querySelectorAll('.card').forEach((c) => c.classList.toggle('selected', c.dataset.skin === selected));
  }
});
nameInput.focus();
nameInput.select();
