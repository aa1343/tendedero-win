// The search field under the line.
const api = window.td;
const q = document.getElementById('q');
const count = document.getElementById('count');
let debounce = null;

document.documentElement.lang = api.lang === 'en' ? 'en' : 'zh-CN';
document.title = api.t('win.search');
q.placeholder = api.t('ui.searchPlaceholder');
count.textContent = `0 / 0`;

function push() {
  if (debounce) clearTimeout(debounce);
  debounce = setTimeout(() => api.setQuery(q.value), 40);
}

q.addEventListener('input', push);

q.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    e.preventDefault();
    if (q.value) {
      q.value = '';
      api.setQuery('');
    } else {
      api.endSearch();
    }
  } else if (e.key === 'Enter') {
    e.preventDefault();
    api.copyNewestMatch();
  } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault();
  }
});

api.onSearchFocus(() => {
  q.value = '';
  q.focus();
  count.classList.remove('on');
  api.setQuery('');
});

api.onSearchCount((p) => {
  if (p.active) {
    count.classList.add('on');
    count.textContent = `${p.count} / ${p.total}`;
  } else {
    count.classList.remove('on');
  }
});

// The window is only 40 tall; keep the field focused.
setInterval(() => {
  if (document.activeElement !== q) q.focus();
}, 400);
q.focus();
