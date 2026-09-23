import { expect, test, type Locator, type Page, type TestInfo } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { PDFDocument } from 'pdf-lib';

type Geometry = { x: number; y: number; width: number; height: number };
type Shape = Geometry & { type: string; shapeKind: string; fillColor: string; strokeColor: string; strokeWidth: number };
type Project = { annotations: Shape[]; pages: { rotation: number }[] };

async function openFixture(page: Page) {
  const pdf = await PDFDocument.create();
  pdf.addPage([500, 700]);
  await page.goto('/');
  await page.getByTestId('pdf-input').setInputFiles({ name: 'shapes.pdf', mimeType: 'application/pdf', buffer: Buffer.from(await pdf.save()) });
  await expect(page.getByTestId('pdf-surface')).toBeVisible({ timeout: 30_000 });
  await expect.poll(() => page.locator('.pdf-canvas').evaluate(element => (element as HTMLCanvasElement).width)).toBeGreaterThan(100);
}

async function placeShape(page: Page, label: string, x: number, y: number) {
  await page.getByRole('button', { name: '図形', exact: true }).click();
  await page.getByLabel('図形の種類', { exact: true }).selectOption({ label });
  const surface = page.getByTestId('pdf-surface');
  const scale = await surface.evaluate(element => parseFloat((element as HTMLElement).style.width) / 500);
  await surface.click({ position: { x: x * scale, y: y * scale } });
  const annotation = page.locator('.annotation.selected');
  await expect(annotation).toBeVisible();
  await expect(annotation.locator('img')).toHaveAttribute('src', /^data:image\/png/);
  return annotation;
}

async function geometry(annotation: Locator): Promise<Geometry> {
  return annotation.evaluate(element => {
    const style = (element as HTMLElement).style;
    return { x: parseFloat(style.left), y: parseFloat(style.top), width: parseFloat(style.width), height: parseFloat(style.height) };
  });
}

async function dragHandle(page: Page, annotation: Locator, handle: string, dx: number, dy: number) {
  const box = await annotation.getByTestId(`resize-${handle}`).boundingBox();
  if (!box) throw new Error('Resize handle is missing');
  const x = box.x + box.width / 2, y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + dx, y + dy, { steps: 6 });
  await page.mouse.up();
}

async function saveProject(page: Page, testInfo: TestInfo, filename = 'shapes.lumapdf') {
  await page.getByRole('button', { name: '作業データ', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '編集の続きを保存・再開', exact: true });
  const event = page.waitForEvent('download');
  await dialog.getByRole('button', { name: '作業データを保存', exact: true }).click();
  const path = testInfo.outputPath(filename);
  await (await event).saveAs(path);
  await expect(dialog).not.toBeVisible();
  return { path, data: JSON.parse(await readFile(path, 'utf8')) as Project };
}

async function openProject(page: Page, path: string) {
  await page.reload();
  await page.getByRole('button', { name: '作業データ', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '編集の続きを保存・再開', exact: true });
  const chooser = page.waitForEvent('filechooser');
  await dialog.getByRole('button', { name: '保存した作業データを開く', exact: true }).click();
  await (await chooser).setFiles(path);
  // Reopening starts a fresh PDF worker; wait for this I/O operation to finish.
  await expect(dialog).not.toBeVisible({ timeout: 30_000 });
}

test.beforeEach(async ({ context }) => {
  await context.route('**/api/autofill', route => route.abort());
  await context.route('https://api.openai.com/**', route => route.abort());
});

test('枠線と塗りを両方消した透明な図形を作らず、線幅0の場合も表示を保つ', async ({ page }, info) => {
  await openFixture(page);
  await page.getByRole('button', { name: '図形', exact: true }).click();
  const stroke = page.getByLabel('枠線を表示', { exact: true });
  const fill = page.getByLabel('塗りつぶし', { exact: true });
  const width = page.getByRole('spinbutton', { name: '枠線の太さ', exact: true });
  await expect(stroke).toBeChecked();
  await expect(stroke).toBeDisabled();
  await width.fill('0'); await width.press('Enter');
  await expect(width).toHaveValue('0.5');
  await page.getByTestId('pdf-surface').click({ position: { x: 80, y: 120 } });
  await fill.check();
  await stroke.uncheck();
  await expect(fill).toBeDisabled();
  await stroke.check();
  await width.fill('0'); await width.press('Enter');
  await expect(width).toHaveValue('0');
  await expect(fill).toBeDisabled();
  await width.fill('2'); await width.press('Enter');
  await fill.uncheck();
  await expect(stroke).toBeDisabled();
  await width.fill('0'); await width.press('Enter');
  await expect(width).toHaveValue('0.5');
  const saved = await saveProject(page, info);
  expect(saved.data.annotations[0]).toMatchObject({ strokeColor: '#000000', strokeWidth: 0.5, fillColor: 'none' });
});

