export type StampBackgroundMode = 'preserve' | 'white' | 'red' | 'black';

export interface StampPixels {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}

export interface ProcessedStamp extends StampPixels {
  hasContent: boolean;
}

export interface StampImageOptions {
  mode: StampBackgroundMode;
  /** 0 keeps faint edges; increasing it removes more background noise. */
  threshold?: number;
  crop?: boolean;
  margin?: number;
}

const MAX_FILE_BYTES = 2 * 1024 * 1024;
const MAX_DIMENSION = 2000;
const MAX_SOURCE_PIXELS = 32 * 1024 * 1024;

function checkPixels(image: StampPixels) {
  if (!Number.isInteger(image.width) || !Number.isInteger(image.height)
    || image.width < 1 || image.height < 1 || image.width > MAX_DIMENSION || image.height > MAX_DIMENSION
    || image.data.length !== image.width * image.height * 4) {
    throw new Error('印鑑画像のサイズが正しくありません。');
  }
}

function softness(value: number, threshold: number) {
  const t = Math.max(0, Math.min(1, (value - threshold) / 24));
  return t * t * (3 - 2 * t);
}

function hasExistingTransparency(image: StampPixels) {
  let transparent = 0;
  for (let index = 3; index < image.data.length; index += 4) if (image.data[index] < 16) transparent++;
  return transparent > image.width * image.height * 0.01;
}

function borderTone(image: StampPixels) {
  const values: number[] = [];
  const add = (x: number, y: number) => {
    const offset = (y * image.width + x) * 4;
    const [r, g, b, a] = image.data.subarray(offset, offset + 4);
    // Estimate the neutral background, excluding red ink and transparent pixels.
    if (a >= 240 && Math.max(r, g, b) - Math.min(r, g, b) < 45) values.push((r + g + b) / 3);
  };
  for (let x = 0; x < image.width; x++) { add(x, 0); add(x, image.height - 1); }
  for (let y = 1; y < image.height - 1; y++) { add(0, y); add(image.width - 1, y); }
  values.sort((a, b) => a - b);
  return values.length ? values[Math.floor(values.length / 2)] : 255;
}

export function suggestStampMode(image: StampPixels): StampBackgroundMode {
  checkPixels(image);
  if (hasExistingTransparency(image)) return 'preserve';
  const tone = borderTone(image);
  return tone > 180 ? 'white' : tone < 80 ? 'black' : 'preserve';
}

/** Deterministic local pixel operation: no AI, OCR, or regeneration of seal strokes. */
export function processStampPixels(image: StampPixels, options: StampImageOptions): ProcessedStamp {
  checkPixels(image);
  const data = new Uint8ClampedArray(image.data);
  const threshold = Number.isFinite(options.threshold) ? Math.max(0, Math.min(100, options.threshold!)) : 18;
  const existingTransparency = hasExistingTransparency(image);
  const matteMode = options.mode === 'red' ? (borderTone(image) < 128 ? 'black' : 'white') : options.mode;
  for (let offset = 0; offset < data.length; offset += 4) {
    const r = image.data[offset], g = image.data[offset + 1], b = image.data[offset + 2];
    const originalAlpha = image.data[offset + 3] / 255;
    if (!originalAlpha || options.mode === 'preserve') continue;
    let outputAlpha = originalAlpha;
    // Existing transparent PNGs already contain unmatted RGB. Preserve those colors
    // in red-only mode, so a dark red seal does not turn into bright red pixels.
    if (options.mode !== 'red' || !existingTransparency) {
      const distance = matteMode === 'black' ? Math.max(r, g, b) : 255 - Math.min(r, g, b);
      const matteAlpha = distance / 255;
      outputAlpha *= matteAlpha * softness(distance, threshold);
      if (matteAlpha > 0) {
        for (let channel = 0; channel < 3; channel++) {
          const value = image.data[offset + channel] / 255;
          // Remove the color of the original matte before setting alpha. Simply
          // hiding white pixels leaves a pale fringe on colored PDF backgrounds.
          data[offset + channel] = (matteMode === 'black'
            ? value / matteAlpha
            : (value - (1 - matteAlpha)) / matteAlpha) * 255;
        }
      }
    }
    if (options.mode === 'red') outputAlpha *= softness(r - Math.max(g, b), threshold);
    data[offset + 3] = outputAlpha * 255;
    if (data[offset + 3] === 0) { data[offset] = 0; data[offset + 1] = 0; data[offset + 2] = 0; }
  }

  let left = image.width, right = -1, top = image.height, bottom = -1;
  for (let y = 0; y < image.height; y++) {
    for (let x = 0; x < image.width; x++) {
      if (data[(y * image.width + x) * 4 + 3] > 2) {
        left = Math.min(left, x); right = Math.max(right, x);
        top = Math.min(top, y); bottom = Math.max(bottom, y);
      }
    }
  }
  const hasContent = right >= left && bottom >= top;
  if (options.crop === false) return { data, width: image.width, height: image.height, hasContent };
  if (!hasContent) return { data: new Uint8ClampedArray(4), width: 1, height: 1, hasContent: false };
  const margin = Number.isFinite(options.margin) ? Math.max(0, Math.min(20, Math.round(options.margin!))) : 4;
  const contentWidth = right - left + 1, contentHeight = bottom - top + 1;
  const marginX = Math.min(margin, Math.floor((MAX_DIMENSION - contentWidth) / 2));
  const marginY = Math.min(margin, Math.floor((MAX_DIMENSION - contentHeight) / 2));
  const width = contentWidth + marginX * 2, height = contentHeight + marginY * 2;
  const cropped = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < contentHeight; y++) {
    const start = ((top + y) * image.width + left) * 4;
    cropped.set(data.subarray(start, start + contentWidth * 4), ((y + marginY) * width + marginX) * 4);
  }
  return { data: cropped, width, height, hasContent: true };
}

