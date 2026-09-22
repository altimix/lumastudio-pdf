import { expect, test, type Locator, type Page, type TestInfo } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { decodePDFRawStream, PDFDict, PDFDocument, PDFHexString, PDFName, PDFNumber, PDFRawStream, PDFString } from 'pdf-lib';

interface SavedAnnotation {
  type: string; text?: string; color?: string; fontSize?: number;
  x: number; y: number; width: number; height: number;
}
interface SavedProject { annotations: SavedAnnotation[]; pages: { rotation: number }[] }

async function openFixture(page: Page, signed = false) {
  const pdf = await PDFDocument.create();
  pdf.addPage([500, 700]).drawText('DIRECT EDIT TEST', { x: 30, y: 660, size: 16 });
  if (signed) {
    const value = pdf.context.register(pdf.context.obj({ Type: 'Sig', Filter: 'Adobe.PPKLite', ByteRange: [0, 100, 200, 30], Contents: PDFHexString.of('010203') }));
    const field = pdf.context.register(pdf.context.obj({ FT: 'Sig', T: PDFString.of('TestSignature'), V: value }));
    pdf.catalog.set(PDFName.of('AcroForm'), pdf.context.obj({ Fields: [field] }));
  }
  await page.goto('/');
  await page.getByTestId('pdf-input').setInputFiles({ name: 'direct-edit.pdf', mimeType: 'application/pdf', buffer: Buffer.from(await pdf.save()) });
  await expect(page.getByTestId('pdf-surface')).toBeVisible();
  await expect.poll(() => page.locator('.pdf-canvas').evaluate(element => (element as HTMLCanvasElement).width)).toBeGreaterThan(100);
}

async function screenPoint(page: Page, x: number, y: number, rotation = 0) {
  const surface = page.getByTestId('pdf-surface');
  const box = await surface.boundingBox();
  if (!box) throw new Error('PDF is not visible');
  const scale = await surface.evaluate(element => parseFloat((element as HTMLElement).style.width) / 500);
  if (rotation === 90) return { x: box.x + (700 - y) * scale, y: box.y + x * scale };
  if (rotation === 180) return { x: box.x + (500 - x) * scale, y: box.y + (700 - y) * scale };
  if (rotation === 270) return { x: box.x + y * scale, y: box.y + (500 - x) * scale };
  return { x: box.x + x * scale, y: box.y + y * scale };
}

async function placeAt(page: Page, x: number, y: number, rotation = 0) {
  const point = await screenPoint(page, x, y, rotation);
  await page.mouse.click(point.x, point.y);
}

async function saveProject(page: Page, testInfo: TestInfo, filename = 'direct-edit.lumapdf') {
  await page.getByRole('button', { name: '作業データ', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '編集の続きを保存・再開', exact: true });
  const event = page.waitForEvent('download');
  await dialog.getByRole('button', { name: '作業データを保存', exact: true }).click();
  const path = testInfo.outputPath(filename);
  await (await event).saveAs(path);
  await expect(dialog).not.toBeVisible();
  return { path, data: JSON.parse(await readFile(path, 'utf8')) as SavedProject };
}

async function dimensions(annotation: Locator) {
  return annotation.evaluate(element => {
    const style = (element as HTMLElement).style;
    return { x: parseFloat(style.left), y: parseFloat(style.top), width: parseFloat(style.width), height: parseFloat(style.height) };
  });
}

async function growSelected(page: Page, annotation: Locator, factor: number, rotation = 0) {
  const before = await dimensions(annotation);
  const handle = annotation.getByTestId('resize-se');
  const box = await handle.boundingBox();
  if (!box) throw new Error('Resize handle is not visible');
  const dx = before.width * (factor - 1), dy = before.height * (factor - 1);
  const movement = rotation === 90 ? { x: -dy, y: dx } : rotation === 180 ? { x: -dx, y: -dy } : rotation === 270 ? { x: dy, y: -dx } : { x: dx, y: dy };
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + movement.x, box.y + box.height / 2 + movement.y, { steps: 8 });
  await page.mouse.up();
  await expect.poll(async () => (await dimensions(annotation)).width).toBeGreaterThan(before.width * 1.15);
  return { before, after: await dimensions(annotation) };
}

test.beforeEach(async ({ context }) => {
  await context.route('**/api/autofill', route => route.abort());
  await context.route('https://api.openai.com/**', route => route.abort());
});