test('図形を四隅・四辺から自由に変形し、回転後も一操作のUndoと作業データ再開が一致する', async ({ page }, testInfo) => {
  await openFixture(page);
  const annotation = await placeShape(page, '長方形', 80, 140);
  await expect(annotation.locator('.annotation-resize-handle')).toHaveCount(8);
  const initial = await geometry(annotation);
  const scale = initial.width / 120;
  expect(initial.height / scale).toBeCloseTo(80, 1);
  await dragHandle(page, annotation, 'se', 60 * scale, 10 * scale);
  const stretched = await geometry(annotation);
  expect(stretched.width / scale).toBeCloseTo(180, 0);
  expect(stretched.height / scale).toBeCloseTo(90, 0);
  await page.getByRole('button', { name: '元に戻す', exact: true }).click();
  const shape = page.locator('.annotation');
  expect(await geometry(shape)).toEqual(initial);
  await page.getByRole('button', { name: 'やり直す', exact: true }).click();
  await shape.click();
  await dragHandle(page, shape, 'e', 40 * scale, -30 * scale);
  const edge = await geometry(shape);
  expect(edge.width / scale).toBeCloseTo(220, 0);
  expect(edge.height).toBeCloseTo(stretched.height, 1);
  expect(edge.y).toBeCloseTo(stretched.y, 1);
  await page.getByRole('button', { name: '選択・移動', exact: true }).click();
  await page.getByRole('button', { name: 'ページを右に回転', exact: true }).click();
  await shape.click();
  await expect(shape.getByTestId('resize-s')).toHaveCSS('cursor', 'ew-resize');
  // In a clockwise-rotated page, dragging left stretches its original height.
  await dragHandle(page, shape, 's', -30 * scale, 18 * scale);
  const rotated = await geometry(shape);
  expect(rotated.width).toBeCloseTo(edge.width, 1);
  expect(rotated.height / scale).toBeCloseTo(120, 0);
  const saved = await saveProject(page, testInfo);
  expect(saved.data.pages[0].rotation).toBe(90);
  expect(saved.data.annotations[0]).toMatchObject({ type: 'shape', shapeKind: 'rectangle', fillColor: 'none' });
  expect(saved.data.annotations[0].width).toBeCloseTo(220, 0);
  expect(saved.data.annotations[0].height).toBeCloseTo(120, 0);
  await openProject(page, saved.path);
  await expect(page.locator('.annotation')).toHaveCount(1);
  await page.locator('.annotation').click();
  await expect(page.locator('.annotation-resize-handle')).toHaveCount(8);
  const reopened = await saveProject(page, testInfo, 'shapes-reopened.lumapdf');
  expect(reopened.data.annotations[0]).toMatchObject({ width: saved.data.annotations[0].width, height: saved.data.annotations[0].height, shapeKind: 'rectangle' });
  await page.screenshot({ path: testInfo.outputPath('rotated-shape-resize.png'), fullPage: true });
});

