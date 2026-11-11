// Tendedero for Windows — main process.
// The line is a transparent strip along the top of the screen. It is
// click-through everywhere except over a card, exactly like the macOS panel.
const {
  app,
  BrowserWindow,
  ipcMain,
  screen,
  Tray,
  Menu,
  clipboard,
  nativeImage,
  shell,
  globalShortcut,
  nativeTheme,
  dialog,
} = require('electron');
const fs = require('fs');
const path = require('path');

const store = require('./store');
const { Line, kindOf, isRecording, isText } = require('./line');
const notes = require('./note');
const { Watcher, screenshotsFolder } = require('./watcher');
const { ClipboardWatcher, enabled: clipboardEnabled } = require('./clipboard-watcher');
const icons = require('./icon');
const ocr = require('./ocr');
const autoClean = require('./autoclean');
const i18n = require('../shared/i18n');

// UI language. null in settings means "follow the system once, then keep it".
let lang = i18n.normalize(store.get('lang')) || i18n.normalize(app.getLocale()) || 'zh';
const tr = (key, ...args) => i18n.t(lang, key, ...args);
notes.setLang(lang);

// Preload scripts ask for this synchronously while the window is loading, which
// can happen before wireIpc() runs — so it is registered up here.
ipcMain.on('app:strings', (e) => {
  e.returnValue = { lang, strings: i18n.DICT[lang] || i18n.DICT.zh };
});

const SIZE = { small: 0.8, medium: 1, large: 1.35 };

function layout() {
  const scale = SIZE[store.get('lineSize')] || 1;
  const photoMaxHeight = Math.round(104 * scale);
  const cardWidth = Math.round(150 * scale);
  const spacing = cardWidth + 24;
  const panelHeight = photoMaxHeight + 106;
  return { scale, photoMaxHeight, cardWidth, spacing, panelHeight, ropeTop: 10, pinAbove: 9.5 };
}

// The window is taller than the line so a card can be seen falling.
const FALL_ROOM = 460;

let strip = null;
let searchWin = null;
let zoomWin = null;
let heldWins = new Map(); // id -> BrowserWindow
let tray = null;
let line = null;
let watcher = null;
let clipWatch = null;

let hitRects = {}; // id -> {x,y,w,h} in window CSS px
let captureRects = []; // extra regions that must take the mouse
let band = null; // {top, bottom} of the hanging band
let pointerInside = false;
let pointerInBand = false;
let ignoringMouse = true;
let revealed = false;
let revealedAt = 0;
let dwellStart = 0;
let awaySince = 0;
let peekUntil = 0;
let peekStart = 0;
let menuBarSuppressed = false;
let menuOpen = false;
let lastTick = 0;
let trayIconState = null;
let tickErrors = 0;
let dragCalls = 0;
let lastDragError = null;
let hoverCardId = null; // card under the pointer, tracked by the 30 Hz tick
let deleteShortcutOn = false; // Delete is registered only while hovering a card

const TICK_MS = 33; // ~30 Hz, as the original's pointer tracker

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function workArea() {
  const pt = screen.getCursorScreenPoint();
  const d = screen.getDisplayNearestPoint(pt);
  return d.workArea;
}

function stripBounds() {
  const wa = workArea();
  const { panelHeight } = layout();
  return {
    x: wa.x,
    y: wa.y,
    width: wa.width,
    height: panelHeight + FALL_ROOM,
  };
}

function sendStrip(channel, ...args) {
  if (strip && !strip.isDestroyed()) strip.webContents.send(channel, ...args);
}

function t(key) {
  return key; // strings live in the renderer; main only needs a few literals
}

// ---------------------------------------------------------------------------
// state snapshot for the renderer
// ---------------------------------------------------------------------------

function snapshot() {
  const L = layout();
  const shown = line.shown.filter((i) => !i.falling || i.fallVisible !== false);
  const keepN = store.get('keepOnLine');
  return {
    items: line.items
      .filter((i) => !i.falling)
      .map((i) => {
        const n = i.kind === 'note' ? notes.parse(i.url) : null;
        return {
          id: i.id,
          kind: i.kind,
          url: i.url,
          name: path.basename(i.url),
          tilt: i.tilt,
          kept: i.kept,
          byHand: i.byHand,
          held: line.held.has(i.id),
          copied: line.copied.has(i.id),
          selected: line.selected.has(i.id),
          thumb: i.thumb ? { dataUrl: i.thumb.dataUrl, w: i.thumb.w, h: i.thumb.h } : null,
          note: n
            ? {
                title: n.title,
                body: n.body,
                code: n.code,
                markdown: n.markdown,
                link: n.linkUrl,
                linkHost: n.linkHost,
                linkPath: n.linkPath,
                dateText: n.dateText,
                bodyHtml: notes.renderBody(n),
              }
            : null,
          isRecording: i.kind === 'recording',
        };
      }),
    shownIds: shown.filter((i) => !i.falling).map((i) => i.id),
    layout: L,
    revealed,
    searching: line.isSearching,
    query: line.query,
    scroll: line.scroll,
    visibleCount: line.visibleCount,
    maxItems: line.maxItems,
    keepOnLine: [25, 50, 100].includes(keepN) ? keepN : null,
    selectedCount: line.selected.size,
    canPutBack: line.canPutBack,
    heldCount: line.held.size,
    dark: nativeTheme.shouldUseDarkColors,
    soundOff: store.get('soundOff'),
  };
}

function push() {
  sendStrip('state', snapshot());
  updateTray();
}

// ---------------------------------------------------------------------------
// the strip window
// ---------------------------------------------------------------------------

function createStrip() {
  const b = stripBounds();
  strip = new BrowserWindow({
    ...b,
    frame: false,
    transparent: true,
    hasShadow: false,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    focusable: false,
    acceptFirstMouse: true,
    backgroundColor: '#00000000',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
    },
  });
  strip.setAlwaysOnTop(true, 'screen-saver');
  strip.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  strip.setIgnoreMouseEvents(true, { forward: true });
  strip.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  strip.once('ready-to-show', () => {
    strip.showInactive();
    applyReveal(false);
  });
  strip.on('closed', () => {
    strip = null;
  });
  // A right-click on the strip is ours; never let Chromium show a menu.
  strip.webContents.on('context-menu', (e) => e.preventDefault());
}

function applyReveal(next) {
  if (revealed === next) {
    sendStrip('reveal', revealed);
    return;
  }
  revealed = next;
  revealedAt = Date.now();
  sendStrip('reveal', revealed);
  if (revealed) {
    line.startBreeze();
    // A fresh look at what hangs, so search is warm.
    line.updateIndex(line.items.filter((i) => !i.falling).map((i) => i.url));
    if (clipWatch && clipboardEnabled()) clipWatch.start();
  } else {
    line.stopBreeze();
    line.clearSelection();
    hideZoom();
    if (searchWin && !searchWin.isDestroyed()) searchWin.hide();
    line.query = '';
    sendStrip('search', { active: false, query: '', count: 0, total: 0 });
  }
  syncDeleteShortcut();
  updateTray();
}

