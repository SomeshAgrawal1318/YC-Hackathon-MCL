// npm run vm:image — build the Freestyle VM image the test runs boot from (docs/vm-plan.md, Phase 1).
// One builder VM gets Google Chrome on a virtual screen (view-only noVNC, token-protected CDP),
// PostgreSQL and Odoo 18 with the demo's vendors, products and past orders. Chrome is signed in
// to Odoo. Then it's snapshotted; every test VM boots from that snapshot with a clean Odoo.
// Writes vm-image.json (gitignored): the snapshot id and the secrets the app needs to reach VMs.
import { randomBytes } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { chromium } from 'playwright-core';
import envMod from '../electron/env.cjs';
import odooMod from '../electron/odoo.cjs';
import vmMod from '../electron/vm-common.cjs';
import { seedOdoo } from './lib/seed';

const env = (envMod as typeof import('../electron/env.cjs')).loadEnv();
const { createOdoo } = odooMod as typeof import('../electron/odoo.cjs');
const vmc = vmMod as typeof import('../electron/vm-common.cjs');

const secret = (n: number) => randomBytes(n).toString('base64url');
const CDP_TOKEN = secret(18);
const VNC_PASSWORD = randomBytes(4).toString('hex'); // x11vnc uses only the first 8 characters
const ODOO_PASSWORD = secret(15);
const t0 = Date.now();
const step = (m: string) => console.log(`[${((Date.now() - t0) / 1000).toFixed(0).padStart(4)} s] ${m}`);

const freestyle = await vmc.freestyleClient(env);
step('Creating the builder VM');
const { vm, vmId } = await freestyle.vms.create({ firewall: vmc.FIREWALL, slug: `mcl-image-builder-${vmc.rand(4)}`, idleTimeoutSeconds: null, ttlSeconds: 7200 });

