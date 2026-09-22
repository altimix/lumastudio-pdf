import { describe, expect, it } from 'vitest';
import { processStampPixels, suggestStampMode, type StampPixels } from './stamp-image';

const row = (pixels: number[][]): StampPixels => ({ width: pixels.length, height: 1, data: new Uint8ClampedArray(pixels.flat()) });
const rgba = (image: StampPixels, index: number) => [...image.data.slice(index * 4, index * 4 + 4)];

describe('local stamp transparency', () => {
  it('preserves original translucent seal pixels without changing color', () => {
    const image = row([[0, 0, 0, 0], [190, 39, 47, 128], [166, 23, 35, 255]]);
    const processed = processStampPixels(image, { mode: 'preserve', crop: false });
    expect(processed.data).toEqual(image.data);
    expect(processed.data).not.toBe(image.data);
    expect(suggestStampMode(image)).toBe('preserve');
  });

  it('removes a white matte and unmattes red edges to prevent pale halos', () => {
    const image = row([[255, 255, 255, 255], [255, 128, 128, 255], [170, 0, 0, 255], [0, 0, 0, 255]]);
    const output = processStampPixels(image, { mode: 'white', threshold: 0, crop: false });
    expect(rgba(output, 0)).toEqual([0, 0, 0, 0]);
    expect(rgba(output, 1)).toEqual([255, 0, 0, 127]);
    expect(rgba(output, 2)).toEqual([170, 0, 0, 255]);
    expect(rgba(output, 3)).toEqual([0, 0, 0, 255]);
    // Re-composition over white matches the original antialiased edge.
    const edge = rgba(output, 1);
    expect(Math.round(edge[1] * edge[3] / 255 + 255 - edge[3])).toBe(128);
  });

  it('removes a black matte without a dark fringe and keeps the original alpha', () => {
    const image = row([[0, 0, 0, 255], [128, 0, 0, 255], [255, 0, 0, 128]]);
    const output = processStampPixels(image, { mode: 'black', threshold: 0, crop: false });
    expect(rgba(output, 0)).toEqual([0, 0, 0, 0]);
    expect(rgba(output, 1)).toEqual([255, 0, 0, 128]);
    expect(rgba(output, 2)).toEqual([255, 0, 0, 128]);
  });

  it('red-only keeps transparent PNG ink while excluding black, white and blue', () => {
    const image = row([[0, 0, 0, 0], [178, 34, 47, 144], [0, 0, 0, 255], [255, 255, 255, 255], [20, 50, 200, 255]]);
    const output = processStampPixels(image, { mode: 'red', threshold: 18, crop: false });
    expect(rgba(output, 1)).toEqual([178, 34, 47, 144]);
    expect([2, 3, 4].map(index => rgba(output, index)[3])).toEqual([0, 0, 0]);
  });

  it('crops transparent margins without stretching rectangular seals and leaves 4px', () => {
    const data = new Uint8ClampedArray(20 * 30 * 4);
    for (let y = 5; y < 25; y++) for (let x = 8; x < 12; x++) data.set([170, 20, 30, 255], (y * 20 + x) * 4);
    const result = processStampPixels({ width: 20, height: 30, data }, { mode: 'preserve' });
    expect(result.width).toBe(12);
    expect(result.height).toBe(28);
    expect(rgba(result, 4 * 12 + 4)).toEqual([170, 20, 30, 255]);
    expect(rgba(result, 3 * 12 + 4)[3]).toBe(0);
    expect(rgba(result, 24 * 12 + 4)[3]).toBe(0);
  });

  it('reports a fully removed image so the dialog can prevent saving it', () => {
    const result = processStampPixels(row([[255, 255, 255, 255]]), { mode: 'white' });
    expect(result.hasContent).toBe(false);
    expect(result.width).toBe(1);
    expect(result.data).toEqual(new Uint8ClampedArray(4));
  });

  it('offers white/black background removal only for opaque images', () => {
    expect(suggestStampMode(row([[255, 255, 255, 255], [170, 0, 0, 255], [255, 255, 255, 255]]))).toBe('white');
    expect(suggestStampMode(row([[0, 0, 0, 255], [170, 0, 0, 255], [0, 0, 0, 255]]))).toBe('black');
  });

  it('rejects incorrect raster dimensions instead of reading outside the array', () => {
    expect(() => processStampPixels({ width: 2001, height: 1, data: new Uint8ClampedArray(8004) }, { mode: 'white' })).toThrow();
    expect(() => processStampPixels({ width: 2, height: 1, data: new Uint8ClampedArray(4) }, { mode: 'white' })).toThrow();
  });
});
