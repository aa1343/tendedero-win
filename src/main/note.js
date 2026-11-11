// Note parsing — a port of NoteSheet.swift's Note.read / looksLikeCode /
// webAddress / Markdown.looks. Kept in the main process so search, menus and
// the renderer all agree on one parse.
const fs = require('fs');
const path = require('path');
const i18n = require('../shared/i18n');

// Dates are the only localised thing in here, so the module keeps its own copy
// of the current language instead of threading it through every parse call.
let uiLang = 'zh';
function setLang(next) {
  uiLang = i18n.normalize(next) || 'zh';
  // Parsed notes cache their date text, so a language change has to drop
  // everything or the cards keep the old wording.
  if (typeof cache !== 'undefined' && cache && cache.clear) cache.clear();
}

const TITLE_LIMIT = 60;
const MAX_CHARS = 4000;

const INK = 'ink';
const SOFT = 'soft';

function decode(file) {
  let buf;
  try {
    buf = fs.readFileSync(file);
  } catch {
    return '';
  }
  // UTF-16 with BOM?
  if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe) return buf.toString('utf16le').slice(1);
  if (buf.length >= 2 && buf[0] === 0xfe && buf[1] === 0xff) {
    const swapped = Buffer.from(buf);
    for (let i = 0; i + 1 < swapped.length; i += 2) {
      const t = swapped[i];
      swapped[i] = swapped[i + 1];
      swapped[i + 1] = t;
    }
    return swapped.toString('utf16le').slice(1);
  }
  let s = buf.toString('utf8');
  if (s.charCodeAt(0) === 0xfeff) s = s.slice(1);
  return s;
}

// RTF: keep the words, drop the control words. Enough for a card.
function fromRTF(raw) {
  let out = '';
  let depth = 0;
  for (let i = 0; i < raw.length; i++) {
    const c = raw[i];
    if (c === '\\') {
      const next = raw[i + 1];
      if (next === '\\' || next === '{' || next === '}') {
        out += next;
        i++;
      } else if (next === "'") {
        const hex = raw.substr(i + 2, 2);
        out += String.fromCharCode(parseInt(hex, 16));
        i += 3;
      } else if (next === '*') {
        // destination group: skip it
        let d = 1;
        i += 2;
        while (i < raw.length && d > 0) {
          if (raw[i] === '{') d++;
          else if (raw[i] === '}') d--;
          i++;
        }
      } else {
        let j = i + 1;
        while (j < raw.length && /[a-zA-Z]/.test(raw[j])) j++;
        const word = raw.slice(i + 1, j);
        while (j < raw.length && /[-\d]/.test(raw[j])) j++;
        if (raw[j] === ' ') j++;
        if (word === 'par' || word === 'line') out += '\n';
        else if (word === 'tab') out += '\t';
        i = j - 1;
      }
    } else if (c === '{') depth++;
    else if (c === '}') depth--;
    else if (c !== '\n' && c !== '\r') out += c;
  }
  return out;
}

function lines(text) {
  return text.split(/\r\n|\r|\n/);
}

function looksLikeCode(text) {
  const ls = lines(text).filter((l) => l.trim() !== '');
  if (ls.length < 2) return false;
  // A line reads as code when it is indented, or ends like a statement:
  // one of { } ; \ ) => ->
  const CODE_END = /(?:[{};\\\\)]|=>|->)$/;
  const codeLike = ls.filter((l) => /^(\s\s|\t)/.test(l) || CODE_END.test(l)).length;
  const symbols = (text.match(/[{}[\]();=<>$#|\\]/g) || []).length;
  return codeLike * 2 >= ls.length || symbols * 12 >= text.length;
}

const INLINE_PATTERNS = [/\*\*[^*\n]+\*\*/, /__[^_\n]+__/, /`[^`\n]+`/, /\[[^\]\n]+\]\([^)\s]+\)/];

function markdownLooks(text) {
  let blocks = 0;
  let inline = 0;
  for (const l of lines(text)) {
    if (/^#{1,6}\s+\S/.test(l) || l.trimStart().startsWith('```')) blocks += 2;
    else if (/^([-*+]|\d+[.)])\s+\S/.test(l) || /^>\s/.test(l)) blocks += 1;
  }
  for (const re of INLINE_PATTERNS) if (re.test(text)) inline += 1;
  return blocks >= 2 || (blocks >= 1 && inline >= 1) || inline >= 2;
}