try {
  step('Installing Chrome and the virtual screen');
  await vmc.runSetup(
    vm,
    'browser',
    [
      'apt-get update -qq',
      'apt-get install -y -qq --no-install-recommends ca-certificates curl wget gnupg fonts-liberation xvfb openbox x11vnc novnc websockify xauth x11-utils dbus-x11 nginx',
      'wget -q -O /tmp/chrome.deb https://dl.google.com/linux/direct/google-chrome-stable_current_amd64.deb',
      'apt-get install -y -qq /tmp/chrome.deb',
    ].join('\n'),
    { log: console.log },
  );

  step('Installing PostgreSQL and Odoo 18 (several minutes)');
  await vmc.runSetup(
    vm,
    'odoo',
    [
      'apt-get install -y -qq postgresql',
      'systemctl enable --now postgresql',
      'wget -qO - https://nightly.odoo.com/odoo.key | gpg --dearmor --yes -o /usr/share/keyrings/odoo-archive-keyring.gpg',
      'echo "deb [signed-by=/usr/share/keyrings/odoo-archive-keyring.gpg] https://nightly.odoo.com/18.0/nightly/deb/ ./" > /etc/apt/sources.list.d/odoo.list',
      'apt-get update -qq',
      'apt-get install -y -qq odoo',
      'systemctl stop odoo || true',
      `su - postgres -c "psql -tAc \\"SELECT 1 FROM pg_roles WHERE rolname='odoo'\\"" | grep -q 1 || su - postgres -c "createuser -s odoo"`,
    ].join('\n'),
    { maxMinutes: 25, log: console.log },
  );

  step('Configuring Odoo and creating the "mcl" database with Purchase');
  await vmc.writeRoot(
    vm,
    '/etc/odoo/odoo.conf',
    ['[options]', 'db_host = False', 'db_port = False', 'db_user = odoo', 'db_password = False', `admin_passwd = ${secret(18)}`, 'dbfilter = ^mcl$', 'list_db = False', 'http_port = 8069', 'proxy_mode = True', 'addons_path = /usr/lib/python3/dist-packages/odoo/addons', ''].join('\n'),
  );
  await vmc.root(vm, 'chown odoo:odoo /etc/odoo/odoo.conf && chmod 640 /etc/odoo/odoo.conf');
  await vmc.runSetup(vm, 'odoo-db', 'su odoo -s /bin/bash -c "odoo -c /etc/odoo/odoo.conf -d mcl -i purchase --without-demo=all --stop-after-init --log-level=warn"\nsystemctl enable --now odoo', { maxMinutes: 15, log: console.log });

  step('Writing the browser, screen and CDP services');
  const files = vmc.serviceFiles({ cdpToken: CDP_TOKEN, startUrl: 'http://localhost:8069/odoo/purchase' });
  for (const [path, body] of Object.entries(files)) await vmc.writeRoot(vm, path, body);
  await vmc.root(vm, `mkdir -p /root/.vnc && x11vnc -storepasswd ${VNC_PASSWORD} /root/.vnc/passwd`);
  await vmc.root(vm, vmc.HIDE_VNC_BAR);
  await vmc.root(vm, 'rm -f /etc/nginx/sites-enabled/default && ln -sf /etc/nginx/sites-available/chrome-cdp /etc/nginx/sites-enabled/chrome-cdp && nginx -t');
  await vmc.root(vm, 'systemctl daemon-reload && systemctl enable --now xvfb openbox x11vnc novnc nginx chrome-headed && systemctl reload nginx', 120000);

  step('Publishing the builder so this PC can reach it');
  const odooDomain = await vmc.publish(freestyle, vmId, 'odoo', 8069);
  const cdpDomain = await vmc.publish(freestyle, vmId, 'cdp', 9333);
  await vmc.waitForUrl(`https://${odooDomain}/web/login`, 120000);

  step('Securing the Odoo admin account and seeding the demo data');
  const asAdmin = createOdoo({ ...env, ODOO_URL: `https://${odooDomain}`, ODOO_DB: 'mcl', ODOO_USER: 'admin', ODOO_PASSWORD: 'admin' });
  const uid = await asAdmin.login();
  await asAdmin.write('res.users', [uid], { password: ODOO_PASSWORD });
  const odoo = createOdoo({ ...env, ODOO_URL: `https://${odooDomain}`, ODOO_DB: 'mcl', ODOO_USER: 'admin', ODOO_PASSWORD: ODOO_PASSWORD });
  await seedOdoo(odoo, (m) => step(m));

  step('Signing Chrome in to Odoo');
  const browser = await chromium.connectOverCDP(await vmc.cdpWebSocket(cdpDomain, CDP_TOKEN));
  const page = browser.contexts()[0].pages()[0] ?? (await browser.contexts()[0].newPage());
  await page.goto('http://localhost:8069/web/login');
  await page.fill('input[name=login]', 'admin');
  await page.fill('input[name=password]', ODOO_PASSWORD);
  await Promise.all([page.waitForURL((u) => !/\/web\/login/.test(String(u)), { timeout: 30000 }), page.click('button[type=submit]')]);
  await page.goto('http://localhost:8069/odoo/purchase');
  await page.waitForSelector('.o_list_view, .o_kanban_view', { timeout: 30000 });
  await page.waitForTimeout(1500);
  // Close Chrome gracefully so it writes the session cookie to disk; systemd starts it again.
  const session = await browser.newBrowserCDPSession();
  await session.send('Browser.close').catch(() => undefined);
  await new Promise((r) => setTimeout(r, 4000));

  const again = await chromium.connectOverCDP(await vmc.cdpWebSocket(cdpDomain, CDP_TOKEN));
  const p2 = again.contexts()[0].pages()[0] ?? (await again.contexts()[0].newPage());
  await p2.goto('http://localhost:8069/odoo/purchase');
  await p2.waitForTimeout(2500);
  if (/\/web\/login/.test(p2.url())) {
    // Not fatal: the test runner signs in to Odoo whenever it lands on the login page.
    step('Note: Chrome did not keep the Odoo session; test runs will sign in themselves.');
    await p2.fill('input[name=login]', 'admin');
    await p2.fill('input[name=password]', ODOO_PASSWORD);
    await Promise.all([p2.waitForURL((u) => !/\/web\/login/.test(String(u)), { timeout: 30000 }), p2.click('button[type=submit]')]);
  }
  await p2.waitForSelector('.o_list_view, .o_kanban_view', { timeout: 30000 });
  await p2.screenshot({ path: 'vm-image-check.png' });
  await again.close();

  step('Snapshotting the image');
  const { snapshotId } = await vm.snapshot();
  const image = {
    snapshotId,
    cdpToken: CDP_TOKEN,
    vncPassword: VNC_PASSWORD,
    odoo: { db: 'mcl', user: 'admin', password: ODOO_PASSWORD },
    chrome: (await vmc.root(vm, 'google-chrome --version')).stdout?.trim(),
    createdAt: new Date().toISOString(),
  };
  writeFileSync('vm-image.json', JSON.stringify(image, null, 2));
  step(`Done. Snapshot ${snapshotId} written to vm-image.json (${image.chrome}).`);
} catch (e) {
  console.error('IMAGE BUILD FAILED:', (e as Error).message);
  process.exitCode = 1;
} finally {
  await vm.delete().catch(() => undefined);
  step('Builder VM deleted.');
}
