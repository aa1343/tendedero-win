/* Tendedero for Windows — the line, drawn.
   Layout, animation and gesture numbers come from the macOS source. */

const api = window.td;

const cardsEl = document.getElementById('cards');
const lineRoot = document.getElementById('lineRoot');
const ropeEl = document.getElementById('rope');
const knotEl = document.getElementById('knot');
const hintEl = document.getElementById('hint');
const menuEl = document.getElementById('menu');

// Every label in this window comes from the shared table, so switching the
// language is just a reload (main reloads the strip when the setting changes).
document.documentElement.lang = api.lang === 'en' ? 'en' : 'zh-CN';
hintEl.textContent = api.t('ui.hintEmpty');

let S = null;             // last state from main
let L = null;             // layout constants
let width = window.innerWidth;
let revealed = false;
let searching = false;
let query = '';
let scroll = 0;
let draggingId = null;
let pressedId = null;
let hoverId = null;
let menuOpen = false;

const cards = new Map();  // id -> {el, item, swing, arrived, tilt, ...}
let lastGust = 0;
let hitReport = null;
let lastReportKey = '';

/* ---------------------------------------------------------------- maths --- */

const clamp01 = (v) => Math.max(0, Math.min(1, v));

function ropeY(x) {
  if (!width) return L.ropeTop;
  const sag = Math.min(30, width * 0.018);
  const f = x / width;
  return L.ropeTop + 4 * sag * f * (1 - f);
}

function sag() {
  return Math.min(30, width * 0.018);
}

function anchorsPinned(pinned, visible) {
  return pinned > 0 && pinned < visible - 1;
}

function xFor(index, count, visible, scrollPos, pinned) {
  const spacing = L.spacing;
  if (keepOn() && count > visible) {
    const newest = width / 2 + ((visible - 1) * spacing) / 2;
    if (anchorsPinned(pinned, visible) && index < pinned) {
      return newest - (visible - 1 - index) * spacing;
    }
    return newest - (count - 1 - index) * spacing + scrollPos;
  }
  const gaps = Math.max(count - 1, 0);
  const step = gaps > 0 ? Math.min(spacing, Math.max(0, width - 200) / gaps) : spacing;
  return width / 2 - (gaps * step) / 2 + index * step;
}

function keepOn() {
  return S && S.keepOnLine !== null && S.keepOnLine !== undefined;
}

/* ---------------------------------------------------------------- spring --- */

// A damped oscillator, the shape SwiftUI's interpolatingSpring gives.
function spring(from, to, stiffness, damping, onFrame) {
  const m = 1;
  const w0 = Math.sqrt(stiffness / m);
  const zeta = damping / (2 * Math.sqrt(stiffness * m));
  const wd = w0 * Math.sqrt(Math.max(0.0001, 1 - zeta * zeta));
  const start = performance.now();
  const delta = to - from;
  let raf = 0;
  const step = (now) => {
    const t = (now - start) / 1000;
    const decay = Math.exp(-zeta * w0 * t);
    const v = 1 - decay * (Math.cos(wd * t) + ((zeta * w0) / wd) * Math.sin(wd * t));
    onFrame(from + delta * v);
    if (t < 4 && Math.abs(delta * decay) > 0.02) raf = requestAnimationFrame(step);
    else {
      onFrame(to);
      raf = 0;
    }
  };
  raf = requestAnimationFrame(step);
  return () => raf && cancelAnimationFrame(raf);
}

/* ------------------------------------------------------------ card build --- */

