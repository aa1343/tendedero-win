// Watches the clipboard for images, text and links, the way the macOS app
// does — but Windows tells us nothing about "concealed" content, so the
// password-manager rules are approximated with the markers Electron does
// expose plus a length/size cap.
const fs = require('fs');
const path = require('path');
const { clipboard, nativeImage } = require('electron');
const store = require('./store');
const notes = require('./note');

const MAX_CHARS = 100000;
const MAX_BYTES = 64 * 1024 * 1024;
const MAX_PIXELS = 80000000;

function enabled() {
  return (
    store.get('clipboardEnabled') ||
    store.get('clipboardTextEnabled') ||
    store.get('clipboardLinksEnabled')
  );
}

class ClipboardWatcher {
  constructor({ onImage, onText, onLink }) {
    this.onImage = onImage;
    this.onText = onText;
    this.onLink = onLink;
    this.timer = null;
    this.lastText = '';
    this.lastImageHash = '';
    this.lastSeq = '';
  }

  start() {
    if (this.timer) return;
    this.reset();
    this.timer = setInterval(() => this.check(), 500);
  }

  // Whatever is on the clipboard now counts as old news: only the next copy
  // hangs. Called at start and whenever a kind is switched on.
  //
  // The image signature has to be adopted here as well, not cleared: clearing
  // it made every launch hang the picture that happened to be on the clipboard
  // as a brand-new card, so restarting the app duplicated it.
  reset() {
    this.acceptCurrent();
  }

  // The app itself just wrote the clipboard (a click on a card copies). Adopt
  // that content as "already seen", otherwise the poller hangs a duplicate of
  // the very thing the user asked for. Unlike reset() this keeps the current
  // image signature, so images are covered too and not only text.
  acceptCurrent() {
    try {
      this.lastText = clipboard.readText() || '';
    } catch {
      this.lastText = '';
    }
    try {
      const img = clipboard.readImage();
      if (img && !img.isEmpty()) {
        const png = img.toPNG();
        this.lastImageHash = png
          ? `${png.length}:${png[0]}:${png[Math.floor(png.length / 2)]}:${png[png.length - 1]}`
          : '';
      } else {
        this.lastImageHash = '';
      }
    } catch {
      this.lastImageHash = '';
    }
    this.lastSeq = this.seq();
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  seq() {
    try {
      const formats = clipboard.availableFormats();
      return formats.join(',');
    } catch {
      return '';
    }
  }

  check() {
    if (!enabled()) return;
    let text = '';
    let img = null;
    try {
      text = clipboard.readText() || '';
    } catch {}
    try {
      img = clipboard.readImage();
    } catch {}

    // Text wins over images, exactly as the macOS watcher returns early.
    if (text && text !== this.lastText) {
      this.lastText = text;
      if (text.length <= MAX_CHARS) {
        const trimmed = text.replace(/^\s+|\s+$/g, '');
        const link = notes.webAddress(trimmed);
        if (link) {
          if (store.get('clipboardLinksEnabled')) this.onLink(trimmed);
          return;
        }
        if (store.get('clipboardTextEnabled')) this.onText(text);
        return;
      }
      return;
    }

    if (img && !img.isEmpty() && store.get('clipboardEnabled')) {
      const size = img.getSize();
      if (size.width * size.height > MAX_PIXELS) return;
      const png = img.toPNG();
      if (!png || png.length > MAX_BYTES) return;
      // Cheap identity: length + a sample of bytes.
      const hash = `${png.length}:${png[0]}:${png[Math.floor(png.length / 2)]}:${png[png.length - 1]}`;
      if (hash === this.lastImageHash) return;
      this.lastImageHash = hash;
      this.onImage(png);
    }
  }
}

module.exports = { ClipboardWatcher, enabled };
