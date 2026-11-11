// Auto-clean.
//
// Two stages, both driven by the same "days" setting:
//   1. anything that has been hanging on the line longer than that many days is
//      taken down — into the app's own Trash, so nothing is destroyed at once;
//   2. anything that has been sitting in that Trash longer than that many days
//      is deleted for good.
// Pinned cards (and a card being dragged or held) are never touched.
const fs = require('fs');
const path = require('path');
const store = require('./store');

const DAY = 24 * 60 * 60 * 1000;

function ageMs(file) {
  try {
    const st = fs.statSync(file);
    const t = Number(st.mtimeMs) || Number(st.birthtimeMs) || 0;
    return t ? Date.now() - t : 0;
  } catch {
    return 0;
  }
}

// Ids of the cards that are old enough to come down, in line order.
function staleIds(line, days) {
  if (!line || !(days > 0)) return [];
  const cutoff = days * DAY;
  const out = [];
  for (const it of line.items) {
    if (it.falling || it.kept || it.held) continue;
    if (line.dragging === it.id || line.pressed === it.id) continue;
    if (ageMs(it.url) < cutoff) continue;
    out.push(it.id);
  }
  return out;
}

function sweepLine(line, days) {
  const ids = staleIds(line, days);
  if (ids.length) line.discard(ids, { quietly: true });
  return ids;
}

function sweepTrash(days) {
  if (!(days > 0)) return 0;
  const cutoff = days * DAY;
  let names = [];
  try {
    names = fs.readdirSync(store.TRASH);
  } catch {
    return 0;
  }
  let removed = 0;
  for (const name of names) {
    const full = path.join(store.TRASH, name);
    // Trashed files are named "<discarded-at ms> <original name>", so the
    // moment they were taken down is exact even if the file is older.
    const m = /^(\d{10,16})\s+/.exec(name);
    const when = m ? Number(m[1]) : 0;
    const age = when ? Date.now() - when : ageMs(full);
    if (age < cutoff) continue;
    try {
      fs.unlinkSync(full);
      removed++;
    } catch {}
  }
  return removed;
}

module.exports = { ageMs, staleIds, sweepLine, sweepTrash, DAY };