const ICONS = {
  x: '<svg viewBox="0 0 10 10"><path d="M2 2 L8 8 M8 2 L2 8"/></svg>',
  eyeOff:
    '<svg viewBox="0 0 12 12"><path d="M1 6s2-3.4 5-3.4S11 6 11 6s-2 3.4-5 3.4S1 6 1 6z"/><circle cx="6" cy="6" r="1.4"/><path d="M1.6 10.4 L10.4 1.6"/></svg>',
  unpin:
    '<svg viewBox="0 0 12 12"><path d="M7 1.5 L10.5 5 M6 2.6 L4.4 6.6 L1.8 8.4 L6.6 9.2 L9.4 7.4z"/><path d="M1.6 10.4 L5.2 6.8"/></svg>',
  check: '<svg viewBox="0 0 10 10"><path d="M1.6 5.4 L3.9 7.7 L8.4 2.6"/></svg>',
  play: '<svg viewBox="0 0 10 10"><path d="M2 1.2 L8.6 5 L2 8.8z"/></svg>',
  link: '<svg viewBox="0 0 12 12"><path d="M5 7 L7 5 M4.4 8.6 L3.2 9.8a1.9 1.9 0 0 1-2.7-2.7l1.2-1.2 M7.6 3.4 L8.8 2.2a1.9 1.9 0 0 1 2.7 2.7l-1.2 1.2"/></svg>',
};

function el(tag, cls, html) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html !== undefined) e.innerHTML = html;
  return e;
}

function photoBox(srcW, srcH) {
  const maxW = L.cardWidth - 14;
  const maxH = L.photoMaxHeight;
  if (!srcW || !srcH) return { w: maxW, h: maxH };
  const s = Math.min(maxW / srcW, maxH / srcH);
  return { w: Math.round(srcW * s), h: Math.round(srcH * s) };
}

function noteBox(item) {
  // Measure the sheet at full width, then contain it like a photo.
  const maxW = L.cardWidth - 14;
  const probe = buildSheet(item, maxW);
  probe.style.position = 'absolute';
  probe.style.visibility = 'hidden';
  probe.style.left = '-9999px';
  document.body.appendChild(probe);
  const natural = probe.getBoundingClientRect().height || maxW * 0.6;
  probe.remove();
  const h = Math.min(L.photoMaxHeight, Math.max(maxW * 0.42, Math.round(natural)));
  const box = photoBox(maxW, h);
  return { w: Math.round(box.w), h: Math.round(box.h) };
}

function buildSheet(item, w) {
  const u = w / 136;
  const n = item.note || {};
  const sheet = el('div', 'sheet');
  sheet.style.setProperty('--u', `${u}px`);
  sheet.style.width = `${w}px`;
  const band = el('div', 'band');
  const perf = el('div', 'perf');
  const content = el('div', 'content');
  sheet.append(band, perf, content);

  const titleSize = (n.body ? 11 : 12.5) * u;
  const bodySize = (n.title ? 8.5 : 9.5) * u;
  const small = 7.5 * u;

  if (n.link) {
    const row = el('div', 'linkrow');
    row.append(el('span', 'ico', ICONS.link));
    const t = el('div', 'linktitle');
    t.style.fontSize = `${11.5 * u}px`;
    t.textContent = n.title || '';
    row.append(t);
    content.append(row);
    if (n.linkPath) {
      const p = el('div', 'linkpath');
      p.style.fontSize = `${8.5 * u}px`;
      p.textContent = n.linkPath;
      content.append(p);
    }
  } else {
    if (n.title) {
      const t = el('div', 'title');
      t.style.fontSize = `${titleSize}px`;
      t.textContent = n.title;
      content.append(t);
    }
    if (n.bodyHtml && n.bodyHtml.type === 'code') {
      const pre = el('div', 'codeblock');
      pre.style.fontSize = `${small}px`;
      pre.textContent = n.bodyHtml.lines.slice(0, 40).join('\n');
      content.append(pre);
    } else if (n.bodyHtml && n.bodyHtml.type === 'blocks') {
      const wrap = el('div', 'body');
      wrap.style.fontSize = `${bodySize}px`;
      for (const b of n.bodyHtml.blocks.slice(0, 40)) {
        const d = el('div');
        if (b.kind === 'heading') {
          const mult = b.level === 1 ? 1.3 : b.level === 2 ? 1.15 : 1.05;
          d.style.fontSize = `${bodySize * mult}px`;
          d.style.fontWeight = '700';
          d.style.color = 'inherit';
        } else if (b.kind === 'quote') {
          d.style.fontStyle = 'italic';
        } else if (b.kind === 'code') {
          d.style.fontFamily = '"Cascadia Mono", Consolas, monospace';
          d.style.fontSize = `${bodySize * 0.9}px`;
          d.style.whiteSpace = 'pre';
        }
        if (b.kind === 'checkOn') d.style.opacity = '0.75';
        d.innerHTML = (b.marker || '') + b.html;
        wrap.append(d);
      }
      content.append(wrap);
    } else if (n.bodyHtml && n.bodyHtml.html) {
      const b = el('div', 'body');
      b.style.fontSize = `${bodySize}px`;
      b.innerHTML = n.bodyHtml.html;
      content.append(b);
    }
  }

  const d = el('div', 'date');
  d.style.fontSize = `${small}px`;
  d.textContent = n.dateText || '';
  content.append(d);
  return sheet;
}

