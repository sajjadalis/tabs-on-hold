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
for (const size of [16, 32, 48, 128]) {
  const pixels = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const px = ((x + 0.5) / size) * 32,
        py = ((y + 0.5) / size) * 32;
      const radius = 7;
      const dx = Math.max(radius - px, px - (32 - radius), 0),
        dy = Math.max(radius - py, py - (32 - radius), 0);
      const inside = dx * dx + dy * dy <= radius * radius;
      const border =
        px >= 8 &&
        px <= 24 &&
        py >= 6 &&
        py <= 26 &&
        (px < 9.5 || px > 22.5 || py < 7.5 || py > 24.5);
      const top =
        py >= 7 && py <= 11 && px >= 13 && px <= 19 && (px < 14.5 || px > 17.5 || py > 9.5);
      const arrow =
        (px >= 15.2 && px <= 16.8 && py >= 14 && py <= 22) ||
        (py >= 18 && py <= 22 && Math.abs(Math.abs(px - 16) - (22 - py)) < 1.1);
      const offset = y * (size * 4 + 1) + 1 + x * 4;
      pixels.set(
        border || top || arrow
          ? [246, 249, 240, inside ? 255 : 0]
          : [72, 107, 61, inside ? 255 : 0],
        offset,
      );
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
