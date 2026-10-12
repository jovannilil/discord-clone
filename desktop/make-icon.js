// Generates icon.png (256x256): a teal rounded square with a white chat bubble.
// Run with: node make-icon.js
const fs = require("node:fs");
const zlib = require("node:zlib");

const SIZE = 256;
const SAMPLES = 4; // supersampling for smooth edges

const insideRoundRect = (x, y, x0, y0, x1, y1, r) => {
  const cx = Math.min(Math.max(x, x0 + r), x1 - r);
  const cy = Math.min(Math.max(y, y0 + r), y1 - r);
  return (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
};

// Triangle tail of the speech bubble.
const insideTail = (x, y) => {
  const [ax, ay, bx, by, cx, cy] = [92, 160, 132, 160, 78, 196];
  const d = (px, py, qx, qy, rx, ry) => (px - rx) * (qy - ry) - (qx - rx) * (py - ry);
  const d1 = d(x, y, ax, ay, bx, by);
  const d2 = d(x, y, bx, by, cx, cy);
  const d3 = d(x, y, cx, cy, ax, ay);
  return !((d1 < 0 || d2 < 0 || d3 < 0) && (d1 > 0 || d2 > 0 || d3 > 0));
};

const insideDot = (x, y, cx) => (x - cx) ** 2 + (y - 118) ** 2 <= 11 ** 2;

function colorAt(x, y) {
  if (!insideRoundRect(x, y, 8, 8, 248, 248, 64)) return null;
  const bubble = insideRoundRect(x, y, 56, 64, 200, 168, 36) || insideTail(x, y);
  if (bubble && !(insideDot(x, y, 96) || insideDot(x, y, 128) || insideDot(x, y, 160))) return [255, 255, 255];
  return [15, 118, 110];
}

const raw = Buffer.alloc((SIZE * 4 + 1) * SIZE);
for (let y = 0; y < SIZE; y++) {
  raw[y * (SIZE * 4 + 1)] = 0; // filter: none
  for (let x = 0; x < SIZE; x++) {
    let r = 0, g = 0, b = 0, a = 0;
    for (let sy = 0; sy < SAMPLES; sy++) {
      for (let sx = 0; sx < SAMPLES; sx++) {
        const c = colorAt(x + (sx + 0.5) / SAMPLES, y + (sy + 0.5) / SAMPLES);
        if (c) { r += c[0]; g += c[1]; b += c[2]; a++; }
      }
    }
    const i = y * (SIZE * 4 + 1) + 1 + x * 4;
    raw[i] = a ? Math.round(r / a) : 0;
    raw[i + 1] = a ? Math.round(g / a) : 0;
    raw[i + 2] = a ? Math.round(b / a) : 0;
    raw[i + 3] = Math.round((a / (SAMPLES * SAMPLES)) * 255);
  }
}

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const byte of buf) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
};

const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(SIZE, 0);
ihdr.writeUInt32BE(SIZE, 4);
ihdr[8] = 8; // bit depth
ihdr[9] = 6; // RGBA

fs.writeFileSync(
  "icon.png",
  Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ])
);
console.log("Wrote icon.png");
