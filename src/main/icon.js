// Draws the t-shirt tray icon in code, the way the original draws its icon in
// Swift: a tiny PNG encoder plus a coverage function, no image files.
const zlib = require('zlib');

function crc32(buf) {
  let c;
  const table = crc32.table || (crc32.table = (() => {
    const t = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c;
    }
    return t;
  })());
  let crc = -1;
  for (let i = 0; i < buf.length; i++) crc = (crc >>> 8) ^ table[(crc ^ buf[i]) & 0xff];
  return (crc ^ -1) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const t = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([t, data])), 0);
  return Buffer.concat([len, t, data, crc]);
}

function encodePNG(w, h, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  const raw = Buffer.alloc((w * 4 + 1) * h);
  let p = 0;
  for (let y = 0; y < h; y++) {
    raw[p++] = 0;
    rgba.copy(raw, p, y * w * 4, (y + 1) * w * 4);
    p += w * 4;
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// A t-shirt silhouette in a 0..1 square. `filled` draws the shirt solid, as
// the macOS template image does; `outline` leaves the collar out.
function shirt(x, y, filled) {
  // Normalised coordinates, origin top-left, y down. A t-shirt: a narrow body,
  // shoulders that slope out, and short sleeves angled down and out.
  const cx = 0.5;
  const bodyTop = 0.22;
  const bodyBottom = 0.88;
  const bodyHalf = 0.215;

  // Body, slightly tapered at the waist.
  if (y >= bodyTop && y <= bodyBottom) {
    const t = (y - bodyTop) / (bodyBottom - bodyTop);
    const half = bodyHalf * (1 - 0.06 * Math.sin(t * Math.PI));
    if (Math.abs(x - cx) <= half) {
      // Round collar notch at the top.
      if (y < bodyTop + 0.11) {
        const dy = (y - bodyTop) / 0.11;
        const depth = 0.10 * Math.sin(Math.min(1, dy) * Math.PI * 0.5);
        if (Math.abs(x - cx) < depth) return false;
      }
      return true;
    }
  }

  // Sleeves: from the shoulder out and down, ending in a slanted cuff.
  const sY = bodyTop + 0.005;
  const sBottom = 0.46;
  if (y >= sY && y <= sBottom) {
    const t = (y - sY) / (sBottom - sY);
    const outer = 0.40 - 0.055 * t;
    const inner = bodyHalf - 0.03;
    const innerEdge = inner + 0.055 * t;
    if (Math.abs(x - cx) >= innerEdge && Math.abs(x - cx) <= outer) return true;
  }
  return false;
}

function render(size, color) {
  const SS = 4;
  const w = size;
  const h = size;
  const rgba = Buffer.alloc(w * h * 4);
  for (let py = 0; py < h; py++) {
    for (let px = 0; px < w; px++) {
      let cover = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const x = (px + (sx + 0.5) / SS) / w;
          const y = (py + (sy + 0.5) / SS) / h;
          if (shirt(x, y, true)) cover++;
        }
      }
      const a = Math.round((cover / (SS * SS)) * 255);
      const i = (py * w + px) * 4;
      rgba[i] = color[0];
      rgba[i + 1] = color[1];
      rgba[i + 2] = color[2];
      rgba[i + 3] = a;
    }
  }
  return encodePNG(w, h, rgba);
}

// Two states: plain (idle) and filled (watching the clipboard).
function icons() {
  return {
    idle: render(32, [120, 120, 120]),
    active: render(32, [40, 40, 40]),
    idleBig: render(64, [120, 120, 120]),
    activeBig: render(64, [40, 40, 40]),
  };
}

module.exports = { icons, encodePNG };
