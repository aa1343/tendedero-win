// The line: what hangs on it, in what order, and what each item can do.
// Port of Line.swift. Files never move on their own — the line is a view.
const fs = require('fs');
const path = require('path');
const { nativeImage, shell, clipboard, app } = require('electron');
const store = require('./store');
const notes = require('./note');

const RECORDING_EXT = new Set(['mov', 'mp4', 'webm', 'mkv']);
const IMAGE_EXT = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'tif', 'tiff', 'ico', 'avif']);
const TEXT_EXT = new Set(['txt', 'rtf', 'md']);

const MAX_STEPS = 20;

let seq = 0;
const nextId = () => `p${++seq}`;
function ext(url) {
  return path.extname(url).toLowerCase().replace('.', '');
}

function isRecording(url) {
  return RECORDING_EXT.has(ext(url));
}

function isText(url) {
  return TEXT_EXT.has(ext(url)) && store.contains(store.NOTES, url);
}

function isImage(url) {
  return IMAGE_EXT.has(ext(url)) || isRecording(url);
}

function kindOf(url) {
  if (isRecording(url)) return 'recording';
  if (isText(url)) return 'note';
  return 'photo';
}

// --- thumbnails -----------------------------------------------------------

const thumbCache = new Map(); // url -> {mtime, dataUrl, w, h}

function thumbFor(url, scale) {
  const st = (() => {
    try {
      return fs.statSync(url);
    } catch {
      return null;
    }
  })();
  if (!st) return null;
  const key = `${url}|${scale}`;
  const hit = thumbCache.get(key);
  if (hit && hit.mtime === st.mtimeMs) return hit;

  const maxPx = Math.round(320 * scale);
  let img = null;
  try {
    img = nativeImage.createFromPath(url);
  } catch {
    img = null;
  }
  if (!img || img.isEmpty()) {
    // Not something Chromium can decode (e.g. a video). Fall back to a plate.
    const rec = { mtime: st.mtimeMs, dataUrl: '', w: maxPx, h: Math.round(maxPx * 0.62), empty: true };
    thumbCache.set(key, rec);
    return rec;
  }
  const size = img.getSize();
  const s = Math.min(1, maxPx / Math.max(size.width, size.height));
  const resized = s < 1 ? img.resize({ width: Math.round(size.width * s), height: Math.round(size.height * s), quality: 'best' }) : img;
  const rs = resized.getSize();
  const rec = { mtime: st.mtimeMs, dataUrl: resized.toDataURL(), w: rs.width, h: rs.height, empty: false };
  thumbCache.set(key, rec);
  return rec;
}

// --- the line -------------------------------------------------------------

class Line {
  constructor() {
    this.items = [];
    this.maxItems = 8;
    this.spacing = 174;
    this.visibleCount = 8;
    this.scroll = 0;
    this.query = '';
    this.selected = new Set();
    this.copied = new Set();
    this.held = new Set();
    this.dragging = null;
    this.pressed = null;
    this.gust = 0;
    this.steps = []; // undo stack: [{ids:[], records:[]}]
    this.desktopSaves = new Map();
    this.listeners = new Set();
    this.gustTimer = null;
    this.copyTimer = null;
    this.revealed = false;
    this.searchIndex = new Map(); // url -> {modified, text}
    this.searchIndexLoaded = false;
    this.searchQueue = [];
    this.searchBusy = false;
    this.ocrRunner = null;
    this.restore();
  }

