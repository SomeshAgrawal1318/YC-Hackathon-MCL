// The demo Chrome: a separate profile with remote debugging, so Trace can read it through
// UI Automation and the workflow runner can drive it. Gmail on the left, Odoo on the right.

const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { chromium } = require('playwright-core');

const GMAIL_URL = 'https://mail.google.com/mail/u/0/#inbox';

function chromePath(env) {
  const candidates = [
    env.CHROME_PATH,
    path.join(process.env.ProgramFiles || 'C:\\Program Files', 'Google', 'Chrome', 'Application', 'chrome.exe'),
    path.join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'Google', 'Chrome', 'Application', 'chrome.exe'),
    path.join(process.env.LOCALAPPDATA || '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
  ].filter(Boolean);
  const found = candidates.find((p) => fs.existsSync(p));
  if (!found) throw new Error('Google Chrome was not found. Install it, or set CHROME_PATH in .env.local.');
  return found;
}

const profileDir = () => path.join(process.env.LOCALAPPDATA || os.tmpdir(), 'mcl-demo-chrome');
const cdpUrl = (env) => `http://127.0.0.1:${env.CDP_PORT}`;
const odooHome = (env) => `${env.ODOO_URL.replace(/\/$/, '')}/odoo/purchase`;

async function cdpUp(env) {
  try {
    const res = await fetch(`${cdpUrl(env)}/json/version`, { signal: AbortSignal.timeout(1500) });
    return res.ok;
  } catch {
    return false;
  }
}

let browser = null;

async function connect(env) {
  if (browser && browser.isConnected()) return browser;
  browser = await chromium.connectOverCDP(cdpUrl(env));
  browser.on('disconnected', () => {
    browser = null;
  });
  return browser;
}

const isGmail = (url) => /^https:\/\/mail\.google\.com\//.test(url) || /accounts\.google\.com/.test(url);
const isOdoo = (env, url) => {
  try {
    const u = new URL(url);
    const o = new URL(env.ODOO_URL);
    return u.port === o.port && ['127.0.0.1', 'localhost', o.hostname].includes(u.hostname);
  } catch {
    return false;
  }
};

async function windowFor(b, page) {
  const session = await page.context().newCDPSession(page);
  const { targetInfo } = await session.send('Target.getTargetInfo');
  await session.detach();
  const browserSession = await b.newBrowserCDPSession();
  const { windowId } = await browserSession.send('Browser.getWindowForTarget', { targetId: targetInfo.targetId });
  return { browserSession, windowId };
}

/** Odoo switches to its phone layout below 768 CSS px; keep its window comfortably wider. */
const ODOO_MIN_WIDTH = 820;

/** Gmail on the left, Odoo on the right, with Odoo given at least ODOO_MIN_WIDTH. */
function layout(area) {
  const odooW = Math.min(area.width, Math.max(ODOO_MIN_WIDTH, Math.round(area.width * 0.57)));
  const gmailW = Math.max(560, area.width - odooW);
  return {
    gmail: { left: area.x, top: area.y, width: gmailW, height: area.height },
    odoo: { left: area.x + area.width - odooW, top: area.y, width: odooW, height: area.height },
  };
}

/** Widens the Odoo window if someone made it narrow enough for Odoo's phone layout. */
async function ensureWide(env, page, area) {
  const w = await page.evaluate(() => window.innerWidth).catch(() => ODOO_MIN_WIDTH);
  if (w >= 780) return;
  const b = await connect(env);
  await placeWindow(b, page, layout(area).odoo);
  await page.waitForTimeout(400);
}

async function placeWindow(b, page, bounds) {
  const { browserSession, windowId } = await windowFor(b, page);
  await browserSession.send('Browser.setWindowBounds', { windowId, bounds: { windowState: 'normal' } });
  await browserSession.send('Browser.setWindowBounds', { windowId, bounds });
  await browserSession.detach();
}

async function openInNewWindow(b, url) {
  const ctx = b.contexts()[0];
  const session = await b.newBrowserCDPSession();
  const waitPage = ctx.waitForEvent('page', { timeout: 15000 });
  await session.send('Target.createTarget', { url, newWindow: true });
  await session.detach();
  const page = await waitPage;
  await page.waitForLoadState('domcontentloaded').catch(() => undefined);
  return page;
}

/** Signs in to Odoo in the demo Chrome if it shows the login page. */
async function odooLogin(env, page) {
  if (!/\/web\/login/.test(page.url())) return;
  await page.fill('input[name=login]', env.ODOO_USER);
  await page.fill('input[name=password]', env.ODOO_PASSWORD);
  await Promise.all([page.waitForURL((u) => !/\/web\/login/.test(String(u)), { timeout: 20000 }), page.click('button[type=submit]')]);
}

/**
 * Starts the demo Chrome if needed and makes sure there is one Gmail window (left) and one Odoo
 * window (right, wide enough for Odoo's desktop layout). `area` is the screen work area in DIPs.
 */
async function openDemoApps(env, area, { place = true } = {}) {
  if (!(await cdpUp(env))) {
    const first = layout(area).gmail;
    const child = spawn(
      chromePath(env),
      [
        `--user-data-dir=${profileDir()}`,
        `--remote-debugging-port=${env.CDP_PORT}`,
        '--force-renderer-accessibility',
        '--no-first-run',
        '--no-default-browser-check',
        '--disable-session-crashed-bubble',
        `--window-position=${first.left},${first.top}`,
        `--window-size=${first.width},${first.height}`,
        '--new-window',
        GMAIL_URL,
      ],
      { detached: true, stdio: 'ignore' },
    );
    child.unref();
    const until = Date.now() + 20000;
    while (!(await cdpUp(env))) {
      if (Date.now() > until) throw new Error('Chrome started but did not open its debugging port. Close all windows of the demo Chrome and try again.');
      await new Promise((r) => setTimeout(r, 400));
    }
  }
  const b = await connect(env);
  const ctx = b.contexts()[0];
  const pages = ctx.pages();
  let gmail = pages.find((p) => isGmail(p.url()));
  let odoo = pages.find((p) => isOdoo(env, p.url()));
  if (!gmail) {
    // A fresh profile opens the URL from the command line; reuse a blank tab if there is one.
    const blank = pages.find((p) => p.url() === 'about:blank' || p.url().startsWith('chrome://newtab'));
    if (blank) {
      gmail = blank;
      await gmail.goto(GMAIL_URL).catch(() => undefined);
    } else gmail = await openInNewWindow(b, GMAIL_URL);
  }
  if (!odoo) odoo = await openInNewWindow(b, odooHome(env));
  await odooLogin(env, odoo).catch(() => undefined);
  if (place) {
    const l = layout(area);
    await placeWindow(b, gmail, l.gmail).catch(() => undefined);
    await placeWindow(b, odoo, l.odoo).catch(() => undefined);
  }
  return { browser: b, gmail, odoo };
}

/** Opens a URL in a new tab of the demo Chrome (used for "Open in Odoo"). */
async function openUrl(env, url) {
  const b = await connect(env);
  const page = await b.contexts()[0].newPage();
  await page.goto(url);
  await page.bringToFront();
}

module.exports = { openDemoApps, openUrl, connect, cdpUp, isGmail, isOdoo, odooLogin, ensureWide, GMAIL_URL };