function buildCard(item) {
  const box = item.kind === 'note' ? noteBox(item) : photoBox(item.thumb ? item.thumb.w : 0, item.thumb ? item.thumb.h : 0);
  const gw = box.w + 8;
  const gh = box.h + 8;

  const card = el('div', 'card');
  card.dataset.id = item.id;
  card.style.width = `${L.cardWidth}px`;

  const clip = el('div', 'clip', '<span class="slot"></span>');
  const glass = el('div', 'glass');
  glass.style.top = '14px';
  glass.style.width = `${gw}px`;
  glass.style.height = `${gh}px`;
  glass.style.left = `${(L.cardWidth - gw) / 2}px`;

  if (item.kind === 'note') {
    const sheet = buildSheet(item, box.w);
    sheet.style.width = `${box.w}px`;
    sheet.style.height = `${box.h}px`;
    glass.append(sheet);
  } else {
    const photo = el('div', 'photo');
    photo.style.width = `${box.w}px`;
    photo.style.height = `${box.h}px`;
    if (item.thumb && item.thumb.dataUrl) {
      const img = document.createElement('img');
      img.src = item.thumb.dataUrl;
      img.draggable = false;
      photo.append(img);
    }
    glass.append(photo);
    if (item.isRecording) {
      glass.append(el('div', 'playbtn', ICONS.play));
    }
  }

  // corner button
  const corner = el('div', 'corner');
  corner.innerHTML = cornerIcon(item);
  glass.append(corner);

  // selection
  glass.append(el('div', 'selring'));
  glass.append(el('div', 'selcheck', ICONS.check));

  // copied badge
  const badge = el('div', 'badge', ICONS.check);
  const badgeText = document.createElement('span');
  badgeText.textContent = api.t('ui.copied');
  badge.append(badgeText);
  glass.append(badge);

  // the click surface covers the glass exactly
  const hit = el('div', 'hit');
  hit.style.position = 'absolute';
  hit.style.inset = '0';
  glass.append(hit);

  card.append(clip, glass);
  cardsEl.append(card);

  const rec = {
    id: item.id,
    el: card,
    item,
    box,
    glass,
    hit,
    swing: 0,
    tilt: item.tilt,
    arrived: false,
    cancelSwing: null,
    hover: false,
  };
  attachGestures(rec);
  return rec;
}

function cornerIcon(item) {
  if (item.kept && item.byHand) return ICONS.eyeOff;
  if (item.kept) return ICONS.unpin;
  return ICONS.x;
}

/* ------------------------------------------------------------- gestures --- */

const HOLD_MS = 450;
const DRAG_PX = 4;
const CROSS = 26;