function reveal(reason) {
  if (reason === 'peek') {
    // A burst of arrivals may extend the peek, but never past 10s total —
    // otherwise a stream of new items would hold the line down forever.
    const now = Date.now();
    if (now > peekUntil) peekStart = now;
    peekUntil = now + 2500;
    if (peekUntil > peekStart + 10000) peekUntil = peekStart + 10000;
  }
  applyReveal(true);
}

function tuck() {
  peekUntil = 0;
  applyReveal(false);
}

function toggle() {
  if (revealed) tuck();
  else reveal('toggle');
}

// ---------------------------------------------------------------------------
// Delete on the hovered card
// ---------------------------------------------------------------------------
// The strip is focusable:false — it never has the keyboard, so a renderer
// keydown can never see a key press. The only way "hover the card, press
// Delete" can work is a global accelerator that exists exactly as long as the
// pointer sits on a card, which is also the only window where swallowing the
// key is harmless.

function syncDeleteShortcut() {
  const searchOpen = !!(searchWin && !searchWin.isDestroyed() && searchWin.isVisible());
  const want = revealed && !!hoverCardId && !menuOpen && !searchOpen && !!line && !line.isSearching;
  if (want === deleteShortcutOn) return;
  if (want) {
    try {
      deleteShortcutOn = globalShortcut.register('Delete', onDeleteHovered);
      if (!deleteShortcutOn) console.error('Delete accelerator is taken by another app');
    } catch (e) {
      deleteShortcutOn = false;
      console.error('Delete accelerator failed', e);
    }
  } else {
    try {
      globalShortcut.unregister('Delete');
    } catch {}
    deleteShortcutOn = false;
  }
}

function onDeleteHovered() {
  const id = hoverCardId;
  hoverCardId = null;
  syncDeleteShortcut();
  if (!id || !revealed || !line) return;
  if (!line.items.some((i) => i.id === id)) return;
  // Same as the menu's "take down": the card leaves the line, an inbox file
  // goes to the app's Trash, and Ctrl+Z puts it back.
  line.discard([id]);
  push();
}

// ---------------------------------------------------------------------------
// pointer tracking: reveal, retract, click-through
// ---------------------------------------------------------------------------

function pointInRect(p, r, pad = 0) {
  return p.x >= r.x - pad && p.x <= r.x + r.w + pad && p.y >= r.y - pad && p.y <= r.y + r.h + pad;
}

function tick() {
  if (!strip || strip.isDestroyed()) return;
  const now = Date.now();
  if (now - lastTick < TICK_MS) return;
  lastTick = now;

  const pt = screen.getCursorScreenPoint();
  const b = stripBounds();
  const local = { x: pt.x - b.x, y: pt.y - b.y };
  const onThisScreen =
    pt.x >= b.x && pt.x < b.x + b.width && pt.y >= b.y && pt.y < b.y + b.height;

  // --- reveal on a rest at the very top of the screen ---
  const { panelHeight } = layout();
  const topEdge = pt.y <= b.y + 5;
  // Unlike the macOS menu bar, a Windows desktop has nothing that advertises
  // the app, so the empty line comes down too: its hint is the only place a
  // first-run user learns what to do.
  if (topEdge && store.get('opensFromMenuBar') && !menuBarSuppressed) {
    if (!dwellStart) dwellStart = now;
    if (now - dwellStart >= 250 && !revealed) reveal('edge');
  } else {
    dwellStart = 0;
    if (!topEdge) menuBarSuppressed = false;
  }

  // --- hit test against cards ---
  let overCard = false;
  let overId = null;
  if (onThisScreen) {
    for (const id of Object.keys(hitRects)) {
      if (pointInRect(local, hitRects[id], 10)) {
        overCard = true;
        overId = id;
        break;
      }
    }
    if (!overCard && band && line.scrollable) {
      // A long line takes the mouse over its whole band, so it can be scrolled.
      if (local.y >= band.top - 4 && local.y <= band.bottom + 4) overCard = true;
    }
    if (!overCard) {
      for (const r of captureRects) {
        if (pointInRect(local, r, 0)) {
          overCard = true;
          break;
        }
      }
    }
  }

  if (overId !== hoverCardId) {
    hoverCardId = overId;
    syncDeleteShortcut();
  }

  if (overCard !== pointerInside) {
    pointerInside = overCard;
    sendStrip('pointer', pointerInside);
  }
  const wantIgnore = !overCard;
  if (wantIgnore !== ignoringMouse) {
    ignoringMouse = wantIgnore;
    strip.setIgnoreMouseEvents(wantIgnore, { forward: true });
    if (!wantIgnore) {
      // Going from click-through to interactive does not make Chromium deliver
      // a fresh pointerenter: the hover state (and the corner badge that only
      // shows on hover) would wait for the user to jiggle the mouse. Nudge the
      // renderer with one move at the current position instead.
      try {
        strip.webContents.sendInputEvent({ type: 'mouseMove', x: Math.round(local.x), y: Math.round(local.y) });
      } catch {}
    }
  }

  // --- retract unless the pointer is actually on the line ---
  // The old zone was the whole panel height across the full width, so the
  // line stayed down whenever the pointer sat anywhere in the top strip —
  // "the mouse is nowhere near it but it never leaves". The pointer must now
  // be on a card, near the rope curve itself, or on the empty-line hint.
  const sag = Math.min(30, b.width * 0.018);
  const fx = b.width > 0 ? Math.min(1, Math.max(0, local.x / b.width)) : 0;
  const ropeYHere = 10 + 4 * sag * fx * (1 - fx);
  const nearRope = local.y >= -4 && local.y <= ropeYHere + 16;
  const onHint = !band && local.y <= ropeYHere + 56;
  const inZone = onThisScreen && (overCard || nearRope || onHint);
  pointerInBand = inZone;

  if (revealed) {
    const busy =
      line.isSearching ||
      line.dragging ||
      line.pressed ||
      menuOpen ||
      (searchWin && !searchWin.isDestroyed() && searchWin.isVisible());
    if (busy) {
      awaySince = 0;
    } else if (peekUntil && now < peekUntil) {
      awaySince = 0;
    } else if (!inZone && !overCard) {
      if (!awaySince) awaySince = now;
      if (now - awaySince >= 500) {
        awaySince = 0;
        peekUntil = 0;
        tuck();
      }
    } else {
      awaySince = 0;
    }
  } else {
    awaySince = 0;
  }

  // --- close the gaps left by cards that fell ---
  if (!revealed || (!inZone && !overCard)) line.closeGaps();
}

// ---------------------------------------------------------------------------
// tray
// ---------------------------------------------------------------------------

function trayImage() {
  const active = clipboardEnabled();
  const key = active ? 'active' : 'idle';
  if (trayIconState === key && tray) return;
  trayIconState = key;
  const set = icons.icons();
  const img = nativeImage.createFromBuffer(set[active ? 'active' : 'idle']);
  if (tray) tray.setImage(img);
  else tray.setImage(img);
}

