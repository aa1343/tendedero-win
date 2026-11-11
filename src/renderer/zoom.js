// Zoom on hover: the card under the pointer, larger, in the middle of the screen.
const api = window.td;
const wrap = document.getElementById('wrap');
const inner = document.getElementById('inner');

document.documentElement.lang = api.lang === 'en' ? 'en' : 'zh-CN';
document.title = api.t('win.zoom');

function blockOf(n) {
  if (n.bodyHtml && n.bodyHtml.type === 'code') {
    const pre = document.createElement('div');
    pre.className = 'codeblock';
    pre.textContent = n.bodyHtml.lines.join('\n');
    return pre;
  }
  if (n.bodyHtml && n.bodyHtml.type === 'blocks') {
    const wrapEl = document.createElement('div');
    wrapEl.className = 'body';
    for (const blk of n.bodyHtml.blocks) {
      const d = document.createElement('div');
      d.innerHTML = (blk.marker || '') + blk.html;
      if (blk.kind === 'heading') {
        d.style.fontWeight = '700';
        d.style.color = '#1c1c1c';
      }
      wrapEl.append(d);
    }
    return wrapEl;
  }
  if (n.bodyHtml && n.bodyHtml.html) {
    const b = document.createElement('div');
    b.className = 'body';
    b.innerHTML = n.bodyHtml.html;
    return b;
  }
  return null;
}

api.onZoomData((p) => {
  inner.innerHTML = '';
  const w = p.size.w - 8;
  const h = p.size.h - 8;
  if (p.kind === 'note' && p.note) {
    const n = p.note;
    const sheet = document.createElement('div');
    sheet.className = 'sheet';
    sheet.style.width = `${w}px`;
    sheet.style.height = `${h}px`;
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
    inner.append(sheet);
  } else if (p.thumb) {
    const img = document.createElement('img');
    img.src = p.thumb;
    img.style.width = `${w}px`;
    img.style.height = `${h}px`;
    inner.append(img);
  }
  wrap.style.width = `${p.size.w}px`;
  wrap.style.height = `${p.size.h}px`;
  wrap.classList.remove('on');
  requestAnimationFrame(() => wrap.classList.add('on'));
});
