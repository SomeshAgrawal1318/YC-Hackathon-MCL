const { test } = require('node:test');
const assert = require('node:assert/strict');
const { isGmail, isOdoo } = require('../electron/origins.cjs');
const { odooLogin } = require('../electron/chrome.cjs');
const env = { ODOO_URL: 'https://erp.example', ODOO_USER: 'user', ODOO_PASSWORD: 'test-only' };
test('reject lookalikes, embedded credentials, insecure protocols and extra ports', () => {
  for (const url of ['https://evil.example/?accounts.google.com', 'https://accounts.google.com.evil.example', 'http://mail.google.com', 'https://x@mail.google.com', 'https://mail.google.com:444']) assert.equal(isGmail(url), false, url);
  for (const url of ['http://erp.example', 'https://erp.example.evil.test', 'http://localhost', 'https://user@erp.example', 'https://erp.example:444']) assert.equal(isOdoo(env, url), false, url);
  assert.equal(isGmail('https://mail.google.com/mail/u/0'), true);
  assert.equal(isOdoo(env, 'https://erp.example/odoo/purchase'), true);
  assert.equal(isOdoo({ ODOO_URL: 'http://localhost:8069' }, 'http://localhost:8069/web/login'), true);
  assert.equal(isOdoo({ ODOO_URL: 'http://localhost:8069' }, 'http://127.0.0.1:8069/web/login'), false);
});
test('never enter credentials into an untrusted login page', async () => {
  const fills = [];
  await assert.rejects(odooLogin(env, { url: () => 'https://evil.example/web/login', fill: async (...args) => fills.push(args) }), /origin/);
  assert.deepEqual(fills, []);
});
test('stop before password entry if navigation changes after username', async () => {
  let url = 'https://erp.example/web/login';
  const fills = [];
  await assert.rejects(odooLogin(env, { url: () => url, fill: async selector => { fills.push(selector); url = 'https://evil.example/web/login'; } }), /origin/);
  assert.deepEqual(fills, ['input[name=login]']);
});
test('configured VM origin logs in and checks the landing page', async () => {
  for (const destination of ['http://localhost:8069/odoo', 'https://evil.example/odoo']) {
    let url = 'http://localhost:8069/web/login';
    const fills = [];
    const page = { url: () => url, fill: async selector => fills.push(selector), waitForURL: async () => {}, click: async () => { url = destination; } };
    const login = odooLogin({ ...env, ODOO_URL: 'http://localhost:8069' }, page);
    if (destination.includes('evil')) await assert.rejects(login, /origin/); else await login;
    assert.equal(fills.length, 2);
  }
});
