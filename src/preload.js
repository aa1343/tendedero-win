// Tendedero for Windows — preload.
// The renderer never touches Node. Everything goes through this bridge.
const { contextBridge, ipcRenderer, webUtils } = require('electron');

// Renderers run sandboxed, so this script cannot require local modules: the
// main process hands over the active language and its string table instead.
// It is read synchronously at preload time — switching the language reloads
// every window, so there is no live re-translation to do.
const BOOT = (() => {
  try {
    return ipcRenderer.sendSync('app:strings') || {};
  } catch {
    return {};
  }
})();
const LANG = BOOT.lang === 'en' ? 'en' : 'zh';
const STR = BOOT.strings || {};
const t = (key, ...args) => {
  const s = STR[key] === undefined ? key : STR[key];
  return String(s).replace(/\{(\d+)\}/g, (m, i) => (args[i] === undefined ? '' : String(args[i])));
};

const invoke = (ch, ...a) => ipcRenderer.invoke(ch, ...a);
const send = (ch, ...a) => ipcRenderer.send(ch, ...a);

const on = (ch, fn) => {
  const h = (_e, ...a) => fn(...a);
  ipcRenderer.on(ch, h);
  return () => ipcRenderer.removeListener(ch, h);
};

contextBridge.exposeInMainWorld('td', {
  // ---- i18n ----
  lang: LANG,
  t,

  // ---- state ----
  getState: () => invoke('state:get'),
  onState: (fn) => on('state', fn),

  // ---- geometry / hit testing (renderer -> main) ----
  // rects: { [id]: {x,y,w,h} } in window CSS pixels; band: {top,bottom} or null
  reportHitRects: (rects, band) => send('hit:report', rects, band),
  // Search field / menu / other regions that must capture the mouse.
  reportCapture: (rects) => send('hit:capture', rects),

  // ---- line ----
  reveal: () => send('line:reveal'),
  tuck: () => send('line:tuck'),
  clear: () => invoke('line:clear'),
  putBack: () => invoke('line:putBack'),
  scrollBy: (delta) => invoke('line:scroll', delta),
  setPointerInside: (v) => send('line:pointer', v),

  // ---- item actions ----
  copy: (ids) => invoke('item:copy', ids),
  open: (ids) => invoke('item:open', ids),
  quickLook: (id) => invoke('item:quickLook', id),
  hold: (id) => invoke('item:hold', id),
  hangBack: (id) => invoke('item:hangBack', id),
  markup: (id) => invoke('item:markup', id),
  revealInExplorer: (id) => invoke('item:reveal', id),
  share: (ids) => invoke('item:share', ids),
  pin: (ids) => invoke('item:pin', ids),
  unpin: (ids) => invoke('item:unpin', ids),
  saveToDesktop: (ids) => invoke('item:saveToDesktop', ids),
  takeDown: (ids) => invoke('item:takeDown', ids),
  discard: (ids) => invoke('item:discard', ids),
  trash: (ids) => invoke('item:trash', ids),
  takeDownSide: (id, side) => invoke('item:takeDownSide', id, side),
  pressCorner: (id) => invoke('item:corner', id),
  startDrag: (ids) => invoke('item:drag', ids),

  // ---- selection ----
  toggleSelection: (id) => send('selection:toggle', id),
  clearSelection: () => send('selection:clear'),
  openSearch: () => send('search:open'),

  // ---- search ----
  setQuery: (q) => invoke('search:query', q),
  endSearch: () => invoke('search:end'),
  copyNewestMatch: () => invoke('search:copyNewest'),
  onSearch: (fn) => on('search', fn),
  onSearchCount: (fn) => on('search:count', fn),
  onSearchFocus: (fn) => on('search:focus', fn),

  // ---- zoom ----
  zoomShow: (id) => send('zoom:show', id),
  zoomHide: () => send('zoom:hide'),
  onZoomData: (fn) => on('zoom:data', fn),

  // ---- held ----
  onHeldData: (fn) => on('held:data', fn),
  heldReady: (id) => send('held:ready', id),
  onShortcutCurrent: (fn) => on('shortcut:current', fn),
  setShortcut: (sc) => send('shortcut:set', sc),

  // ---- line events ----
  onReveal: (fn) => on('reveal', fn),
  onPointer: (fn) => on('pointer', fn),
  onRelayout: (fn) => on('relayout', fn),
  onGust: (fn) => on('gust', fn),
  onSound: (fn) => on('sound', fn),

  // ---- menu (HTML menu rendered in the strip) ----
  cardMenu: (id) => invoke('menu:card', id),
  selectionMenu: (ids) => invoke('menu:selection', ids),

  // ---- misc ----
  thumbUrl: (id) => invoke('item:thumb', id),
  openSettingsFolder: () => invoke('app:openFolder'),
  setLang: (next) => invoke('app:setLang', next),
  autoClean: () => invoke('app:autoclean'),
  quit: () => invoke('app:quit'),
  soundUrls: () => invoke('app:sounds'),
  diag: () => invoke('diag:get'),
  pathForFile: (file) => { try { return webUtils.getPathForFile(file); } catch { return ''; } },
});