function attachGestures(rec) {
  const { hit, el: card } = rec;
  let downAt = 0;
  let downPos = null;
  let holdTimer = null;
  let didHold = false;
  let didDrag = false;
  let pressedCross = false;
  let crossAt = null; // where the corner was armed, in screen px
  let moved = 0;

  const clearHold = () => {
    if (holdTimer) clearTimeout(holdTimer);
    holdTimer = null;
  };

  hit.addEventListener('pointerdown', (e) => {
    if (e.button === 2) return;
    if (e.button === 1) {
      // middle click is the Windows stand-in for a force click
      e.preventDefault();
      api.quickLook(rec.id);
      return;
    }
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();

    if (e.shiftKey) {
      clearHold();
      api.toggleSelection(rec.id);
      return;
    }
    if (rec.item.held) {
      api.hangBack(rec.id);
      return;
    }

    const rect = hit.getBoundingClientRect();
    const lx = e.clientX - rect.left;
    const ly = e.clientY - rect.top;
    if (lx <= CROSS && ly <= CROSS) {
      pressedCross = true;
      crossAt = { x: e.screenX, y: e.screenY };
      return;
    }

    if (e.detail >= 2) {
      // A second click means "open": cancel the first click's pending copy so
      // a double click never touches the clipboard.
      if (rec.copyTimer) {
        clearTimeout(rec.copyTimer);
        rec.copyTimer = null;
      }
      api.open([rec.id]);
      return;
    }

    downAt = performance.now();
    downPos = { x: e.screenX, y: e.screenY };
    didHold = false;
    didDrag = false;
    moved = 0;
    pressedId = rec.id;
    card.classList.add('pressed');
    holdTimer = setTimeout(() => {
      didHold = true;
      pressedId = null;
      card.classList.remove('pressed');
      if (rec.item.kind === 'note') api.open([rec.id]);
      else api.markup(rec.id);
    }, HOLD_MS);
  });

  hit.addEventListener('pointermove', (e) => {
    if (!rec.hover) {
      rec.hover = true;
      card.classList.add('hover');
      hoverId = rec.id;
    }
    if (!downPos) return;
    // The release can be swallowed (an OLE drag loop does that); a move with
    // no button down is treated as the missing pointerup so no press state
    // sticks and the next click works normally.
    if ((e.buttons & 1) === 0) {
      clearHold();
      card.classList.remove('pressed');
      pressedId = null;
      downPos = null;
      pressedCross = false;
      return;
    }
    moved = Math.hypot(e.screenX - downPos.x, e.screenY - downPos.y);
    if (moved > DRAG_PX && !didHold && !didDrag) {
      didDrag = true;
      clearHold();
      card.classList.remove('pressed');
      pressedId = null;
      card.classList.add('dragging');
      draggingId = rec.id;
      api.startDrag([rec.id]);
      // OLE drags swallow the release; never leave the card in "dragging"
      // state forever if no pointerup arrives.
      setTimeout(() => {
        didDrag = false;
        draggingId = null;
        card.classList.remove('dragging');
        downPos = null;
      }, 8000);
    }
  });

  hit.addEventListener('pointerup', (e) => {
    if (e.button !== 0) return;
    // A drag that started (didDrag) or a press that was already cleaned up
    // (no downPos, no corner armed) must not fall through to the copy path.
    if (didDrag) {
      didDrag = false;
      draggingId = null;
      card.classList.remove('dragging');
      downPos = null;
      return;
    }
    if (!downPos && !pressedCross) return;
    clearHold();
    card.classList.remove('pressed');
    pressedId = null;

    if (pressedCross) {
      pressedCross = false;
      // The card scales up on hover and swings, so its rect at release time is
      // not necessarily the rect that armed the corner. A small movement is
      // still a click on the badge; anything further is a miss.
      const away = crossAt ? Math.hypot(e.screenX - crossAt.x, e.screenY - crossAt.y) : 0;
      crossAt = null;
      if (away <= CROSS) api.pressCorner(rec.id);
      return;
    }
    if (didHold) {
      downPos = null;
      return;
    }
    downPos = null;
    // A click copies, but only once it is clear it was not a double click.
    const id = rec.id;
    if (rec.copyTimer) clearTimeout(rec.copyTimer);
    rec.copyTimer = setTimeout(() => {
      rec.copyTimer = null;
      api.copy([id]);
    }, 260);
  });

  hit.addEventListener('pointercancel', () => {
    clearHold();
    card.classList.remove('pressed', 'dragging');
    pressedId = null;
    draggingId = null;
    downPos = null;
    pressedCross = false;
  });

  hit.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    e.stopPropagation();
    clearHold();
    downPos = null;
    api.cardMenu(rec.id);
  });

  hit.addEventListener('pointerenter', () => {
    rec.hover = true;
    card.classList.add('hover');
    hoverId = rec.id;
    if (S && S.dark === undefined) return;
    api.zoomShow(rec.id);
  });

  hit.addEventListener('pointerleave', () => {
    rec.hover = false;
    card.classList.remove('hover');
    if (hoverId === rec.id) hoverId = null;
    api.zoomHide();
  });

  // The visible badge is its own target: clicking it never depends on the
  // 26 px corner maths, nor on the card not having moved in the meantime.
  const cornerEl = rec.glass.querySelector('.corner');
  if (cornerEl) {
    cornerEl.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();
      clearHold();
      downPos = null;
      pressedCross = false;
      crossAt = null;
      api.pressCorner(rec.id);
    });
  }

  // A click on a held trace brings it back; handled in pointerdown already.
}

