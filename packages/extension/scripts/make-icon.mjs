// Renders resources/icon.png (128×128) with no dependencies: a dark tile with
// a memory map — stack and heap rows, and a struct with a hatched padding hole.
// 4× supersampled for anti-aliasing. Run: npm run build:icon
import { deflateSync } from "node:zlib";
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const SIZE = 128;
const SS = 4;
const W = SIZE * SS;
const px = new Float32Array(W * W * 4); // premultiplied RGBA, 0..1

const hex = (h) => [parseInt(h.slice(1, 3), 16) / 255, parseInt(h.slice(3, 5), 16) / 255, parseInt(h.slice(5, 7), 16) / 255];

function roundRect(x, y, w, h, r, color, test = () => true) {
  const [cr, cg, cb] = hex(color);
  const [X, Y, Wd, Ht, R] = [x, y, w, h, r].map((v) => v * SS);
  for (let j = Math.max(0, Math.floor(Y)); j < Math.min(W, Math.ceil(Y + Ht)); j++) {
    for (let i = Math.max(0, Math.floor(X)); i < Math.min(W, Math.ceil(X + Wd)); i++) {
      const dx = Math.max(X + R - i - 0.5, 0, i + 0.5 - (X + Wd - R));
      const dy = Math.max(Y + R - j - 0.5, 0, j + 0.5 - (Y + Ht - R));
      if (dx * dx + dy * dy > R * R) continue;
      if (!test(i / SS, j / SS)) continue;
      const k = (j * W + i) * 4;
      px[k] = cr;
      px[k + 1] = cg;
      px[k + 2] = cb;
      px[k + 3] = 1;
    }
  }
}

// Tile
roundRect(4, 4, 120, 120, 24, "#1b2633");
// Region rails
roundRect(18, 22, 4, 26, 2, "#3794ff");
roundRect(18, 56, 4, 26, 2, "#e69f00");
roundRect(18, 90, 4, 18, 2, "#cc79a7");
// Stack row: three variables
roundRect(28, 22, 34, 26, 5, "#3794ff");
roundRect(66, 22, 18, 26, 5, "#3794ff");
roundRect(88, 22, 22, 26, 5, "#5aa9ff");
// Heap row: a struct — field, padding hole (hatched), field
roundRect(28, 56, 22, 26, 5, "#e69f00");
roundRect(52, 56, 26, 26, 5, "#e69f00", (x, y) => Math.floor((x + y) / 4) % 2 === 0);
roundRect(80, 56, 30, 26, 5, "#f2b134");
// Globals row
roundRect(28, 90, 82, 18, 5, "#cc79a7");

// Downsample + encode
const raw = Buffer.alloc(SIZE * (SIZE * 4 + 1));
for (let y = 0; y < SIZE; y++) {
  raw[y * (SIZE * 4 + 1)] = 0;
  for (let x = 0; x < SIZE; x++) {
    let r = 0, g = 0, b = 0, a = 0;
    for (let sy = 0; sy < SS; sy++)
      for (let sx = 0; sx < SS; sx++) {
        const k = ((y * SS + sy) * W + (x * SS + sx)) * 4;
        r += px[k]; g += px[k + 1]; b += px[k + 2]; a += px[k + 3];
      }
    const n = SS * SS;
    const o = y * (SIZE * 4 + 1) + 1 + x * 4;
    const alpha = a / n;
    raw[o] = alpha ? Math.round(((r / n) / alpha) * 255) : 0;
    raw[o + 1] = alpha ? Math.round(((g / n) / alpha) * 255) : 0;
    raw[o + 2] = alpha ? Math.round(((b / n) / alpha) * 255) : 0;
    raw[o + 3] = Math.round(alpha * 255);
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
  const td = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
};
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(SIZE, 0);
ihdr.writeUInt32BE(SIZE, 4);
ihdr[8] = 8; // bit depth
ihdr[9] = 6; // RGBA
const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk("IHDR", ihdr),
  chunk("IDAT", deflateSync(raw, { level: 9 })),
  chunk("IEND", Buffer.alloc(0)),
]);
const out = join(dirname(fileURLToPath(import.meta.url)), "..", "resources", "icon.png");
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, png);
console.log(`wrote ${out} (${png.length} bytes)`);
