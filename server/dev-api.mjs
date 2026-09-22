import http from 'node:http';
import { pathToFileURL } from 'node:url';
import ai from './ai.cjs';

const ALLOWED_ORIGIN = 'http://127.0.0.1:5193';

export function createApiServer(service = ai) {
  let runningRequests = 0;
  return http.createServer(async (req, res) => {
    const send = (status, data) => {
      res.writeHead(status, {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
      });
      res.end(JSON.stringify(data));
    };
    // Only Vite on the fixed loopback origin may make state-changing requests.
    // Same-origin GETs may omit Origin; status contains no credentials or document data.
    const host = req.headers.host ?? '';
    if (!/^127\.0\.0\.1:(5193|5194)$/u.test(host)
      || (req.headers.origin && req.headers.origin !== ALLOWED_ORIGIN)
      || (req.method !== 'GET' && req.headers.origin !== ALLOWED_ORIGIN)) {
      send(403, { error: 'この接続元からは利用できません。', code: 'FORBIDDEN_ORIGIN' });
      req.resume();
      return;
    }
    if (req.method === 'GET' && req.url === '/api/ai-status') {
      send(200, service.getAiStatus());
      return;
    }
    if (req.method !== 'POST' || req.url !== '/api/autofill') {
      send(404, { error: '見つかりません。', code: 'NOT_FOUND' });
      req.resume();
      return;
    }
    if (!/^application\/json(?:;|$)/iu.test(req.headers['content-type'] ?? '')) {
      send(415, { error: 'JSON形式で送信してください。', code: 'INVALID_CONTENT_TYPE' });
      req.resume();
      return;
    }
    if (Number(req.headers['content-length']) > ai.MAX_REQUEST_BYTES) {
      send(413, { error: '送信する画像が大きすぎます。', code: 'PAYLOAD_TOO_LARGE' });
      req.resume();
      return;
    }
    if (runningRequests >= 2) {
      send(429, { error: '別のAI記入を処理中です。完了後にお試しください。', code: 'AI_BUSY' });
      req.resume();
      return;
    }
    runningRequests += 1;
    try {
      const chunks = [];
      let size = 0;
      for await (const chunk of req) {
        size += chunk.length;
        if (size > ai.MAX_REQUEST_BYTES) {
          send(413, { error: '送信する画像が大きすぎます。', code: 'PAYLOAD_TOO_LARGE' });
          return;
        }
        chunks.push(chunk);
      }
      let payload;
      try { payload = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
      catch { send(400, { error: '送信内容を読み取れません。', code: 'INVALID_JSON' }); return; }
      send(200, await service.autofill(payload));
    } catch (error) {
      if (res.headersSent || res.destroyed) return;
      send(error instanceof ai.AutofillError ? error.status : 500, {
        error: error instanceof ai.AutofillError ? error.message : 'AIの処理に失敗しました。',
        code: error instanceof ai.AutofillError ? error.code : 'AI_ERROR',
      });
    } finally {
      runningRequests -= 1;
    }
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const server = createApiServer();
  server.requestTimeout = 120000;
  server.headersTimeout = 10000;
  server.listen(5194, '127.0.0.1', () => process.stdout.write('LumaStudio AI API: http://127.0.0.1:5194\n'));
  server.on('error', () => {
    process.stderr.write('AI APIを起動できませんでした。ポート5194の使用状況を確認してください。\n');
    process.exitCode = 1;
  });
}