test('用紙に黒い日本語を直接入力し、IME・キャンセル・履歴・PDF保存を扱える', async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await openFixture(page);
  await page.getByRole('button', { name: '文字を記入', exact: true }).click();
  await expect(page.getByLabel('文字色', { exact: true })).toHaveValue('#000000');
  await placeAt(page, 80, 150);
  const input = page.getByRole('textbox', { name: 'PDF上の文字入力', exact: true });
  await expect(input).toBeFocused();
  await input.fill('山田 太郎\n東京都架空市');
  await input.dispatchEvent('compositionstart', { data: '市' });
  await input.dispatchEvent('keydown', { key: 'Escape', code: 'Escape', isComposing: true, bubbles: true });
  await input.dispatchEvent('keydown', { key: 'Enter', code: 'Enter', ctrlKey: true, isComposing: true, bubbles: true });
  await expect(input).toBeVisible();
  await input.dispatchEvent('compositionend', { data: '市' });
  await input.press('ControlOrMeta+Enter');
  await expect(input).not.toBeVisible();
  const initial = page.getByRole('button', { name: '文字: 山田 太郎 東京都架空市', exact: true });
  await expect(initial).toBeVisible();
  await initial.dblclick();
  await input.fill('取り消す入力');
  await input.press('Escape');
  await expect(initial).toBeVisible();
  await initial.dblclick();
  await input.fill('山田 花子\n東京都架空市');
  await input.press('Tab');
  await expect(page.getByRole('button', { name: '文字入力を確定', exact: true })).toBeFocused();
  await page.keyboard.press('Delete');
  await page.keyboard.press('ControlOrMeta+z');
  // Native textarea undo may still apply from its adjacent toolbar. It must
  // never run the document's undo or delete the existing annotation beneath it.
  await expect(input).toBeVisible();
  await expect(page.locator('.annotation')).toHaveCount(1);
  await input.fill('山田 花子\n東京都架空市');
  await page.getByRole('button', { name: '文字入力を確定', exact: true }).click();
  const edited = page.getByRole('button', { name: '文字: 山田 花子 東京都架空市', exact: true });
  await expect(edited).toBeVisible();
  await page.getByRole('button', { name: '元に戻す', exact: true }).click();
  await expect(initial).toBeVisible();
  await page.getByRole('button', { name: 'やり直す', exact: true }).click();
  await expect(edited).toBeVisible();
  const saved = await saveProject(page, testInfo);
  expect(saved.data.annotations).toHaveLength(1);
  expect(saved.data.annotations[0]).toMatchObject({ text: '山田 花子\n東京都架空市', color: '#000000' });
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'PDFを保存', exact: true }).click();
  const path = testInfo.outputPath('direct-black-text.pdf');
  await (await download).saveAs(path);
  expect((await PDFDocument.load(await readFile(path))).getPageCount()).toBe(1);
  await page.getByTestId('pdf-input').setInputFiles(path);
  await expect(page.locator('.annotation')).toHaveCount(0);
  // The added text is black in the saved PDF itself, below the fixture's title.
  await expect.poll(() => page.locator('.pdf-canvas').evaluate(element => {
    const canvas = element as HTMLCanvasElement;
    const data = canvas.getContext('2d')!.getImageData(0, Math.round(canvas.height * 0.2), canvas.width, Math.round(canvas.height * 0.2)).data;
    let black = 0;
    // Small Japanese glyphs are antialiased after PDF rasterization. Neutral
    // gray coverage is expected from black ink; the saved model above is RGB 0.
    for (let index = 0; index < data.length; index += 4) if (data[index] < 190 && Math.abs(data[index] - data[index + 1]) < 2 && Math.abs(data[index] - data[index + 2]) < 2 && data[index + 3] === 255) black++;
    return black;
  })).toBeGreaterThan(80);
  await page.screenshot({ path: testInfo.outputPath('direct-black-text-reopened.png'), fullPage: true });
  expect(errors).toEqual([]);
});

