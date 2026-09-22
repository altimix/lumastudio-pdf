import { getDocument, GlobalWorkerOptions } from '../node_modules/pdfjs-dist/build/pdf.mjs';

GlobalWorkerOptions.workerSrc = new URL('../node_modules/pdfjs-dist/build/pdf.worker.mjs', import.meta.url).href;

try {
  const data = await window.lumaPrint.getJob();
  const task = getDocument({
    data: new Uint8Array(data),
    isEvalSupported: false,
    cMapUrl: new URL('../node_modules/pdfjs-dist/cmaps/', import.meta.url).href,
    cMapPacked: true,
    standardFontDataUrl: new URL('../node_modules/pdfjs-dist/standard_fonts/', import.meta.url).href,
    wasmUrl: new URL('../node_modules/pdfjs-dist/wasm/', import.meta.url).href,
  });
  const pdf = await task.promise;
  if (pdf.numPages > 100) throw new Error('MVPの印刷は100ページまでです。PDF保存後に通常のPDFビューアーで印刷してください。');
  const sheets = document.getElementById('pages');
  const pageRules = document.createElement('style');
  document.head.append(pageRules);
  let firstPageSize;
  let totalPixels = 0;
  for (let index = 1; index <= pdf.numPages; index += 1) {
    const page = await pdf.getPage(index);
    const natural = page.getViewport({ scale: 1 });
    const scale = Math.min(150 / 72, 2400 / Math.max(natural.width, natural.height));
    const viewport = page.getViewport({ scale });
    totalPixels += Math.ceil(viewport.width) * Math.ceil(viewport.height);
    if (totalPixels > 160_000_000) throw new Error('印刷用の画像が大きすぎます。PDF保存後に通常のPDFビューアーで印刷してください。');
    const sheet = document.createElement('section');
    sheet.className = 'sheet';
    sheet.style.width = `${natural.width}pt`;
    sheet.style.height = `${natural.height}pt`;
    sheet.style.page = `pdfpage${index}`;
    pageRules.sheet.insertRule(`@page pdfpage${index} { size: ${natural.width}pt ${natural.height}pt; margin: 0; }`);
    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    sheet.append(canvas);
    sheets.append(sheet);
    await page.render({ canvas, canvasContext: canvas.getContext('2d'), viewport }).promise;
    page.cleanup();
    firstPageSize ??= { width: Math.round(natural.width / 72 * 25400), height: Math.round(natural.height / 72 * 25400) };
    document.getElementById('progress').textContent = `${index} / ${pdf.numPages} ページを準備しました`;
  }
  await pdf.loadingTask.destroy();
  await document.fonts.ready;
  // Give Chromium one frame to apply print layout before opening its print UI.
  await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  window.lumaPrint.ready(firstPageSize);
} catch (error) {
  document.getElementById('progress').textContent = error.message || 'PDFの印刷準備に失敗しました。';
  window.lumaPrint.failed(error.message || 'PDFの印刷準備に失敗しました。');
}
