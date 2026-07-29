// "Give Quackers a voice" — saves the API key through macOS secure storage.

const input = document.getElementById('key');
const button = document.getElementById('save');
const status = document.getElementById('status');

async function save() {
  const key = input.value.trim();
  if (!key) return;
  button.disabled = true;
  const res = await window.quackers.keySave(key);
  button.disabled = false;
  if (res.ok) {
    status.className = 'ok';
    status.textContent = 'Quackers has a voice now. Press ⌃⇧T (or double-click it) to talk. *quack*';
    setTimeout(() => window.close(), 2600);
  } else {
    status.className = 'err';
    status.textContent = res.error || 'that key did not take — try again?';
  }
}

button.addEventListener('click', save);
input.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') save();
});
