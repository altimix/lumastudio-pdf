import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { PDFDocument, StandardFonts } from 'pdf-lib';

async function openFixture(page: Page) {
  const pdf = await PDFDocument.create();
  const sheet = pdf.addPage([500, 700]);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  sheet.drawText('ORIGINAL CONTENT', { x: 25, y: 650, size: 16, font });
  await page.goto('/');
  await page.getByTestId('pdf-input').setInputFiles({ name: 'ink-test.pdf', mimeType: 'application/pdf', buffer: Buffer.from(await pdf.save()) });
  await expect(page.getByTestId('pdf-surface')).toBeVisible({ timeout: 30_000 });
}

async function dragOnPage(page: Page, from: [number, number], to: [number, number], shift = false, steps = 10) {
  const surface = page.getByTestId('pdf-surface');
  const box = await surface.boundingBox();
  if (!box) throw new Error('PDFが表示されていません');
  const scale = await surface.evaluate(element => parseFloat((element as HTMLElement).style.width) / 500);
  if (shift) await page.keyboard.down('Shift');
  await page.mouse.move(box.x + from[0] * scale, box.y + from[1] * scale);
  await page.mouse.down();
  await page.mouse.move(box.x + to[0] * scale, box.y + to[1] * scale, { steps });
  await page.mouse.up();
  if (shift) await page.keyboard.up('Shift');
}

async function project(page: Page, info: TestInfo, name: string) {
  await page.getByRole('button', { name: '作業データ', exact: true }).click();
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: '作業データを保存', exact: true }).click();
  const path = info.outputPath(name);
  await (await download).saveAs(path);
  return { path, data: JSON.parse(await readFile(path, 'utf8')) as { pages: { rotation: number }[]; annotations: { type: string; points?: { x: number; y: number }[]; color?: string; markerCap?: string }[] } };
}

test.beforeEach(async ({ context }) => {
  await context.route('**/api/autofill', route => route.abort());
  await context.route('https://api.openai.com/**', route => route.abort());
});

test('ペン手書き・Shift直線・半透明マーカーをPDFと作業データへ保存する', async ({ page }, info) => {
  await openFixture(page);
  await page.getByRole('button', { name: 'ペン', exact: true }).click();
  await dragOnPage(page, [80, 120], [220, 170]);
  await dragOnPage(page, [80, 230], [220, 260], true);
  await page.getByRole('button', { name: '蛍光ペン', exact: true }).click();
  await expect(page.getByRole('spinbutton', { name: '手書き線の太さ', exact: true })).toHaveValue('18');
  await dragOnPage(page, [80, 330], [230, 330]);
  await expect(page.locator('.annotation')).toHaveCount(3);
  const saved = await project(page, info, 'ink-strokes.lumapdf');
  expect(saved.data.annotations.map(item => item.type)).toEqual(['pen', 'pen', 'marker']);
  expect(saved.data.annotations[0].points!.length).toBeGreaterThan(2);
  expect(saved.data.annotations[1].points).toHaveLength(2);
  expect(saved.data.annotations[2].color).toBe('#ffe14a');
  const event = page.waitForEvent('download');
  await page.getByRole('button', { name: 'PDFを保存', exact: true }).click();
  const exported = info.outputPath('ink-strokes.pdf');
  await (await event).saveAs(exported);
  expect((await PDFDocument.load(await readFile(exported))).getPageCount()).toBe(1);
  await page.getByTestId('pdf-input').setInputFiles(exported);
  await expect(page.locator('.annotation')).toHaveCount(0);
  await expect.poll(() => page.locator('.pdf-canvas').evaluate(canvas => {
    const element = canvas as HTMLCanvasElement;
    const pixels = element.getContext('2d')!.getImageData(0, 0, element.width, element.height).data;
    let dark = 0, yellow = 0;
    for (let offset = 0; offset < pixels.length; offset += 4) {
      const [r, g, b] = [pixels[offset], pixels[offset + 1], pixels[offset + 2]];
      if (r < 130 && g < 130 && b < 130) dark++;
      if (r > 220 && g > 210 && b < 230 && r - b > 25) yellow++;
    }
    return dark > 100 && yellow > 100;
  })).toBe(true);
  await page.screenshot({ path: info.outputPath('ink-exported.png'), fullPage: true });
});

