import { expect, test } from '@playwright/test';
import { degrees, PDFDocument, rgb } from 'pdf-lib';

test('縦・横・正方形・回転済みPDFを用紙の形でサムネイルと本文に表示する', async ({ page }) => {
  const source = await PDFDocument.create();
  const sizes: [number, number][] = [[400, 600], [600, 400], [500, 500], [250, 800]];
  for (const [index, [width, height]] of sizes.entries()) {
    const sheet = source.addPage([width, height]);
    sheet.drawRectangle({ x: 12, y: 12, width: width - 24, height: height - 24, borderWidth: 3, borderColor: rgb(0.1, 0.45, 0.35) });
    sheet.drawText(`PAGE ${index + 1}`, { x: 25, y: height - 48, size: 20 });
  }
  source.getPage(3).setRotation(degrees(90));
  await page.goto('/');
  await page.getByTestId('pdf-input').setInputFiles({ name: 'mixed-pages.pdf', mimeType: 'application/pdf', buffer: Buffer.from(await source.save()) });
  const papers = page.locator('.thumbnail-paper');
  await expect(papers).toHaveCount(4, { timeout: 30_000 });
  const ratios = [400 / 600, 600 / 400, 1, 800 / 250];
  for (const [index, ratio] of ratios.entries()) {
    const thumbnail = papers.nth(index);
    await expect.poll(() => thumbnail.locator('canvas').evaluate(canvas => (canvas as HTMLCanvasElement).width)).toBeGreaterThan(20);
    await expect.poll(() => thumbnail.locator('canvas').evaluate(canvas => {
      const element = canvas as HTMLCanvasElement;
      const pixels = element.getContext('2d')!.getImageData(0, 0, element.width, element.height).data;
      let ink = 0;
      for (let offset = 0; offset < pixels.length; offset += 24) if (pixels[offset] < 170) ink++;
      return ink;
    })).toBeGreaterThan(20);
    const paper = await thumbnail.boundingBox();
    const canvas = await thumbnail.locator('canvas').boundingBox();
    if (!paper || !canvas) throw new Error('ページのサムネイルが表示されていません');
    expect(paper.width / paper.height).toBeCloseTo(ratio, 1);
    expect(canvas.x).toBeGreaterThanOrEqual(paper.x - 1);
    expect(canvas.y).toBeGreaterThanOrEqual(paper.y - 1);
    expect(canvas.x + canvas.width).toBeLessThanOrEqual(paper.x + paper.width + 1);
    expect(canvas.y + canvas.height).toBeLessThanOrEqual(paper.y + paper.height + 1);
    await page.getByRole('button', { name: `${index + 1}ページ目`, exact: true }).click();
    const viewer = await page.getByTestId('pdf-surface').boundingBox();
    if (!viewer) throw new Error('PDFの本文が表示されていません');
    expect(viewer.width / viewer.height).toBeCloseTo(ratio, 1);
  }
  await page.getByRole('button', { name: '1ページ目', exact: true }).click();
  await page.getByRole('button', { name: 'ページを右に回転', exact: true }).click();
  await expect.poll(async () => {
    const paper = await papers.first().boundingBox();
    return paper ? paper.width / paper.height : 0;
  }).toBeCloseTo(600 / 400, 1);
  const rotated = await page.getByTestId('pdf-surface').boundingBox();
  expect(rotated!.width / rotated!.height).toBeCloseTo(600 / 400, 1);
  await page.setViewportSize({ width: 1024, height: 768 });
  for (const thumbnail of await papers.all()) {
    const frame = await thumbnail.boundingBox();
    const button = await thumbnail.locator('..').boundingBox();
    if (!frame || !button) throw new Error('狭い画面でページが表示されていません');
    expect(frame.x).toBeGreaterThanOrEqual(button.x);
    expect(frame.x + frame.width).toBeLessThanOrEqual(button.x + button.width + 1);
  }
  await page.screenshot({ path: test.info().outputPath('mixed-page-thumbnails.png'), fullPage: true });
});