function updateTray() {
  if (!tray) return;
  trayImage();
  const count = line.liveCount;
  const watching = clipboardEnabled();
  tray.setToolTip(
    `${watching ? tr('tip.watching') : tr('tip.idle')}\n${
      count === 0 ? tr('tip.empty') : tr('tip.count', count)
    }`
  );
}

function buildTrayMenu() {
  const keep = store.get('keepOnLine');
  const keepN = [25, 50, 100].includes(keep) ? keep : null;
  const size = store.get('lineSize');
  const sc = store.get('shortcut');

  const template = [
    {
      label: revealed ? tr('tray.hideLine') : tr('tray.showLine'),
      accelerator: sc ? `${sc.ctrl ? 'Control+' : ''}${sc.alt ? 'Alt+' : ''}${sc.shift ? 'Shift+' : ''}${sc.key}` : undefined,
      click: () => toggle(),
    },
    {
      label: tr('tray.search'),
      accelerator: 'Control+Alt+F',
      enabled: line.liveCount > 0,
      click: () => openSearch(),
    },
    {
      label: tr('tray.putBack'),
      accelerator: 'Control+Z',
      enabled: line.canPutBack,
      click: () => doPutBack(),
    },
    {
      label: tr('tray.clearAll'),
      enabled: line.liveCount > 0,
      click: () => {
        line.clear();
        push();
      },
    },
  ];
  if (line.held.size) {
    template.push({ label: tr('tray.hangAllBack'), click: () => hangEverythingBack() });
  }

  template.push({ type: 'separator' });
  template.push({ label: tr('tray.screenshotsSection'), enabled: false });

  template.push({
    label: tr('tray.takeNow'),
    accelerator: (() => {
      const c = store.get('captureShortcut');
      return c ? accelOf(c) : undefined;
    })(),
    click: () => takeScreenshot(),
  });

  template.push({
    label: tr('tray.handleShots'),
    type: 'checkbox',
    checked: !!store.get('inboxEnabled'),
    click: (item) => {
      store.set('inboxEnabled', item.checked);
      restartWatcher();
      push();
    },
  });

  const folders = store.get('extraFolders') || [];
  template.push({
    label: tr('tray.watchFolders'),
    submenu: [
      ...folders.map((f) => ({
        label: path.basename(f) || f,
        type: 'checkbox',
        checked: true,
        click: () => {
          store.set('extraFolders', folders.filter((x) => x !== f));
          restartWatcher();
        },
      })),
      ...(folders.length ? [{ type: 'separator' }] : []),
      {
        label: tr('tray.addFolder'),
        enabled: folders.length < 3,
        click: () => addFolder(),
      },
    ],
  });

  template.push({
    label: tr('tray.openShotsFolder'),
    click: () => shell.openPath(screenshotsFolder()),
  });

  template.push({ type: 'separator' });
  template.push({ label: tr('tray.hangCopySection'), enabled: false });
  for (const [label, key] of [
    [tr('tray.images'), 'clipboardEnabled'],
    [tr('tray.text'), 'clipboardTextEnabled'],
    [tr('tray.links'), 'clipboardLinksEnabled'],
  ]) {
    template.push({
      label,
      type: 'checkbox',
      checked: !!store.get(key),
      click: (item) => {
        store.set(key, item.checked);
        // The watcher always runs; the flags decide which kinds it accepts.
        clipWatch.reset();
        updateTray();
      },
    });
  }

  template.push({ type: 'separator' });
  template.push({
    label: tr('tray.bringDown'),
    submenu: [
      {
        label: tr('tray.whenPointer'),
        type: 'checkbox',
        checked: !!store.get('opensFromMenuBar'),
        click: (i) => store.set('opensFromMenuBar', i.checked),
      },
      {
        label: tr('tray.whenNew'),
        type: 'checkbox',
        checked: !!store.get('peeksAtNew'),
        click: (i) => store.set('peeksAtNew', i.checked),
      },
      {
        label: tr('tray.overFullScreen'),
        type: 'checkbox',
        checked: !!store.get('showOverFullScreen'),
        click: (i) => {
          store.set('showOverFullScreen', i.checked);
          applyFullScreenPolicy();
        },
      },
    ],
  });

  template.push({
    label: tr('tray.keep'),
    submenu: [
      {
        label: tr('tray.asMany'),
        type: 'radio',
        checked: keepN === null,
        click: () => setKeep(0),
      },
      ...[25, 50, 100].map((n) => ({
        label: tr('tray.photos', n),
        type: 'radio',
        checked: keepN === n,
        click: () => setKeep(n),
      })),
    ],
  });

  template.push({
    label: tr('tray.autoClean'),
    submenu: [
      // Two separate clocks: how long a card may hang, and how long a taken-down
      // file may sit in the Trash before it is deleted for good.
      {
        label: tr('tray.cleanLineGroup'),
        submenu: [
          { label: tr('tray.cleanLineOff'), type: 'radio', checked: cleanLineDays() === 0, click: () => setCleanLine(0) },
          ...[1, 2, 3, 7].map((d) => ({
            label: d === 1 ? tr('tray.cleanLineDay1') : tr('tray.cleanLineDays', d),
            type: 'radio',
            checked: cleanLineDays() === d,
            click: () => setCleanLine(d),
          })),
        ],
      },
      {
        label: tr('tray.cleanTrashGroup'),
        submenu: [
          {
            label: tr('tray.cleanTrashOff'),
            type: 'radio',
            checked: cleanTrashDays() === 0,
            click: () => setCleanTrash(0),
          },
          ...[1, 3, 7, 14, 30].map((d) => ({
            label: d === 1 ? tr('tray.cleanTrashDay1') : tr('tray.cleanTrashDays', d),
            type: 'radio',
            checked: cleanTrashDays() === d,
            click: () => setCleanTrash(d),
          })),
        ],
      },
      { type: 'separator' },
      { label: tr('tray.autoCleanNow'), click: () => runAutoClean(true) },
    ],
  });

  template.push({
    label: tr('tray.size'),
    submenu: [
      [tr('tray.small'), 'small'],
      [tr('tray.medium'), 'medium'],
      [tr('tray.large'), 'large'],
    ].map(([label, val]) => ({
      label,
      type: 'radio',
      checked: size === val,
      click: () => setSize(val),
    })),
  });

  template.push({
    label: tr('tray.zoom'),
    type: 'checkbox',
    checked: !!store.get('zoomOn'),
    click: (i) => {
      store.set('zoomOn', i.checked);
      if (!i.checked) hideZoom();
    },
  });

  template.push({
    label: tr('tray.shortcut'),
    submenu: [
      {
        label: sc ? `${sc.ctrl ? 'Ctrl+' : ''}${sc.alt ? 'Alt+' : ''}${sc.shift ? 'Shift+' : ''}${sc.key}` : tr('tray.none'),
        enabled: false,
      },
      {
        label: tr('tray.changeShortcut'),
        click: () => promptShortcut(),
      },
      { type: 'separator' },
      {
        label: tr('tray.shotShortcut'),
        enabled: false,
      },
      {
        label: (() => {
          const c = store.get('captureShortcut');
          return c ? `${c.ctrl ? 'Ctrl+' : ''}${c.alt ? 'Alt+' : ''}${c.shift ? 'Shift+' : ''}${c.key}` : tr('tray.none');
        })(),
        enabled: false,
      },
      {
        label: tr('tray.changeShotShortcut'),
        click: () => promptShortcut('captureShortcut'),
      },
    ],
  });

  template.push({ type: 'separator' });
  template.push({
    label: tr('tray.sounds'),
    type: 'checkbox',
    checked: !store.get('soundOff'),
    click: (i) => {
      store.set('soundOff', !i.checked);
      push();
    },
  });
  template.push({
    label: tr('tray.openAtLogin'),
    type: 'checkbox',
    checked: app.getLoginItemSettings().openAtLogin,
    click: (i) => {
      app.setLoginItemSettings({ openAtLogin: i.checked, args: [] });
    },
  });
  template.push({
    label: tr('tray.openData'),
    click: () => shell.openPath(store.ROOT),
  });
  template.push({ type: 'separator' });
  // Language is the last thing before Quit: set once, rarely touched.
  template.push({
    label: tr('tray.language'),
    submenu: [
      { label: tr('tray.langZh'), type: 'radio', checked: lang === 'zh', click: () => switchLang('zh') },
      { label: tr('tray.langEn'), type: 'radio', checked: lang === 'en', click: () => switchLang('en') },
    ],
  });
  template.push({ type: 'separator' });
  template.push({ label: tr('tray.quit'), accelerator: 'Control+Q', click: () => quitApp() });
  return Menu.buildFromTemplate(template);
}