/* --------------------------------------------------------------- layout --- */

function visibleIds() {
  if (!S) return [];
  if (!searching) return S.items.map((i) => i.id);
  return S.shownIds;
}

function layoutCards(animate = true) {
  if (!S) return;
  const ids = visibleIds();
  const pinned = searching ? 0 : countPinnedLead();
  const scrollPos = searching ? 0 : scroll;
  const count = ids.length;

  // remove cards that left
  for (const [id, rec] of [...cards]) {
    if (!ids.includes(id)) {
      rec.cancelSwing && rec.cancelSwing();
      rec.el.remove();
      cards.delete(id);
    }
  }

  ids.forEach((id, index) => {
    let rec = cards.get(id);
    if (!rec) {
      const item = S.items.find((i) => i.id === id);
      if (!item) return;
      rec = buildCard(item);
      cards.set(id, rec);
      // arrive: 16 degrees, dropped in from above
      rec.swing = 16;
      requestAnimationFrame(() => {
        rec.cancelSwing = spring(rec.swing, 0, 46, 2.6, (v) => {
          rec.swing = v;
          applyTransform(rec);
        });
        rec.arrived = true;
      });
    } else {
      rec.item = S.items.find((i) => i.id === id) || rec.item;
    }

    const x = xFor(index, count, S.visibleCount, scrollPos, pinned);
    const ry = ropeY(x);
    const top = ry - L.pinAbove;
    const h = L.panelHeight - ry;
    rec.el.style.left = `${x - L.cardWidth / 2}px`;
    rec.el.style.top = `${top}px`;
    rec.el.style.height = `${h}px`;
    rec.x = x;
    rec.ry = ry;

    // edge fade
    let op = clamp01(Math.min(x, width - x) / 90);
    if (keepOn() && count > S.visibleCount) {
      const bounds = scrollBounds(count, pinned);
      if (bounds) {
        const cardLeft = x - L.cardWidth / 2;
        const cardRight = x + L.cardWidth / 2;
        if (index >= pinned) {
          const gone = bounds[0] - L.cardWidth / 2;
          const rest = firstLooseX(count, pinned) - L.cardWidth / 2;
          const fadeIn = Math.min(1, Math.max(0, (cardLeft - gone) / Math.max(1, rest - gone)));
          op *= fadeIn;
          if (cardRight > bounds[1]) op *= 0.35;
        }
      }
    }
    rec.el.style.opacity = String(op);
    rec.hit.style.pointerEvents = op < 0.06 ? 'none' : 'auto';

    // state classes
    const it = rec.item;
    rec.el.classList.toggle('pinned', !!it.kept);
    rec.el.classList.toggle('selected', !!it.selected);
    rec.el.classList.toggle('copied', !!it.copied);
    rec.el.classList.toggle('held', !!it.held);
    const c = rec.el.querySelector('.corner');
    if (c) c.innerHTML = cornerIcon(it);
    applyTransform(rec);
  });

  drawKnot(ids, pinned);
  drawHint(ids.length === 0);
  reportHit();
}

