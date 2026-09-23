import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { assetManifest, expectedAssets, verifyVersion } from './release-check.mjs';

test('tag must exactly match the package version', () => {
  assert.equal(verifyVersion('0.1.0', 'v0.1.0'), '0.1.0');
  assert.equal(verifyVersion('0.2.0-beta.1', 'v0.2.0-beta.1'), '0.2.0-beta.1');
  for (const tag of ['0.1.0', 'v0.1.1', '../0.1.0', undefined]) {
    assert.throws(() => verifyVersion('0.1.0', tag));
  }
  assert.throws(() => verifyVersion('../x', 'v../x'));
});

test('requires portable releases and detects changed downloaded packages', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'luma-release-'));
  try {
    await assert.rejects(assetManifest(directory, '0.1.0', 'windows'));
    for (const filename of expectedAssets('0.1.0', 'windows')) {
      await writeFile(path.join(directory, filename), `test-only Windows asset ${filename}`);
    }
    const windows = await assetManifest(directory, '0.1.0', 'windows');
    await writeFile(path.join(directory, 'SHA256SUMS-windows.txt'), windows);
    const macDirectory = await mkdtemp(path.join(directory, 'mac-'));
    for (const filename of expectedAssets('0.1.0', 'macos')) {
      await writeFile(path.join(macDirectory, filename), filename === 'LICENSE.txt' ? await readFile('LICENSE') : `test-only Mac asset ${filename}`);
    }
    const macos = await assetManifest(macDirectory, '0.1.0', 'macos');
    await writeFile(path.join(macDirectory, 'LICENSE.txt'), 'not the GPL text');
    await assert.rejects(assetManifest(macDirectory, '0.1.0', 'macos'), /GPLライセンス本文/);
    await writeFile(path.join(directory, 'SHA256SUMS-macos.txt'), macos);
    for (const filename of expectedAssets('0.1.0', 'macos')) {
      await writeFile(path.join(directory, filename), filename === 'LICENSE.txt' ? await readFile('LICENSE') : `test-only Mac asset ${filename}`);
    }
    const combined = await assetManifest(directory, '0.1.0', 'all');
    assert.equal(combined.trim().split('\n').length, 5);
    assert.match(combined, /^[a-f0-9]{64}  LICENSE\.txt$/m);
    assert.match(combined, /^[a-f0-9]{64}  README-Mac\.txt$/m);
    assert.match(combined, /^[a-f0-9]{64}  LumaStudio-PDF-/m);
    await writeFile(path.join(directory, expectedAssets('0.1.0', 'windows')[0]), 'changed');
    await assert.rejects(assetManifest(directory, '0.1.0', 'all'), /チェックサム/);
    await writeFile(path.join(directory, 'unexpected.exe'), 'not part of release');
    await assert.rejects(assetManifest(directory, '0.1.0', 'all'), /予期しない/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