test('蛍光ペンの角と丸を選び、描画後の変更・作業再開・完成PDFに反映する', async ({ page }, info) => {
  await openFixture(page);
  await page.getByRole('button', { name: '蛍光ペン', exact: true }).click();
  const cap = page.getByLabel('蛍光ペンの端', { exact: true });
  await expect(cap).toHaveValue('square');
  await dragOnPage(page, [80, 330], [230, 330], true);
  await cap.selectOption('round');
  await dragOnPage(page, [80, 380], [230, 380], true);
  await page.getByRole('button', { name: '選択・移動', exact: true }).click();
  await page.getByRole('button', { name: /^蛍光ペン:/ }).first().click();
  await expect(cap).toHaveValue('square');
  await cap.selectOption('round');
  await expect(cap).toHaveValue('round');
  await page.getByRole('button', { name: '元に戻す', exact: true }).click();
  const saved = await project(page, info, 'marker-tips.lumapdf');
  expect(saved.data.annotations.map(annotation => annotation.markerCap)).toEqual(['square', 'round']);
  await page.reload();
  await page.getByTestId('project-input').setInputFiles(saved.path);
  await expect(page.locator('.annotation')).toHaveCount(2);
  await page.getByRole('button', { name: /^蛍光ペン:/ }).first().click();
  await expect(page.getByLabel('蛍光ペンの端', { exact: true })).toHaveValue('square');
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'PDFを保存', exact: true }).click();
  const exported = info.outputPath('marker-tips.pdf');
  await (await download).saveAs(exported);
  await page.getByTestId('pdf-input').setInputFiles(exported);
  await expect(page.locator('.annotation')).toHaveCount(0);
  await expect.poll(() => page.locator('.pdf-canvas').evaluate(element => {
    const canvas = element as HTMLCanvasElement;
    const context = canvas.getContext('2d')!;
    return [[72, 322], [72, 372]].map(([x, y]) => {
      const pixel = context.getImageData(Math.round(x * canvas.width / 500), Math.round(y * canvas.height / 700), 1, 1).data;
      return pixel[2] < 235 ? 'yellow' : 'white';
    });
  })).toEqual(['yellow', 'white']);
  await page.screenshot({ path: info.outputPath('marker-tips.png'), fullPage: true });
});

test('太い斜めの角端マーカーは画像の端で切れない', async ({ page }, info) => {
  await openFixture(page);
  await page.getByRole('button', { name: '蛍光ペン', exact: true }).click();
  await expect(page.getByLabel('蛍光ペンの端', { exact: true })).toHaveValue('square');
  const width = page.getByRole('spinbutton', { name: '手書き線の太さ', exact: true });
  await width.fill('72');
  await width.press('Enter');
  await dragOnPage(page, [100, 120], [180, 200], true);
  const image = page.locator('.annotation img');
  await expect(image).toHaveAttribute('src', /^data:image\/png/);
  const pixels = await image.evaluate(element => {
    const image = element as HTMLImageElement;
    const canvas = document.createElement('canvas');
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    const context = canvas.getContext('2d')!;
    context.drawImage(image, 0, 0);
    const data = context.getImageData(0, 0, canvas.width, canvas.height).data;
    let painted = false, clipped = false;
    for (let y = 0; y < canvas.height; y++) for (let x = 0; x < canvas.width; x++) {
      if (data[(y * canvas.width + x) * 4 + 3] > 4) {
        painted = true;
        if (x < 2 || y < 2 || x >= canvas.width - 2 || y >= canvas.height - 2) clipped = true;
      }
    }
    return { painted, clipped };
  });
  expect(pixels).toEqual({ painted: true, clipped: false });
  const saved = await project(page, info, 'diagonal-square-marker.lumapdf');
  expect(saved.data.annotations[0].markerCap).toBe('square');
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'PDFを保存', exact: true }).click();
  const exported = info.outputPath('diagonal-square-marker.pdf');
  await (await download).saveAs(exported);
  expect((await PDFDocument.load(await readFile(exported))).getPageCount()).toBe(1);
});