function countPinnedLead() {
  if (!S) return 0;
  let n = 0;
  for (const i of S.items) {
    if (!i.kept) break;
    n++;
  }
  return n;
}

function firstLooseX(count, pinned) {
  const newest = width / 2 + ((S.visibleCount - 1) * L.spacing) / 2;
  const first = newest - (S.visibleCount - 1) * L.spacing;
  const lead = anchorsPinned(pinned, S.visibleCount) ? pinned : 0;
  return first + lead * L.spacing;
}

function scrollBounds(count, pinned) {
  if (!keepOn() || count <= S.visibleCount) return null;
  const pinnedStay =
    pinned > 0 && pinned < S.visibleCount - 1 && keepOn() && count > S.visibleCount;
  const start = pinnedStay ? knotXValue(count, pinned) || 0 : 0;
  return [start, width];
}

function knotXValue(count, pinned) {
  const items = S.items;
  let last = -1;
  items.forEach((i, idx) => {
    if (i.kept) last = idx;
  });
  if (last < 0) return null;
  const x = (i) => xFor(i, count, S.visibleCount, scroll, pinned);
  const pinnedEdge = pinned > 0 && pinned < S.visibleCount - 1 && keepOn() && count > S.visibleCount;
  if (pinnedEdge) return x(last) + L.spacing / 2;
  const next = last + 1 < count ? x(last + 1) : x(last) + L.spacing;
  return (x(last) + next) / 2;
}

function applyTransform(rec) {
  const angle = rec.swing + rec.tilt;
  rec.el.style.transform = `rotate(${angle.toFixed(3)}deg)`;
}

/* ------------------------------------------------------------------ rope --- */

function drawRope() {
  ropeEl.setAttribute('width', String(width));
  ropeEl.setAttribute('height', '60');
  ropeEl.setAttribute('viewBox', `0 0 ${width} 60`);
  const top = L.ropeTop;
  const s = sag();
  const d = `M -20 ${top} Q ${width / 2} ${top + 2 * s} ${width + 20} ${top}`;
  const maskId = 'ropeMask';
  ropeEl.innerHTML = `
    <defs>
      <linearGradient id="${maskId}" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0" stop-color="white" stop-opacity="0"/>
        <stop offset="0.08" stop-color="white" stop-opacity="1"/>
        <stop offset="0.92" stop-color="white" stop-opacity="1"/>
        <stop offset="1" stop-color="white" stop-opacity="0"/>
      </linearGradient>
      <filter id="ropeShadow" x="-5%" y="-200%" width="110%" height="500%">
        <feDropShadow dx="0" dy="1.2" stdDeviation="1.2" flood-color="rgba(0,0,0,0.22)"/>
      </filter>
    </defs>
    <g mask="url(#${maskId})">
      <path d="${d}" fill="none" stroke="rgba(0,0,0,0.22)" stroke-width="1.4" filter="url(#ropeShadow)"/>
      <path d="${d}" fill="none" stroke="#8c8c8c" stroke-width="1.2"/>
      <path d="${d}" fill="none" stroke="rgba(255,255,255,0.45)" stroke-width="0.4" transform="translate(0,-0.35)"/>
    </g>`;
}

function drawKnot(ids, pinned) {
  const items = S.items;
  const hasKept = items.some((i) => i.kept);
  if (searching || !hasKept || !ids.length) {
    knotEl.classList.remove('on');
    return;
  }
  const kx = knotXValue(ids.length, pinned);
  if (kx === null) {
    knotEl.classList.remove('on');
    return;
  }
  const ky = ropeY(kx) + 0.5;
  knotEl.style.left = `${kx - 4}px`;
  knotEl.style.top = `${ky - 3}px`;
  knotEl.classList.add('on');
  knotEl.firstElementChild.innerHTML = `
    <ellipse cx="4" cy="3" rx="3.5" ry="2.75" fill="#808080"/>
    <path d="M3.5 3 Q3.8 7 1.5 11" stroke="#8c8c8c" stroke-width="1" fill="none" stroke-linecap="round"/>
    <path d="M4 3 Q4.5 7 6.5 10" stroke="#8c8c8c" stroke-width="1" fill="none" stroke-linecap="round"/>`;
}

