import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from '@playwright/test';

const site = process.env.SITE_URL || 'http://127.0.0.1:8792/';
const origin = new URL(site).origin;
await mkdir('test-results/website', { recursive: true });
const browser = await chromium.launch({ headless: true });
const errors = [];
try {
  const desktop = await browser.newPage({ reducedMotion: 'reduce', viewport: { width: 1280, height: 800 } });
  desktop.on('pageerror', error => errors.push(error.message));
  desktop.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  desktop.on('request', request => {
    if (new URL(request.url()).origin !== origin) errors.push(`Unexpected page resource: ${request.url()}`);
  });
  const response = await desktop.goto(site, { waitUntil: 'networkidle' });
  assert.equal(response?.status(), 200);
  assert.match((await response.headers())['cache-control'] || '', /(?:^|,)\s*no-transform(?:,|$)/i);
  assert.match(await desktop.title(), /学校で気軽に使えるPDF追記ソフト.*LumaStudio PDF/);
  assert.match(await desktop.locator('meta[name="description"]').getAttribute('content') || '', /安藤昇が開発/);
  assert.equal(await desktop.locator('html').getAttribute('lang'), 'ja');
  assert.equal(await desktop.locator('meta[name="google-site-verification"]').getAttribute('content'), '7noRTdsmiBhhESZf4oVrmTV3F7gpK23qy8waA1azMKY');
  assert.equal(await desktop.locator('meta[name="robots"][content*="noindex"]').count(), 0);
  assert.equal(await desktop.getByRole('heading', { level: 1 }).count(), 1);
  assert.match(await desktop.getByRole('heading', { level: 1 }).innerText(), /いつものPDFに、\s*ひとこと書き足す/);
  assert.match(await desktop.locator('.window-topline').innerText(), /v1\.0\.9/);
  assert.match(await desktop.locator('#workspace-caption').innerText(), /v1\.0\.9/);
  assert.match(await desktop.locator('#workspace-caption').innerText(), /実アプリ.*架空の校外学習プリント/);
  assert.equal(await desktop.locator('link[rel="canonical"]').getAttribute('href'), 'https://lumastudiopdf.altimix.jp/');
  assert.equal(await desktop.locator('a.guide-home-link').getAttribute('href'), '/guide/');
  const structured = JSON.parse(await desktop.locator('script[type="application/ld+json"]').textContent() || '{}');
  assert.equal(structured['@type'], 'SoftwareApplication');
  assert.equal(structured.author?.name, '安藤昇');
  assert.equal(structured.softwareVersion, '1.0.9');
  assert.equal(structured.publisher?.name, '株式会社Altimix');
  assert.equal(await desktop.locator('.contact-actions a').first().getAttribute('href'), 'https://altimix.co.jp/contact/');
  assert.equal(await desktop.locator('.contact-actions a').last().getAttribute('href'), 'https://github.com/altimix/lumastudio-pdf/issues');
  const features = await desktop.locator('.feature-list').innerText();
  for (const feature of ['文字を書き足す', 'チェックや丸を付ける', '手書きと蛍光ペン', '必要なページをまとめる', '画像や印鑑を重ねる', '保存した続きから']) assert.ok(features.includes(feature));
  assert.match(features, /横書きと縦書き/);
  assert.match(await desktop.locator('.faq-list').textContent(), /縦書き.*縦中横/s);
  assert.match(await desktop.locator('.faq-list').textContent(), /署名付きPDFとは別に.*編集用原稿を保存.*閲覧専用/s);
  assert.match(await desktop.locator('.download-section').innerText(), /追記の重なり表示と、電子署名後の編集用原稿の保存を改善/);
  assert.equal(await desktop.locator('[data-release-notes]').getAttribute('href'), 'https://github.com/altimix/lumastudio-pdf/releases/tag/v1.0.9');
  assert.match(await desktop.locator('.hero-description').innerText(), /学校.*PDF追記ソフト/s);
  assert.match(await desktop.locator('.faq-list').textContent(), /学校や教育委員会のソフト利用・データ管理/);
  assert.match(await desktop.locator('.faq-list').textContent(), /元のページに文字や印などを書き足す/);
  assert.match(await desktop.locator('.safety-points').innerText(), /OpenAIへ送信/);
  assert.match(await desktop.locator('.faq-list').innerText(), /最大化した画面を元に戻す/);
  await desktop.getByText('使い方や最新版はどこで確認できますか？', { exact: true }).click();
  assert.match(await desktop.locator('.faq-list').innerText(), /ショートカット一覧/);
  assert.equal(await desktop.locator('.site-footer a[href="/privacy/"]').count(), 1);
  assert.equal(await desktop.locator('img:not([alt])').count(), 0);
  assert.match(await desktop.locator('.workspace-frame img').getAttribute('alt') || '', /架空の校外学習プリント/);
  for (const selector of ['.workspace-frame img', '.developer-photo img']) {
    const image = desktop.locator(selector);
    await image.scrollIntoViewIfNeeded();
    assert.equal(await image.evaluate(async element => { await element.decode(); return element.naturalWidth > 100; }), true, `${selector} did not load`);
  }
  const release = 'https://github.com/altimix/lumastudio-pdf/releases/download/v1.0.9/';
  const downloads = {
    'windows-portable': 'LumaStudio-PDF-1.0.9-windows-x64-portable.exe',
    'mac-arm64': 'LumaStudio-PDF-1.0.9-macos-arm64.zip',
    'mac-x64': 'LumaStudio-PDF-1.0.9-macos-x64.zip',
    'mac-guide': 'README-Mac.txt',
    checksums: 'SHA256SUMS.txt',
    license: 'LICENSE.txt',
  };
  for (const [name, filename] of Object.entries(downloads)) {
    const href = await desktop.locator(`[data-download="${name}"]`).getAttribute('href');
    assert.equal(href, release + filename, `Incorrect ${name} download`);
  }
  await desktop.screenshot({ path: 'test-results/website/desktop.png', fullPage: true });
  await desktop.locator('.hero').screenshot({ path: 'test-results/website/hero-desktop.png' });

  const mobile = await browser.newPage({ reducedMotion: 'reduce', viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  mobile.on('pageerror', error => errors.push(error.message));
  await mobile.goto(site, { waitUntil: 'networkidle' });
  assert.equal(await mobile.locator('body').evaluate(body => body.scrollWidth <= window.innerWidth + 1), true, 'Mobile page overflows horizontally');
  assert.equal(await mobile.locator('.desktop-nav').isVisible(), false);
  await mobile.locator('.mobile-nav summary').click();
  assert.equal(await mobile.locator('.mobile-nav nav a').count(), 6);
  await mobile.locator('.mobile-nav nav a[href="#download"]').click();
  assert.equal(new URL(mobile.url()).hash, '#download');
  assert.equal(await mobile.getByRole('heading', { name: /まずは一枚/ }).isVisible(), true);
  await mobile.locator('.faq-list summary').first().click();
  assert.equal(await mobile.locator('.faq-list details').first().evaluate(item => item.open), true);
  await mobile.locator('.mobile-nav summary').click();
  await mobile.screenshot({ path: 'test-results/website/mobile.png', fullPage: true });
  await mobile.locator('.hero').screenshot({ path: 'test-results/website/hero-mobile.png' });
  await mobile.locator('.download-section').scrollIntoViewIfNeeded();
  await mobile.screenshot({ path: 'test-results/website/download-mobile.png' });
  await mobile.setViewportSize({ width: 320, height: 740 });
  assert.equal(await mobile.locator('body').evaluate(body => body.scrollWidth <= window.innerWidth + 1), true, 'Small mobile page overflows horizontally');

  const guide = await browser.newPage({ reducedMotion: 'reduce', viewport: { width: 1280, height: 800 } });
  guide.on('pageerror', error => errors.push(error.message));
  const guideResponse = await guide.goto(new URL('/guide/', origin).href, { waitUntil: 'networkidle' });
  assert.equal(guideResponse?.status(), 200);
  assert.match((await guideResponse.headers())['cache-control'] || '', /(?:^|,)\s*no-transform(?:,|$)/i);
  assert.match(await guide.title(), /プリントや書類のPDFに追記する方法/);
  assert.equal(await guide.locator('link[rel="canonical"]').getAttribute('href'), 'https://lumastudiopdf.altimix.jp/guide/');
  assert.equal(await guide.getByRole('heading', { level: 1 }).count(), 1);
  assert.ok((await guide.getByRole('heading', { level: 2 }).count()) >= 6);
  assert.equal(await guide.locator('meta[name="robots"][content*="noindex"]').count(), 0);
  assert.match(await guide.locator('main').innerText(), /文字の向き.*縦書き/s);
  assert.match(await guide.locator('main').innerText(), /形式4/);
  assert.match(await guide.locator('main').innerText(), /印鑑の中心/);
  assert.match(await guide.locator('main').innerText(), /チェック・図形・蛍光ペンを使う/);
  assert.match(await guide.locator('main').innerText(), /角（初期値）または丸/);
  assert.match(await guide.locator('main').innerText(), /縦横比のロックが初期オフ/);
  assert.match(await guide.locator('main').innerText(), /緑の線が示す位置に/);
  assert.match(await guide.locator('main').innerText(), /電子署名を使う場合の原稿保存.*未署名PDFまたは作業データ.*編集用原稿を保存/s);
  assert.match(await guide.locator('.guide-shot img').getAttribute('alt') || '', /架空の校外学習プリント/);
  assert.equal(await guide.locator('a[href="/#download"]').count() > 0, true);
  await guide.screenshot({ path: 'test-results/website/guide-desktop.png', fullPage: true });
  const guideMobile = await browser.newPage({ reducedMotion: 'reduce', viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  guideMobile.on('pageerror', error => errors.push(error.message));
  await guideMobile.goto(new URL('/guide/', origin).href, { waitUntil: 'networkidle' });
  assert.equal(await guideMobile.locator('body').evaluate(body => body.scrollWidth <= window.innerWidth + 1), true, 'Guide page overflows on mobile');
  await guideMobile.screenshot({ path: 'test-results/website/guide-mobile.png', fullPage: true });

  for (const [path, expected] of [
    ['/robots.txt', 200], ['/sitemap.xml', 200], ['/guide/', 200], ['/privacy/', 200], ['/assets/favicon.svg', 200],
    ['/assets/editor-school-v1.0.9.png', 200], ['/assets/ando2026.png', 200], ['/missing-page', 404],
  ]) {
    const result = await fetch(new URL(path, origin));
    assert.equal(result.status, expected, path);
  }
  const robots = await (await fetch(new URL('/robots.txt', origin))).text();
  assert.match(robots, /Sitemap: https:\/\/lumastudiopdf\.altimix\.jp\/sitemap\.xml/);
  const privacyResponse = await fetch(new URL('/privacy/', origin));
  const privacy = await privacyResponse.text();
  assert.match(privacy, /AIを明示実行した場合/);
  assert.match(privacy, /editable-pdfs/);
  assert.match(privacy, /学校の共有端末で使う場合/);
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