test('入力途中の保存でも文字を落とさず、新しい空欄の取消は履歴を増やさない', async ({ page }, testInfo) => {
  await openFixture(page);
  await page.getByRole('button', { name: '文字を記入', exact: true }).click();
  await placeAt(page, 70, 120);
  const input = page.getByRole('textbox', { name: 'PDF上の文字入力', exact: true });
  await input.press('Escape');
  await expect(page.locator('.annotation')).toHaveCount(0);
  await expect(page.getByRole('button', { name: '元に戻す', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: '文字を記入', exact: true }).click();
  await placeAt(page, 70, 120);
  await input.fill('保存時に確定する文字');
  const downloaded = page.waitForEvent('download');
  await input.press('ControlOrMeta+s');
  const path = testInfo.outputPath('pending-text.pdf');
  await (await downloaded).saveAs(path);
  await expect(input).not.toBeVisible();
  await expect(page.getByRole('button', { name: '文字: 保存時に確定する文字', exact: true })).toBeVisible();
  const saved = await saveProject(page, testInfo);
  expect(saved.data.annotations[0]).toMatchObject({ text: '保存時に確定する文字', color: '#000000' });
  await page.getByTestId('pdf-input').setInputFiles(path);
  await expect(page.locator('.annotation')).toHaveCount(0);
  await expect.poll(() => page.locator('.pdf-canvas').evaluate(element => {
    const canvas = element as HTMLCanvasElement;
    const data = canvas.getContext('2d')!.getImageData(0, Math.round(canvas.height * 0.16), canvas.width, Math.round(canvas.height * 0.15)).data;
    let ink = 0;
    for (let index = 0; index < data.length; index += 4) if (data[index] < 190 && data[index + 3] > 200) ink++;
    return ink;
  })).toBeGreaterThan(100);
});

test('既存文字を空にして確定・保存すると削除され、Undoで戻り、Escapeなら元の文字を保つ', async ({ page }, testInfo) => {
  await openFixture(page);
  await page.getByRole('button', { name: '文字を記入', exact: true }).click();
  await placeAt(page, 70, 120);
  const input = page.getByRole('textbox', { name: 'PDF上の文字入力', exact: true });
  // Completing a brand new empty draft is not an edit.
  await page.getByRole('button', { name: '文字入力を確定', exact: true }).click();
  await expect(input).not.toBeVisible();
  await expect(page.locator('.annotation')).toHaveCount(0);
  await expect(page.getByRole('button', { name: '元に戻す', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: '文字を記入', exact: true }).click();
  await placeAt(page, 70, 120);
  await input.fill('消去と取消を区別する');
  await input.press('ControlOrMeta+Enter');
  const annotation = page.getByRole('button', { name: '文字: 消去と取消を区別する', exact: true });
  await annotation.dblclick();
  await input.fill('');
  await input.press('Escape');
  await expect(annotation).toBeVisible();
  await annotation.dblclick();
  await input.fill('');
  await page.getByRole('button', { name: '文字入力を確定', exact: true }).click();
  await expect(page.locator('.annotation')).toHaveCount(0);
  await page.getByRole('button', { name: '元に戻す', exact: true }).click();
  await expect(annotation).toBeVisible();
  await annotation.dblclick();
  await input.fill('');
  const downloaded = page.waitForEvent('download');
  await input.press('ControlOrMeta+s');
  const path = testInfo.outputPath('cleared-text.pdf');
  await (await downloaded).saveAs(path);
  await expect(input).not.toBeVisible();
  await expect(page.locator('.annotation')).toHaveCount(0);
  const saved = await PDFDocument.load(await readFile(path));
  expect(saved.getPage(0).node.Resources()?.lookupMaybe(PDFName.of('XObject'), PDFDict)?.entries() ?? []).toHaveLength(0);
  await page.getByRole('button', { name: '元に戻す', exact: true }).click();
  await expect(annotation).toBeVisible();
});

test('長い日本語を半分に縮小しても末尾の文字を欠かさずPDFに保存できる', async ({ page }, testInfo) => {
  await openFixture(page);
  await page.getByRole('button', { name: '文字を記入', exact: true }).click();
  await placeAt(page, 70, 150);
  const text = 'あ'.repeat(18);
  const input = page.getByRole('textbox', { name: 'PDF上の文字入力', exact: true });
  await input.fill(text);
  await input.press('ControlOrMeta+Enter');
  const annotation = page.getByRole('button', { name: `文字: ${text}`, exact: true });
  const before = await dimensions(annotation);
  expect(before.width / 0.85).toBeCloseTo(240, 1);
  const handle = (await annotation.getByTestId('resize-se').boundingBox())!;
  await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
  await page.mouse.down();
  await page.mouse.move(handle.x + handle.width / 2 - before.width / 2, handle.y + handle.height / 2 - before.height / 2, { steps: 8 });
  await page.mouse.up();
  await expect.poll(async () => (await dimensions(annotation)).width).toBeLessThan(before.width * 0.6);
  const project = await saveProject(page, testInfo);
  const resized = project.data.annotations[0];
  expect(resized.text).toBe(text);
  expect(resized.fontSize).toBeLessThan(7);
  const advance = await page.evaluate(size => {
    const context = document.createElement('canvas').getContext('2d')!;
    context.font = `400 ${size}px "Yu Gothic", "Hiragino Kaku Gothic ProN", "Meiryo", sans-serif`;
    return context.measureText('あ').width;
  }, resized.fontSize!);
  // The complete first line must fit between the fixed left/right padding.
  expect(advance * 18).toBeLessThanOrEqual(resized.width - 4 + 0.1);
  const downloaded = page.waitForEvent('download');
  await page.getByRole('button', { name: 'PDFを保存', exact: true }).click();
  const path = testInfo.outputPath('small-japanese-complete.pdf');
  await (await downloaded).saveAs(path);
  const saved = await PDFDocument.load(await readFile(path));
  const images = saved.getPage(0).node.Resources()!.lookup(PDFName.of('XObject'), PDFDict);
  const raster = saved.context.lookup(images.entries()[0][1], PDFRawStream);
  const mask = raster.dict.lookup(PDFName.of('SMask'), PDFRawStream);
  const width = mask.dict.lookup(PDFName.of('Width'), PDFNumber).asNumber();
  const height = mask.dict.lookup(PDFName.of('Height'), PDFNumber).asNumber();
  const alpha = decodePDFRawStream(mask).decode();
  expect(alpha.length).toBe(width * height);
  const scaleX = width / resized.width, scaleY = height / resized.height;
  const left = Math.ceil((2 + advance * 17) * scaleX);
  const right = Math.min(width, Math.floor((2 + advance * 18) * scaleX));
  const top = Math.floor(2 * scaleY), bottom = Math.min(height, Math.ceil((2 + resized.fontSize!) * scaleY));
  let lastGlyphInk = 0;
  for (let y = top; y < bottom; y++) for (let x = left; x < right; x++) if (alpha[y * width + x] > 20) lastGlyphInk++;
  // Inspect the actual embedded alpha mask, at the final glyph's first-line
  // position. The old resize wrapped this glyph below the clipped image.
  expect(lastGlyphInk).toBeGreaterThan(10);
  await page.screenshot({ path: testInfo.outputPath('small-japanese-complete.png'), fullPage: true });
});

test('文字を角から拡大して一度で元に戻せ、矢印キーで微調整した状態を再開できる', async ({ page }, testInfo) => {
  await openFixture(page);
  await page.getByRole('button', { name: '文字を記入', exact: true }).click();
  await page.getByLabel('記入する文字', { exact: true }).fill('大きさを変更');
  await placeAt(page, 50, 160);
  const annotation = page.getByRole('button', { name: '文字: 大きさを変更', exact: true });
  const resized = await growSelected(page, annotation, 1.4);
  const fontSize = Number(await page.getByLabel('文字サイズ', { exact: true }).inputValue());
  expect(fontSize).toBeGreaterThan(13);
  await page.getByRole('button', { name: '元に戻す', exact: true }).click();
  await expect.poll(async () => (await dimensions(annotation)).width).toBeCloseTo(resized.before.width, 1);
  await annotation.click();
  await expect(page.getByLabel('文字サイズ', { exact: true })).toHaveValue('13');
  await page.getByRole('button', { name: 'やり直す', exact: true }).click();
  await expect.poll(async () => (await dimensions(annotation)).width).toBeCloseTo(resized.after.width, 1);
  await annotation.click();
  await annotation.focus();
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Shift+ArrowDown');
  await expect.poll(async () => (await dimensions(annotation)).x).toBeCloseTo(resized.before.x + 0.85, 1);
  await expect.poll(async () => (await dimensions(annotation)).y).toBeCloseTo(resized.before.y + 8.5, 1);
  const saved = await saveProject(page, testInfo);
  expect(saved.data.annotations[0].fontSize).toBeCloseTo(fontSize, 2);
  expect(saved.data.annotations[0].x).toBeCloseTo(51, 1);
  expect(saved.data.annotations[0].y).toBeCloseTo(170, 1);
  await page.reload();
  await page.getByTestId('project-input').setInputFiles(saved.path);
  await expect(annotation).toBeVisible();
  await annotation.click();
  expect(Number(await page.getByLabel('文字サイズ', { exact: true }).inputValue())).toBeCloseTo(fontSize, 2);
  await annotation.press('Enter');
  await expect(page.getByRole('textbox', { name: 'PDF上の文字入力', exact: true })).toHaveValue('大きさを変更');
  await page.screenshot({ path: testInfo.outputPath('resized-text-inline.png'), fullPage: true });
});

test('文字入力中に複数PDFをドロップしても、結合の取消・実行・元に戻すで入力が残る', async ({ page }, testInfo) => {
  await openFixture(page);
  await page.getByRole('button', { name: '文字を記入', exact: true }).click();
  await placeAt(page, 70, 150);
  const input = page.getByRole('textbox', { name: 'PDF上の文字入力', exact: true });
  await input.fill('ドロップ時の文字\n消してはいけない');
  const extra = await PDFDocument.create();
  extra.addPage([400, 600]).drawText('EXTRA PAGE', { x: 30, y: 550, size: 14 });
  const bytes = Array.from(await extra.save());
  const dropFiles = async () => {
    const transfer = await page.evaluateHandle(data => {
      const result = new DataTransfer();
      for (const name of ['extra-a.pdf', 'extra-b.pdf']) result.items.add(new File([new Uint8Array(data)], name, { type: 'application/pdf' }));
      return result;
    }, bytes);
    await page.locator('.app-shell').dispatchEvent('drop', { dataTransfer: transfer });
    await transfer.dispose();
  };
  await expect(input).toBeFocused();
  await dropFiles();
  const dialog = page.getByRole('dialog', { name: 'PDFを結合', exact: true });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'キャンセル', exact: true }).click();
  const initial = page.getByRole('button', { name: '文字: ドロップ時の文字 消してはいけない', exact: true });
  await expect(initial).toBeVisible();
  await initial.dblclick();
  await input.fill('結合しても残る文字\n変更後の内容');
  await dropFiles();
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'この順序で結合', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await expect(page.locator('.thumbnail-button')).toHaveCount(3);
  await page.getByRole('button', { name: '元に戻す', exact: true }).click();
  await expect(page.locator('.thumbnail-button')).toHaveCount(1);
  await expect(page.getByRole('button', { name: '文字: 結合しても残る文字 変更後の内容', exact: true })).toBeVisible();
  const saved = await saveProject(page, testInfo);
  expect(saved.data.annotations).toHaveLength(1);
  expect(saved.data.annotations[0].text).toBe('結合しても残る文字\n変更後の内容');
});