test('細い直線の色と縦横比ロックを変えても配置と大きさが変わらない', async ({ page }) => {
  await openFixture(page);
  await page.getByRole('button', { name: 'ペン', exact: true }).click();
  await dragOnPage(page, [80, 120], [240, 120], true);
  await page.getByRole('button', { name: '選択・移動', exact: true }).click();
  const line = page.getByRole('button', { name: /^ペン:/ });
  await line.click();
  await expect(page.getByRole('spinbutton', { name: '要素の高さ' })).toHaveValue('8');
  const before = await line.boundingBox();
  if (!before) throw new Error('直線が表示されていません');
  await page.getByRole('button', { name: '縦横比をロック' }).click();
  await page.locator('.color-field input[type="color"]').fill('#123456');
  const after = await line.boundingBox();
  if (!after) throw new Error('変更後の直線が表示されていません');
  for (const key of ['x', 'y', 'width', 'height'] as const) expect(after[key]).toBeCloseTo(before[key], 1);
});

test('消しゴムは描いた線だけを消し、一操作のUndoと作業データ再開で復元できる', async ({ page }, info) => {
  await openFixture(page);
  await page.getByRole('button', { name: 'チェック', exact: true }).click();
  await page.getByTestId('pdf-surface').click({ position: { x: 300, y: 400 } });
  await page.getByRole('button', { name: 'ペン', exact: true }).click();
  await dragOnPage(page, [80, 120], [220, 170]);
  await page.getByRole('button', { name: '蛍光ペン', exact: true }).click();
  await dragOnPage(page, [80, 320], [220, 320]);
  await expect(page.locator('.annotation')).toHaveCount(3);
  await page.getByRole('button', { name: '消しゴム', exact: true }).click();
  await dragOnPage(page, [140, 140], [170, 150]);
  await expect(page.locator('.annotation')).toHaveCount(2);
  await page.getByRole('button', { name: '元に戻す', exact: true }).click();
  await expect(page.locator('.annotation')).toHaveCount(3);
  const surface = page.getByTestId('pdf-surface');
  const box = await surface.boundingBox();
  if (!box) throw new Error('PDFが表示されていません');
  const scale = await surface.evaluate(element => parseFloat((element as HTMLElement).style.width) / 500);
  await page.getByRole('button', { name: '消しゴム', exact: true }).click();
  await page.mouse.click(box.x + 300 * scale, box.y + 400 * scale);
  await expect(page.locator('.annotation')).toHaveCount(3);
  await dragOnPage(page, [150, 280], [150, 360], false, 1);
  await expect(page.locator('.annotation')).toHaveCount(2);
  const saved = await project(page, info, 'ink-after-erase.lumapdf');
  expect(saved.data.annotations.map(item => item.type)).toEqual(['check', 'pen']);
  await page.reload();
  await page.getByTestId('project-input').setInputFiles(saved.path);
  await expect(page.locator('.annotation')).toHaveCount(2);
  await expect(page.getByRole('button', { name: '消しゴム', exact: true })).toBeEnabled();
  const pen = page.getByRole('button', { name: /^ペン:/ });
  await pen.click();
  const width = page.getByRole('spinbutton', { name: '要素の幅', exact: true });
  const beforeWidth = Number(await width.inputValue());
  await width.fill(String(Math.round(beforeWidth + 25)));
  await width.press('Enter');
  expect(Number(await width.inputValue())).toBeGreaterThan(beforeWidth + 20);
  const beforeMove = await pen.boundingBox();
  if (!beforeMove) throw new Error('選択したペンの線が表示されていません');
  await page.mouse.move(beforeMove.x + beforeMove.width / 2, beforeMove.y + beforeMove.height / 2);
  await page.mouse.down();
  await page.mouse.move(beforeMove.x + beforeMove.width / 2 + 24, beforeMove.y + beforeMove.height / 2 + 16, { steps: 6 });
  await page.mouse.up();
  await expect.poll(async () => (await pen.boundingBox())?.x ?? 0).toBeGreaterThan(beforeMove.x + 15);
});

