const id = new URLSearchParams(location.search).get('id');

async function load() {
  const reminder = await window.quackers.reminderGet(id);
  if (!reminder) return window.close();
  document.body.dataset.color = reminder.color || 'butter';
  document.getElementById('text').textContent = reminder.text;
  const due = new Date(reminder.dueAt);
  document.getElementById('due').textContent = Number.isNaN(due.getTime())
    ? ''
    : `set for ${due.toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' })}`;
}

document.getElementById('done').addEventListener('click', async () => {
  await window.quackers.reminderDone(id);
  window.close();
});
document.getElementById('dismiss').addEventListener('click', async () => {
  await window.quackers.reminderDismiss(id);
  window.close();
});
document.getElementById('snooze').addEventListener('click', async () => {
  await window.quackers.reminderSnooze(id, 15);
  window.close();
});

load();