// Switching language rebuilds every menu on the fly (buildTrayMenu runs per
// click) and reloads the strip so the renderer re-reads the strings. The
// transient windows are closed instead of reloaded: they are small and modal.
function switchLang(next) {
  const want = i18n.normalize(next) || 'zh';
  if (want === lang) return;
  lang = want;
  store.set('lang', lang);
  notes.setLang(lang);
  require('./capture').setShotName(tr('file.shot'));
  for (const w of [searchWin, zoomWin]) {
    if (w && !w.isDestroyed()) w.destroy();
  }
  searchWin = null;
  zoomWin = null;
  for (const w of heldWins.values()) {
    if (w && !w.isDestroyed()) w.destroy();
  }
  heldWins.clear();
  if (openMenu) {
    try {
      openMenu.closePopup();
    } catch {}
  }
  openMenu = null;
  menuOpen = false;
  closeMenuCatcher();
  updateTray();
  if (strip && !strip.isDestroyed()) {
    syncDeleteShortcut();
    strip.webContents.reload();
  }
}

function createTray() {
  const set = icons.icons();
  tray = new Tray(nativeImage.createFromBuffer(set.idle));
  tray.setToolTip('Tendedero');
  tray.on('click', () => {
    tray.popUpContextMenu(buildTrayMenu());
  });
  tray.on('right-click', () => {
    tray.popUpContextMenu(buildTrayMenu());
  });
  updateTray();
}

// ---------------------------------------------------------------------------
// actions
// ---------------------------------------------------------------------------

function doPutBack() {
  line.putBack();
  if (store.get('peeksAtNew')) reveal('peek');
  push();
}

function setKeep(n) {
  store.set('keepOnLine', n);
  const L = layout();
  line.setCapacity(stripBounds().width, L.spacing);
  // Lowering it takes the excess down at once, oldest loose first.
  while (line.liveCount > line.maxItems) {
    const victim = line.oldestLoose;
    if (!victim) break;
    line.letGo(victim.id);
  }
  line.scroll = 0;
  push();
}

// ---------------------------------------------------------------------------
// auto-clean
// ---------------------------------------------------------------------------

const CLEAN_EVERY_MS = 10 * 60 * 1000;

function daysOf(key) {
  const d = Number(store.get(key));
  return Number.isFinite(d) && d > 0 ? d : 0;
}

const cleanLineDays = () => daysOf('autoCleanDays');
const cleanTrashDays = () => daysOf('autoCleanTrashDays');

function setCleanLine(days) {
  store.set('autoCleanDays', days);
  runAutoClean(true);
  push();
}

function setCleanTrash(days) {
  store.set('autoCleanTrashDays', days);
  runAutoClean(true);
  push();
}

function runAutoClean(force = false) {
  const lineDays = cleanLineDays();
  const trashDays = cleanTrashDays();
  if ((!lineDays && !trashDays) || !line) return { line: 0, trash: 0 };
  const taken = lineDays ? autoClean.sweepLine(line, lineDays).length : 0;
  const purged = trashDays ? autoClean.sweepTrash(trashDays) : 0;
  if (taken) {
    // A quiet report through the tray tooltip is enough: this happens in the
    // background and must never steal focus or push a popup at the user.
    push();
    updateTray();
  }
  if (taken || purged || force) {
    console.log(`auto-clean: ${taken} off the line (>= ${lineDays} d), ${purged} out of the Trash (>= ${trashDays} d)`);
  }
  return { line: taken, trash: purged };
}

function setSize(s) {
  store.set('lineSize', s);
  const L = layout();
  const b = stripBounds();
  if (strip && !strip.isDestroyed()) {
    strip.setBounds({ ...b, height: L.panelHeight + FALL_ROOM });
  }
  line.setCapacity(b.width, L.spacing);
  // Thumbnails were made for the old size.
  for (const it of line.items) {
    it.scale = L.scale;
    if (it.kind !== 'note') {
      const { thumbFor } = require('./line');
      const t = thumbFor(it.url, L.scale);
      if (t) it.thumb = t;
    }
  }
  sendStrip('relayout');
  push();
}

function applyFullScreenPolicy() {
  if (!strip) return;
  const over = !!store.get('showOverFullScreen');
  strip.setAlwaysOnTop(true, over ? 'screen-saver' : 'floating');
  if (!over) strip.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: false });
  else strip.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
}

function addFolder() {
  const res = dialog.showOpenDialogSync({
    title: tr('tray.watchFolders'),
    properties: ['openDirectory'],
  });
  if (!res || !res.length) return;
  const folders = [...(store.get('extraFolders') || []), res[0]].slice(0, 3);
  store.set('extraFolders', folders);
  restartWatcher();
}

function restartWatcher() {
  if (!watcher) return;
  watcher.stop();
  watcher.start([...(store.get('extraFolders') || [])]);
}

function hangFile(file) {
  const id = line.hang(file, { flying: false });
  if (!id) return null;
  push();
  if (store.get('peeksAtNew')) reveal('peek');
  return id;
}

function hangClipboardImage(png) {
  const target = store.uniqueIn(store.SCREENSHOTS, `${tr('file.clip')} ${store.stamp()}.png`);
  try {
    fs.writeFileSync(target, png, { mode: 0o600 });
  } catch (e) {
    return null;
  }
  return hangFile(target);
}

function hangClipboardText(text) {
  const target = store.uniqueIn(store.NOTES, `${tr('file.text')} ${store.stamp()}.txt`);
  try {
    fs.writeFileSync(target, text, { mode: 0o600 });
  } catch {
    return null;
  }
  return hangFile(target);
}