test('印鑑と画像は縦横比を保って拡大でき、回転した用紙でも保存した寸法が一致する', async ({ page }, testInfo) => {
  await openFixture(page);
  await page.getByRole('button', { name: '印鑑', exact: true }).click();
  await page.getByLabel('印鑑に入れる名前', { exact: true }).fill('山田');
  await placeAt(page, 90, 190);
  const stamp = page.getByRole('button', { name: '印鑑: 山田', exact: true });
  const stampSize = await growSelected(page, stamp, 1.6);
  expect(stampSize.after.width / stampSize.after.height).toBeCloseTo(1, 3);
  await page.getByRole('button', { name: '選択・移動', exact: true }).click();
  await page.getByRole('button', { name: 'ページを右に回転', exact: true }).click();
  const png = await page.evaluate(() => {
    const canvas = document.createElement('canvas'); canvas.width = 120; canvas.height = 60;
    const context = canvas.getContext('2d')!; context.fillStyle = '#1f66cc'; context.fillRect(0, 0, 120, 60);
    return canvas.toDataURL('image/png');
  });
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: '画像', exact: true }).click();
  await (await chooser).setFiles({ name: 'wide-test-image.png', mimeType: 'image/png', buffer: Buffer.from(png.split(',')[1], 'base64') });
  await placeAt(page, 80, 340, 90);
  const image = page.locator('.annotation').filter({ has: page.locator('img') }).last();
  await expect(page.locator('.annotation')).toHaveCount(2);
  const imageSize = await growSelected(page, image, 1.4, 90);
  expect(imageSize.after.width / imageSize.after.height).toBeCloseTo(2, 3);
  const saved = await saveProject(page, testInfo);
  expect(saved.data.pages[0].rotation).toBe(90);
  expect(saved.data.annotations[0].width / saved.data.annotations[0].height).toBeCloseTo(1, 3);
  expect(saved.data.annotations[1].width / saved.data.annotations[1].height).toBeCloseTo(2, 3);
  expect(saved.data.annotations[1].width * 0.85).toBeCloseTo(imageSize.after.width, 1);
  const event = page.waitForEvent('download');
  await page.getByRole('button', { name: 'PDFを保存', exact: true }).click();
  const path = testInfo.outputPath('resized-rotated-materials.pdf');
  await (await event).saveAs(path);
  expect((await PDFDocument.load(await readFile(path))).getPage(0).getRotation().angle).toBe(90);
  await page.screenshot({ path: testInfo.outputPath('resized-rotated-materials.png'), fullPage: true });
  await page.getByTestId('pdf-input').setInputFiles(path);
  await expect(page.locator('.annotation')).toHaveCount(0);
  const blueBounds = () => page.locator('.pdf-canvas').evaluate(element => {
    const canvas = element as HTMLCanvasElement;
    const pixels = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data;
    let left = canvas.width, top = canvas.height, right = -1, bottom = -1, count = 0;
    for (let y = 0; y < canvas.height; y++) for (let x = 0; x < canvas.width; x++) {
      const index = (y * canvas.width + x) * 4;
      if (pixels[index + 2] > 150 && pixels[index + 2] > pixels[index] * 3 && pixels[index + 2] > pixels[index + 1] * 1.5) {
        left = Math.min(left, x); right = Math.max(right, x); top = Math.min(top, y); bottom = Math.max(bottom, y); count++;
      }
    }
    return { left, top, width: right - left + 1, height: bottom - top + 1, count, scale: canvas.width / 700 };
  });
  await expect.poll(async () => (await blueBounds()).count).toBeGreaterThan(100);
  const pixels = await blueBounds(), savedImage = saved.data.annotations[1];
  expect(Math.abs(pixels.left - (700 - savedImage.y - savedImage.height) * pixels.scale)).toBeLessThan(3);
  expect(Math.abs(pixels.top - savedImage.x * pixels.scale)).toBeLessThan(3);
  expect(Math.abs(pixels.width - savedImage.height * pixels.scale)).toBeLessThan(3);
  expect(Math.abs(pixels.height - savedImage.width * pixels.scale)).toBeLessThan(3);
});

