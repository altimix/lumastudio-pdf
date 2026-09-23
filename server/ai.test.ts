import { describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
import http from 'node:http';
import { createApiServer } from './dev-api.mjs';

const require = createRequire(import.meta.url);
const { createAutofill, validatePayload, cleanResult } = require('./ai.cjs');

const imageDataUrl = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=';
const payload = () => ({
  pages: [{ pageId: 'page-1', width: 595, height: 842, imageDataUrl }],
  profile: { 氏名: '山田 太郎', 住所: '東京都架空区1-2-3', 記入日: '2026年9月22日', 口座番号: '1234567' },
  stamp: { enabled: true, name: '山田' },
});
const placement = (overrides: Record<string, unknown> = {}) => ({
  pageId: 'page-1', type: 'text', field: '氏名', text: '山田 太郎', x: 20, y: 50, width: 150, height: 20,
  ...overrides,
});
const fakeResponse = (result: unknown) => new Response(JSON.stringify({
  status: 'completed',
  output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify(result) }] }],
}), { status: 200 });

describe('AI autofill boundary', () => {
  it('calls only the Responses API with strict output and no response storage', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(fakeResponse({ placements: [placement()], notes: [] }));
    const service = createAutofill({ env: { OPENAI_API_KEY: 'test-only-key' }, fetchImpl });
    expect(service.getAiStatus()).toEqual({ available: true, model: 'gpt-6-sol' });
    const result = await service.autofill(payload());
    expect(result.placements).toEqual([placement()]);
    const [url, request] = fetchImpl.mock.calls[0];
    const body = JSON.parse(request.body);
    expect(url).toBe('https://api.openai.com/v1/responses');
    expect(body.model).toBe('gpt-6-sol');
    expect(body.store).toBe(false);
    expect(body.reasoning).toEqual({ effort: 'medium' });
    expect(body.text.format.strict).toBe(true);
    expect(body.text.format.schema.additionalProperties).toBe(false);
    expect(body.input[0].content.some((part: { type: string }) => part.type === 'input_image')).toBe(true);
    expect(request.body).not.toContain('test-only-key');
    expect(JSON.stringify(result)).not.toContain('test-only-key');
    expect(JSON.stringify(service.getAiStatus())).not.toContain('test-only-key');
  });

  it('sends the selected Luna model and falls back to Sol for unsupported environment values', async () => {
    const fetchImpl = vi.fn().mockImplementation(async () => fakeResponse({ placements: [], notes: [] }));
    const service = createAutofill({ env: { OPENAI_API_KEY: 'test-only-key', OPENAI_MODEL: 'gpt-6-sol' }, fetchImpl });
    const luna = service.withModel('gpt-6-luna');
    expect(luna.getAiStatus()).toEqual({ available: true, model: 'gpt-6-luna' });
    await luna.autofill(payload());
    expect(JSON.parse(fetchImpl.mock.calls[0][1].body).model).toBe('gpt-6-luna');
    expect(JSON.parse(fetchImpl.mock.calls[0][1].body).reasoning).toEqual({ effort: 'medium' });
    expect(createAutofill({ env: { OPENAI_MODEL: 'gpt-5.4-mini' } }).getAiStatus().model).toBe('gpt-6-sol');
  });

  it('drops invented account numbers, mismatched field values, unknown pages, and unapproved stamps', () => {
    const input = payload();
    input.stamp.enabled = false;
    const result = cleanResult({ placements: [
      placement(),
      placement({ field: '口座番号', text: '7654321' }),
      placement({ field: '住所', text: input.profile.氏名 }),
      placement({ field: '未登録', text: input.profile.氏名 }),
      placement({ pageId: 'page-from-another-document' }),
      placement({ type: 'stamp', field: '印鑑', text: '山田' }),
    ], notes: [] }, validatePayload(input));
    expect(result.placements).toEqual([placement()]);
    expect(result.notes.join('')).toContain('5件除外');
  });

  it('accepts only the registered stamp name in a stamp field', () => {
    const good = placement({ type: 'stamp', field: '印鑑', text: '山田', width: 40, height: 40 });
    const result = cleanResult({ placements: [
      good,
      placement({ type: 'stamp', field: '印鑑', text: '佐藤' }),
      placement({ type: 'stamp', field: '氏名', text: '山田' }),
    ], notes: [] }, validatePayload(payload()));
    expect(result.placements).toEqual([good]);
  });

  it('limits guessed stamps to a 48-point square', () => {
    const result = cleanResult({ placements: [
      placement({ type: 'stamp', field: '印鑑', text: '山田', width: 100, height: 60 }),
    ], notes: [] }, validatePayload(payload()));
    expect(result.placements).toEqual([placement({ type: 'stamp', field: '印鑑', text: '山田', width: 48, height: 48 })]);
  });

  it('uses measured cells instead of model coordinates and rejects unknown cells', () => {
    const input = {
      ...payload(),
      pages: [{ ...payload().pages[0], cells: [{ id: 'C1', x: 150, y: 300, width: 300, height: 48 }], coordinateGrid: { step: 50 } }],
    };
    const result = cleanResult({ placements: [
      placement({ cellId: 'C1', x: 0, y: 0, width: 2, height: 2 }),
      placement({ cellId: 'C99' }),
    ], notes: [] }, validatePayload(input));
    expect(result.placements).toEqual([placement({ x: 156, y: 313, width: 288, height: 22 })]);
    expect(result.notes.join('')).toContain('1件除外');
    expect(() => validatePayload({ ...input, pages: [{ ...input.pages[0], cells: [{ id: 'C1', x: 590, y: 300, width: 300, height: 48 }] }] })).toThrow();
  });

  it('lays out separate registered values side by side inside their shared cell', () => {
    const input = validatePayload({
      ...payload(),
      pages: [{ ...payload().pages[0], cells: [{ id: 'C1', x: 150, y: 300, width: 300, height: 48 }] }],
    });
    const result = cleanResult({ placements: [
      placement({ cellId: 'C1' }),
      placement({ cellId: 'C1', field: '口座番号', text: '1234567' }),
    ], notes: [] }, input);
    expect(result.placements).toHaveLength(2);
    const [first, second] = result.placements;
    expect(first.x).toBe(156);
    expect(first.x + first.width).toBeLessThan(second.x);
    expect(second.x + second.width).toBeLessThanOrEqual(444);
    expect(first.y).toBe(313);
    expect(second.y).toBe(313);
  });

  it('clamps placement rectangles inside the page and drops invalid numeric values', () => {
    const result = cleanResult({ placements: [
      placement({ x: -15, y: 1000 }),
      placement({ x: Infinity }),
      placement({ width: -1 }),
      placement({ type: 'script' }),
    ], notes: [] }, validatePayload(payload()));
    expect(result.placements).toEqual([placement({ x: 0, y: 822 })]);
    expect(result.notes.join('')).toContain('3件除外');
    expect(result.notes.join('')).toContain('1件調整');
  });

  it('rejects malformed or oversize input before calling the provider', async () => {
    const fetchImpl = vi.fn();
    const service = createAutofill({ env: { OPENAI_API_KEY: 'test-only-key' }, fetchImpl });
    const input = payload();
    await expect(service.autofill({ ...input, pages: Array(6).fill(input.pages[0]) })).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    await expect(service.autofill({ ...input, pages: [input.pages[0], input.pages[0]] })).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    await expect(service.autofill({ ...input, pages: [{ ...input.pages[0], imageDataUrl: 'data:image/png;base64,AAAAAAAAAAA=' }] })).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    await expect(service.autofill({ ...input, pages: [{ ...input.pages[0], imageDataUrl: `data:image/png;base64,${'A'.repeat(6 * 1024 * 1024)}` }] })).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    await expect(service.autofill({ ...input, profile: Object.fromEntries(Array.from({ length: 20 }, (_, i) => [`欄${i}`, 'あ'.repeat(800)])) })).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    await expect(service.autofill({ ...input, profile: JSON.parse('{"__proto__":"bad"}') })).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('does not call the provider when no key is configured', async () => {
    const fetchImpl = vi.fn();
    const service = createAutofill({ env: {}, fetchImpl });
    expect(service.getAiStatus().available).toBe(false);
    await expect(service.autofill(payload())).rejects.toMatchObject({ code: 'AI_UNAVAILABLE', status: 503 });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('does not disclose provider errors or network exceptions', async () => {
    const secret = 'secret-key-and-private-account-details';
    for (const response of [
      () => Promise.resolve(new Response(secret, { status: 401 })),
      () => Promise.reject(new Error(secret)),
      () => Promise.resolve(new Response(secret, { status: 200 })),
    ]) {
      const service = createAutofill({ env: { OPENAI_API_KEY: secret }, fetchImpl: response });
      let thrown;
      try { await service.autofill(payload()); } catch (error) { thrown = error; }
      expect(thrown).toBeInstanceOf(Error);
      expect(String(thrown)).not.toContain(secret);
    }
  });

  it('rejects incomplete, malformed, and excessive output', async () => {
    const values = [
      new Response(JSON.stringify({ status: 'incomplete', output: [] })),
      fakeResponse({ placements: [], notes: 'not-an-array' }),
      fakeResponse({ placements: Array(101).fill(placement()), notes: [] }),
      fakeResponse({ placements: [], notes: ['x'.repeat(501)] }),
    ];
    for (const response of values) {
      const service = createAutofill({ env: { OPENAI_API_KEY: 'test-only-key' }, fetchImpl: async () => response });
      await expect(service.autofill(payload())).rejects.toMatchObject({ status: 502 });
    }
  });

  it('allows only the local app origin and sanitizes unexpected server failures', async () => {
    const service = {
      getAiStatus: () => ({ available: true, model: 'test-model' }),
      autofill: vi.fn().mockResolvedValue({ placements: [], notes: [] }),
    };
    const server = createApiServer(service);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Missing test server address');
    const request = (origin: string | undefined, host = '127.0.0.1:5194', method = 'POST', url = '/api/autofill') => new Promise<{
      status: number, body: string, headers: http.IncomingHttpHeaders,
    }>((resolve, reject) => {
      const req = http.request({
        host: '127.0.0.1', port: address.port, method, path: url,
        headers: { Host: host, 'Content-Type': 'application/json', ...(origin ? { Origin: origin } : {}) },
      }, (res) => {
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => { body += chunk; });
        res.on('end', () => resolve({ status: res.statusCode ?? 0, body, headers: res.headers }));
      });
      req.on('error', reject);
      req.end(method === 'POST' ? '{}' : undefined);
    });
    try {
      for (const origin of ['https://untrusted.example', 'null', undefined]) {
        expect((await request(origin)).status).toBe(403);
      }
      expect((await request('http://127.0.0.1:5193', 'attacker.example:5194')).status).toBe(403);
      expect(service.autofill).not.toHaveBeenCalled();
      const result = await request('http://127.0.0.1:5193');
      expect(result.status).toBe(200);
      expect(result.headers['access-control-allow-origin']).toBeUndefined();
      expect(service.autofill).toHaveBeenCalledOnce();
      expect((await request(undefined, '127.0.0.1:5194', 'GET', '/api/ai-status')).status).toBe(200);
      service.autofill.mockRejectedValueOnce(new Error('private-document-secret'));
      const failed = await request('http://127.0.0.1:5193');
      expect(failed.status).toBe(500);
      expect(failed.body).not.toContain('private-document-secret');
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error?: Error) => error ? reject(error) : resolve()));
    }
  });
});
