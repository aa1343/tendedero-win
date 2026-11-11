// Settings + on-disk layout. Mirrors the macOS app's UserDefaults keys and
// Application Support folders, with Windows equivalents.
const fs = require('fs');
const path = require('path');
const { app } = require('electron');

const ROOT = app.getPath('userData');
const SCREENSHOTS = path.join(ROOT, 'Screenshots');
const NOTES = path.join(ROOT, 'Notes');
const INDEX_FILE = path.join(ROOT, 'SearchIndex.json');
const SETTINGS_FILE = path.join(ROOT, 'settings.json');

for (const d of [ROOT, SCREENSHOTS, NOTES]) fs.mkdirSync(d, { recursive: true });

const DEFAULTS = {
  // ui
  lang: null, // null = follow the system on first run; then 'zh' | 'en'
  // housekeeping, two clocks (0 = off for that stage):
  //   autoCleanDays      — a card older than this many days comes down into Trash
  //   autoCleanTrashDays — a file that has sat in Trash this long is deleted
  autoCleanDays: 1,
  autoCleanTrashDays: 3,
  // line
  lineSize: 'medium', // small | medium | large
  keepOnLine: 0, // 0 = as many as fit, else 25 | 50 | 100
  soundOff: false,
  opensFromMenuBar: true,
  peeksAtNew: true,
  showOverFullScreen: false,
  zoomOn: false,
  // what hangs
  inboxEnabled: false,
  // Images hang by default: a screenshot taken in WeChat/QQ/Snipping Tool
  // lands on the clipboard, and that is the Windows equivalent of the
  // original's "every capture hangs" promise. Text and links stay opt-in.
  clipboardEnabled: true,
  clipboardTextEnabled: false,
  clipboardLinksEnabled: false,
  // line contents (absolute paths, left -> right)
  pegged: [],
  kept: [],
  byHand: [],
  extraFolders: [],
  // shortcut: {key:'T', ctrl:true, alt:true, shift:false} or null
  shortcut: { key: 'T', ctrl: true, alt: true, shift: false },
  captureShortcut: { key: 'S', ctrl: true, alt: true, shift: false },
  // system screenshot folder we replaced, restored on quit
  inboxSaved: null,
  firstRunDone: false,
};

let data = { ...DEFAULTS };
let saveTimer = null;

function load() {
  try {
    let raw = fs.readFileSync(SETTINGS_FILE, 'utf8');
    // A settings file edited by hand may carry a BOM; JSON.parse chokes on it.
    if (raw.charCodeAt(0) === 0xfeff) raw = raw.slice(1);
    const parsed = JSON.parse(raw);
    data = { ...DEFAULTS, ...parsed };
    // Profiles written before the two-clock auto-clean only had one value.
    // Adopt the new pair (1 day on the line, 3 days in the Trash) once.
    if (parsed && parsed.autoCleanTrashDays === undefined) {
      data.autoCleanDays = 1;
      data.autoCleanTrashDays = 3;
    }
  } catch {
    data = { ...DEFAULTS };
  }
  return data;
}

function save() {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveTimer = null;
    writeNow();
  }, 120);
}

function writeNow() {
  try {
    const tmp = SETTINGS_FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2), { mode: 0o600 });
    fs.renameSync(tmp, SETTINGS_FILE);
  } catch (e) {
    console.error('settings save failed', e);
  }
}

function get(key) {
  return data[key];
}

function set(key, value) {
  data[key] = value;
  save();
  return value;
}

function all() {
  return data;
}

// --- line contents --------------------------------------------------------

function saveLine(paths, keptPaths, byHandPaths) {
  data.pegged = paths;
  data.kept = keptPaths;
  data.byHand = byHandPaths;
  save();
}

function restoreLine() {
  return {
    pegged: Array.isArray(data.pegged) ? data.pegged : [],
    kept: new Set(Array.isArray(data.kept) ? data.kept : []),
    byHand: new Set(Array.isArray(data.byHand) ? data.byHand : []),
  };
}

function contains(folder, file) {
  try {
    return path.dirname(path.resolve(file)).toLowerCase() === path.resolve(folder).toLowerCase();
  } catch {
    return false;
  }
}

function inInbox(file) {
  return contains(SCREENSHOTS, file) || contains(NOTES, file);
}

function stamp() {
  const d = new Date();
  const p = (n, w = 2) => String(n).padStart(w, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}.${p(
    d.getMinutes()
  )}.${p(d.getSeconds())}`;
}

// Taking something down must be undoable, so an inbox file is moved into our
// own trash folder rather than deleted. "Put back" moves it out again; the
// folder is emptied when the app quits with nothing left to restore.
const TRASH = path.join(ROOT, 'Trash');
fs.mkdirSync(TRASH, { recursive: true });

function trashFile(file) {
  try {
    const target = uniqueIn(TRASH, `${Date.now()} ${path.basename(file)}`);
    fs.renameSync(file, target);
    return target;
  } catch {
    return null;
  }
}

function restoreFile(trashed, original) {
  try {
    if (!fs.existsSync(trashed)) return false;
    fs.mkdirSync(path.dirname(original), { recursive: true });
    if (fs.existsSync(original)) {
      const alt = uniqueIn(path.dirname(original), path.basename(original));
      fs.renameSync(trashed, alt);
      return alt;
    }
    fs.renameSync(trashed, original);
    return original;
  } catch {
    return false;
  }
}

function emptyTrash() {
  try {
    for (const name of fs.readdirSync(TRASH)) {
      try {
        fs.unlinkSync(path.join(TRASH, name));
      } catch {}
    }
  } catch {}
}

function uniqueIn(folder, name) {
  const ext = path.extname(name);
  const base = path.basename(name, ext);
  let candidate = path.join(folder, name);
  let n = 2;
  while (fs.existsSync(candidate)) {
    candidate = path.join(folder, `${base} ${n}${ext}`);
    n++;
  }
  return candidate;
}

module.exports = {
  ROOT,
  SCREENSHOTS,
  NOTES,
  TRASH,
  INDEX_FILE,
  SETTINGS_FILE,
  DEFAULTS,
  load,
  save,
  writeNow,
  get,
  set,
  all,
  saveLine,
  restoreLine,
  contains,
  inInbox,
  stamp,
  uniqueIn,
  trashFile,
  restoreFile,
  emptyTrash,
};
