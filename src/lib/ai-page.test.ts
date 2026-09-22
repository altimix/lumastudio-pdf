import { describe, expect, it } from 'vitest';
import { detectBlankCells } from './ai-page';

function formRaster(filled = false) {
  const width = 400, height = 240;
  const data = new Uint8ClampedArray(width * height * 4).fill(255);
  const pixel = (x: number, y: number, color = 218) => {
    const index = (y * width + x) * 4;
    data[index] = data[index + 1] = data[index + 2] = color;
  };
  for (const y of [60, 110, 160]) for (let x = 30; x <= 360; x++) pixel(x, y);
  for (const x of [30, 120, 360]) for (let y = 60; y <= 160; y++) pixel(x, y);
  // Printed field labels: these are never empty candidate cells.
  for (const top of [80, 130]) for (let y = top; y < top + 10; y++) for (let x = 50; x < 65; x++) pixel(x, y, 30);
  if (filled) for (let y = 80; y < 90; y++) for (let x = 145; x < 190; x++) pixel(x, y, 30);
  return { width, height, data };
}

describe('AI page geometry anchors', () => {
  it('detects the blank writing cells and excludes their printed labels', () => {
    const cells = detectBlankCells(formRaster(), 400, 240);
    expect(cells).toEqual([
      { id: 'C1', x: 120, y: 60, width: 240, height: 50 },
      { id: 'C2', x: 120, y: 110, width: 240, height: 50 },
    ]);
  });
  it('excludes a cell already containing user text and converts raster to point coordinates', () => {
    expect(detectBlankCells(formRaster(true), 800, 480)).toEqual([
      { id: 'C1', x: 240, y: 220, width: 480, height: 100 },
    ]);
  });
  it('does not invent cells on a page without form borders', () => {
    const image = formRaster(); image.data.fill(255);
    expect(detectBlankCells(image, 400, 240)).toEqual([]);
  });
});