function drawHint(empty) {
  if (empty && !searching) {
    hintEl.classList.add('on');
    const cx = width / 2;
    hintEl.style.left = `${cx}px`;
    hintEl.style.top = `${ropeY(cx) + 34}px`;
  } else {
    hintEl.classList.remove('on');
  }
}

/* ------------------------------------------------------------ hit rects --- */

function reportHit() {
  const rects = {};
  for (const [id, rec] of cards) {
    if (!rec.el.style.opacity || Number(rec.el.style.opacity) < 0.06) continue;
    const g = rec.glass.getBoundingClientRect();
    rects[id] = { x: g.left, y: g.top, w: g.width, h: g.height };
  }
  let band = null;
  if (Object.keys(rects).length) {
    let top = Infinity;
    let bottom = -Infinity;
    for (const r of Object.values(rects)) {
      top = Math.min(top, r.y);
      bottom = Math.max(bottom, r.y + r.h);
    }
    band = { top, bottom };
  }
  const key = JSON.stringify([rects, band]);
  if (key === lastReportKey) return;
  lastReportKey = key;
  api.reportHitRects(rects, band);
}

/* --------------------------------------------------------------- search --- */

function applySearch() {
  searching = !!S.searching;
  layoutCards();
  if (searching) {
    // keep the line down while searching
    api.setPointerInside(true);
  }
}

/* ---------------------------------------------------------------- state --- */

function applyState(next) {
  const prev = S;
  S = next;
  L = next.layout;
  document.body.classList.toggle('dark', !!next.dark);

  if (!prev) {
    scroll = next.scroll || 0;
    revealed = next.revealed;
    applyReveal(next.revealed, false);
    drawRope();
    layoutCards(false);
    return;
  }

  // a card that was dropped: let it fall away
  const gone = prev.items.filter((p) => !next.items.some((n) => n.id === p.id));
  for (const g of gone) {
    const rec = cards.get(g.id);
    if (rec) fallAway(rec);
  }

  scroll = next.scroll || 0;
  if (next.revealed !== revealed) {
    applyReveal(next.revealed, true);
    for (const ms of [80, 200, 340, 480]) setTimeout(() => layoutCards(), ms);
  }
  applySearch();

  if (next.gust !== lastGust) {
    lastGust = next.gust;
    breeze();
  }

  // a card that arrived from a capture lands with a small sway
  if (prev.items.length < next.items.length) {
    const added = next.items.filter((n) => !prev.items.some((p) => p.id === n.id));
    for (const a of added) {
      const rec = cards.get(a.id);
      if (rec) setTimeout(() => nudge(rec, 2.2), 60);
    }
  }
}

function applyReveal(on, animate) {
  revealed = on;
  const shift = L ? L.panelHeight + 12 : 222;
  lineRoot.style.transform = on ? 'translateY(0px)' : `translateY(-${shift}px)`;
  lineRoot.classList.toggle('tucked', !on);
  if (!on) {
    hideMenu();
    closeSearchField();
  }
}

function fallAway(rec) {
  rec.cancelSwing && rec.cancelSwing();
  const start = performance.now();
  const tilt = rec.tilt;
  const from = rec.el.style.transform;
  const step = (now) => {
    const k = Math.min(1, (now - start) / 550);
    const e = k * k * k;
    const angle = tilt + (tilt * 7 + 20) * e;
    rec.el.style.transform = `translateY(${520 * e}px) rotate(${angle}deg)`;
    rec.el.style.opacity = String(1 - e);
    if (k < 1) requestAnimationFrame(step);
    else {
      rec.el.remove();
      cards.delete(rec.id);
      layoutCards();
    }
  };
  requestAnimationFrame(step);
}

