const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { setTimeout: delay } = require('node:timers/promises');
const { validatePdfBytes, watchPrintInbox } = require('./pdf-files.cjs');

const pdfA = Buffer.from('%PDF-1.7\nexample A\n%%EOF\n');
const pdfB = Buffer.from('%PDF-1.7\nexample B\n%%EOF\n');

async function waitFor(predicate) {
  const deadline = Date.now() + 2500;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await delay(20);
  }
  assert.fail('Timed out waiting for inbox delivery');
}

test('rejects non-PDF and invalid IPC byte values', () => {
  assert.throws(() => validatePdfBytes(Buffer.from('not a pdf')));
  assert.throws(() => validatePdfBytes([37, 80, 68, 70, 45, -1]));
  assert.throws(() => validatePdfBytes('a PDF path is not accepted'));
  assert.deepEqual(validatePdfBytes(Array.from(pdfA)), pdfA);
});

test('inbox waits for completed bytes, deduplicates and ignores its own saved output', async () => {
  const inbox = await fs.mkdtemp(path.join(os.tmpdir(), 'luma-inbox-test-'));
  const deliveries = [];
  const watcher = watchPrintInbox(inbox, (pdf) => deliveries.push(pdf), { intervalMs: 20, stableMs: 50 });
  try {
    const incoming = path.join(inbox, 'incoming.pdf');
    await fs.writeFile(incoming, '%PDF-1.7\npartial data');
    await delay(160);
    assert.equal(deliveries.length, 0, 'unfinished print job must not open');
    await fs.writeFile(incoming, pdfA);
    await waitFor(() => deliveries.length === 1);
    assert.equal(deliveries[0].name, 'incoming.pdf');
    assert.deepEqual(Buffer.from(deliveries[0].data), pdfA);
    await fs.writeFile(incoming, pdfA);
    await delay(160);
    assert.equal(deliveries.length, 1, 'same content rewrite must not reopen');
    await fs.writeFile(incoming, pdfB);
    await waitFor(() => deliveries.length === 2);
    const saved = path.join(inbox, 'edited.pdf');
    await fs.writeFile(saved, pdfA);
    await watcher.markSaved(saved, pdfA);
    await delay(160);
    assert.equal(deliveries.length, 2, 'own export into inbox must not loop');
    assert.deepEqual(await fs.readFile(incoming), pdfB, 'inbox never deletes or moves source files');
  } finally {
    watcher.stop();
    await delay(30);
    await fs.rm(inbox, { recursive: true });
  }
});