function webAddress(text) {
  if (/\s/.test(text)) return null;
  let u;
  try {
    u = new URL(text);
  } catch {
    return null;
  }
  const scheme = u.protocol.replace(':', '').toLowerCase();
  if (scheme !== 'http' && scheme !== 'https') return null;
  // NSDataDetector must cover the entire string: no stray prefix/suffix.
  if (u.href.replace(/\/$/, '') !== text.replace(/\/$/, '') && u.href !== text) {
    // tolerate a trailing slash difference only
    if (!text.startsWith(u.origin)) return null;
  }
  return u;
}

function hostOf(u) {
  return (u.host || '').replace(/^www\./, '');
}

function dateText(d) {
  const now = new Date();
  const same = (a, b) =>
    a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  const y = new Date(now);
  y.setDate(y.getDate() - 1);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  const time = `${hh}:${mm}`;
  if (same(d, now)) return i18n.t(uiLang, 'date.today', time);
  if (same(d, y)) return i18n.t(uiLang, 'date.yesterday', time);
  if (d.getFullYear() === now.getFullYear()) return i18n.t(uiLang, 'date.md', d.getMonth() + 1, d.getDate(), time);
  return i18n.t(uiLang, 'date.ymd', d.getFullYear(), d.getMonth() + 1, d.getDate(), time);
}

const cache = new Map();

