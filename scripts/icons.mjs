import { mkdirSync, writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, body) {
  const name = Buffer.from(type);
  const size = Buffer.alloc(4);
  size.writeUInt32BE(body.length);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(Buffer.concat([name, body])));
  return Buffer.concat([size, name, body, checksum]);
}
mkdirSync('public/icon', { recursive: true });
function roundedRect(x, y, left, top, width, height, radius) {
  const dx = Math.max(left + radius - x, x - (left + width - radius), 0);
  const dy = Math.max(top + radius - y, y - (top + height - radius), 0);
  return (
    x >= left &&
    x <= left + width &&
    y >= top &&
    y <= top + height &&
    dx * dx + dy * dy <= radius * radius
  );
}
function line(x, y, x1, y1, x2, y2, width) {
  const t = Math.max(
    0,
    Math.min(1, ((x - x1) * (x2 - x1) + (y - y1) * (y2 - y1)) / ((x2 - x1) ** 2 + (y2 - y1) ** 2)),
  );
  return (x - x1 - t * (x2 - x1)) ** 2 + (y - y1 - t * (y2 - y1)) ** 2 <= (width / 2) ** 2;
}
function colorAt(x, y) {
  if (!roundedRect(x, y, 1, 1, 30, 30, 8)) return [0, 0, 0, 0];
  const color = [72, 107, 61, 255];
  if (roundedRect(x, y, 4.5, 5, 18, 15.5, 3)) color.splice(0, 3, 172, 193, 160);
  if (roundedRect(x, y, 8, 9, 18.5, 16.5, 3)) color.splice(0, 3, 246, 249, 240);
  if (x >= 10 && x <= 24.5 && y >= 13 && y <= 14) color.splice(0, 3, 218, 228, 209);
  if (
    line(x, y, 12, 19.5, 22, 19.5, 2) ||
    line(x, y, 19, 16.5, 22, 19.5, 2) ||
    line(x, y, 22, 19.5, 19, 22.5, 2)
  )
    color.splice(0, 3, 72, 107, 61);
  return color;
}
// Supersampling keeps the tab silhouette crisp at Chrome's small toolbar sizes.
for (const size of [16, 24, 32, 48, 128]) {
  const pixels = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const sum = [0, 0, 0, 0];
      for (let sy = 0; sy < 4; sy++)
        for (let sx = 0; sx < 4; sx++) {
          const sample = colorAt(
            ((x + (sx + 0.5) / 4) / size) * 32,
            ((y + (sy + 0.5) / 4) / size) * 32,
          );
          for (let channel = 0; channel < 3; channel++) sum[channel] += sample[channel] * sample[3];
          sum[3] += sample[3];
        }
      const offset = y * (size * 4 + 1) + 1 + x * 4;
      pixels.set(
        sum.slice(0, 3).map((value) => (sum[3] ? Math.round(value / sum[3]) : 0)),
        offset,
      );
      pixels[offset + 3] = Math.round(sum[3] / 16);
    }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size);
  header.writeUInt32BE(size, 4);
  header[8] = 8;
  header[9] = 6;
  const png = Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(pixels)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
  writeFileSync(`public/icon/${size}.png`, png);
}