  onChange(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  emit(what = 'items') {
    for (const fn of this.listeners) {
      try {
        fn(what);
      } catch (e) {
        console.error('listener', e);
      }
    }
  }

  // -- derived -------------------------------------------------------------

  get live() {
    return this.items.filter((i) => !i.falling);
  }

  get liveCount() {
    return this.items.filter((i) => !i.falling).length;
  }

  get keptCount() {
    return this.items.filter((i) => !i.falling && i.kept).length;
  }

  get pinnedLead() {
    let n = 0;
    for (const i of this.items) {
      if (!i.kept) break;
      n++;
    }
    return n;
  }

  get oldestLoose() {
    return this.items.find((i) => !i.falling && !i.kept && !i.held);
  }

  get isSearching() {
    return words(this.query).length > 0;
  }

  get shown() {
    const w = words(this.query);
    if (!w.length) return this.items;
    return this.items.filter((i) => i.falling || this.matches(i, w));
  }

  get canPutBack() {
    return this.steps.length > 0;
  }

  // -- capacity ------------------------------------------------------------

  setCapacity(panelWidth, spacing) {
    const usable = panelWidth - 200;
    const fits = Math.max(3, Math.min(12, Math.floor(usable / spacing)));
    this.visibleCount = fits;
    const keep = store.get('keepOnLine');
    const keepN = [25, 50, 100].includes(keep) ? keep : null;
    this.maxItems = Math.max(fits, keepN ?? fits);
    this.scroll = Math.min(this.scroll, this.maxScroll);
  }

  get scrollable() {
    return [25, 50, 100].includes(store.get('keepOnLine'));
  }

  get maxScroll() {
    const keep = store.get('keepOnLine');
    if (![25, 50, 100].includes(keep)) return 0;
    const spacing = this.spacing || 174;
    return Math.max(0, this.liveCount - this.visibleCount) * spacing;
  }

  setSpacing(sp) {
    this.spacing = sp;
    this.scroll = Math.min(this.scroll, this.maxScroll);
  }

  scrollBy(delta) {
    const next = Math.max(0, Math.min(this.maxScroll, this.scroll + delta));
    if (next !== this.scroll) {
      this.scroll = next;
      this.emit('layout');
    }
  }

  // -- hanging -------------------------------------------------------------

  makeItem(url, { flying = false } = {}) {
    const kind = kindOf(url);
    const scale = { small: 0.8, medium: 1, large: 1.35 }[store.get('lineSize')] || 1;
    const thumb = kind === 'note' ? null : thumbFor(url, scale);
    if (kind !== 'note' && (!thumb || thumb.empty) && !isRecording(url)) return null;
    return {
      id: nextId(),
      url,
      kind,
      tilt: Math.random() * 5 - 2.5,
      falling: false,
      flying,
      kept: false,
      held: false,
      byHand: false,
      thumb,
      scale,
    };
  }

  hang(url, { quietly = false, flying = false, pin = false } = {}) {
    const resolved = path.resolve(url);
    if (this.items.some((i) => !i.falling && path.resolve(i.url) === resolved)) return null;
    if (!fs.existsSync(resolved)) return null;
    const item = this.makeItem(resolved, { flying });
    if (!item) return null;
    this.sweepFallen();
    this.items.push(item);
    if (pin) {
      this.items.pop();
      item.kept = true;
      this.items.push(item);
      this.keepKeptFirst();
    }
    this.scroll = 0;
    if (this.liveCount > this.maxItems && this.oldestLoose) this.letGo(this.oldestLoose.id);
    this.save();
    this.emit('hang');
    return item.id;
  }

  land(id) {
    const it = this.items.find((i) => i.id === id);
    if (it) it.flying = false;
  }

  drop(id, { quietly = false } = {}) {
    const it = this.items.find((i) => i.id === id);
    if (!it || it.falling) return;
    this.selected.delete(id);
    it.falling = true;
    this.save();
    this.emit('fall');
    if (!quietly) this.play('pop');
    this.lastFall = Date.now();
  }

  sweepFallen() {
    if (this.items.some((i) => i.falling)) {
      this.items = this.items.filter((i) => !i.falling);
    }
  }

  closeGaps() {
    if (!this.items.some((i) => i.falling)) return;
    if (Date.now() - (this.lastFall || 0) < 600) return;
    this.sweepFallen();
    this.emit('layout');
  }

  clear() {
    this.takeDown(this.items.filter((i) => !i.falling && !i.kept && !i.held));
  }

  neighbours(id, toTheLeft) {
    const live = this.items.filter((i) => !i.falling);
    const idx = live.findIndex((i) => i.id === id);
    if (idx < 0) return [];
    const side = toTheLeft ? live.slice(0, idx) : live.slice(idx + 1);
    return side.filter((i) => !i.kept && !i.held);
  }

  takeDownSide(id, side) {
    this.takeDown(this.neighbours(id, side === 'left'));
  }

  takeDown(list) {
    if (!list.length) return;
    const step = [];
    list.forEach((item, n) => {
      setTimeout(() => {
        this.discard(item.id, { quietly: n > 0, step });
      }, 60 * n);
    });
  }

  prune() {
    for (const i of this.items) {
      if (!i.falling && !fs.existsSync(i.url)) this.drop(i.id, { quietly: true });
    }
  }

  // -- selection -----------------------------------------------------------

  actionItems(ids) {
    const set = new Set(ids);
    return this.items.filter((i) => !i.falling && set.has(i.id));
  }

  get selectedItems() {
    return this.actionItems([...this.selected]);
  }

  toggleSelection(id) {
    if (this.selected.has(id)) this.selected.delete(id);
    else this.selected.add(id);
    this.emit('selection');
  }

  clearSelection() {
    if (!this.selected.size) return;
    this.selected.clear();
    this.emit('selection');
  }

  // -- actions -------------------------------------------------------------

  async copy(ids) {
    const list = this.actionItems(ids);
    if (!list.length) return false;
    const textParts = [];
    const files = [];
    let allImages = true;
    for (const it of list) {
      if (it.kind === 'note') {
        const n = notes.parse(it.url);
        if (n) textParts.push(n.linkUrl || (n.title ? `${n.title}\n${n.body}` : n.body));
        allImages = false;
      } else {
        files.push(it.url);
      }
    }
    if (files.length === 1 && allImages) {
      const img = nativeImage.createFromPath(files[0]);
      if (img && !img.isEmpty()) clipboard.writeImage(img);
      else clipboard.writeText(files[0]);
    } else if (files.length > 1) {
      // Windows has no multi-file clipboard flavour through Electron; put the
      // paths on as text so a paste into Explorer works.
      clipboard.writeText(files.map((f) => `"${f}"`).join('\r\n'));
    } else if (textParts.length) {
      clipboard.writeText(textParts.join('\r\n\r\n'));
    } else if (files.length === 1) {
      clipboard.writeText(files[0]);
    }
    for (const it of list) this.copied.add(it.id);
    if (this.copyTimer) clearTimeout(this.copyTimer);
    this.copyTimer = setTimeout(() => {
      this.copied.clear();
      this.emit('copied');
    }, 1200);
    this.play('tink');
    this.emit('copied');
    return true;
  }

  async open(ids) {
    const list = this.actionItems(ids);
    for (const it of list) {
      if (it.kind === 'note') {
        const n = notes.parse(it.url);
        if (n && n.linkUrl) {
          await shell.openExternal(n.linkUrl);
          continue;
        }
      }
      await shell.openPath(it.url);
    }
    return true;
  }

  quickLook(id) {
    const it = this.items.find((i) => i.id === id);
    if (!it) return false;
    shell.openPath(it.url);
    return true;
  }

  markup(id) {
    const it = this.items.find((i) => i.id === id);
    if (!it) return false;
    // Windows has no system Markup extension: open the file in the default
    // image editor (Photos / Paint), which is where "Markup" lands on macOS.
    shell.openPath(it.url);
    return true;
  }

  revealInExplorer(id) {
    const it = this.items.find((i) => i.id === id);
    if (!it) return false;
    shell.showItemInFolder(it.url);
    return true;
  }

  async saveToDesktop(ids, step = null) {
    const list = this.actionItems(ids);
    let ok = 0;
    for (const it of list) {
      const target = store.uniqueIn(app.getPath('desktop'), path.basename(it.url));
      try {
        fs.copyFileSync(it.url, target);
        this.desktopSaves.set(target, fs.statSync(target).mtimeMs);
        ok++;
      } catch (e) {
        console.error('save to desktop failed', e);
      }
    }
    if (ok) this.play('tink');
    return ok;
  }

  isOnDesktop(url) {
    const dir = path.dirname(url).toLowerCase();
    return dir === path.resolve(app.getPath('desktop')).toLowerCase();
  }

  // Where the corner button leads.
  corner(id) {
    const it = this.items.find((i) => i.id === id);
    if (!it) return 'hide';
    if (it.kept && it.byHand) return 'hide';
    if (it.kept) return 'unpin';
    if (store.inInbox(it.url)) return 'trash';
    return 'hide';
  }

  pressCorner(id) {
    const what = this.corner(id);
    if (what === 'unpin') this.unpin([id]);
    else if (what === 'trash') this.trash([id]);
    else this.discard([id]);
    return what;
  }

  canDiscard(ids) {
    const list = this.actionItems(ids);
    return list.length > 0 && list.every((i) => !i.kept || i.byHand);
  }

  // Take down: keep the file, remove the card. An inbox file goes into the
  // app's own Trash folder so "Put back" can return it; anything else is only
  // hidden from the line.
  discard(ids, { quietly = false, step = null } = {}) {
    const list = this.actionItems(ids);
    if (!list.length) return 0;
    const records = [];
    for (const it of list) {
      records.push({
        url: it.url,
        index: this.items.filter((i) => !i.falling).findIndex((i) => i.id === it.id),
        kept: it.kept,
        byHand: it.byHand,
        trashed: null,
      });
      if (store.inInbox(it.url)) {
        const moved = store.trashFile(it.url);
        if (moved) records[records.length - 1].trashed = moved;
      }
      this.drop(it.id, { quietly: quietly || list.length > 1 });
    }
    this.pushStep(records, step);
    this.emit('items');
    return list.length;
  }

  trash(ids) {
    return this.discard(ids);
  }

  letGo(id) {
    const it = this.items.find((i) => i.id === id);
    if (!it) return;
    if (store.inInbox(it.url)) this.discard([id], { quietly: true });
    else this.drop(id, { quietly: true });
    this.emit('items');
  }

  pin(ids, { quietly = false, step = null } = {}) {
    const list = this.actionItems(ids).filter((i) => !i.kept);
    if (!list.length) return 0;
    const records = [];
    for (const it of list) {
      records.push({ url: it.url, kept: false, byHand: false, pinChange: true });
      this.items = this.items.filter((x) => x.id !== it.id);
      it.kept = true;
      const at = this.keptCount;
      this.items.splice(at, 0, it);
    }
    this.pushStep(records, step);
    this.save();
    if (!quietly) this.play('tink');
    this.emit('items');
    return list.length;
  }

  unpin(ids, { step = null } = {}) {
    const list = this.actionItems(ids).filter((i) => i.kept && !i.byHand);
    if (!list.length) return 0;
    const records = [];
    for (const it of [...list].reverse()) {
      records.push({ url: it.url, kept: true, byHand: false, pinChange: true });
      this.items = this.items.filter((x) => x.id !== it.id);
      it.kept = false;
      const at = this.keptCount;
      this.items.splice(at, 0, it);
    }
    this.pushStep(records, step);
    this.save();
    this.emit('items');
    return list.length;
  }

  keepKeptFirst() {
    const kept = this.items.filter((i) => i.kept);
    const loose = this.items.filter((i) => !i.kept);
    this.items = [...kept, ...loose];
  }

  // Hang a file by hand (Hang on Tendedero).
  hangKept(url) {
    const id = this.hang(url, { pin: true });
    if (!id) return false;
    const it = this.items.find((i) => i.id === id);
    if (it) {
      it.byHand = true;
      it.kept = true;
      this.keepKeptFirst();
      this.save();
      this.emit('items');
    }
    return true;
  }

  setHeld(id, held) {
    const it = this.items.find((i) => i.id === id);
    if (!it) return;
    it.held = held;
    if (held) this.held.add(id);
    else this.held.delete(id);
    this.emit('items');
  }

  // -- undo ----------------------------------------------------------------

  pushStep(records, step) {
    if (step) {
      step.push(...records);
      return;
    }
    if (!records.length) return;
    this.steps.push({ records });
    if (this.steps.length > MAX_STEPS) this.steps.shift();
  }

  putBack() {
    const step = this.steps.pop();
    if (!step) return false;
    // A card that was just taken down is still on its way out; clear it so the
    // item coming back is not mistaken for a duplicate of it.
    this.sweepFallen();
    const restored = new Set();
    for (const rec of step.records) {
      if (rec.pinChange) {
        const it = this.items.find((i) => i.url === rec.url);
        if (it) {
          it.kept = rec.kept;
          it.byHand = rec.byHand;
        }
        continue;
      }
      // A file we took down from our own folder comes back out of the Trash.
      let url = rec.url;
      if (rec.trashed) {
        const back = store.restoreFile(rec.trashed, rec.url);
        if (!back) continue;
        url = back;
      }
      if (!fs.existsSync(url)) continue;
      if (this.items.some((i) => path.resolve(i.url) === path.resolve(url))) continue;
      const item = this.makeItem(url);
      if (!item) continue;
      item.kept = rec.kept;
      item.byHand = rec.byHand;
      const at = Math.max(0, Math.min(this.items.length, rec.index ?? this.items.length));
      this.items.splice(at, 0, item);
      restored.add(item.id);
    }
    // Undo never evicts what it just restored.
    while (this.liveCount > this.maxItems) {
      const victim = this.items.find((i) => !i.falling && !i.kept && !i.held && !restored.has(i.id));
      if (!victim) break;
      this.letGo(victim.id);
    }
    this.keepKeptFirst();
    this.save();
    this.play('tink');
    this.emit('items');
    return true;
  }

  // -- search --------------------------------------------------------------

  loadIndex() {
    if (this.searchIndexLoaded) return;
    this.searchIndexLoaded = true;
    try {
      const raw = JSON.parse(fs.readFileSync(store.INDEX_FILE, 'utf8'));
      for (const [k, v] of Object.entries(raw)) {
        if (v && typeof v.text === 'string') this.searchIndex.set(k, v);
      }
    } catch {}
  }

  saveIndex() {
    try {
      const obj = {};
      for (const [k, v] of this.searchIndex) obj[k] = v;
      fs.writeFileSync(store.INDEX_FILE, JSON.stringify(obj), { mode: 0o600 });
    } catch {}
  }

  updateIndex(urls) {
    const live = new Set(urls);
    let changed = false;
    for (const k of [...this.searchIndex.keys()]) {
      if (!live.has(k)) {
        this.searchIndex.delete(k);
        changed = true;
      }
    }
    if (changed) this.saveIndex();
    for (const url of urls) {
      if (isText(url)) continue;
      if (!isImage(url)) continue;
      const st = (() => {
        try {
          return fs.statSync(url);
        } catch {
          return null;
        }
      })();
      if (!st) continue;
      const hit = this.searchIndex.get(url);
      if (hit && hit.modified === st.mtimeMs) continue;
      if (this.searchQueue.includes(url)) continue;
      this.searchQueue.push(url);
    }
    this.pumpSearch();
  }

  async pumpSearch() {
    if (this.searchBusy || !this.searchQueue.length) return;
    this.searchBusy = true;
    const url = this.searchQueue.shift();
    const st = (() => {
      try {
        return fs.statSync(url);
      } catch {
        return null;
      }
    })();
    if (st) {
      const text = await this.recognize(url);
      this.searchIndex.set(url, { modified: st.mtimeMs, text: fold(text || '') });
      this.saveIndex();
      this.emit('search');
    }
    this.searchBusy = false;
    if (this.searchQueue.length) setImmediate(() => this.pumpSearch());
  }

  recognize(url) {
    return new Promise((resolve) => {
      try {
        const { recognizeFile } = require('./ocr');
        recognizeFile(url)
          .then((t) => resolve(t))
          .catch(() => resolve(''));
      } catch {
        resolve('');
      }
    });
  }

  matches(item, wordList) {
    let text;
    if (item.kind === 'note') {
      const n = notes.parse(item.url);
      if (!n) return false;
      const parts = [n.title, n.body];
      if (n.linkHost) parts.push(n.linkHost, n.linkPath);
      text = fold(parts.join('\n'));
    } else {
      text = this.searchIndex.get(item.url)?.text || '';
    }
    return wordList.every((w) => text.includes(w));
  }

  get newestMatch() {
    const w = words(this.query);
    if (!w.length) return null;
    const shown = this.items.filter((i) => !i.falling && this.matches(i, w));
    return shown.length ? shown[shown.length - 1] : null;
  }

  // -- persistence ---------------------------------------------------------

  save() {
    const live = this.items.filter((i) => !i.falling);
    store.saveLine(
      live.map((i) => i.url),
      live.filter((i) => i.kept).map((i) => i.url),
      live.filter((i) => i.byHand).map((i) => i.url)
    );
    this.updateIndex(live.map((i) => i.url));
  }

  restore() {
    const { pegged, kept, byHand } = store.restoreLine();
    for (const p of pegged) {
      if (!fs.existsSync(p)) continue;
      if (this.items.some((i) => i.url === p)) continue;
      const item = this.makeItem(p);
      if (!item) continue;
      item.byHand = byHand.has(p);
      item.kept = kept.has(p) || item.byHand;
      this.items.push(item);
    }
    this.keepKeptFirst();
  }

  // -- sounds --------------------------------------------------------------

  play(name) {
    if (store.get('soundOff')) return;
    this.emit('sound:' + name);
  }

  // -- breeze --------------------------------------------------------------

  startBreeze() {
    if (this.gustTimer) return;
    const tick = () => {
      const wait = 7000 + Math.random() * 9000;
      this.gustTimer = setTimeout(() => {
        if (this.revealed && !this.dragging) {
          this.gust++;
          this.emit('gust');
        }
        tick();
      }, wait);
    };
    tick();
  }

  stopBreeze() {
    if (this.gustTimer) clearTimeout(this.gustTimer);
    this.gustTimer = null;
  }
}

// -- text helpers ----------------------------------------------------------

function fold(s) {
  return String(s)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[\uFF01-\uFF5E]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0));
}

function words(q) {
  return fold(q)
    .split(/\s+/)
    .filter(Boolean);
}

module.exports = { Line, fold, words, kindOf, isRecording, isText, isImage, thumbFor, nextId };
