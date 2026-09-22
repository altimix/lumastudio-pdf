// Explicit live smoke check. The PNG must be a fictitious sample form only.
import fs from 'node:fs/promises';
import path from 'node:path';
import ai from '../server/ai.cjs';

if (!process.argv.includes('--run-live')) {
  process.stdout.write('実API検証は未実行です。架空の書式を tmp/ai-live-page.png に用意し、node scripts/smoke-ai.mjs --run-live で実行します。API利用料が発生します。\n');
  process.exit(0);
}

try {
  const imagePath = path.resolve('tmp/ai-live-page.png');
  const outputPath = path.resolve('tmp/ai-live-result.json');
  const image = await fs.readFile(imagePath);
  const client = ai.createAutofill();
  if (!client.getAiStatus().available) throw new Error('AI_UNAVAILABLE');
  const result = await client.autofill({
    pages: [{ pageId: 'ai-live-sample', width: 595.28, height: 841.89, imageDataUrl: `data:image/png;base64,${image.toString('base64')}` }],
    profile: {
      氏名: '山田 太郎',
      会社名: '株式会社テスト文具',
      住所: '東京都架空区テスト町1-2-3',
      電話番号: '03-0000-0000',
      銀行名: '架空銀行',
      支店名: 'テスト支店',
      口座種別: '普通',
      口座番号: '0000000',
      口座名義: 'ヤマダ タロウ',
      記入日: '2026年9月22日',
    },
    stamp: { enabled: true, name: '山田' },
  });
  await fs.writeFile(outputPath, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
  process.stdout.write(JSON.stringify({
    completed: true,
    placementCount: result.placements.length,
    fields: result.placements.map(({ type, field }) => ({ type, field })),
    noteCount: result.notes.length,
    output: 'tmp/ai-live-result.json',
  }, null, 2) + '\n');
} catch (error) {
  // Do not print arbitrary exception messages; those may contain provider data.
  process.stderr.write(JSON.stringify({ completed: false, code: error instanceof ai.AutofillError ? error.code : 'SMOKE_FAILED' }) + '\n');
  process.exitCode = 1;
}
