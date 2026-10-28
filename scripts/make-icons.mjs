// Renders the PNG app icons (same design as public/icon.svg: a black "h"
// whose leg flows into a wave, on an orange tile) without any image
// library. Run: node scripts/make-icons.mjs
//
// Full-bleed square, no transparent corners: iOS and Android round the
// corners themselves, and the mark stays inside the maskable safe zone.

import { writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

const ORANGE = [0xff, 0x7a, 0x1a];
const INK = [0x15, 0x15, 0x15];
const STROKE = 52; // in the 512 grid, round caps and joins

// The icon.svg path as absolute cubic segments (512 grid).
const LINES = [[[176, 112], [176, 400]]];
const CURVES = [
  [[176, 290], [176, 230], [212, 198], [256, 198]],
  [[256, 198], [300, 198], [336, 230], [336, 290]],
  [[336, 290], [336, 290], [336, 324], [336, 324]],
  [[336, 324], [336, 368], [366, 394], [406, 380]],
];

// Flatten to short segments; a pixel is ink if it is within STROKE/2 of any.
const segments = [...LINES];
for (const [p0, p1, p2, p3] of CURVES) {
  let prev = p0;
  for (let i = 1; i <= 48; i++) {
    const t = i / 48, u = 1 - t;
    const pt = [0, 1].map(k => u * u * u * p0[k] + 3 * u * u * t * p1[k] + 3 * u * t * t * p2[k] + t * t * t * p3[k]);
    segments.push([prev, pt]);
    prev = pt;
  }
}

function distToSegment(x, y, [[ax, ay], [bx, by]]) {
  const dx = bx - ax, dy = by - ay;
  const len = dx * dx + dy * dy;
  const t = len ? Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / len)) : 0;
  return Math.hypot(x - (ax + t * dx), y - (ay + t * dy));
}
const inMark = (x, y) => segments.some(s => distToSegment(x, y, s) <= STROKE / 2);

function crc32(buf) {
  let c, crc = 0xffffffff;
  for (const b of buf) {
    c = (crc ^ b) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function png(size) {
  const ss = 4; // supersampling for smooth edges
  const raw = Buffer.alloc(size * (size * 3 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 3 + 1)] = 0; // filter: none
    for (let x = 0; x < size; x++) {
      let hits = 0;
      for (let sy = 0; sy < ss; sy++) {
        for (let sx = 0; sx < ss; sx++) {
          if (inMark(((x + (sx + 0.5) / ss) * 512) / size, ((y + (sy + 0.5) / ss) * 512) / size)) hits++;
        }
      }
      const t = hits / (ss * ss);
      const o = y * (size * 3 + 1) + 1 + x * 3;
      for (let i = 0; i < 3; i++) raw[o + i] = Math.round(ORANGE[i] * (1 - t) + INK[i] * t);
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // RGB
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const out = new URL('../public/', import.meta.url);
for (const [name, size] of [['icon-192.png', 192], ['icon-512.png', 512], ['apple-touch-icon.png', 180]]) {
  writeFileSync(new URL(name, out), png(size));
}
console.log('icons written');