function hangClipboardLink(url) {
  const target = store.uniqueIn(store.NOTES, `${tr('file.link')} ${store.stamp()}.txt`);
  try {
    fs.writeFileSync(target, url, { mode: 0o600 });
  } catch {
    return null;
  }
  return hangFile(target);
}

// Every path that copies a card has to go through here: the clipboard watcher
// polls the same clipboard, so the app must mark what it just wrote as seen or
// a click would hang a duplicate of the card it copied.
function copyItems(ids) {
  const ok = line.copy(ids);
  if (ok && clipWatch) clipWatch.acceptCurrent();
  return ok;
}

// ---------------------------------------------------------------------------
// search window
// ---------------------------------------------------------------------------

function openSearch() {
  if (!line.liveCount) return;
  reveal('search');
  const b = stripBounds();
  const L = layout();
  const w = 340;
  const h = 40;
  const x = Math.round(b.x + b.width / 2 - w / 2);
  const y = Math.round(b.y + L.panelHeight - h - 6);
  if (!searchWin || searchWin.isDestroyed()) {
    searchWin = new BrowserWindow({
      x,
      y,
      width: w,
      height: h,
      frame: false,
      transparent: true,
      hasShadow: false,
      resizable: false,
      movable: false,
      skipTaskbar: true,
      alwaysOnTop: true,
      backgroundColor: '#00000000',
      show: false,
      webPreferences: {
        preload: path.join(__dirname, '..', 'preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
        backgroundThrottling: false,
      },
    });
    searchWin.setAlwaysOnTop(true, 'screen-saver');
    searchWin.loadFile(path.join(__dirname, '..', 'renderer', 'search.html'));
    searchWin.on('blur', () => {
      // Clicking elsewhere ends the search but leaves the line as it is.
      if (searchWin && !searchWin.isDestroyed() && searchWin.isVisible()) endSearch();
    });
  } else {
    searchWin.setBounds({ x, y, width: w, height: h });
  }
  searchWin.show();
  searchWin.focus();
  searchWin.webContents.send('search:focus', '');
}

function endSearch() {
  line.query = '';
  sendStrip('search', { active: false, query: '', count: 0, total: 0 });
  if (searchWin && !searchWin.isDestroyed()) searchWin.hide();
  push();
}

function runSearch(q) {
  line.query = q;
  const words = q
    .normalize('NFKD')
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);
  const total = line.items.filter((i) => !i.falling).length;
  const shown = line.shown.filter((i) => !i.falling);
  const payload = {
    active: words.length > 0,
    query: q,
    count: shown.length,
    total,
  };
  sendStrip('search', payload);
  if (searchWin && !searchWin.isDestroyed()) searchWin.webContents.send('search:count', payload);
  push();
}

// ---------------------------------------------------------------------------
// zoom on hover
// ---------------------------------------------------------------------------