export function stampPixelsToDataUrl(image: StampPixels) {
  const canvas = document.createElement('canvas');
  canvas.width = image.width; canvas.height = image.height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('画像を処理できませんでした。');
  context.putImageData(new ImageData(new Uint8ClampedArray(image.data), image.width, image.height), 0, 0);
  return canvas.toDataURL('image/png');
}

function sourceDimensions(bytes: Uint8Array): { width: number; height: number } | undefined {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.length >= 24 && bytes[0] === 137 && bytes[1] === 80) return { width: view.getUint32(16), height: view.getUint32(20) };
  let offset = 2;
  while (offset + 8 < bytes.length) {
    if (bytes[offset] !== 255) break;
    const marker = bytes[offset + 1];
    if (marker === 255) { offset++; continue; }
    const length = view.getUint16(offset + 2);
    if (length < 2) break;
    if ([192, 193, 194, 195, 197, 198, 199, 201, 202, 203, 205, 206, 207].includes(marker)) {
      return { width: view.getUint16(offset + 7), height: view.getUint16(offset + 5) };
    }
    offset += length + 2;
  }
  return undefined;
}

export async function decodeStampFile(file: File): Promise<{ pixels: StampPixels; originalDataUrl: string; suggestedMode: StampBackgroundMode }> {
  if (file.size <= 0 || file.size > MAX_FILE_BYTES) throw new Error('印鑑画像は2MB以下のPNGまたはJPEGを選択してください。');
  const bytes = new Uint8Array(await file.arrayBuffer());
  const isPng = bytes.length >= 24 && [137, 80, 78, 71, 13, 10, 26, 10].every((n, index) => bytes[index] === n);
  const isJpeg = bytes.length >= 10 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
  if (!isPng && !isJpeg) throw new Error('PNGまたはJPEG形式の印鑑画像を選択してください。');
  const dimensions = sourceDimensions(bytes);
  if (dimensions && (!dimensions.width || !dimensions.height || dimensions.width * dimensions.height > MAX_SOURCE_PIXELS)) {
    throw new Error('画像の解像度が大きすぎます。3,200万画素以下に縮小してください。');
  }
  let bitmap: ImageBitmap;
  try { bitmap = await createImageBitmap(new Blob([bytes], { type: isPng ? 'image/png' : 'image/jpeg' })); }
  catch { throw new Error('印鑑画像を読み込めませんでした。別のPNGまたはJPEGをお試しください。'); }
  try {
    if (!bitmap.width || !bitmap.height || bitmap.width * bitmap.height > MAX_SOURCE_PIXELS) throw new Error('画像の解像度が大きすぎます。');
    const scale = Math.min(1, MAX_DIMENSION / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bitmap.width * scale)); canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) throw new Error('画像を処理できませんでした。');
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
    return { pixels, originalDataUrl: canvas.toDataURL('image/png'), suggestedMode: suggestStampMode(pixels) };
  } finally { bitmap.close(); }
}
