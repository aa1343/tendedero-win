// Taking a screenshot, the Windows way.
//
// macOS gives every capture a place on disk the moment it is taken, which is
// why the original only has to watch a folder. Windows can put a capture on
// the clipboard and nowhere else, so this module takes one itself with
// Electron's desktopCapturer and writes it where the line expects it.
const { desktopCapturer, screen } = require('electron');
const fs = require('fs');
const path = require('path');
const store = require('./store');

let namePrefix = 'Screenshot';
function setShotName(prefix) {
  namePrefix = prefix || 'Screenshot';
}

async function captureScreen(displayId = null) {
  const displays = screen.getAllDisplays();
  const target =
    displays.find((d) => String(d.id) === String(displayId)) ||
    screen.getDisplayNearestPoint(screen.getCursorScreenPoint()) ||
    displays[0];

  const sources = await desktopCapturer.getSources({
    types: ['screen'],
    thumbnailSize: {
      width: Math.round(target.size.width * target.scaleFactor),
      height: Math.round(target.size.height * target.scaleFactor),
    },
    fetchWindowIcons: false,
  });
  if (!sources.length) return null;

  const wanted = sources.find((s) => String(s.display_id) === String(target.id)) || sources[0];
  const img = wanted.thumbnail;
  if (!img || img.isEmpty()) return null;

  const file = store.uniqueIn(store.SCREENSHOTS, `${namePrefix} ${store.stamp()}.png`);
  fs.writeFileSync(file, img.toPNG(), { mode: 0o600 });
  return file;
}

module.exports = { captureScreen, setShotName };
