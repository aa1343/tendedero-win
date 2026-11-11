// Watches for new screenshots and new files in folders the user asked to
// watch. Port of ScreenshotWatcher.swift.
//
// macOS knows a screenshot by an xattr and by a settings-changed folder.
// Windows has neither reliably, so this watches three places:
//   1. the folder Windows saves screenshots to (Pictures\Screenshots or
//      Desktop, whichever the system uses),
//   2. the Desktop,
//   3. any extra folders the user adds.
// A file is only accepted once it has stopped growing, so a half-written PNG
// never hangs.
const fs = require('fs');
const path = require('path');
const os = require('os');
const { app } = require('electron');

const IMAGE_EXT = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.tif', '.tiff', '.avif']);
const REC_EXT = new Set(['.mp4', '.mov', '.webm', '.mkv']);

function screenshotsFolder() {
  const candidates = [];
  const reg = readReg();
  if (reg) candidates.push(reg);
  candidates.push(path.join(app.getPath('pictures'), 'Screenshots'));
  candidates.push(path.join(os.homedir(), 'Pictures', 'Screenshots'));
  candidates.push(app.getPath('desktop'));
  for (const c of candidates) {
    try {
      if (c && fs.statSync(c).isDirectory()) return c;
    } catch {}
  }
  return app.getPath('desktop');
}

function readReg() {
  try {
    const { execFileSync } = require('child_process');
    const out = execFileSync(
      'reg',
      ['query', 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\User Shell Folders', '/v', '{B7BEDE81-DF94-4682-A7D8-57A71709C8ED}'],
      { encoding: 'utf8', windowsHide: true }
    );
    const m = out.match(/REG_EXPAND_SZ\s+(.+)/) || out.match(/REG_SZ\s+(.+)/);
    if (m) return m[1].trim().replace(/%([^%]+)%/g, (_, v) => process.env[v] || '');
  } catch {}
  return null;
}

class Watcher {
  constructor({ onImage }) {
    this.onImage = onImage;
    this.watchers = new Map(); // folder -> fs.FSWatcher
    this.pending = new Map(); // path -> {first, last, size}
    this.timer = null;
    this.known = new Set();
    this.extra = [];
    this.started = false;
  }

  start(extraFolders = []) {
    this.extra = extraFolders.filter(Boolean);
    const folders = new Set([screenshotsFolder(), app.getPath('desktop'), ...this.extra]);
    for (const f of folders) this.watch(f);
    // Snapshot what already exists so a restart does not re-hang old files.
    for (const f of folders) this.snapshot(f);
    if (!this.timer) this.timer = setInterval(() => this.settle(), 500);
    // The system screenshot folder may not exist yet (Snipping Tool creates
    // Pictures\Screenshots only when auto-save is turned on). Re-scan so a
    // folder that appears later starts being watched too.
    if (!this.rescan) {
      this.rescan = setInterval(() => {
        const wanted = [screenshotsFolder(), app.getPath('desktop'), ...this.extra];
        for (const f of wanted) {
          if (!this.watchers.has(f)) {
            this.watch(f);
            this.snapshot(f);
          }
        }
      }, 60000);
    }
    this.started = true;
  }

  stop() {
    for (const w of this.watchers.values()) {
      try {
        w.close();
      } catch {}
    }
    this.watchers.clear();
    if (this.timer) clearInterval(this.timer);
    if (this.rescan) clearInterval(this.rescan);
    this.timer = null;
    this.rescan = null;
    this.started = false;
  }

  snapshot(folder) {
    try {
      for (const name of fs.readdirSync(folder)) {
        this.known.add(path.join(folder, name).toLowerCase());
      }
    } catch {}
  }

  watch(folder) {
    if (this.watchers.has(folder)) return;
    try {
      if (!fs.statSync(folder).isDirectory()) return;
    } catch {
      return;
    }
    try {
      const w = fs.watch(folder, { persistent: false }, (_ev, name) => {
        if (!name) return;
        this.consider(path.join(folder, name.toString()));
      });
      this.watchers.set(folder, w);
    } catch {}
  }

  consider(file) {
    const ext = path.extname(file).toLowerCase();
    if (!IMAGE_EXT.has(ext) && !REC_EXT.has(ext)) return;
    let st;
    try {
      st = fs.statSync(file);
    } catch {
      return;
    }
    if (!st.isFile()) return;
    const key = file.toLowerCase();
    if (this.known.has(key)) {
      // A file we have seen before only counts again if it grew.
      const p = this.pending.get(key);
      if (!p) return;
    }
    this.pending.set(key, { path: file, size: st.size, since: Date.now() });
  }

  settle() {
    const now = Date.now();
    for (const [key, p] of [...this.pending]) {
      let st;
      try {
        st = fs.statSync(p.path);
      } catch {
        this.pending.delete(key);
        continue;
      }
      if (st.size !== p.size) {
        p.size = st.size;
        p.since = now;
        continue;
      }
      if (now - p.since < 320) continue;
      this.pending.delete(key);
      this.known.add(key);
      if (!this.isComplete(p.path)) continue;
      this.onImage(p.path);
    }
  }

  // A quick "is the file finished" probe: PNG must end with IEND, JPEG with
  // FFD9, GIF with 3B. Anything else is taken as finished.
  isComplete(file) {
    const ext = path.extname(file).toLowerCase();
    try {
      const size = fs.statSync(file).size;
      if (size < 64) return false;
      const fd = fs.openSync(file, 'r');
      const tail = Buffer.alloc(Math.min(32, size));
      fs.readSync(fd, tail, 0, tail.length, size - tail.length);
      fs.closeSync(fd);
      if (ext === '.png') return tail.includes(Buffer.from('IEND'));
      if (ext === '.jpg' || ext === '.jpeg') {
        for (let i = tail.length - 2; i >= 0; i--) {
          if (tail[i] === 0xff && tail[i + 1] === 0xd9) return true;
        }
        return false;
      }
      if (ext === '.gif') return tail[tail.length - 1] === 0x3b;
      return true;
    } catch {
      return false;
    }
  }
}

module.exports = { Watcher, screenshotsFolder };
