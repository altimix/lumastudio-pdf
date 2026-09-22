export type AiCell = { id: string; x: number; y: number; width: number; height: number };
export type AiPageInput = {
  pageId: string; width: number; height: number; imageDataUrl: string;
  cells: AiCell[]; coordinateGrid: { step: number };
};

type Raster = { data: Uint8ClampedArray; width: number; height: number };

/** Conservative line geometry: only closed, empty rectangles become anchors. */
export function detectBlankCells(image: Raster, pageWidth: number, pageHeight: number): AiCell[] {
  const { width, height, data } = image;
  const sx = width / pageWidth, sy = height / pageHeight;
  const luminance = (x: number, y: number) => {
    const offset = (Math.max(0, Math.min(height - 1, y)) * width + Math.max(0, Math.min(width - 1, x))) * 4;
    return (data[offset] + data[offset + 1] + data[offset + 2]) / 3;
  };
  const horizontal: { y: number; left: number; right: number }[] = [];
  const minLine = Math.max(20, Math.round(35 * sx));
  const neighborX = Math.max(2, Math.round(sx * 3));
  const neighborY = Math.max(2, Math.round(sy * 3));
  const horizontalInk = (x: number, y: number) => luminance(x, y) < 253
    && luminance(x, y) + 2 < (luminance(x, y - neighborY) + luminance(x, y + neighborY)) / 2;
  const verticalInk = (x: number, y: number) => luminance(x, y) < 253
    && luminance(x, y) + 2 < (luminance(x - neighborX, y) + luminance(x + neighborX, y)) / 2;
  for (let y = 0; y < height; y += 1) {
    let start = -1, lastInk = -1;
    for (let x = 0; x <= width; x += 1) {
      if (x < width && horizontalInk(x, y)) {
        if (start < 0) start = x;
        lastInk = x;
      } else if (start >= 0 && (x - lastInk > 2 || x === width)) {
        if (lastInk - start >= minLine) horizontal.push({ y, left: start, right: lastInk });
        start = -1;
      }
    }
  }
  // Merge anti-aliased line thickness without merging adjacent form rows.
  const rows: { y: number; left: number; right: number }[] = [];
  for (const line of horizontal) {
    const previous = rows[rows.length - 1];
    if (previous && line.y - previous.y <= Math.max(2, sy * 1.5)) {
      previous.y = (previous.y + line.y) / 2;
      previous.left = Math.min(previous.left, line.left);
      previous.right = Math.max(previous.right, line.right);
    } else rows.push({ ...line });
  }
  const boxes: Omit<AiCell, 'id'>[] = [];
  for (let index = 0; index < rows.length - 1; index += 1) {
    const top = rows[index], bottom = rows[index + 1];
    const topY = Math.round(top.y), bottomY = Math.round(bottom.y);
    const heightPt = (bottomY - topY) / sy;
    if (heightPt < 14 || heightPt > 140) continue;
    // Intersections can disappear from the horizontal contrast mask because the
    // vertical stroke continues above/below them. Include that border width.
    const left = Math.max(0, Math.max(top.left, bottom.left) - neighborX);
    const right = Math.min(width - 1, Math.min(top.right, bottom.right) + neighborX);
    const verticals: number[] = [];
    let verticalRun: number[] = [];
    for (let x = left; x <= right + 1; x += 1) {
      let hits = 0, samples = 0;
      if (x <= right) for (let y = topY + 2; y < bottomY - 1; y += 1) {
        samples += 1;
        if (verticalInk(x, y)) hits += 1;
      }
      if (samples && hits / samples > 0.78) verticalRun.push(x);
      else if (verticalRun.length) {
        // A filled region is not a thin form border.
        if (verticalRun.length <= Math.max(5, sx * 3)) verticals.push(verticalRun.reduce((sum, value) => sum + value, 0) / verticalRun.length);
        verticalRun = [];
      }
    }
    for (let n = 0; n < verticals.length - 1; n += 1) {
      const x1 = verticals[n], x2 = verticals[n + 1];
      if ((x2 - x1) / sx < 24) continue;
      const insetX = Math.max(3, Math.round(sx * 3));
      const insetY = Math.max(3, Math.round(sy * 3));
      let dark = 0, pixels = 0;
      for (let y = topY + insetY; y < bottomY - insetY; y += 1) {
        for (let x = Math.ceil(x1) + insetX; x < x2 - insetX; x += 1) {
          pixels += 1;
          if (luminance(x, y) < 205) dark += 1;
        }
      }
      // Label text, handwriting, previous edits and checkboxes disqualify a cell.
      if (!pixels || dark > Math.max(3, pixels * 0.0005)) continue;
      boxes.push({ x: x1 / sx, y: topY / sy, width: (x2 - x1) / sx, height: (bottomY - topY) / sy });
    }
  }
  return boxes.slice(0, 150).map((box, index) => ({
    id: `C${index + 1}`,
    x: Math.round(box.x * 10) / 10, y: Math.round(box.y * 10) / 10,
    width: Math.round(box.width * 10) / 10, height: Math.round(box.height * 10) / 10,
  }));
}

/** Adds visible point rulers and local cell IDs only to the AI request image. */
export function prepareAiPage(source: HTMLCanvasElement, page: { pageId: string; width: number; height: number }): AiPageInput {
  const scale = Math.min(2.2, 1800 / Math.max(page.width, page.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(page.width * scale);
  canvas.height = Math.ceil(page.height * scale);
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('AI用のページ画像を準備できませんでした。');
  context.fillStyle = '#ffffff'; context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(source, 0, 0, canvas.width, canvas.height);
  const cells = detectBlankCells(context.getImageData(0, 0, canvas.width, canvas.height), page.width, page.height);
  context.scale(canvas.width / page.width, canvas.height / page.height);
  const step = 50;
  context.save();
  context.strokeStyle = 'rgba(23,103,172,0.20)'; context.lineWidth = 0.45;
  context.setLineDash([2, 4]);
  for (let x = step; x < page.width; x += step) { context.beginPath(); context.moveTo(x, 0); context.lineTo(x, page.height); context.stroke(); }
  for (let y = step; y < page.height; y += step) { context.beginPath(); context.moveTo(0, y); context.lineTo(page.width, y); context.stroke(); }
  context.restore();
  context.font = 'bold 7px sans-serif'; context.textBaseline = 'top';
  for (let x = 0; x < page.width - 20; x += step) {
    context.fillStyle = '#e7f2ff'; context.fillRect(x + 1, 1, 25, 11);
    context.fillStyle = '#185c96'; context.fillText(`x${x}`, x + 2, 2);
  }
  for (let y = step; y < page.height - 10; y += step) {
    context.fillStyle = '#e7f2ff'; context.fillRect(1, y, 27, 10);
    context.fillStyle = '#185c96'; context.fillText(`y${y}`, 2, y + 1);
  }
  for (const cell of cells) {
    context.strokeStyle = '#267fd0'; context.lineWidth = 0.8;
    context.strokeRect(cell.x + 1, cell.y + 1, cell.width - 2, cell.height - 2);
    context.fillStyle = '#e7f2ff'; context.fillRect(cell.x + 2, cell.y + 2, 24, 12);
    context.fillStyle = '#185c96'; context.fillText(cell.id, cell.x + 4, cell.y + 3);
  }
  return { ...page, imageDataUrl: canvas.toDataURL('image/png'), cells, coordinateGrid: { step } };
}
