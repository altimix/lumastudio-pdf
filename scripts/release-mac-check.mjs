// Verify the actual ZIPs delivered to users, using copies created only for this check.
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { appendFile, copyFile, mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

assert.equal(process.platform, 'darwin', 'Mac archive verification requires macOS.');
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { version } = JSON.parse(await readFile(path.join(repo, 'package.json'), 'utf8'));
const scratch = path.join(repo, 'tmp');
await mkdir(scratch, { recursive: true });
const expectedGuide = await readFile(path.join(repo, 'README-Mac.txt'), 'utf8');
const results = [];
for (const arch of ['x64', 'arm64']) {
  const archive = path.join(repo, 'release', `LumaStudio-PDF-${version}-macos-${arch}.zip`);
  const temporary = await mkdtemp(path.join(scratch, `mac-archive-${arch}-`));
  assert.equal(path.dirname(temporary), scratch);
  try {
    execFileSync('/usr/bin/ditto', ['-x', '-k', archive, temporary], { stdio: 'inherit' });
    const bundle = path.join(temporary, 'LumaStudio PDF.app');
    assert.equal(await readFile(path.join(temporary, 'README-Mac.txt'), 'utf8'), expectedGuide);
    assert.equal(await readFile(path.join(bundle, 'Contents', 'Resources', 'README-Mac.txt'), 'utf8'), expectedGuide);
    assert.ok((await stat(path.join(bundle, 'Contents', '_CodeSignature', 'CodeResources'))).size > 0);
    const verifyArgs = ['--verify', '--deep', '--strict', bundle];
    execFileSync('/usr/bin/codesign', verifyArgs, { stdio: 'inherit' });
    // Touch only this extracted disposable copy. The original ZIP and packaged app remain intact.
    await appendFile(path.join(bundle, 'Contents', 'Resources', 'app.asar'), '\nLumaStudio PDF verification mutation\n');
    const changed = spawnSync('/usr/bin/codesign', verifyArgs, { encoding: 'utf8' });
    if (changed.error) throw changed.error;
    assert.ok(Number.isInteger(changed.status) && changed.status !== 0, '改変した配布アプリが整合性検証を通過しました。');
    results.push({ arch, archive: path.basename(archive), signatureVerified: true, changedResourceRejected: true, installGuideIncluded: true, notarized: false, gatekeeperApprovalTested: false });
  } finally {
    // temporary is generated beneath our own scratch folder; never delete a supplied bundle path.
    assert.equal(path.dirname(path.resolve(temporary)), scratch);
    await rm(temporary, { recursive: true, force: true });
  }
}
await copyFile(path.join(repo, 'README-Mac.txt'), path.join(repo, 'release', 'README-Mac.txt'));
await writeFile(path.join(scratch, 'release-mac-archives.json'), JSON.stringify(results, null, 2));
console.log(JSON.stringify({ verifiedMacArchives: results }));
