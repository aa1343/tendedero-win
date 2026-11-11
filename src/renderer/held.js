// The held window: one thing taken off the line and floated in front of you.
const api = window.td;
const frameBody = document.getElementById('body');
const closeBtn = document.getElementById('close');
let data = null;
let zoom = 1;

document.documentElement.lang = api.lang === 'en' ? 'en' : 'zh-CN';
document.title = api.t('win.held');
{
  const hint = document.getElementById('hint');
  if (hint) hint.textContent = api.t('ui.heldHint');
}

function blockOf(n) {
  if (n.bodyHtml && n.bodyHtml.type === 'code') {
    const pre = document.createElement('div');
    pre.className = 'codeblock';
    pre.textContent = n.bodyHtml.lines.join('\n');
    return pre;
  }
  if (n.bodyHtml && n.bodyHtml.type === 'blocks') {
    const wrap = document.createElement('div');
    wrap.className = 'body';
    for (const blk of n.bodyHtml.blocks) {
      const d = document.createElement('div');
      d.innerHTML = (blk.marker || '') + blk.html;
      if (blk.kind === 'heading') {
        d.style.fontWeight = '700';
        d.style.color = '#1c1c1c';
      }
      wrap.append(d);
    }
    return wrap;
  }
  if (n.bodyHtml && n.bodyHtml.html) {
    const b = document.createElement('div');
    b.className = 'body';
    b.innerHTML = n.bodyHtml.html;
    return b;
  }
  return null;
}

function render(p) {
  data = p;
  frameBody.innerHTML = '';
  if (p.kind === 'note' && p.note) {
    const n = p.note;
    const sheet = document.createElement('div');
    sheet.id = 'sheet';
    if (n.link) {
      const t = document.createElement('div');
      t.className = 'title';
      t.textContent = n.title || '';
      sheet.append(t);
      if (n.linkPath) {
        const b = document.createElement('div');
        b.className = 'body';
        b.textContent = n.linkPath;
        sheet.append(b);
      }
    } else {
      if (n.title) {
        const t = document.createElement('div');
        t.className = 'title';
        t.textContent = n.title;
        sheet.append(t);
      }
      const blk = blockOf(n);
      if (blk) sheet.append(blk);
    }
    const d = document.createElement('div');
    d.className = 'date';
    d.textContent = n.dateText || '';
    sheet.append(d);
    frameBody.append(sheet);
  } else if (p.thumb) {
    const img = document.createElement('img');
    img.src = p.thumb;
    img.id = 'pic';
    frameBody.append(img);
  }
  applyZoom();
}

function applyZoom() {
  const img = document.getElementById('pic');
  if (img) img.style.transform = `scale(${zoom})`;
  const s = document.getElementById('sheet');
  if (s) s.style.fontSize = `${zoom * 13}px`;
}

api.onHeldData(render);

window.addEventListener('wheel', (e) => {
  if (!e.ctrlKey && !e.altKey) return;
  e.preventDefault();
  zoom = Math.max(0.1, Math.min(4, zoom * (e.deltaY < 0 ? 1.08 : 0.93)));
  applyZoom();
}, { passive: false });

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') api.hangBack(data ? data.id : '');
  if (e.ctrlKey && (e.key === 'c' || e.key === 'C')) {
    const sel = window.getSelection();
    if ((!sel || sel.isCollapsed) && data) api.copy([data.id]);
  }
  if (e.key === '0') {
    zoom = 1;
    applyZoom();
  }
});

closeBtn.addEventListener('click', () => api.hangBack(data ? data.id : ''));

// Ask for the content again: the first push may have arrived before this
// script was listening.
const wanted = new URLSearchParams(location.search).get('id') || '';
if (wanted) api.heldReady(wanted);
