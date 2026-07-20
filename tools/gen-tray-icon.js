// Generates assets/tray.png (16x16) and assets/tray@2x.png (32x32) from the
// duck sprite — pure node, no deps. Run: node tools/gen-tray-icon.js
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const COLORS = {
  C: [0xff, 0xf4, 0xda, 255],
  O: [0xe8, 0xd5, 0xac, 255],
  E: [0x33, 0x30, 0x2e, 255],
  B: [0xf7, 0x9e, 0x2d, 255],
  b: [0xd9, 0x7f, 0x14, 255],
  K: [0xff, 0xc9, 0xc4, 255],
  F: [0xe8, 0x89, 0x1a, 255],
};

const BODY = [
  '.....OCCCCO...',
  '...OCCCCCCCO..',
  '..OCCCCCCCCCO.',
  '..OCCCCCCCCCO.',
  '.OCCCCCCCCCCO.',
  '.OCCCCCCCCCCO.',
  '.OCCCCCCCCCCO.',
  '.OCCCCCCCCCCO.',
  '.OCCCCCCCCCCO.',
  '.OCCCCCCCCCCO.',
  '..OCCCCCCCCO..',
  '..OCCCCCCCCO..',
  '...OCCCCCCO...',
];
const EYES = [[3, 4], [4, 4], [3, 5], [4, 5], [9, 4], [10, 4], [9, 5], [10, 5]];
const BEAK_B = [[5, 6], [6, 6], [7, 6], [8, 6]];
const BEAK_b = [[6, 7], [7, 7]];
const CHEEKS = [[2, 8], [3, 8], [10, 8], [11, 8]];
const FEET = [[3, 13], [4, 13], [5, 13], [8, 13], [9, 13], [10, 13]];

// build 16x16 RGBA, sprite at offset (1,1)
const SIZE = 16;
const px = new Uint8Array(SIZE * SIZE * 4);
function set(x, y, rgba) {
  if (x < 0 || y < 0 || x >= SIZE || y >= SIZE) return;
  px.set(rgba, (y * SIZE + x) * 4);
}
BODY.forEach((row, r) => {
  [...row].forEach((ch, c) => {
    if (COLORS[ch]) set(c + 1, r + 1, COLORS[ch]);
  });
});
for (const [c, r] of EYES) set(c + 1, r + 1, COLORS.E);
for (const [c, r] of BEAK_B) set(c + 1, r + 1, COLORS.B);
for (const [c, r] of BEAK_b) set(c + 1, r + 1, COLORS.b);
for (const [c, r] of CHEEKS) set(c + 1, r + 1, COLORS.K);
for (const [c, r] of FEET) set(c + 1, r + 1, COLORS.F);

// --- minimal PNG encoder ---
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}
function encodePNG(rgba, size) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0; // filter: none
    Buffer.from(rgba.buffer, y * size * 4, size * 4).copy(raw, y * (size * 4 + 1) + 1);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// 2x upscale for retina
const SIZE2 = SIZE * 2;
const px2 = new Uint8Array(SIZE2 * SIZE2 * 4);
for (let y = 0; y < SIZE2; y++) {
  for (let x = 0; x < SIZE2; x++) {
    const src = ((y >> 1) * SIZE + (x >> 1)) * 4;
    px2.set(px.subarray(src, src + 4), (y * SIZE2 + x) * 4);
  }
}

const outDir = path.join(__dirname, '..', 'assets');
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, 'tray.png'), encodePNG(px, SIZE));
fs.writeFileSync(path.join(outDir, 'tray@2x.png'), encodePNG(px2, SIZE2));
console.log('wrote assets/tray.png and assets/tray@2x.png');
