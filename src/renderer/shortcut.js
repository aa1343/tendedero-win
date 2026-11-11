// Change Shortcut: press a combination, Escape cancels, Delete clears it.
const api = window.td;
const keys = document.getElementById('keys');

document.documentElement.lang = api.lang === 'en' ? 'en' : 'zh-CN';
document.title = api.t('win.shortcut');
{
  const t = document.querySelector('.box .title');
  if (t) t.textContent = api.t('ui.shortcutPress');
  const h = document.querySelector('.box .hint');
  if (h) h.textContent = api.t('ui.shortcutHint');
}

function label(sc) {
  if (!sc || !sc.key) return api.t('ui.none');
  const p = [];
  if (sc.ctrl) p.push('Ctrl');
  if (sc.alt) p.push('Alt');
  if (sc.shift) p.push('Shift');
  p.push(sc.key === 'Space' ? api.t('ui.space') : sc.key);
  return p.join(' + ');
}

api.onShortcutCurrent((sc) => {
  keys.textContent = label(sc);
});

window.addEventListener('keydown', (e) => {
  e.preventDefault();
  if (e.key === 'Escape') {
    window.close();
    return;
  }
  if (e.key === 'Delete' || e.key === 'Backspace') {
    api.setShortcut(null);
    return;
  }
  const k = e.key;
  if (['Control', 'Alt', 'Shift', 'Meta'].includes(k)) return;
  if (!e.ctrlKey && !e.altKey) return;
  const key = k.length === 1 ? k.toUpperCase() : k;
  const sc = { key, ctrl: e.ctrlKey, alt: e.altKey, shift: e.shiftKey };
  keys.textContent = label(sc);
  api.setShortcut(sc);
});
