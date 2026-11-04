/**
 * make-icon.js — generate build/icon.png (256x256 RGBA) with no external deps.
 *
 * Draws the GEO Cockpit mark: a brand-violet rounded square with a white "locator" ring + centre
 * dot, rendered at 2x and box-downsampled for smooth edges. electron-builder converts this PNG to
 * the Windows .ico automatically, and the main process reuses it for the tray + window icon.
 */
"use strict";

const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

const OUT = path.join(__dirname, "..", "build", "icon.png");
const SIZE = 256;
const SS = 2;            // supersample factor
const W = SIZE * SS;     // work resolution
const H = SIZE * SS;

// palette (RGBA 0-255)
const violetTop = [0x7c, 0x5c, 0xff];
const violetBot = [0x5b, 0x3f, 0xe0];
const white = [0xff, 0xff, 0xff];

function lerp(a, b, t) { return a + (b - a) * t; }
function mix(c1, c2, t) { return [lerp(c1[0], c2[0], t), lerp(c1[1], c2[1], t), lerp(c1[2], c2[2], t)]; }

// rounded-rect signed coverage helper: returns true if (x,y) is inside a rounded rect
function insideRoundRect(x, y, w, h, r) {
  const rx = Math.min(r, w / 2), ry = Math.min(r, h / 2);
  const dx = Math.max(Math.abs(x - w / 2) - (w / 2 - rx), 0);
  const dy = Math.max(Math.abs(y - h / 2) - (h / 2 - ry), 0);
  return dx * dx + dy * dy <= rx * rx || (Math.abs(x - w / 2) <= w / 2 - rx) || (Math.abs(y - h / 2) <= h / 2 - ry)
    ? dx * dx + dy * dy <= rx * rx
    : false;
}

// Render the hi-res RGBA buffer.
const buf = new Float64Array(W * H * 4);
const cx = W / 2, cy = H / 2;
const margin = 10 * SS;
const rectW = W - margin * 2;
const rectH = H - margin * 2;
const radius = 52 * SS;

const ringOuter = 82 * SS;
const ringInner = 66 * SS;
const dotR = 26 * SS;

for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    const i = (y * W + x) * 4;
    // background rounded square (brand gradient), else transparent
    const lx = x - margin, ly = y - margin;
    let r = 0, g = 0, b = 0, a = 0;
    if (lx >= 0 && ly >= 0 && lx <= rectW && ly <= rectH && insideRoundRect(lx, ly, rectW, rectH, radius)) {
      const t = y / H;
      const c = mix(violetTop, violetBot, t);
      r = c[0]; g = c[1]; b = c[2]; a = 255;
    }
    // white ring + centre dot on top
    const dist = Math.hypot(x - cx, y - cy);
    if ((dist >= ringInner && dist <= ringOuter) || dist <= dotR) {
      r = white[0]; g = white[1]; b = white[2]; a = 255;
    }
    buf[i] = r; buf[i + 1] = g; buf[i + 2] = b; buf[i + 3] = a;
  }
}

// Box-downsample SSxSS -> final SIZE x SIZE, producing raw scanlines with a 0 filter byte.
const stride = SIZE * 4;
const raw = Buffer.alloc((stride + 1) * SIZE);
for (let y = 0; y < SIZE; y++) {
  raw[y * (stride + 1)] = 0; // filter type 0 (None)
  for (let x = 0; x < SIZE; x++) {
    let r = 0, g = 0, b = 0, a = 0;
    for (let sy = 0; sy < SS; sy++) {
      for (let sx = 0; sx < SS; sx++) {
        const i = ((y * SS + sy) * W + (x * SS + sx)) * 4;
        r += buf[i]; g += buf[i + 1]; b += buf[i + 2]; a += buf[i + 3];
      }
    }
    const n = SS * SS;
    const o = y * (stride + 1) + 1 + x * 4;
    raw[o] = Math.round(r / n);
    raw[o + 1] = Math.round(g / n);
    raw[o + 2] = Math.round(b / n);
    raw[o + 3] = Math.round(a / n);
  }
}

// --- PNG encoding -----------------------------------------------------------
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buffer) {
  let c = 0xffffffff;
  for (let i = 0; i < buffer.length; i++) c = CRC_TABLE[(c ^ buffer[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, "ascii");
  const body = Buffer.concat([typeBuf, data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}

const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(SIZE, 0);
ihdr.writeUInt32BE(SIZE, 4);
ihdr[8] = 8;   // bit depth
ihdr[9] = 6;   // color type RGBA
ihdr[10] = 0;  // compression
ihdr[11] = 0;  // filter
ihdr[12] = 0;  // interlace
const idat = zlib.deflateSync(raw, { level: 9 });
const png = Buffer.concat([
  sig,
  chunk("IHDR", ihdr),
  chunk("IDAT", idat),
  chunk("IEND", Buffer.alloc(0)),
]);

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, png);
console.log("Wrote " + OUT + " (" + png.length + " bytes, " + SIZE + "x" + SIZE + ")");