test('長方形・楕円・三角形の枠線と塗りつぶしを指定し、PDF出力にも色と透明部分を残す', async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await openFixture(page);
  await placeShape(page, '長方形', 80, 120);
  await page.getByLabel('塗りつぶし', { exact: true }).check();
  await page.getByLabel('塗りつぶしの色', { exact: true }).fill('#ff0000');
  await page.getByLabel('枠線の色', { exact: true }).fill('#0000ff');
  await page.getByRole('spinbutton', { name: '枠線の太さ', exact: true }).fill('6');
  await page.getByRole('spinbutton', { name: '枠線の太さ', exact: true }).press('Enter');

  await placeShape(page, '楕円・円', 80, 280);
  await page.getByLabel('塗りつぶし', { exact: true }).uncheck();
  await page.getByLabel('枠線を表示', { exact: true }).check();
  await page.getByLabel('枠線の色', { exact: true }).fill('#00aa00');
  await page.getByRole('spinbutton', { name: '枠線の太さ', exact: true }).fill('6');
  await page.getByRole('spinbutton', { name: '枠線の太さ', exact: true }).press('Enter');

  await placeShape(page, '三角形', 280, 280);
  await page.getByLabel('塗りつぶし', { exact: true }).check();
  await page.getByLabel('塗りつぶしの色', { exact: true }).fill('#0000ff');
  await page.getByLabel('枠線を表示', { exact: true }).uncheck();
  const saved = await saveProject(page, testInfo);
  expect(saved.data.annotations.map(shape => [shape.shapeKind, shape.fillColor, shape.strokeColor])).toEqual([
    ['rectangle', '#ff0000', '#0000ff'], ['ellipse', 'none', '#00aa00'], ['triangle', '#0000ff', 'none'],
  ]);
  await openProject(page, saved.path);
  await expect(page.locator('.annotation')).toHaveCount(3);
  const event = page.waitForEvent('download');
  await page.getByRole('button', { name: 'PDFを保存', exact: true }).click();
  const path = testInfo.outputPath('colored-shapes.pdf');
  await (await event).saveAs(path);
  const document = await PDFDocument.load(await readFile(path));
  expect(document.getPageCount()).toBe(1);
  await page.getByTestId('pdf-input').setInputFiles(path);
  await expect(page.locator('.annotation')).toHaveCount(0, { timeout: 30_000 });
  const samples = [
    { x: 80, y: 120, expected: 'red' },
    { x: 21, y: 120, expected: 'blue' },
    { x: 145, y: 120, expected: 'white' },
    { x: 80, y: 232, expected: 'green' },
    { x: 80, y: 280, expected: 'white' },
    { x: 280, y: 290, expected: 'blue' },
    { x: 230, y: 235, expected: 'white' },
  ];
  await expect.poll(() => page.locator('.pdf-canvas').evaluate((element, points) => {
    const canvas = element as HTMLCanvasElement;
    const context = canvas.getContext('2d')!;
    return points.map(point => {
      const [r, g, b] = context.getImageData(Math.round(point.x * canvas.width / 500), Math.round(point.y * canvas.height / 700), 1, 1).data;
      if (r > 230 && g > 230 && b > 230) return 'white';
      if (r > 180 && g < 80 && b < 80) return 'red';
      if (b > 180 && r < 80 && g < 80) return 'blue';
      if (g > 100 && r < 80 && b < 80) return 'green';
      return `${r},${g},${b}`;
    });
  }, samples)).toEqual(samples.map(point => point.expected));
  await page.screenshot({ path: testInfo.outputPath('exported-shapes.png'), fullPage: true });
  expect(errors).toEqual([]);
});

test('図形は丸を初期選択し、線と二重線をクリック中心に置いてPDFへ保存できる', async ({ page }, testInfo) => {
  await openFixture(page);
  await page.getByRole('button', { name: '図形', exact: true }).click();
  await expect(page.getByLabel('図形の種類', { exact: true })).toHaveValue('ellipse');
  const surface = page.getByTestId('pdf-surface');
  const scale = await surface.evaluate(element => parseFloat((element as HTMLElement).style.width) / 500);
  await surface.click({ position: { x: 250 * scale, y: 180 * scale } });
  const lock = page.getByRole('button', { name: '縦横比をロック', exact: true });
  await expect(lock).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('.annotation.selected .annotation-resize-handle')).toHaveCount(8);
  await lock.click();
  await expect(lock).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.annotation.selected .annotation-resize-handle')).toHaveCount(4);
  await expect(page.getByTestId('resize-e')).toHaveCount(0);
  await lock.click();
  await expect(page.locator('.annotation.selected .annotation-resize-handle')).toHaveCount(8);
  await placeShape(page, '線', 250, 300);
  await expect(page.getByLabel('塗りつぶし', { exact: true })).toHaveCount(0);
  await placeShape(page, '二重線（取消線）', 250, 370);
  const saved = await saveProject(page, testInfo, 'centered-shapes.lumapdf');
  expect(saved.data.annotations).toMatchObject([
    { shapeKind: 'ellipse', x: 200, y: 130, width: 100, height: 100, aspectLocked: false },
    { shapeKind: 'line', x: 170, y: 294, width: 160, height: 12, aspectLocked: false, fillColor: 'none' },
    { shapeKind: 'double-line', x: 170, y: 361, width: 160, height: 18, aspectLocked: false, fillColor: 'none' },
  ]);
  const event = page.waitForEvent('download');
  await page.getByRole('button', { name: 'PDFを保存', exact: true }).click();
  const path = testInfo.outputPath('centered-shapes.pdf');
  await (await event).saveAs(path);
  expect((await PDFDocument.load(await readFile(path))).getPageCount()).toBe(1);
  await page.getByTestId('pdf-input').setInputFiles(path);
  await expect(page.locator('.annotation')).toHaveCount(0);
  await expect.poll(() => page.locator('.pdf-canvas').evaluate(element => {
    const canvas = element as HTMLCanvasElement;
    const context = canvas.getContext('2d')!;
    return [[250, 300], [250, 367], [250, 370], [250, 372]].map(([x, y]) => {
      const color = context.getImageData(Math.round(x * canvas.width / 500), Math.round(y * canvas.height / 700), 1, 1).data;
      return color[0] < 100 && color[1] < 100 && color[2] < 100 ? 'black' : 'white';
    });
  })).toEqual(['black', 'black', 'white', 'black']);
});
