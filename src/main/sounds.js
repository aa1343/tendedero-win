// Two tiny sounds, generated in code so the app ships no audio files:
// a "tink" for something arriving and a "pop" for something leaving.
const fs = require('fs');
const os = require('os');
const path = require('path');

function wav(samples, rate = 44100) {
  const n = samples.length;
  const buf = Buffer.alloc(44 + n * 2);
  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + n * 2, 4);
  buf.write('WAVE', 8);
  buf.write('fmt ', 12);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(rate, 24);
  buf.writeUInt32LE(rate * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write('data', 36);
  buf.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) {
    const v = Math.max(-1, Math.min(1, samples[i]));
    buf.writeInt16LE(Math.round(v * 32767), 44 + i * 2);
  }
  return buf;
}

// A bright short chime: two partials, fast decay.
function tink(rate = 44100) {
  const dur = 0.16;
  const n = Math.round(dur * rate);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / rate;
    const env = Math.exp(-t * 26);
    out[i] =
      (Math.sin(2 * Math.PI * 2093 * t) * 0.5 + Math.sin(2 * Math.PI * 3136 * t) * 0.25) * env * 0.5;
  }
  return wav(out, rate);
}

// A soft low pop: a fast downward sweep.
function pop(rate = 44100) {
  const dur = 0.12;
  const n = Math.round(dur * rate);
  const out = new Float32Array(n);
  let phase = 0;
  for (let i = 0; i < n; i++) {
    const t = i / rate;
    const f = 320 * Math.exp(-t * 22) + 90;
    phase += (2 * Math.PI * f) / rate;
    const env = Math.exp(-t * 30);
    out[i] = Math.sin(phase) * env * 0.55;
  }
  return wav(out, rate);
}

let cached = null;

function soundDataUrls() {
  if (cached) return cached;
  cached = {
    tink: 'data:audio/wav;base64,' + tink().toString('base64'),
    pop: 'data:audio/wav;base64,' + pop().toString('base64'),
  };
  return cached;
}

module.exports = { soundDataUrls };
