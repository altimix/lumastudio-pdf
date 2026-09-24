import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from '@playwright/test';

const site = process.env.SITE_URL || 'http://127.0.0.1:8792/';
const origin = new URL(site).origin;
await mkdir('test-results/website', { recursive: true });
const browser = await chromium.launch({ headless: true });
const errors = [];
try {
  const desktop = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  desktop.on('pageerror', error => errors.push(error.message));
  desktop.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  desktop.on('request', request => {
    if (new URL(request.url()).origin !== origin) errors.push(`Unexpected page resource: ${request.url()}`);
  });
  const response = await desktop.goto(site, { waitUntil: 'networkidle' });
  assert.equal(response?.status(), 200);
  assert.match((await response.headers())['cache-control'] || '', /(?:^|,)\s*no-transform(?:,|$)/i);
  assert.match(await desktop.title(), /PDFに文字入力・印鑑を押せるソフト.*LumaStudio PDF/);
  assert.match(await desktop.locator('meta[name="description"]').getAttribute('content') || '', /安藤昇が開発/);
  assert.equal(await desktop.locator('html').getAttribute('lang'), 'ja');
  assert.equal(await desktop.locator('meta[name="google-site-verification"]').getAttribute('content'), '7noRTdsmiBhhESZf4oVrmTV3F7gpK23qy8waA1azMKY');
  assert.equal(await desktop.locator('meta[name="robots"][content*="noindex"]').count(), 0);
  assert.equal(await desktop.getByRole('heading', { level: 1 }).count(), 1);
  assert.match(await desktop.getByRole('heading', { level: 1 }).innerText(), /届いたPDFを、\s*返せる書類に/);
  assert.match(await desktop.locator('.window-topline').innerText(), /v1\.0\.5/);
  assert.match(await desktop.locator('#workspace-caption').innerText(), /v1\.0\.5/);
  assert.doesNotMatch(await desktop.locator('#workspace-caption').innerText(), /最新版と一部異なります/);
  assert.equal(await desktop.locator('link[rel="canonical"]').getAttribute('href'), 'https://lumastudiopdf.altimix.jp/');
  assert.equal(await desktop.locator('a.guide-home-link').getAttribute('href'), '/guide/');
  const structured = JSON.parse(await desktop.locator('script[type="application/ld+json"]').textContent() || '{}');
  assert.equal(structured['@type'], 'SoftwareApplication');
  assert.equal(structured.author?.name, '安藤昇');
  assert.equal(structured.softwareVersion, '1.0.5');
  assert.equal(structured.publisher?.name, '株式会社Altimix');
  assert.equal(await desktop.locator('.contact-actions a').first().getAttribute('href'), 'https://altimix.co.jp/contact/');
  assert.equal(await desktop.locator('.contact-actions a').last().getAttribute('href'), 'https://github.com/altimix/lumastudio-pdf/issues');
  assert.match(await desktop.locator('.feature-list').innerText(), /蛍光ペンは端を角（初期値）・丸から選べます/);
  assert.match(await desktop.locator('.feature-list').innerText(), /文字ボックスは縦横比のロックが初期オフ/);
  assert.match(await desktop.locator('.feature-list').innerText(), /長方形、楕円・円、三角形、線、二重線はドラッグした大きさで配置/);
  assert.match(await desktop.locator('.feature-list').innerText(), /日本語メニュー/);
  assert.match(await desktop.locator('.feature-list').innerText(), /クリックした位置を中心に配置/);
  assert.match(await desktop.locator('.faq-list').innerText(), /最大化した画面を元に戻す/);
  await desktop.getByText('使い方や最新版はどこで確認できますか？', { exact: true }).click();
  assert.match(await desktop.locator('.faq-list').innerText(), /ショートカット一覧/);
  assert.equal(await desktop.locator('.site-footer a[href="/privacy/"]').count(), 1);
  assert.equal(await desktop.locator('img:not([alt])').count(), 0);
  for (const selector of ['.workspace-frame img', '.developer-photo img']) {
    const image = desktop.locator(selector);
    await image.scrollIntoViewIfNeeded();
    assert.equal(await image.evaluate(async element => { await element.decode(); return element.naturalWidth > 100; }), true, `${selector} did not load`);
  }
  const release = 'https://github.com/altimix/lumastudio-pdf/releases/download/v1.0.5/';
  const downloads = {
    'windows-portable': 'LumaStudio-PDF-1.0.5-windows-x64-portable.exe',
    'mac-arm64': 'LumaStudio-PDF-1.0.5-macos-arm64.zip',
    'mac-x64': 'LumaStudio-PDF-1.0.5-macos-x64.zip',
    'mac-guide': 'README-Mac.txt',
    checksums: 'SHA256SUMS.txt',
    license: 'LICENSE.txt',
  };
  for (const [name, filename] of Object.entries(downloads)) {
    const href = await desktop.locator(`[data-download="${name}"]`).getAttribute('href');
    assert.equal(href, release + filename, `Incorrect ${name} download`);
  }
  await desktop.screenshot({ path: 'test-results/website/desktop.png', fullPage: true });

  const mobile = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  mobile.on('pageerror', error => errors.push(error.message));
  await mobile.goto(site, { waitUntil: 'networkidle' });
  assert.equal(await mobile.locator('body').evaluate(body => body.scrollWidth <= window.innerWidth + 1), true, 'Mobile page overflows horizontally');
  assert.equal(await mobile.locator('.desktop-nav').isVisible(), false);
  await mobile.locator('.mobile-nav summary').click();
  assert.equal(await mobile.locator('.mobile-nav nav a').count(), 6);
  await mobile.locator('.mobile-nav nav a[href="#download"]').click();
  assert.equal(new URL(mobile.url()).hash, '#download');
  assert.equal(await mobile.getByRole('heading', { name: /あなたのPCで/ }).isVisible(), true);
  await mobile.locator('.faq-list summary').first().click();
  assert.equal(await mobile.locator('.faq-list details').first().evaluate(item => item.open), true);
  await mobile.screenshot({ path: 'test-results/website/mobile.png', fullPage: true });

  const guide = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  guide.on('pageerror', error => errors.push(error.message));
  const guideResponse = await guide.goto(new URL('/guide/', origin).href, { waitUntil: 'networkidle' });
  assert.equal(guideResponse?.status(), 200);
  assert.match((await guideResponse.headers())['cache-control'] || '', /(?:^|,)\s*no-transform(?:,|$)/i);
  assert.match(await guide.title(), /PDFに文字を記入して印鑑を押す方法/);
  assert.equal(await guide.locator('link[rel="canonical"]').getAttribute('href'), 'https://lumastudiopdf.altimix.jp/guide/');
  assert.equal(await guide.getByRole('heading', { level: 1 }).count(), 1);
  assert.ok((await guide.getByRole('heading', { level: 2 }).count()) >= 6);
  assert.equal(await guide.locator('meta[name="robots"][content*="noindex"]').count(), 0);
  assert.match(await guide.locator('main').innerText(), /印鑑の中心/);
  assert.match(await guide.locator('main').innerText(), /図形と蛍光ペンを使う/);
  assert.match(await guide.locator('main').innerText(), /角（初期値）または丸/);
  assert.match(await guide.locator('main').innerText(), /縦横比のロックが初期オフ/);
  assert.equal(await guide.locator('a[href="/#download"]').count() > 0, true);
  await guide.screenshot({ path: 'test-results/website/guide-desktop.png', fullPage: true });
  const guideMobile = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  guideMobile.on('pageerror', error => errors.push(error.message));
  await guideMobile.goto(new URL('/guide/', origin).href, { waitUntil: 'networkidle' });
  assert.equal(await guideMobile.locator('body').evaluate(body => body.scrollWidth <= window.innerWidth + 1), true, 'Guide page overflows on mobile');
  await guideMobile.screenshot({ path: 'test-results/website/guide-mobile.png', fullPage: true });

  for (const [path, expected] of [
    ['/robots.txt', 200], ['/sitemap.xml', 200], ['/guide/', 200], ['/privacy/', 200], ['/assets/favicon.svg', 200],
    ['/assets/editor-v1.0.5.png', 200], ['/assets/ando2026.png', 200], ['/missing-page', 404],
  ]) {
    const result = await fetch(new URL(path, origin));
    assert.equal(result.status, expected, path);
  }
  const robots = await (await fetch(new URL('/robots.txt', origin))).text();
  assert.match(robots, /Sitemap: https:\/\/lumastudiopdf\.altimix\.jp\/sitemap\.xml/);
  const privacyResponse = await fetch(new URL('/privacy/', origin));
  const privacy = await privacyResponse.text();
  assert.match(privacy, /AIを明示実行した場合/);
  assert.match(privacy, /https:\/\/altimix\.co\.jp\/contact\//);
  assert.match(privacyResponse.headers.get('cache-control') || '', /(?:^|,)\s*no-transform(?:,|$)/i);
  const sitemap = await (await fetch(new URL('/sitemap.xml', origin))).text();
  assert.match(sitemap, /<loc>https:\/\/lumastudiopdf\.altimix\.jp\/<\/loc>/);
  assert.match(sitemap, /<loc>https:\/\/lumastudiopdf\.altimix\.jp\/privacy\/<\/loc>/);
  assert.match(sitemap, /<loc>https:\/\/lumastudiopdf\.altimix\.jp\/guide\/<\/loc>/);
  if (process.env.VERIFY_DOWNLOADS === '1') {
    const hrefs = await desktop.locator('[data-download]').evaluateAll(links => links.map(link => link.href));
    for (const href of hrefs) {
      const head = await fetch(href, { method: 'HEAD', redirect: 'follow' });
      assert.equal(head.status, 200, `Download unavailable: ${href}`);
      const contentLength = head.headers.get('content-length');
      if (contentLength !== null) assert.ok(Number(contentLength) > 0, `Download empty: ${href}`);
    }
  }
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ result: 'passed', site, desktop: true, mobile: true, seo: true, assets: true, downloadsChecked: process.env.VERIFY_DOWNLOADS === '1' }));
} finally {
  await browser.close();
}