function showZoom(id) {
  if (!store.get('zoomOn')) return;
  if (line.dragging || menuOpen) return;
  const it = line.items.find((i) => i.id === id);
  if (!it) return;
  const wa = workArea();
  const L = layout();
  const top = wa.y + L.panelHeight + 34;
  const room = {
    w: Math.min(560, wa.width - 32),
    h: Math.min(420, wa.y + wa.height - top - 32),
  };
  if (room.w <= 120 || room.h <= 120) return;
  const inner = { w: room.w - 8, h: room.h - 8 };
  const sw = it.thumb ? it.thumb.w : 320;
  const sh = it.thumb ? it.thumb.h : 200;
  const s = Math.min(inner.w / sw, inner.h / sh);
  const size = { w: Math.round(sw * s) + 8, h: Math.round(sh * s) + 8 };
  const content = {
    x: Math.round(wa.x + wa.width / 2 - size.w / 2),
    y: Math.round(Math.min(wa.y + wa.height / 2 - size.h / 2, top)),
  };
  const frame = {
    x: content.x - 40,
    y: content.y - 40,
    width: size.w + 80,
    height: size.h + 80,
  };
  if (!zoomWin || zoomWin.isDestroyed()) {
    zoomWin = new BrowserWindow({
      ...frame,
      frame: false,
      transparent: true,
      hasShadow: false,
      resizable: false,
      skipTaskbar: true,
      focusable: false,
      alwaysOnTop: true,
      backgroundColor: '#00000000',
      show: false,
      webPreferences: {
        preload: path.join(__dirname, '..', 'preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
      },
    });
    zoomWin.setAlwaysOnTop(true, 'screen-saver');
    zoomWin.setIgnoreMouseEvents(true, { forward: true });
    zoomWin.loadFile(path.join(__dirname, '..', 'renderer', 'zoom.html'));
  } else {
    zoomWin.setBounds(frame);
  }
  const n = it.kind === 'note' ? notes.parse(it.url) : null;
  const payload = {
    kind: it.kind,
    url: it.url,
    thumb: it.thumb ? it.thumb.dataUrl : '',
    size,
    note: n
      ? {
          title: n.title,
          body: n.body,
          code: n.code,
          markdown: n.markdown,
          link: n.linkUrl,
          linkHost: n.linkHost,
          linkPath: n.linkPath,
          dateText: n.dateText,
          bodyHtml: notes.renderBody(n),
        }
      : null,
  };
  const showIt = () => {
    if (!zoomWin || zoomWin.isDestroyed()) return;
    zoomWin.webContents.send('zoom:data', payload);
    zoomWin.showInactive();
  };
  if (zoomWin.webContents.isLoading()) zoomWin.webContents.once('did-finish-load', showIt);
  else showIt();
}

function hideZoom() {
  if (zoomWin && !zoomWin.isDestroyed()) zoomWin.hide();
}

// ---------------------------------------------------------------------------
// held windows
// ---------------------------------------------------------------------------

function sendHeldData(win, it, id) {
  if (!win || win.isDestroyed()) return;
  const n = it.kind === 'note' ? notes.parse(it.url) : null;
  win.webContents.send('held:data', {
    id,
    kind: it.kind,
    url: it.url,
    thumb: it.thumb ? it.thumb.dataUrl : '',
    note: n
      ? {
          title: n.title,
          body: n.body,
          code: n.code,
          markdown: n.markdown,
          link: n.linkUrl,
          linkHost: n.linkHost,
          linkPath: n.linkPath,
          dateText: n.dateText,
          bodyHtml: notes.renderBody(n),
        }
      : null,
  });
}

function holdItem(id) {  const it = line.items.find((i) => i.id === id);
  if (!it || it.kind === 'recording') return false;
  if (heldWins.has(id)) {
    heldWins.get(id).focus();
    return true;
  }
  const wa = workArea();
  const w = Math.round(wa.width * 0.5);
  const h = Math.round(wa.height * 0.5);
  const offset = heldWins.size * 24;
  const win = new BrowserWindow({
    x: wa.x + Math.round((wa.width - w) / 2) + offset,
    y: wa.y + Math.round((wa.height - h) / 2) + offset,
    width: w,
    height: h,
    frame: false,
    transparent: true,
    hasShadow: true,
    resizable: true,
    skipTaskbar: false,
    alwaysOnTop: true,
    backgroundColor: '#00000000',
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  win.setAlwaysOnTop(true, 'floating');
  win.loadFile(path.join(__dirname, '..', 'renderer', 'held.html'), { query: { id } });
  win.webContents.once('did-finish-load', () => {
    sendHeldData(win, it, id);
  });
  // The renderer may finish wiring its listener a tick after the document
  // loads, so hand the content over again once it says it is ready.
  ipcMain.on('held:ready', (_e, wanted) => {
    if (wanted !== id) return;
    sendHeldData(win, it, id);
  });
  win.on('closed', () => {
    heldWins.delete(id);
    if (line.held.has(id)) hangBack(id);
  });
  heldWins.set(id, win);
  line.setHeld(id, true);
  push();
  return true;
}

function hangBack(id) {
  const win = heldWins.get(id);
  if (win && !win.isDestroyed()) {
    heldWins.delete(id);
    win.destroy();
  }
  line.setHeld(id, false);
  push();
}

function hangEverythingBack() {
  for (const id of [...heldWins.keys()]) hangBack(id);
}

// ---------------------------------------------------------------------------
// context menus (native, at the pointer)
// ---------------------------------------------------------------------------

function cardMenu(id) {
  const it = line.items.find((i) => i.id === id);
  if (!it) return;
  const ids = line.selected.has(id) && line.selected.size > 1 ? [...line.selected] : [id];
  const list = line.actionItems(ids);
  const one = list.length === 1 ? list[0] : null;
  const n = one && one.kind === 'note' ? notes.parse(one.url) : null;
  const template = [];

  if (list.length > 1) {
    template.push({ label: tr('menu.selected', list.length), enabled: false });
    template.push({ type: 'separator' });
    template.push({ label: tr('menu.copy'), click: () => copyItems(ids) });
    template.push({ label: tr('menu.open'), click: () => line.open(ids) });
    template.push({ label: tr('menu.showInExplorer'), click: () => one && line.revealInExplorer(one.id) });
    template.push({ type: 'separator' });
    template.push({ label: tr('menu.saveToDesktop'), click: () => line.saveToDesktop(ids) });
    template.push({ type: 'separator' });
    if (list.some((i) => !i.kept)) template.push({ label: tr('menu.pin'), click: () => line.pin(ids) });
    if (list.some((i) => i.kept && !i.byHand)) template.push({ label: tr('menu.unpin'), click: () => line.unpin(ids) });
    template.push({
      label: line.canDiscard(ids) ? tr('menu.discard') : tr('menu.takeDown'),
      click: () => line.discard(ids),
    });
    popup(template);
    return;
  }

  if (!one) return;
  template.push({ label: tr('menu.copy'), click: () => copyItems([one.id]) });
  template.push({ label: tr('menu.open'), click: () => line.open([one.id]) });
  if (n && n.linkUrl) template.push({ label: tr('menu.openLink'), click: () => shell.openExternal(n.linkUrl) });
  template.push({ label: tr('menu.quickLook'), click: () => line.quickLook(one.id) });
  if (one.kind !== 'recording') {
    template.push({ label: one.held ? tr('menu.hangBack') : tr('menu.hold'), click: () => (one.held ? hangBack(one.id) : holdItem(one.id)) });
  }
  if (one.kind === 'photo') template.push({ label: tr('menu.markup'), click: () => line.markup(one.id) });
  template.push({ label: tr('menu.showInExplorer'), click: () => line.revealInExplorer(one.id) });
  template.push({ type: 'separator' });
  template.push({ label: tr('menu.share'), click: () => line.revealInExplorer(one.id) });
  template.push({ type: 'separator' });
  if (!one.kept) template.push({ label: tr('menu.pin'), click: () => line.pin([one.id]) });
  if (one.kept && !one.byHand) template.push({ label: tr('menu.unpin'), click: () => line.unpin([one.id]) });
  template.push({
    label: tr('menu.saveToDesktop'),
    click: () => line.saveToDesktop([one.id]),
  });
  template.push({ type: 'separator' });
  if (one.kept && one.byHand) {
    template.push({ label: tr('menu.takeDown'), click: () => line.discard([one.id]) });
  } else if (store.inInbox(one.url)) {
    template.push({ label: tr('menu.discard'), click: () => line.discard([one.id]) });
  } else {
    template.push({ label: tr('menu.takeDown'), click: () => line.discard([one.id]) });
    template.push({ label: tr('menu.recycle'), click: () => line.trash([one.id]) });
  }
  template.push({
    label: tr('menu.takeDownLeft'),
    enabled: line.neighbours(one.id, true).length > 0,
    click: () => line.takeDownSide(one.id, 'left'),
  });
  template.push({
    label: tr('menu.takeDownRight'),
    enabled: line.neighbours(one.id, false).length > 0,
    click: () => line.takeDownSide(one.id, 'right'),
  });
  // Discovery for the keyboard shortcut: Del acts on whatever the pointer is on.
  template.push({ type: 'separator' });
  template.push({ label: tr('ui.hintDelete'), enabled: false });
  popup(template);
}

let openMenu = null;
let menuCatcher = null;

// A native menu hangs off our focusless strip, so Windows never delivers it the
// click that should dismiss it: the menu stays up until one of its own items is
// picked. This invisible, focusable window sits under the menu for as long as it
// is open and turns any click (or Esc, or a wheel) that lands outside the menu
// into "close it".
function openMenuCatcher() {
  if (menuCatcher && !menuCatcher.isDestroyed()) return;
  const wa = workArea();
  menuCatcher = new BrowserWindow({
    x: wa.x,
    y: wa.y,
    width: wa.width,
    height: wa.height,
    frame: false,
    transparent: true,
    hasShadow: false,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    focusable: true,
    show: false,
    backgroundColor: '#00000000',
    webPreferences: {
      preload: path.join(__dirname, '..', 'catcher-preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  menuCatcher.setAlwaysOnTop(true, 'screen-saver');
  menuCatcher.loadURL('data:text/html;charset=utf-8,<html><body style="margin:0;background:transparent"></body></html>');
  menuCatcher.once('ready-to-show', () => {
    if (menuCatcher && !menuCatcher.isDestroyed()) {
      menuCatcher.show();
      menuCatcher.focus();
    }
  });
  menuCatcher.on('closed', () => {
    menuCatcher = null;
  });
}

function closeMenuCatcher() {
  if (menuCatcher && !menuCatcher.isDestroyed()) menuCatcher.destroy();
  menuCatcher = null;
}

function popup(template) {
  menuOpen = true;
  const menu = Menu.buildFromTemplate(template);
  openMenu = menu; // keep a reference so it is not collected mid-display
  const close = () => {
    if (!menuOpen) return;
    menuOpen = false;
    openMenu = null;
    closeMenuCatcher();
    syncDeleteShortcut();
    push();
  };
  // The callback alone is not trustworthy on a focusless window; the close
  // event plus a safety net guarantee busy never sticks.
  menu.on('menu-will-close', close);
  const safety = setTimeout(close, 60000);
  openMenuCatcher();
  menu.popup({
    window: strip || undefined,
    callback: () => {
      clearTimeout(safety);
      close();
    },
  });
}

// ---------------------------------------------------------------------------
// shortcut capture
// ---------------------------------------------------------------------------

function promptShortcut(key = 'shortcut') {
  const win = new BrowserWindow({
    width: 380,
    height: 150,
    frame: false,
    resizable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    backgroundColor: '#1e1e1e',
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  win.loadFile(path.join(__dirname, '..', 'renderer', 'shortcut.html'));
  win.webContents.once('did-finish-load', () => {
    win.webContents.send('shortcut:current', store.get(key));
  });
  ipcMain.once('shortcut:set', (_e, sc) => {
    store.set(key, sc);
    registerShortcuts();
    if (!win.isDestroyed()) win.close();
  });
}

// ---------------------------------------------------------------------------
// shortcuts
// ---------------------------------------------------------------------------

function accelOf(sc) {
  if (!sc || !sc.key) return null;
  const parts = [];
  if (sc.ctrl) parts.push('Control');
  if (sc.alt) parts.push('Alt');
  if (sc.shift) parts.push('Shift');
  parts.push(sc.key.length === 1 ? sc.key.toUpperCase() : sc.key);
  return parts.join('+');
}

function registerShortcuts() {
  globalShortcut.unregisterAll();
  const accel = accelOf(store.get('shortcut'));
  if (accel) {
    try {
      globalShortcut.register(accel, () => toggle());
    } catch {}
  }
  try {
    globalShortcut.register('Control+Alt+F', () => openSearch());
  } catch {}
  // Windows has no built-in "capture straight to the line", so the app takes
  // the screenshot itself. Ctrl+Alt+S by default; changeable from the tray.
  const cap = accelOf(store.get('captureShortcut'));
  if (cap) {
    try {
      globalShortcut.register(cap, () => takeScreenshot());
    } catch {}
  }
}

async function takeScreenshot() {
  try {
    require('./capture').setShotName(tr('file.shot'));
    const file = await require('./capture').captureScreen();
    if (!file) return;
    const id = line.hang(file, { flying: true });
    push();
    if (id) {
      // the card slides into place from just above, then lands
      setTimeout(() => {
        line.land(id);
        push();
      }, 120);
    }
    if (store.get('peeksAtNew')) reveal('peek');
  } catch (e) {
    console.error('capture failed', e);
  }
}

// ---------------------------------------------------------------------------
// ipc
// ---------------------------------------------------------------------------

function wireIpc() {
  ipcMain.handle('state:get', () => snapshot());

  ipcMain.on('hit:report', (_e, rects, bandIn) => {
    hitRects = rects || {};
    band = bandIn || null;
  });
  ipcMain.on('hit:capture', (_e, rects) => {
    captureRects = rects || [];
  });
  ipcMain.on('line:reveal', () => reveal('explicit'));
  ipcMain.on('line:tuck', () => tuck());
  ipcMain.on('line:pointer', (_e, v) => {
    pointerInside = !!v;
  });
  ipcMain.on('selection:toggle', (_e, id) => {
    line.toggleSelection(id);
    push();
  });
  ipcMain.on('selection:clear', () => {
    line.clearSelection();
    push();
  });
  ipcMain.on('search:open', () => openSearch());

  ipcMain.handle('line:clear', () => {
    line.clear();
    push();
    return true;
  });
  ipcMain.handle('line:putBack', () => {
    doPutBack();
    return true;
  });
  ipcMain.handle('line:scroll', (_e, d) => {
    line.scrollBy(d);
    return line.scroll;
  });

  const act = (name, fn) => ipcMain.handle(name, (_e, ...a) => {
    const r = fn(...a);
    push();
    return r;
  });

  act('item:copy', (ids) => copyItems(ids));
  act('item:open', (ids) => line.open(ids));
  act('item:quickLook', (id) => line.quickLook(id));
  act('item:hold', (id) => holdItem(id));
  act('item:hangBack', (id) => hangBack(id));
  act('item:markup', (id) => line.markup(id));
  act('item:reveal', (id) => line.revealInExplorer(id));
  act('item:share', (ids) => line.revealInExplorer(ids[0]));
  act('item:pin', (ids) => line.pin(ids));
  act('item:unpin', (ids) => line.unpin(ids));
  act('item:saveToDesktop', (ids) => line.saveToDesktop(ids));
  act('item:takeDown', (ids) => line.discard(ids));
  act('item:discard', (ids) => line.discard(ids));
  act('item:trash', (ids) => line.trash(ids));
  act('item:takeDownSide', (id, side) => line.takeDownSide(id, side));
  act('item:corner', (id) => line.pressCorner(id));
  act('item:drag', (ids) => startDrag(ids));
  act('item:thumb', (id) => {
    const it = line.items.find((i) => i.id === id);
    return it && it.thumb ? it.thumb.dataUrl : '';
  });

  ipcMain.handle('search:query', (_e, q) => {
    runSearch(q || '');
    return true;
  });
  ipcMain.handle('search:end', () => {
    endSearch();
    return true;
  });
  ipcMain.handle('search:copyNewest', () => {
    const it = line.newestMatch;
    if (!it) return false;
    copyItems([it.id]);
    endSearch();
    tuck();
    return true;
  });

  ipcMain.on('zoom:show', (_e, id) => showZoom(id));
  ipcMain.on('zoom:hide', () => hideZoom());

  ipcMain.handle('menu:card', (_e, id) => {
    cardMenu(id);
    return true;
  });
  ipcMain.handle('menu:selection', (_e, ids) => {
    cardMenu(ids[0]);
    return true;
  });

  ipcMain.handle('app:openFolder', () => shell.openPath(store.ROOT));
  ipcMain.handle('app:autoclean', () => runAutoClean(true));
  ipcMain.handle('app:setLang', (_e, next) => {
    switchLang(next);
    return lang;
  });
  ipcMain.handle('app:quit', () => quitApp());
  ipcMain.handle('app:sounds', () => require('./sounds').soundDataUrls());

  // A click anywhere outside an open native menu: the catcher window sends this.
  ipcMain.on('menu:catcher', () => {
    const menu = openMenu;
    menuOpen = false;
    openMenu = null;
    closeMenuCatcher();
    syncDeleteShortcut();
    if (menu) {
      try {
        menu.closePopup();
      } catch {}
    }
    push();
  });

  // Live diagnostics for the 30 Hz loop and the busy flags behind it.
  ipcMain.handle('diag:get', () => ({
    revealed,
    ignoringMouse,
    menuOpen,
    awayMs: awaySince ? Date.now() - awaySince : -1,
    peekInMs: peekUntil ? peekUntil - Date.now() : -1,
    dragging: line.dragging,
    pressed: line.pressed,
    searching: line.isSearching,
    hitCount: Object.keys(hitRects).length,
    rects: hitRects,
    band: band ? { top: Math.round(band.top), bottom: Math.round(band.bottom) } : null,
    captureCount: captureRects.length,
    tickAgeMs: lastTick ? Date.now() - lastTick : -1,
    tickErrors,
    dragCalls,
    lastDragError,
    cursor: screen.getCursorScreenPoint(),
    topEdgeMs: dwellStart ? Date.now() - dwellStart : -1,
    hoverId: hoverCardId,
    deleteRegistered: deleteShortcutOn,
    lang,
    // Menu labels are rebuilt per open, so this is a cheap way to assert the
    // strings in either language from a test.
    trayLabels: (() => {
      try {
        return buildTrayMenu().items.map((i) => ({
          label: i.label,
          type: i.type,
          sub: i.submenu ? i.submenu.items.map((s) => s.label) : null,
        }));
      } catch {
        return [];
      }
    })(),
    searchWinVisible: !!(searchWin && !searchWin.isDestroyed() && searchWin.isVisible()),
    live: line.liveCount,
    scrollable: line.scrollable,
    size: strip && !strip.isDestroyed() ? strip.getBounds() : null,
  }));

  // drag out of the strip
  ipcMain.on('drag:begin', (_e, id) => startDrag([id]));
}

function startDrag(ids) {
  const it = line.items.find((i) => i.id === ids[0]);
  if (!it || !strip) return false;
  dragCalls++;
  lastDragError = null;
  line.dragging = it.id;
  push();
  // A re-check shortly after: if the file was moved by the drop, the card
  // leaves the line (drag into a folder = keep it there).
  setTimeout(() => {
    line.prune();
    push();
  }, 1000);

  // Chromium's own OLE drag: it owns the message loop and the drop-target
  // negotiation, which is far more compatible with real mouse input than a
  // WinForms-hosted DoDragDrop (that path was tried and always returned
  // effect=None under synthetic input). Native startDrag drops into Explorer,
  // Paint, chat windows and anything else that accepts a file.
  try {
    let icon = nativeImage.createFromPath(it.url);
    if (icon.isEmpty() && it.thumb && it.thumb.dataUrl) {
      icon = nativeImage.createFromDataURL(it.thumb.dataUrl);
    }
    if (icon.isEmpty()) icon = nativeImage.createFromBuffer(icons.icons().active);
    if (!icon.isEmpty()) {
      icon = icon.resize({ width: Math.min(160, Math.max(32, icon.getSize().width || 64)) });
    }
    strip.webContents.startDrag({ file: it.url, icon });
  } catch (e) {
    lastDragError = String((e && e.message) || e);
    console.error('startDrag failed', e);
  }
  // startDrag has no completion callback; keep the busy flag short and let
  // the 30 Hz pointer tracker retract the line as soon as the cursor leaves.
  setTimeout(() => {
    if (line.dragging === it.id) {
      line.dragging = null;
      line.prune();
      push();
    }
  }, 1500);
  return true;
}

// ---------------------------------------------------------------------------
// app lifecycle
// ---------------------------------------------------------------------------

function quitApp() {
  try {
    line.stopBreeze();
    ocr.shutdown();
    if (watcher) watcher.stop();
    if (clipWatch) clipWatch.stop();
    closeMenuCatcher();
    globalShortcut.unregisterAll();
  } catch {}
  store.writeNow();
  app.quit();
}

function boot() {
  store.load();
  // Make sure the settings file exists from the first run.
  store.writeNow();
  line = new Line();
  const L = layout();

  createStrip();
  createTray();
  wireIpc();
  applyFullScreenPolicy();
  registerShortcuts();

  let pushQueued = false;
  line.onChange((what) => {
    if (typeof what === 'string' && what.startsWith('sound:')) {
      sendStrip('sound', what.slice(6));
      return;
    }
    if (pushQueued) return;
    pushQueued = true;
    setImmediate(() => {
      pushQueued = false;
      push();
    });
  });

  const b = stripBounds();
  line.setCapacity(b.width, L.spacing);
  line.setSpacing(L.spacing);

  watcher = new Watcher({
    onImage: (file) => {
      hangFile(file);
    },
  });
  if (store.get('inboxEnabled')) restartWatcher();

  clipWatch = new ClipboardWatcher({
    onImage: (png) => hangClipboardImage(png),
    onText: (text) => hangClipboardText(text),
    onLink: (url) => hangClipboardLink(url),
  });
  clipWatch.start();

  // Pointer tracking, 30 Hz like the original. A throw here would silently
  // kill both the click-through toggle and the retract, so it is guarded and
  // counted for the diagnostic channel.
  setInterval(() => {
    try {
      tick();
      tickErrors = 0;
    } catch (e) {
      tickErrors++;
      if (tickErrors <= 3) console.error('tick failed', e);
    }
  }, TICK_MS);

  // Auto-clean: cards older than the configured age come down into the app's
  // Trash, and the Trash itself is emptied of things older than the same age.
  // Pinned cards are never touched.
  setTimeout(runAutoClean, 4000);
  setInterval(runAutoClean, CLEAN_EVERY_MS);

  // The first text pass starts a moment after launch, as it does on macOS.
  setTimeout(() => {
    line.updateIndex(line.items.filter((i) => !i.falling).map((i) => i.url));
  }, 3000);

  screen.on('display-metrics-changed', relayout);
  screen.on('display-added', relayout);
  screen.on('display-removed', relayout);

  // A second copy just brings the first one's line down.
  const gotLock = app.requestSingleInstanceLock();
  if (!gotLock) {
    app.quit();
    return;
  }
  app.on('second-instance', () => reveal('explicit'));

  // Files handed to us (Hang on Tendedero / drag onto the exe).
  app.on('open-file', (_e, f) => hangByHand(f));
}

function relayout() {
  const b = stripBounds();
  const L = layout();
  if (strip && !strip.isDestroyed()) strip.setBounds({ ...b, height: L.panelHeight + FALL_ROOM });
  line.setCapacity(b.width, L.spacing);
  line.setSpacing(L.spacing);
  sendStrip('relayout');
  push();
}

function hangByHand(file) {
  if (!fs.existsSync(file)) return;
  let target = file;
  const ext = path.extname(file).toLowerCase();
  if (['.txt', '.md', '.rtf'].includes(ext) && !store.contains(store.NOTES, file)) {
    // Adopt a text file into Notes so it can be parsed as a note.
    try {
      const st = fs.statSync(file);
      if (st.size <= 1000000) {
        const dest = store.uniqueIn(store.NOTES, path.basename(file));
        fs.copyFileSync(file, dest);
        target = dest;
      }
    } catch {}
  }
  line.hangKept(target);
  push();
  reveal('explicit');
}

app.on('window-all-closed', (e) => {
  // The tray keeps the app alive, like a menu-bar app.
  e.preventDefault();
});

app.on('before-quit', () => {
  store.writeNow();
});

app.whenReady().then(() => {
  // Command line files
  const args = process.argv.slice(1).filter((a) => !a.startsWith('-') && fs.existsSync(a) && a !== __dirname);
  boot();
  for (const a of args) {
    if (path.extname(a)) hangByHand(a);
  }
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
  ocr.shutdown();
});
