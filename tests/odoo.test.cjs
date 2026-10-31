const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createOdoo } = require('../electron/odoo.cjs');
const { parseRetryAfter, retryDelayMs } = require('../electron/retry-policy.cjs');
const env = { ODOO_URL: 'https://erp.example', ODOO_DB: 'demo', ODOO_USER: 'user', ODOO_PASSWORD: 'test-only' };
function client(fail, methodResult = []) {
  const calls = [], delays = [];
  return { calls, delays, odoo: createOdoo(env, {
    sleep: async ms => delays.push(ms),
    fetch: async (url, options) => {
      const req = JSON.parse(options.body);
      calls.push({ url, options, req });
      if (req.params.service === 'object') {
        const failure = fail(calls.filter(c => c.req.params.service === 'object').length);
        if (failure instanceof Error) throw failure;
        if (failure) return failure;
      }
      return new Response(JSON.stringify({ jsonrpc: '2.0', id: req.id, result: req.params.service === 'common' ? 1 : methodResult }));
    },
  }) };
}
test('read recovers from transient errors, honors Retry-After and rejects redirects', async () => {
  const c = client(n => n === 1 ? new Response('', { status: 503, headers: { 'Retry-After': '1' } }) : null);
  assert.deepEqual(await c.odoo.read('purchase.order', [1], ['name']), []);
  assert.deepEqual(c.delays, [1000]);
  assert.equal(c.calls.length, 3);
  for (const call of c.calls) { assert.equal(call.options.redirect, 'error'); assert.ok(call.options.signal instanceof AbortSignal); }
});
test('read retries are bounded and client errors are not retried', async () => {
  for (const status of [401, 403, 429, 503]) {
    const c = client(() => new Response('', { status }));
    await assert.rejects(c.odoo.search('purchase.order', []));
    assert.equal(c.calls.length, status >= 500 || status === 429 ? 4 : 2);
  }
});
test('writes and unknown methods never retry after ambiguous network failures', async () => {
  for (const method of ['create', 'write', 'unlink', 'button_confirm']) {
    const c = client(() => new TypeError('socket closed'));
    await assert.rejects(c.odoo.call('purchase.order', method, []), /verify the ERP/);
    assert.equal(c.calls.length, 2);
    assert.deepEqual(c.delays, []);
  }
});
test('malformed response IDs and application errors are rejected without retries', async () => {
  for (const body of [{ jsonrpc: '2.0', id: 999, result: [] }, { jsonrpc: '2.0', id: 2, error: { message: 'Access denied' } }]) {
    const c = client(() => new Response(JSON.stringify(body)));
    await assert.rejects(c.odoo.read('purchase.order', [1], []));
    assert.equal(c.calls.length, 2);
  }
});
test('server delay is capped and invalid metadata falls back', () => {
  assert.equal(parseRetryAfter('9999999'), 300000);
  assert.equal(parseRetryAfter('nonsense'), undefined);
  assert.equal(retryDelayMs({ retryAfterMs: -1 }, 250), 250);
});