test('PDF内のピンチ相当ホイールは位置を保って20〜400%でズームし、全体表示と手のひら移動を使える', async ({ page }) => {
  await openFixture(page);
  const workspace = page.locator('.workspace');
  const zoom = page.locator('.zoom-controls').getByText(/^\d+%$/u);
  const bounds = await workspace.boundingBox();
  if (!bounds) throw new Error('Workspace missing');
  const anchor = { x: bounds.x + bounds.width * 0.55, y: bounds.y + bounds.height * 0.4 };
  await workspace.dispatchEvent('wheel', { deltaY: -500, ctrlKey: true, clientX: anchor.x, clientY: anchor.y, bubbles: true, cancelable: true });
  await expect.poll(async () => Number((await zoom.textContent())!.replace('%', ''))).toBeGreaterThan(150);
  await workspace.evaluate(element => { element.scrollLeft = 90; element.scrollTop = 120; });
  const before = await page.getByTestId('pdf-surface').boundingBox();
  if (!before) throw new Error('PDF missing');
  const fraction = { x: (anchor.x - before.x) / before.width, y: (anchor.y - before.y) / before.height };
  await workspace.dispatchEvent('wheel', { deltaY: -70, ctrlKey: true, clientX: anchor.x, clientY: anchor.y, bubbles: true, cancelable: true });
  await expect.poll(async () => (await page.getByTestId('pdf-surface').boundingBox())!.width).toBeGreaterThan(before.width);
  const after = (await page.getByTestId('pdf-surface').boundingBox())!;
  expect(Math.abs(after.x + fraction.x * after.width - anchor.x)).toBeLessThan(3);
  expect(Math.abs(after.y + fraction.y * after.height - anchor.y)).toBeLessThan(3);
  await workspace.dispatchEvent('wheel', { deltaY: -10000, ctrlKey: true, clientX: anchor.x, clientY: anchor.y, bubbles: true, cancelable: true });
  await expect(zoom).toHaveText('400%');
  await page.getByRole('button', { name: '手のひら・スクロール', exact: true }).click();
  await workspace.evaluate(element => { element.scrollLeft = 150; element.scrollTop = 150; });
  await page.mouse.move(anchor.x, anchor.y);
  await page.mouse.down();
  await page.mouse.move(anchor.x - 60, anchor.y - 55, { steps: 5 });
  await page.mouse.up();
  expect(await workspace.evaluate(element => element.scrollLeft)).toBeGreaterThan(195);
  expect(await workspace.evaluate(element => element.scrollTop)).toBeGreaterThan(190);
  await workspace.dispatchEvent('wheel', { deltaY: 10000, ctrlKey: true, clientX: anchor.x, clientY: anchor.y, bubbles: true, cancelable: true });
  await expect(zoom).toHaveText('20%');
  await page.getByRole('button', { name: 'ページ全体に合わせる', exact: true }).click();
  const fitted = (await page.getByTestId('pdf-surface').boundingBox())!;
  expect(fitted.width).toBeLessThan(bounds.width);
  expect(fitted.height).toBeLessThan(bounds.height);
  await expect(page.locator('.annotation')).toHaveCount(0);
});