function breeze() {
  if (!revealed) return;
  for (const rec of cards.values()) {
    const delay = Math.random() * 350;
    setTimeout(() => {
      if (!revealed) return;
      nudge(rec, 1.6 + Math.random() * 1.8);
    }, delay);
  }
}

function nudge(rec, deg) {
  if (!revealed) return;
  rec.cancelSwing && rec.cancelSwing();
  const t0 = performance.now();
  const dur = 300;
  const startSwing = rec.swing;
  const step = (now) => {
    const k = Math.min(1, (now - t0) / dur);
    const e = 1 - Math.pow(1 - k, 3);
    rec.swing = startSwing + (deg - startSwing) * e;
    applyTransform(rec);
    if (k < 1) requestAnimationFrame(step);
    else {
      rec.cancelSwing = spring(rec.swing, 0, 38, 2.4, (v) => {
        rec.swing = v;
        applyTransform(rec);
      });
    }
  };
  requestAnimationFrame(step);
}

/* ---------------------------------------------------------------- wheel --- */

window.addEventListener(
  'wheel',
  (e) => {
    if (!revealed) return;
    const dx = Math.abs(e.deltaX) >= Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
    const precise = e.deltaMode === 0;
    const delta = precise ? dx : dx * 12;
    api.scrollBy(delta);
  },
  { passive: true }
);

/* ----------------------------------------------------------------- menu --- */

function hideMenu() {
  menuEl.classList.remove('on');
  menuOpen = false;
  api.reportCapture([]);
}

// Native menus are used for cards (see main), so this is only a fallback.

/* -------------------------------------------------------------- search UI --- */

function openSearchField() {
  api.openSearch();
}

function closeSearchField() {
  api.reportCapture([]);
}

/* ---------------------------------------------------------------- sound --- */

const audio = { tink: null, pop: null };
let soundUrls = null;

function playSound(name) {
  if (!soundUrls) return;
  const url = soundUrls[name];
  if (!url) return;
  const a = new Audio(url);
  a.volume = name === 'pop' ? 0.25 : 0.35;
  a.play().catch(() => {});
}

/* ------------------------------------------------------------------ boot --- */

api.onState((next) => {
  try {
    applyState(next);
  } catch (e) {
    console.error(e);
  }
});

api.onReveal((on) => {
  if (!L) return;
  applyReveal(on, true);
  layoutCards();
  // The slide is a CSS transition: getBoundingClientRect reports the START
  // position until it finishes, and the main process keeps those stale rects
  // forever (it dedups unchanged reports) — the mouse could then never enter
  // the window. Re-measure while it settles and once it has.
  for (const ms of [80, 200, 340, 480]) setTimeout(() => layoutCards(), ms);
});

api.onRelayout(() => {
  width = window.innerWidth;
  if (!L) return;
  drawRope();
  layoutCards(false);
});

api.onSound((name) => playSound(name));

api.onSearch((payload) => {
  if (!S) return;
  S.searching = payload.active;
  S.query = payload.query;
  searching = payload.active;
  layoutCards();
});

window.addEventListener('resize', () => {
  width = window.innerWidth;
  if (!L) return;
  drawRope();
  layoutCards(false);
});

// Self-healing hit rects: a state push that lands mid-transition can leave the
// main process with rects measured at the wrong offset, and nothing would
// re-measure afterwards. Re-report periodically while down; reportHit dedups,
// so this costs four getBoundingClientRect calls and sends only on change.
setInterval(() => {
  if (revealed && S) reportHit();
}, 120);

Promise.all([api.getState(), Promise.resolve(api.soundUrls ? api.soundUrls() : null)]).then(([next, urls]) => {
  width = window.innerWidth;
  soundUrls = urls;
  applyState(next);
  lastGust = next.gust || 0;
});

// A card that arrived with a flight gets a tiny sway when it lands.
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    hideMenu();
    closeSearchField();
    api.clearSelection();
  }
});
