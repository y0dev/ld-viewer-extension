// Generates media/icon.png: a small, dependency-free PNG encoder (raw
// pixels -> zlib-deflated scanlines -> PNG chunks) so the extension icon
// doesn't require an image-editing toolchain. Run with `node
// scripts/generate-icon.js` to regenerate after changing the design below.
const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

const SIZE = 128;

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf) {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) crc = CRC_TABLE[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const typeBuf = Buffer.from(type, "ascii");
  const lenBuf = Buffer.alloc(4);
  lenBuf.writeUInt32BE(data.length, 0);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([lenBuf, typeBuf, data, crcBuf]);
}

function hex(h) {
  const n = parseInt(h.replace("#", ""), 16);
  return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
}

const BG = hex("#1e1e1e");
const BORDER = hex("#3c3c3c");
const SEGMENTS = [
  { x0: 18, x1: 58, color: hex("#3794ff") }, // blue
  { x0: 62, x1: 84, color: hex("#4ec9b0") }, // teal
  { x0: 88, x1: 110, color: hex("#c586c0") }, // purple
];

const pixels = Buffer.alloc(SIZE * SIZE * 4);

function setPixel(x, y, [r, g, b], a = 255) {
  if (x < 0 || x >= SIZE || y < 0 || y >= SIZE) return;
  const i = (y * SIZE + x) * 4;
  pixels[i] = r;
  pixels[i + 1] = g;
  pixels[i + 2] = b;
  pixels[i + 3] = a;
}

// Background fill, rounded corners via a simple radius cutoff.
const RADIUS = 20;
for (let y = 0; y < SIZE; y++) {
  for (let x = 0; x < SIZE; x++) {
    const cornerX = x < RADIUS ? RADIUS : x >= SIZE - RADIUS ? SIZE - 1 - RADIUS : -1;
    const cornerY = y < RADIUS ? RADIUS : y >= SIZE - RADIUS ? SIZE - 1 - RADIUS : -1;
    if (cornerX >= 0 && cornerY >= 0) {
      const dx = x - cornerX;
      const dy = y - cornerY;
      if (dx * dx + dy * dy > RADIUS * RADIUS) {
        setPixel(x, y, BG, 0);
        continue;
      }
    }
    setPixel(x, y, BG, 255);
  }
}

// Memory-map bar motif: a bordered track with three colored region segments,
// echoing the Studio view's own memory-map bar.
const BAR_Y0 = 52;
const BAR_Y1 = 78;
const BAR_X0 = 14;
const BAR_X1 = 114;

for (let y = BAR_Y0; y < BAR_Y1; y++) {
  for (let x = BAR_X0; x < BAR_X1; x++) {
    const onBorder = y === BAR_Y0 || y === BAR_Y1 - 1 || x === BAR_X0 || x === BAR_X1 - 1;
    setPixel(x, y, onBorder ? BORDER : hex("#2d2d2d"));
  }
}

for (const seg of SEGMENTS) {
  for (let y = BAR_Y0 + 3; y < BAR_Y1 - 3; y++) {
    for (let x = seg.x0; x < seg.x1; x++) {
      setPixel(x, y, seg.color);
    }
  }
}

const raw = Buffer.alloc(SIZE * (1 + SIZE * 4));
for (let y = 0; y < SIZE; y++) {
  const rowStart = y * (1 + SIZE * 4);
  raw[rowStart] = 0; // filter type: none
  pixels.copy(raw, rowStart + 1, y * SIZE * 4, (y + 1) * SIZE * 4);
}

const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(SIZE, 0);
ihdr.writeUInt32BE(SIZE, 4);
ihdr[8] = 8; // bit depth
ihdr[9] = 6; // color type: RGBA
ihdr[10] = 0;
ihdr[11] = 0;
ihdr[12] = 0;

const idat = zlib.deflateSync(raw, { level: 9 });

const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk("IHDR", ihdr),
  chunk("IDAT", idat),
  chunk("IEND", Buffer.alloc(0)),
]);

const outPath = path.join(__dirname, "..", "media", "icon.png");
fs.writeFileSync(outPath, png);
console.log(`Wrote ${outPath} (${png.length} bytes)`);
