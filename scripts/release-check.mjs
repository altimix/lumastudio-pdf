import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { appendFile, mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const versionPattern = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z]+(?:\.[0-9A-Za-z]+)*)?$/;

export function verifyVersion(version, tag) {
  assert.match(version, versionPattern, 'package.json のバージョン形式が不正です。');
  assert.equal(tag, `v${version}`, 'タグは package.json のバージョンと一致させてください。');
  return version;
}

export function expectedAssets(version, platform) {
  assert.match(version, versionPattern);
  assert.ok(['windows', 'macos', 'all'].includes(platform), 'Unknown release platform');
  const prefix = `LumaStudio-PDF-${version}`;
  const windows = [`${prefix}-windows-x64-setup.exe`, `${prefix}-windows-x64-portable.exe`];
  const macos = ['x64', 'arm64'].flatMap((arch) => ['dmg', 'zip'].map((ext) => `${prefix}-macos-${arch}.${ext}`));
  macos.push('README-Mac.txt', 'LICENSE.txt');
  return (platform === 'all' ? [...windows, ...macos] : platform === 'windows' ? windows : macos).sort();
}

export async function assetManifest(directory, version, platform) {
  const expected = expectedAssets(version, platform);
  const found = (await readdir(directory, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && (/\.(?:exe|dmg|zip)$/i.test(entry.name) || ['README-Mac.txt', 'LICENSE.txt'].includes(entry.name)))
    .map((entry) => entry.name).sort();
  assert.deepEqual(found, expected, '配布ファイルが不足しているか、予期しない名前・バージョンのファイルが含まれています。');
  if (platform !== 'windows') {
    const license = await readFile(path.join(directory, 'LICENSE.txt'));
    assert.ok(license.equals(await readFile('LICENSE')), '配布用のGPLライセンス本文が元のLICENSEと一致しません。');
  }
  const lines = [];
  for (const name of expected) {
    const filename = path.join(directory, name);
    assert.ok((await stat(filename)).size > 0, `空の配布ファイル: ${name}`);
    const hash = createHash('sha256');
    for await (const chunk of createReadStream(filename)) hash.update(chunk);
    lines.push(`${hash.digest('hex')}  ${name}`);
  }
  const result = `${lines.join('\n')}\n`;
  if (platform === 'all') {
    const originals = (await Promise.all(['windows', 'macos'].map((name) =>
      readFile(path.join(directory, `SHA256SUMS-${name}.txt`), 'utf8'))))
      .flatMap((text) => text.trim().split(/\r?\n/)).sort();
    assert.deepEqual(lines.slice().sort(), originals, 'ビルド時とダウンロード後のチェックサムが一致しません。');
  }
  return result;
}

export async function verifyWindowsPackageLicense(directory, version) {
  assert.equal(process.platform, 'win32', 'Windows配布物の展開検査はWindowsで実行してください。');
  const original = await readFile('LICENSE');
  const sevenZip = path.resolve('node_modules/electron-winstaller/vendor/7z.exe');
  const scratchRoot = path.resolve('tmp');
  await mkdir(scratchRoot, { recursive: true });
  for (const name of expectedAssets(version, 'windows')) {
    const scratch = await mkdtemp(path.join(scratchRoot, 'license-package-'));
    assert.equal(path.dirname(path.resolve(scratch)), scratchRoot);
    try {
      execFileSync(sevenZip, ['e', '-y', `-o${scratch}`, path.resolve(directory, name), '$PLUGINSDIR\\app-64.7z'], { stdio: 'pipe' });
      const inner = path.join(scratch, 'app-64.7z');
      const bundled = execFileSync(sevenZip, ['e', '-so', inner, 'resources\\LICENSE'], { maxBuffer: original.length + 1024 });
      assert.ok(bundled.equals(original), `Windows配布物内のGPL本文が一致しません: ${name}`);
    } finally {
      assert.equal(path.dirname(path.resolve(scratch)), scratchRoot);
      await rm(scratch, { recursive: true, force: true });
    }
  }
}

async function main() {
  const pkg = JSON.parse(await readFile('package.json', 'utf8'));
  const [command, value, directory = 'release'] = process.argv.slice(2);
  if (command === 'version') {
    const version = verifyVersion(pkg.version, value || process.env.GITHUB_REF_NAME);
    assert.ok((await readFile(`docs/releases/v${version}.md`, 'utf8')).trim(), 'リリースノートが空です。');
    if (process.env.GITHUB_OUTPUT) await appendFile(process.env.GITHUB_OUTPUT, `version=${version}\n`);
    console.log(`Verified tag v${version}, package version, and release notes.`);
  } else if (command === 'assets') {
    if (value === 'windows') await verifyWindowsPackageLicense(directory, pkg.version);
    const manifest = await assetManifest(directory, pkg.version, value);
    const filename = value === 'all' ? 'SHA256SUMS.txt' : `SHA256SUMS-${value}.txt`;
    await writeFile(path.join(directory, filename), manifest, 'utf8');
    console.log(`Verified ${expectedAssets(pkg.version, value).length} release files; wrote ${filename}.`);
  } else {
    throw new Error('Usage: node scripts/release-check.mjs version [tag] | assets windows|macos|all [directory]');
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