function parse(file) {
  const stat = (() => {
    try {
      return fs.statSync(file);
    } catch {
      return null;
    }
  })();
  if (!stat) return null;

  const key = file;
  const hit = cache.get(key);
  if (hit && hit.mtimeMs === stat.mtimeMs && hit.size === stat.size) return hit.note;

  const ext = path.extname(file).toLowerCase().replace('.', '');
  let raw = decode(file);
  if (ext === 'rtf') raw = fromRTF(raw);
  let text = raw.slice(0, MAX_CHARS).replace(/^\s+|\s+$/g, '');

  const note = {
    title: '',
    body: '',
    code: false,
    markdown: false,
    link: null,
    linkHost: '',
    linkPath: '',
    linkUrl: '',
    dateText: dateText(stat.birthtimeMs ? new Date(stat.birthtimeMs) : new Date(stat.mtimeMs)),
  };

  const link = webAddress(text);
  if (link) {
    note.link = link.href;
    note.linkUrl = link.href;
    note.linkHost = hostOf(link);
    note.linkPath = link.pathname === '/' ? '' : decodeURIComponent(link.pathname);
    note.title = note.linkHost;
    note.body = link.href;
    cache.set(key, { mtimeMs: stat.mtimeMs, size: stat.size, note });
    return note;
  }

  const ls = lines(text);
  const first = (ls[0] || '').replace(/^\s+|\s+$/g, '');
  const rest = ls.slice(1).join('\n').replace(/^\s+|\s+$/g, '');

  const isMarkdown = ext === 'md' || (ext !== 'rtf' && markdownLooks(text));
  if (isMarkdown) {
    note.markdown = true;
    const h = first.match(/^#{1,6}\s+(.*)$/);
    if (h) {
      note.title = h[1].replace(/^#+\s*/, '').replace(/\s+$/, '');
      note.body = rest;
    } else if (/^([-*+]|\d+[.)])\s+/.test(first) || /^>\s*/.test(first) || first.startsWith('```') || first.length > TITLE_LIMIT) {
      note.title = '';
      note.body = text;
    } else {
      note.title = first;
      note.body = rest;
    }
    cache.set(key, { mtimeMs: stat.mtimeMs, size: stat.size, note });
    return note;
  }

  if (looksLikeCode(text)) {
    note.code = true;
    note.title = '';
    note.body = text;
    cache.set(key, { mtimeMs: stat.mtimeMs, size: stat.size, note });
    return note;
  }

  if (first.length > TITLE_LIMIT) {
    note.title = '';
    note.body = text;
  } else {
    note.title = first;
    note.body = rest;
  }
  cache.set(key, { mtimeMs: stat.mtimeMs, size: stat.size, note });
  return note;
}

// --- Markdown rendering to a block list the renderer draws ----------------

const BULLET = '\u2022\u00a0';
const QUOTE = '\u258d\u00a0';
const CHECK_ON = '\u2611\u00a0';
const CHECK_OFF = '\u2610\u00a0';

function escapeHtml(s) {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function inlineHtml(s) {
  let out = escapeHtml(s);
  out = out.replace(/`([^`\n]+)`/g, '<code>$1</code>');
  out = out.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>');
  out = out.replace(/__([^_\n]+)__/g, '<strong>$1</strong>');
  out = out.replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>');
  out = out.replace(/(^|[^_])_([^_\n]+)_/g, '$1<em>$2</em>');
  out = out.replace(/~~([^~\n]+)~~/g, '<del>$1</del>');
  out = out.replace(/\[([^\]\n]+)\]\(([^)\s]+)\)/g, '<a href="$2">$1</a>');
  return out;
}

function markdownBlocks(text) {
  const out = [];
  let inFence = false;
  for (const line of lines(text)) {
    if (line.trimStart().startsWith('```')) {
      inFence = !inFence;
      continue;
    }
    if (inFence) {
      out.push({ kind: 'code', text: line, level: 0 });
      continue;
    }
    const indent = (line.match(/^[ \t]*/) || [''])[0].replace(/\t/g, '    ').length;
    const level = Math.min(Math.floor(indent / 2), 4);
    const body = line.slice((line.match(/^[ \t]*/) || [''])[0].length);

    let m;
    if ((m = body.match(/^(#{1,6})\s+(.*)$/))) {
      out.push({ kind: 'heading', level: Math.min(m[1].length, 6), text: m[2] });
    } else if ((m = body.match(/^([-*+])\s+\[([ xX])\]\s+(.*)$/))) {
      out.push({ kind: m[2].toLowerCase() === 'x' ? 'checkOn' : 'checkOff', level, text: m[3] });
    } else if ((m = body.match(/^([-*+])\s+(.*)$/))) {
      out.push({ kind: 'bullet', level, text: m[2] });
    } else if ((m = body.match(/^(\d+[.)])\s+(.*)$/))) {
      out.push({ kind: 'number', level, marker: m[1], text: m[2] });
    } else if ((m = body.match(/^>\s?(.*)$/))) {
      out.push({ kind: 'quote', level, text: m[1] });
    } else {
      out.push({ kind: 'para', level, text: body });
    }
  }
  return out;
}

function renderBody(note) {
  if (note.code) {
    return { type: 'code', lines: lines(note.body) };
  }
  if (note.markdown) {
    const blocks = markdownBlocks(note.body);
    return {
      type: 'blocks',
      blocks: blocks.map((b) => {
        const indent = '\u2003'.repeat(b.level);
        let marker = '';
        if (b.kind === 'bullet') marker = BULLET;
        else if (b.kind === 'number') marker = b.marker + '\u00a0';
        else if (b.kind === 'checkOn') marker = CHECK_ON;
        else if (b.kind === 'checkOff') marker = CHECK_OFF;
        else if (b.kind === 'quote') marker = QUOTE;
        return {
          kind: b.kind,
          level: b.level,
          marker: indent + marker,
          html: b.kind === 'code' ? escapeHtml(b.text) : inlineHtml(b.text),
        };
      }),
    };
  }
  return { type: 'plain', html: inlineHtml(note.body) };
}

module.exports = {
  parse,
  renderBody,
  markdownLooks,
  looksLikeCode,
  webAddress,
  setLang,
  TITLE_LIMIT,
  MAX_CHARS,
};
