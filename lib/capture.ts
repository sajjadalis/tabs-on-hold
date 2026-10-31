import type { Screenshot, Settings } from './model';

export async function compressScreenshot(
  dataUrl: string,
  quality: Settings['quality'],
): Promise<Omit<Screenshot, 'tabId'>> {
  const config = { small: [960, 0.62], balanced: [1280, 0.78], high: [1920, 0.88] }[quality];
  const source = await (await fetch(dataUrl)).blob();
  const bitmap = await createImageBitmap(source);
  try {
    const ratio = Math.min(1, config[0] / bitmap.width);
    const width = Math.max(1, Math.round(bitmap.width * ratio));
    const height = Math.max(1, Math.round(bitmap.height * ratio));
    const canvas = new OffscreenCanvas(width, height);
    const context = canvas.getContext('2d');
    if (!context) throw new Error('The browser could not prepare a preview.');
    context.drawImage(bitmap, 0, 0, width, height);
    const blob = await canvas.convertToBlob({ type: 'image/webp', quality: config[1] });
    return { blob, bytes: blob.size, width, height, capturedAt: Date.now() };
  } finally {
    bitmap.close();
  }
}
