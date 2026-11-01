import type { Screenshot } from './model';

export const MAX_SCREENSHOT_BYTES = 16 * 1024 * 1024;
export interface BackupScreenshot {
  mimeType: string;
  data: string;
  width: number;
  height: number;
  capturedAt: number;
}

function validateSignature(bytes: Uint8Array, mimeType: string) {
  const matches =
    (mimeType === 'image/png' &&
      [137, 80, 78, 71, 13, 10, 26, 10].every((byte, i) => bytes[i] === byte)) ||
    (mimeType === 'image/jpeg' && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) ||
    (mimeType === 'image/webp' &&
      [82, 73, 70, 70].every((byte, i) => bytes[i] === byte) &&
      [87, 69, 66, 80].every((byte, i) => bytes[i + 8] === byte));
  if (!matches) throw new Error('Invalid screenshot: expected a PNG, JPEG, or WebP image.');
}

function validateDimensions(image: { width: number; height: number }) {
  if (
    !Number.isSafeInteger(image.width) ||
    !Number.isSafeInteger(image.height) ||
    image.width < 1 ||
    image.height < 1 ||
    image.width > 32768 ||
    image.height > 32768 ||
    image.width * image.height > 64_000_000
  )
    throw new Error('Invalid screenshot dimensions.');
}

function validateMetadata(image: Pick<BackupScreenshot, 'width' | 'height' | 'capturedAt'>) {
  validateDimensions(image);
  if (!Number.isSafeInteger(image.capturedAt) || image.capturedAt < 0 || image.capturedAt > 8.64e15)
    throw new Error('Invalid screenshot capture date.');
}

// Inspect encoded dimensions before asking the browser to allocate a bitmap.
function validateEncodedDimensions(bytes: Uint8Array, mimeType: string) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tag = (offset: number, value: string) =>
    [...value].every((character, i) => bytes[offset + i] === character.charCodeAt(0));
  if (
    mimeType === 'image/png' &&
    bytes.length >= 33 &&
    tag(12, 'IHDR') &&
    view.getUint32(8) === 13
  ) {
    validateDimensions({ width: view.getUint32(16), height: view.getUint32(20) });
    return;
  }
  if (mimeType === 'image/jpeg') {
    let offset = 2;
    while (offset < bytes.length && bytes[offset] === 255) {
      while (bytes[offset] === 255) offset++;
      const marker = bytes[offset++];
      if (marker === 217 || marker === 218) break;
      if (marker === 1 || (marker >= 208 && marker <= 215)) continue;
      if (offset + 2 > bytes.length) break;
      const length = view.getUint16(offset);
      if (length < 2 || offset + length > bytes.length) break;
      // JPEG start-of-frame markers contain height and width after sample precision.
      if (
        [0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(
          marker,
        )
      ) {
        if (length < 8) break;
        validateDimensions({
          width: view.getUint16(offset + 5),
          height: view.getUint16(offset + 3),
        });
        return;
      }
      offset += length;
    }
  }
  if (mimeType === 'image/webp' && bytes.length >= 20) {
    const end = view.getUint32(4, true) + 8;
    if (end > bytes.length) throw new Error('Invalid screenshot: truncated WebP image.');
    const uint24 = (offset: number) =>
      bytes[offset] + bytes[offset + 1] * 256 + bytes[offset + 2] * 65536;
    let dimensions: { width: number; height: number } | undefined;
    for (let offset = 12; offset + 8 <= end;) {
      const length = view.getUint32(offset + 4, true);
      const data = offset + 8;
      if (data + length > end) break;
      let size: typeof dimensions;
      if (tag(offset, 'VP8X') && length >= 10)
        size = { width: uint24(data + 4) + 1, height: uint24(data + 7) + 1 };
      if (tag(offset, 'VP8L') && length >= 5 && bytes[data] === 47) {
        const bits = view.getUint32(data + 1, true);
        size = { width: (bits & 16383) + 1, height: ((bits >>> 14) & 16383) + 1 };
      }
      if (
        tag(offset, 'VP8 ') &&
        length >= 10 &&
        bytes[data + 3] === 0x9d &&
        bytes[data + 4] === 1 &&
        bytes[data + 5] === 0x2a
      )
        size = {
          width: view.getUint16(data + 6, true) & 16383,
          height: view.getUint16(data + 8, true) & 16383,
        };
      if (size) {
        validateDimensions(size);
        if (dimensions && (dimensions.width !== size.width || dimensions.height !== size.height))
          throw new Error('Invalid screenshot: inconsistent WebP dimensions.');
        dimensions = size;
      }
      offset = data + length + (length % 2);
    }
    if (dimensions) return;
  }
  throw new Error('Invalid screenshot: missing or truncated image header.');
}

async function validateImage(
  bytes: Uint8Array,
  blob: Blob,
  image: { width: number; height: number },
) {
  validateSignature(bytes, blob.type);
  validateEncodedDimensions(bytes, blob.type);
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(blob);
  } catch {
    throw new Error('Invalid screenshot: image data could not be decoded.');
  }
  try {
    validateDimensions(bitmap);
    if (bitmap.width !== image.width || bitmap.height !== image.height)
      throw new Error('Invalid screenshot: image dimensions do not match the backup metadata.');
  } finally {
    bitmap.close();
  }
}

export async function encodeScreenshot(image: Screenshot): Promise<BackupScreenshot> {
  if (!image.blob.size || image.blob.size > MAX_SCREENSHOT_BYTES)
    throw new Error('Screenshots must be between 1 byte and 16 MB.');
  validateMetadata(image);
  const bytes = new Uint8Array(await image.blob.arrayBuffer());
  await validateImage(bytes, image.blob, image);
  // A multiple of three lets each chunk encode without intermediate padding.
  const parts: string[] = [];
  for (let offset = 0; offset < bytes.length; offset += 24576)
    parts.push(btoa(String.fromCharCode(...bytes.subarray(offset, offset + 24576))));
  const result = {
    mimeType: image.blob.type,
    data: parts.join(''),
    width: image.width,
    height: image.height,
    capturedAt: image.capturedAt,
  };
  return result;
}

export async function decodeScreenshot(value: unknown): Promise<Omit<Screenshot, 'tabId'>> {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    throw new Error('Invalid screenshot record.');
  const image = value as BackupScreenshot;
  validateMetadata(image);
  if (
    typeof image.data !== 'string' ||
    !image.data.length ||
    image.data.length > 4 * Math.ceil(MAX_SCREENSHOT_BYTES / 3) ||
    image.data.length % 4 !== 0 ||
    !/^[A-Za-z0-9+/]*={0,2}$/.test(image.data)
  )
    throw new Error('Invalid screenshot Base64 data (maximum 16 MB per image).');
  const binary = atob(image.data);
  if (binary.length > MAX_SCREENSHOT_BYTES)
    throw new Error('Screenshots must be no larger than 16 MB.');
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  const blob = new Blob([bytes], { type: image.mimeType });
  await validateImage(bytes, blob, image);
  return {
    blob,
    bytes: bytes.length,
    width: image.width,
    height: image.height,
    capturedAt: image.capturedAt,
  };
}