test('二本指操作では文字を誤配置せず、既存素材の位置や閲覧専用PDFを変更しない', async ({ page }, testInfo) => {
  await openFixture(page);
  const session = await page.context().newCDPSession(page);
  await session.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 2 });
  const pinch = async (x: number, y: number) => {
    await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y, id: 1 }] });
    await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y, id: 1 }, { x: x + 80, y: y + 50, id: 2 }] });
    await session.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x - 25, y: y - 15, id: 1 }, { x: x + 105, y: y + 65, id: 2 }] });
    await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [{ x: x - 25, y: y - 15, id: 1 }] });
    await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  };
  await page.getByRole('button', { name: '文字を記入', exact: true }).click();
  const first = await screenPoint(page, 110, 230);
  await pinch(first.x, first.y);
  await expect(page.getByRole('textbox', { name: 'PDF上の文字入力', exact: true })).toHaveCount(0);
  await expect(page.locator('.annotation')).toHaveCount(0);
  await expect.poll(async () => Number((await page.locator('.zoom-controls').getByText(/^\d+%$/u).textContent())!.replace('%', ''))).toBeGreaterThan(85);
  await page.getByRole('button', { name: 'ページ全体に合わせる', exact: true }).click();
  await page.getByLabel('記入する文字', { exact: true }).fill('位置を保つ');
  await placeAt(page, 70, 180);
  const annotation = page.getByRole('button', { name: '文字: 位置を保つ', exact: true });
  const box = (await annotation.boundingBox())!;
  await pinch(box.x + 10, box.y + 10);
  const saved = await saveProject(page, testInfo);
  expect(saved.data.annotations).toHaveLength(1);
  expect(saved.data.annotations[0].text).toBe('位置を保つ');
  expect(saved.data.annotations[0].x).toBeCloseTo(70, 1);
  expect(saved.data.annotations[0].y).toBeCloseTo(180, 1);
  await session.send('Emulation.setTouchEmulationEnabled', { enabled: false });
  await openFixture(page, true);
  await expect(page.getByRole('button', { name: '文字を記入', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: '手のひら・スクロール', exact: true })).toBeEnabled();
  await expect(page.getByRole('button', { name: 'PDFを保存', exact: true })).toBeDisabled();
  await page.getByTestId('pdf-surface').dblclick({ position: { x: 90, y: 140 } });
  const signedWidth = (await page.getByTestId('pdf-surface').boundingBox())!.width;
  await page.locator('.workspace').dispatchEvent('wheel', { deltaY: -100, ctrlKey: true, clientX: 700, clientY: 400, bubbles: true, cancelable: true });
  await expect.poll(async () => (await page.getByTestId('pdf-surface').boundingBox())!.width).toBeGreaterThan(signedWidth);
  await expect(page.getByRole('textbox', { name: 'PDF上の文字入力', exact: true })).toHaveCount(0);
  await expect(page.locator('.annotation')).toHaveCount(0);
  await session.detach();
});