test('回転したページでShift直線を描き、位置と回転を保存PDFに残す', async ({ page }, info) => {
  await openFixture(page);
  await page.getByRole('button', { name: 'ページを右に回転', exact: true }).click();
  await page.getByRole('button', { name: 'ペン', exact: true }).click();
  const surface = page.getByTestId('pdf-surface');
  const box = await surface.boundingBox();
  if (!box) throw new Error('回転したPDFが表示されていません');
  const scale = await surface.evaluate(element => parseFloat((element as HTMLElement).style.width) / 500);
  const screen = (x: number, y: number) => ({ x: box.x + (700 - y) * scale, y: box.y + x * scale });
  const start = screen(100, 200), end = screen(250, 200);
  await page.keyboard.down('Shift');
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 8 });
  await page.mouse.up();
  await page.keyboard.up('Shift');
  await expect(page.locator('.annotation')).toHaveCount(1);
  const saved = await project(page, info, 'rotated-ink.lumapdf');
  expect(saved.data.pages[0].rotation).toBe(90);
  expect(saved.data.annotations[0].points).toHaveLength(2);
  await page.getByRole('button', { name: '消しゴム', exact: true }).click();
  const midpoint = screen(175, 200);
  await page.mouse.click(midpoint.x, midpoint.y);
  await expect(page.locator('.annotation')).toHaveCount(0);
  await page.getByRole('button', { name: '元に戻す', exact: true }).click();
  await expect(page.locator('.annotation')).toHaveCount(1);
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'PDFを保存', exact: true }).click();
  const path = info.outputPath('rotated-ink.pdf');
  await (await download).saveAs(path);
  const output = await PDFDocument.load(await readFile(path));
  expect(output.getPage(0).getRotation().angle).toBe(90);
  await page.getByTestId('pdf-input').setInputFiles(path);
  await expect(page.locator('.annotation')).toHaveCount(0);
  await expect.poll(() => page.locator('.pdf-canvas').evaluate(canvas => (canvas as HTMLCanvasElement).width > (canvas as HTMLCanvasElement).height)).toBe(true);
  await page.screenshot({ path: info.outputPath('rotated-ink.png'), fullPage: true });
});

test('描画中のEscと二本指ピンチでは手書き線を確定しない', async ({ page }) => {
  await openFixture(page);
  await page.getByRole('button', { name: 'ペン', exact: true }).click();
  const surface = page.getByTestId('pdf-surface');
  const box = await surface.boundingBox();
  if (!box) throw new Error('PDFが表示されていません');
  await page.mouse.move(box.x + 80, box.y + 100);
  await page.mouse.down();
  await page.mouse.move(box.x + 190, box.y + 160, { steps: 5 });
  await page.keyboard.press('Escape');
  await page.mouse.up();
  await expect(page.locator('.annotation')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'ペン', exact: true })).toHaveClass(/active/);
  const session = await page.context().newCDPSession(page);
  try {
    await session.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 2 });
    const x = box.x + 100, y = box.y + 200;
    await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y, id: 1 }] });
    await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y, id: 1 }, { x: x + 80, y: y + 50, id: 2 }] });
    await session.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x - 25, y: y - 15, id: 1 }, { x: x + 105, y: y + 65, id: 2 }] });
    await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [{ x: x - 25, y: y - 15, id: 1 }] });
    await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await expect(page.locator('.annotation')).toHaveCount(0);
  } finally {
    await session.send('Emulation.setTouchEmulationEnabled', { enabled: false });
    await session.detach();
  }
});

test('一本指のタッチで描画・消去でき、背景パンに奪われない', async ({ page }) => {
  await openFixture(page);
  await page.getByRole('button', { name: 'ペン', exact: true }).click();
  const box = await page.getByTestId('pdf-surface').boundingBox();
  if (!box) throw new Error('PDFが表示されていません');
  const session = await page.context().newCDPSession(page);
  try {
    await session.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 2 });
    await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: box.x + 100, y: box.y + 200, id: 1 }] });
    await session.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: box.x + 200, y: box.y + 250, id: 1 }] });
    await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await expect(page.getByRole('button', { name: /^ペン:/ })).toBeVisible();
    await page.getByRole('button', { name: '消しゴム', exact: true }).click();
    await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: box.x + 150, y: box.y + 170, id: 2 }] });
    await session.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: box.x + 150, y: box.y + 280, id: 2 }] });
    await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await expect(page.locator('.annotation')).toHaveCount(0);
  } finally {
    await session.send('Emulation.setTouchEmulationEnabled', { enabled: false });
    await session.detach();
  }
});
