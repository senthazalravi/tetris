/**
 * Draws the app icons (the same T-block mark as the favicon) as PNGs, with no
 * dependencies: rounded rectangles are rasterised with 4x supersampling and
 * written out with node:zlib.
 *
 *   node scripts/make-icons.mjs
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { deflateSync } from "node:zlib";

const OUT = "apps/web/public/icons";
const BG = [0x26, 0x26, 0x24];
const CREAM = [0xfa, 0xf9, 0xf5];
const CLAY = [0xd9, 0x77, 0x57];

/** The mark on a 64-unit grid (matches favicon.svg): three cream blocks over one clay block. */
const BLOCKS = [
  { x: 8, y: 14, c: CREAM },
  { x: 25, y: 14, c: CREAM },
  { x: 42, y: 14, c: CREAM },
  { x: 25, y: 31, c: CLAY },
];
const BLOCK = 14;
const RADIUS = 3;

function inRound(px, py, x, y, w, h, r) {
  if (px < x || px >= x + w || py < y || py >= y + h) return false;
  const cx = px < x + r ? x + r : px > x + w - r ? x + w - r : px;
  const cy = py < y + r ? y + r : py > y + h - r ? y + h - r : py;
  return (px - cx) ** 2 + (py - cy) ** 2 <= r * r;
}

/**
 * @param size   output size in pixels
 * @param pad    fraction of the canvas to keep clear around the mark (maskable icons need ~20%)
 * @param round  corner radius of the background in 64-unit space (0 = full bleed)
 */
function render(size, pad, round) {
  const SS = 4;
  const px = Buffer.alloc(size * size * 4);
  // Fit the mark's bounding box (8..56 x 14..45) into the padded area.
  const bw = 48;
  const bh = 31;
  const avail = 64 * (1 - 2 * pad);
  const scale = avail / Math.max(bw, bh);
  const ox = (64 - bw * scale) / 2 - 8 * scale;
  const oy = (64 - bh * scale) / 2 - 14 * scale;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const u = ((x + (sx + 0.5) / SS) / size) * 64;
          const v = ((y + (sy + 0.5) / SS) / size) * 64;
          if (round > 0 && !inRound(u, v, 0, 0, 64, 64, round)) continue;
          let col = BG;
          for (const blk of BLOCKS) {
            if (inRound(u, v, ox + blk.x * scale, oy + blk.y * scale, BLOCK * scale, BLOCK * scale, RADIUS * scale)) {
              col = blk.c;
            }
          }
          r += col[0]; g += col[1]; b += col[2]; a += 255;
        }
      }
      const n = SS * SS;
      const i = (y * size + x) * 4;
      const cover = a / (255 * n);
      px[i] = cover ? Math.round(r / (cover * n)) : 0;
      px[i + 1] = cover ? Math.round(g / (cover * n)) : 0;
      px[i + 2] = cover ? Math.round(b / (cover * n)) : 0;
      px[i + 3] = Math.round(cover * 255);
    }
  }
  return png(size, px);
}

const crcTable = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf) {
  let c = 0xffffffff;
  for (const byte of buf) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}
function png(size, rgba) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

mkdirSync(OUT, { recursive: true });
const files = {
  "icon-192.png": render(192, 0.1, 14),
  "icon-512.png": render(512, 0.1, 14),
  // Maskable: full bleed, mark kept inside the central safe zone.
  "icon-maskable-512.png": render(512, 0.22, 0),
  "apple-touch-icon.png": render(180, 0.1, 0),
};
for (const [name, data] of Object.entries(files)) {
  writeFileSync(`${OUT}/${name}`, data);
  console.log(`wrote ${OUT}/${name} (${data.length} bytes)`);
}
