import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { PDFDocument, PDFDict, PDFName } from 'pdf-lib';

async function open(page: Page) {
  const pdf = await PDFDocument.create();
  pdf.addPage([500, 700]);
  await page.goto('/');
  await page.getByTestId('pdf-input').setInputFiles({ name: 'typography.pdf', mimeType: 'application/pdf', buffer: Buffer.from(await pdf.save()) });
  await expect(page.getByTestId('pdf-surface')).toBeVisible({ timeout: 30_000 });
}

async function project(page: Page, info: TestInfo, name: string) {
  await page.getByRole('button', { name: '作業データ', exact: true }).click();
  const event = page.waitForEvent('download');
  await page.getByRole('button', { name: '作業データを保存', exact: true }).click();
  const path = info.outputPath(name);
  await (await event).saveAs(path);
  return { path, data: JSON.parse(await readFile(path, 'utf8')) };
}

test('同梱Googleフォントの標準・装飾を選んで再開し、PDFにも書き出せる', async ({ page }, info) => {
  const externalFonts: string[] = [];
  page.on('request', request => { if (/fonts\.(?:googleapis|gstatic)\.com/.test(request.url())) externalFonts.push(request.url()); });
  await open(page);
  await page.getByRole('button', { name: '文字を記入', exact: true }).click();
  await expect(page.getByLabel('フォント', { exact: true })).toHaveValue('noto-sans-jp');
  await expect(page.getByRole('spinbutton', { name: '文字サイズ', exact: true })).toHaveValue('11');
  await page.getByLabel('記入する文字', { exact: true }).fill('日本語の書体と太字');
  await page.getByLabel('フォント', { exact: true }).selectOption('noto-serif-jp');
  await page.getByRole('button', { name: '太字', exact: true }).click();
  await page.getByRole('button', { name: '斜体', exact: true }).click();
  await page.getByRole('button', { name: '下線', exact: true }).click();
  await page.getByTestId('pdf-surface').click({ position: { x: 70, y: 140 } });
  const annotation = page.getByRole('button', { name: '文字: 日本語の書体と太字', exact: true });
  await expect(annotation.locator('img')).toHaveAttribute('src', /^data:image\/png/);
  const fontSubsets = await page.evaluate(() => {
    let total = 0, loaded = 0;
    document.fonts.forEach(face => {
      if (face.family.replace(/^["']|["']$/g, '') !== 'Noto Serif JP Variable') return;
      total++;
      if (face.status === 'loaded') loaded++;
    });
    return { total, loaded };
  });
  expect(fontSubsets.total).toBeGreaterThan(50);
  expect(fontSubsets.loaded).toBeGreaterThan(0);
  expect(fontSubsets.loaded).toBeLessThan(fontSubsets.total / 2);
  const saved = await project(page, info, 'styled-text.lumapdf');
  expect(saved.data.annotations[0]).toMatchObject({ fontFamily: 'noto-serif-jp', fontWeight: 700, fontStyle: 'italic', underline: true, fontSize: 11, color: '#000000' });
  await page.reload();
  await page.getByTestId('project-input').setInputFiles(saved.path);
  await expect(annotation).toBeVisible();
  await annotation.click();
  await expect(page.getByLabel('フォント', { exact: true })).toHaveValue('noto-serif-jp');
  await expect(page.getByRole('button', { name: '太字', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await annotation.dblclick();
  const input = page.getByRole('textbox', { name: 'PDF上の文字入力', exact: true });
  await expect(input).toHaveCSS('font-weight', '700');
  await expect(input).toHaveCSS('font-style', 'italic');
  await expect(input).toHaveCSS('text-decoration-line', 'underline');
  await expect(input).toHaveCSS('font-family', /Noto Serif JP Variable/);
  await input.fill('明朝体の再編集');
  await input.press('ControlOrMeta+Enter');
  await page.getByLabel('フォント', { exact: true }).selectOption('biz-udgothic');
  await expect(page.getByLabel('フォント', { exact: true })).toHaveValue('biz-udgothic');
  await expect(page.locator('.busy-indicator')).toHaveCount(0);
  const changed = await project(page, info, 'changed-font.lumapdf');
  expect(changed.data.annotations[0]).toMatchObject({ text: '明朝体の再編集', fontFamily: 'biz-udgothic', fontWeight: 700, underline: true });
  const event = page.waitForEvent('download');
  await page.getByRole('button', { name: 'PDFを保存', exact: true }).click();
  const pdfPath = info.outputPath('styled-text.pdf');
  await (await event).saveAs(pdfPath);
  const output = await PDFDocument.load(await readFile(pdfPath));
  expect(output.getPage(0).node.Resources()?.lookup(PDFName.of('XObject'), PDFDict).entries()).toHaveLength(1);
  await page.screenshot({ path: info.outputPath('typography-controls.png'), fullPage: true });
  expect(externalFonts).toEqual([]);
});

test('新しい字形の読み込み前に文字を確定しても保存データの高さを実フォントで測る', async ({ page }, info) => {
  await open(page);
  await page.getByRole('button', { name: '文字を記入', exact: true }).click();
  await page.getByTestId('pdf-surface').click({ position: { x: 70, y: 130 } });
  const input = page.getByRole('textbox', { name: 'PDF上の文字入力', exact: true });
  await expect(input).toBeEnabled();
  let releaseFonts!: () => void;
  const gate = new Promise<void>(resolve => { releaseFonts = resolve; });
  let blocked = 0;
  await page.route(/\.woff2?(?:\?|$)/, async route => {
    blocked++;
    await gate;
    await route.continue();
  });
  const text = '請求書'.repeat(24);
  try {
    await input.fill(text);
    await expect.poll(() => blocked).toBeGreaterThan(0);
    await input.press('ControlOrMeta+Enter');
    const placedText = page.getByRole('button', { name: `文字: ${text}`, exact: true });
    await expect(placedText).toBeVisible();
    const beforeWidth = await placedText.evaluate(element => parseFloat((element as HTMLElement).style.width));
    const handle = await placedText.getByTestId('resize-se').boundingBox();
    if (!handle) throw new Error('文字のサイズ変更ハンドルが見つかりません');
    await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
    await page.mouse.down();
    await page.mouse.move(handle.x + handle.width / 2 + 35, handle.y + handle.height / 2 + 20, { steps: 6 });
    await page.mouse.up();
    await expect.poll(() => placedText.evaluate(element => parseFloat((element as HTMLElement).style.width))).toBeGreaterThan(beforeWidth);
    await page.getByRole('button', { name: 'チェック', exact: true }).click();
    await page.getByTestId('pdf-surface').click({ position: { x: 250, y: 250 } });
    await expect(page.locator('.annotation')).toHaveCount(2);
    await page.getByRole('button', { name: '作業データ', exact: true }).click();
    const event = page.waitForEvent('download');
    await page.getByRole('button', { name: '作業データを保存', exact: true }).click();
    await expect(page.locator('.busy-indicator')).toBeVisible();
    releaseFonts();
    const path = info.outputPath('fast-commit.lumapdf');
    await (await event).saveAs(path);
    const saved = JSON.parse(await readFile(path, 'utf8'));
    const annotation = saved.annotations.find((item: { type: string }) => item.type === 'text');
    const measured = await page.evaluate(async (value) => {
      const { measureTextHeight } = await import('/src/lib/fonts.ts');
      return measureTextHeight(value);
    }, annotation);
    expect(annotation.height).toBeGreaterThanOrEqual(measured - 0.01);
    await page.getByRole('button', { name: '元に戻す', exact: true }).click();
    await expect(page.locator('.annotation')).toHaveCount(1);
    const scale = await page.getByTestId('pdf-surface').evaluate(element => parseFloat((element as HTMLElement).style.width) / 500);
    const visibleHeight = await page.getByRole('button', { name: `文字: ${text}`, exact: true }).evaluate(element => parseFloat((element as HTMLElement).style.height));
    expect(visibleHeight / scale).toBeCloseTo(annotation.height, 1);
  } finally {
    releaseFonts();
  }
});

test('同梱書体にない絵文字だけの文字欄も表示してPDFと作業データへ保存できる', async ({ page }, info) => {
  await open(page);
  await page.getByRole('button', { name: '文字を記入', exact: true }).click();
  await page.getByLabel('記入する文字', { exact: true }).fill('😀😀');
  await page.getByTestId('pdf-surface').click({ position: { x: 90, y: 160 } });
  await expect(page.getByRole('button', { name: '文字: 😀😀', exact: true }).locator('img')).toHaveAttribute('src', /^data:image\/png/);
  const saved = await project(page, info, 'emoji-fallback.lumapdf');
  expect(saved.data.annotations[0]).toMatchObject({ text: '😀😀', fontFamily: 'noto-sans-jp' });
  const event = page.waitForEvent('download');
  await page.getByRole('button', { name: 'PDFを保存', exact: true }).click();
  const path = info.outputPath('emoji-fallback.pdf');
  await (await event).saveAs(path);
  expect((await PDFDocument.load(await readFile(path))).getPageCount()).toBe(1);
});

test('印鑑35四方とチェック15四方で配置し、旧作業データは従来書体で開く', async ({ page }, info) => {
  await open(page);
  await page.getByRole('button', { name: '印鑑', exact: true }).click();
  await expect(page.getByRole('spinbutton', { name: '印鑑の大きさ', exact: true })).toHaveValue('35');
  await page.getByLabel('印鑑に入れる名前', { exact: true }).fill('山田');
  await page.getByTestId('pdf-surface').click({ position: { x: 80, y: 100 } });
  await expect(page.getByRole('spinbutton', { name: '要素の幅', exact: true })).toHaveValue('35');
  await expect(page.getByRole('spinbutton', { name: '要素の高さ', exact: true })).toHaveValue('35');
  await page.getByRole('button', { name: 'チェック', exact: true }).click();
  await page.getByTestId('pdf-surface').click({ position: { x: 150, y: 200 } });
  await expect(page.getByRole('spinbutton', { name: '要素の幅', exact: true })).toHaveValue('15');
  await expect(page.getByRole('spinbutton', { name: '要素の高さ', exact: true })).toHaveValue('15');
  await page.getByRole('button', { name: '文字を記入', exact: true }).click();
  await page.getByLabel('記入する文字', { exact: true }).fill('従来の文字');
  await page.getByTestId('pdf-surface').click({ position: { x: 70, y: 300 } });
  const saved = await project(page, info, 'sizes-and-legacy.lumapdf');
  expect(saved.data.annotations[0]).toMatchObject({ type: 'stamp', width: 35, height: 35 });
  expect(saved.data.annotations[1]).toMatchObject({ type: 'check', width: 15, height: 15 });
  const legacy = saved.data.annotations[2];
  saved.data.version = 1;
  delete legacy.fontFamily; delete legacy.fontWeight; delete legacy.fontStyle; delete legacy.underline;
  await page.reload();
  await page.getByTestId('project-input').setInputFiles({ name: 'legacy.lumapdf', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(saved.data)) });
  await page.getByRole('button', { name: '文字: 従来の文字', exact: true }).click();
  await expect(page.getByLabel('フォント', { exact: true })).toHaveValue('legacy');
});

test('チェックをクリック中心に置き、縦横比ロックを切り替えて文字の縦位置も中央に置く', async ({ page }, info) => {
  await open(page);
  const surface = page.getByTestId('pdf-surface');
  const scale = await surface.evaluate(element => parseFloat((element as HTMLElement).style.width) / 500);
  await page.getByRole('button', { name: 'チェック', exact: true }).click();
  await surface.click({ position: { x: 150 * scale, y: 200 * scale } });
  const lock = page.getByRole('button', { name: '縦横比をロック', exact: true });
  await expect(lock).toHaveAttribute('aria-pressed', 'true');
  const width = page.getByRole('spinbutton', { name: '要素の幅', exact: true });
  const height = page.getByRole('spinbutton', { name: '要素の高さ', exact: true });
  await width.fill('30'); await width.press('Enter');
  await expect(height).toHaveValue('30');
  await lock.click();
  await expect(lock).toHaveAttribute('aria-pressed', 'false');
  await width.fill('50'); await width.press('Enter');
  await expect(height).toHaveValue('30');
  await height.fill('40'); await height.press('Enter');
  await expect(width).toHaveValue('50');
  await page.getByRole('button', { name: '文字を記入', exact: true }).click();
  await surface.click({ position: { x: 80 * scale, y: 300 * scale } });
  const input = page.getByRole('textbox', { name: 'PDF上の文字入力', exact: true });
  await input.fill('中央配置');
  await input.press('ControlOrMeta+Enter');
  const saved = await project(page, info, 'centered-materials.lumapdf');
  expect(saved.data.annotations[0]).toMatchObject({ type: 'check', width: 50, height: 40, aspectLocked: false });
  expect(saved.data.annotations[0].x).toBeCloseTo(142.5, 1);
  expect(saved.data.annotations[0].y).toBeCloseTo(192.5, 1);
  const text = saved.data.annotations[1];
  expect(text.type).toBe('text');
  expect(text.x).toBeCloseTo(80, 1);
  expect(text.y + text.height / 2).toBeCloseTo(300, 1);
});

test('名前の印鑑と画像印鑑をクリック中心に置き、用紙端でははみ出さない', async ({ page }, info) => {
  await open(page);
  const surface = page.getByTestId('pdf-surface');
  const scale = await surface.evaluate(element => parseFloat((element as HTMLElement).style.width) / 500);
  await page.getByRole('button', { name: '印鑑', exact: true }).click();
  await page.getByLabel('印鑑に入れる名前', { exact: true }).fill('山田');
  await surface.click({ position: { x: 150 * scale, y: 200 * scale } });

  const imageData = await page.evaluate(() => {
    const canvas = document.createElement('canvas'); canvas.width = 120; canvas.height = 80;
    const context = canvas.getContext('2d')!;
    context.strokeStyle = '#bd3030'; context.lineWidth = 6;
    context.strokeRect(10, 10, 100, 60);
    return canvas.toDataURL('image/png');
  });
  await page.getByRole('button', { name: '印鑑', exact: true }).click();
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: '画像から印鑑を登録', exact: true }).click();
  await (await chooser).setFiles({ name: 'image-seal.png', mimeType: 'image/png', buffer: Buffer.from(imageData.split(',')[1], 'base64') });
  const dialog = page.getByRole('dialog', { name: '印鑑画像を登録' });
  await dialog.getByRole('textbox', { name: '印鑑名', exact: true }).fill('画像印');
  await dialog.getByRole('button', { name: 'この印鑑を登録', exact: true }).click();
  await surface.click({ position: { x: 260 * scale, y: 320 * scale } });
  await page.getByRole('button', { name: '印鑑', exact: true }).click();
  await surface.click({ position: { x: 10 * scale, y: 10 * scale } });

  const saved = await project(page, info, 'centered-stamps.lumapdf');
  expect(saved.data.annotations).toHaveLength(3);
  const [named, image, edge] = saved.data.annotations;
  expect(named.type).toBe('stamp');
  expect(named.x + named.width / 2).toBeCloseTo(150, 1);
  expect(named.y + named.height / 2).toBeCloseTo(200, 1);
  expect(image).toMatchObject({ type: 'image', stampSource: true });
  expect(image.x + image.width / 2).toBeCloseTo(260, 1);
  expect(image.y + image.height / 2).toBeCloseTo(320, 1);
  expect(edge.x).toBe(0);
  expect(edge.y).toBe(0);
});

test('印鑑サイズを変更すると次の配置と再読み込み後にも同じ大きさを使う', async ({ page }) => {
  await open(page);
  await page.getByRole('button', { name: '印鑑', exact: true }).click();
  const size = page.getByRole('spinbutton', { name: '印鑑の大きさ', exact: true });
  await expect(size).toHaveValue('35');
  await size.fill('48');
  await size.press('Enter');
  await page.getByLabel('印鑑に入れる名前', { exact: true }).fill('山田');
  await page.getByTestId('pdf-surface').click({ position: { x: 70, y: 130 } });
  const width = page.getByRole('spinbutton', { name: '要素の幅', exact: true });
  await expect(width).toHaveValue('48');
  await width.fill('62');
  await width.press('Enter');
  await expect(width).toHaveValue('62');
  await page.getByRole('button', { name: '印鑑', exact: true }).click();
  await expect(size).toHaveValue('62');
  await page.reload();
  await page.getByRole('button', { name: 'サンプルの書類で試す', exact: true }).click();
  await expect(page.getByTestId('pdf-surface')).toBeVisible({ timeout: 30_000 });
  await page.getByRole('button', { name: '印鑑', exact: true }).click();
  await expect(page.getByRole('spinbutton', { name: '印鑑の大きさ', exact: true })).toHaveValue('62');
  await page.getByLabel('印鑑に入れる名前', { exact: true }).fill('次の印');
  await page.getByTestId('pdf-surface').click({ position: { x: 90, y: 240 } });
  await expect(page.getByRole('spinbutton', { name: '要素の幅', exact: true })).toHaveValue('62');
});

test('ページより大きい丸印も縦横比を保って用紙に収める', async ({ page }) => {
  await open(page);
  await page.getByRole('button', { name: '印鑑', exact: true }).click();
  const size = page.getByRole('spinbutton', { name: '印鑑の大きさ', exact: true });
  await size.fill('1000');
  await size.press('Enter');
  await page.getByLabel('印鑑に入れる名前', { exact: true }).fill('山田');
  await page.getByTestId('pdf-surface').click({ position: { x: 60, y: 100 } });
  await expect(page.getByRole('spinbutton', { name: '要素の幅', exact: true })).toHaveValue('500');
  await expect(page.getByRole('spinbutton', { name: '要素の高さ', exact: true })).toHaveValue('500');
  await page.getByRole('button', { name: '印鑑', exact: true }).click();
  await expect(size).toHaveValue('1000');
});

test('フォント読込が遅れても作業データ画面から入力欄へフォーカスを奪わない', async ({ page }) => {
  let releaseFonts!: () => void;
  const gate = new Promise<void>(resolve => { releaseFonts = resolve; });
  await page.route(/\.woff2?(?:\?|$)/, async route => { await gate; await route.continue(); });
  const pdf = await PDFDocument.create(); pdf.addPage([500, 700]);
  const source = {
    app: 'LumaStudio PDF', version: 2, filename: 'font-load.pdf', original: Buffer.from(await pdf.save()).toString('base64'),
    pages: [{ id:'p', sourceIndex:0, width:500, height:700, rotation:0, viewportTransform:[1,0,0,-1,0,700] }],
    annotations: [{ id:'a', pageId:'p', type:'text', x:70, y:140, width:180, height:30, text:'読込中の文字', fontFamily:'noto-sans-jp', fontSize:11 }],
  };
  await page.goto('/');
  await page.getByTestId('project-input').setInputFiles({ name:'font-load.lumapdf', mimeType:'application/json', buffer:Buffer.from(JSON.stringify(source)) });
  await page.getByRole('button', { name:'文字: 読込中の文字', exact:true }).dblclick();
  const input = page.getByRole('textbox', { name:'PDF上の文字入力', exact:true });
  await expect(input).toBeDisabled();
  await page.getByRole('button', { name:'作業データ', exact:true }).click();
  const dialog = page.getByRole('dialog', { name:'編集の続きを保存・再開', exact:true });
  await dialog.getByRole('button', { name:'作業データ画面を閉じる', exact:true }).focus();
  releaseFonts();
  await expect(input).toBeEditable();
  expect(await dialog.evaluate(element => element.contains(document.activeElement))).toBe(true);
  await dialog.getByRole('button', { name:'作業データ画面を閉じる', exact:true }).click();
  await input.fill('読み込み後も編集できる');
  await input.press('ControlOrMeta+Enter');
  await expect(page.getByRole('button', { name:'文字: 読み込み後も編集できる', exact:true })).toBeVisible();
});
