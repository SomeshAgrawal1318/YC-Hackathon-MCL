// Test VMs on Freestyle: one fresh VM per test, booted from the image `npm run vm:image` built
// (vm-image.json). Each gets random public domains for its Chrome (token-protected CDP), its
// view-only screen (noVNC) and its own Odoo. VMs are deleted a while after the run, on quit,
// and by Freestyle itself after ttlSeconds whatever happens to this app.

const fs = require('node:fs');
const path = require('node:path');
const { loadEnv, ROOT } = require('./env.cjs');
const vmc = require('./vm-common.cjs');

const IMAGE_FILE = path.join(ROOT, 'vm-image.json');
const KEEP_AFTER_RUN_MS = 10 * 60 * 1000;

function loadImage() {
  try {
    return JSON.parse(fs.readFileSync(IMAGE_FILE, 'utf8'));
  } catch {
    return null;
  }
}

/** Whether "Test in VMs" can run, and if not, what's missing (in plain words). */
function vmStatus(env = loadEnv()) {
  if (!env.FREESTYLE_API_KEY) return { available: false, reason: 'Add FREESTYLE_API_KEY to .env.local to run tests in VMs.' };
  const image = loadImage();
  if (!image?.snapshotId) return { available: false, reason: 'Build the VM image first: npm run vm:image' };
  if (!env.GMAIL_INBOX_APP_PASSWORD) return { available: false, reason: 'Add GMAIL_INBOX_APP_PASSWORD to .env.local: test VMs read email over IMAP.' };
  return { available: true, reason: `Freestyle image from ${new Date(image.createdAt).toLocaleString()}` };
}

const live = new Map(); // runId -> { vm, vmId, timer }

/** Boots a VM for one test and waits until its Chrome and Odoo answer. */
async function startTestVm(runId, label, { env = loadEnv() } = {}) {
  const image = loadImage();
  if (!image) throw new Error('No VM image. Run "npm run vm:image" first.');
  const freestyle = await vmc.freestyleClient(env);
  const t0 = Date.now();
  let created;
  try {
    created = await freestyle.vms.create({
      firewall: vmc.FIREWALL,
      snapshotId: image.snapshotId,
      displayName: `mcl-test-${label}`.slice(0, 60),
      idleTimeoutSeconds: 900,
      ttlSeconds: 2400, // Freestyle deletes it after 40 minutes even if this app is gone
    });
  } catch (e) {
    throw new Error(`Freestyle could not start a VM: ${e.message}`);
  }
  const { vm, vmId } = created;
  live.set(runId, { vm, vmId, timer: null });
  const bootMs = Date.now() - t0;
  const [, odooDomain, cdpDomain, vncDomain] = await Promise.all([
    vm.exec({ command: vmc.HIDE_VNC_BAR, linuxUser: 'root', timeoutMs: 20000 }).catch(() => undefined),
    vmc.publish(freestyle, vmId, 'odoo', 8069),
    vmc.publish(freestyle, vmId, 'cdp', 9333),
    vmc.publish(freestyle, vmId, 'vnc', 6080),
  ]);
  const [cdpWs] = await Promise.all([
    vmc.cdpWebSocket(cdpDomain, image.cdpToken, 90000),
    vmc.waitForUrl(`https://${odooDomain}/web/login`, 90000),
    vmc.waitForUrl(`https://${vncDomain}/vnc_lite.html`, 90000),
  ]);
  return {
    runId,
    vmId,
    bootMs,
    readyMs: Date.now() - t0,
    cdpWs,
    vncUrl: vmc.vncUrl(vncDomain, image.vncPassword),
    odooUrl: `https://${odooDomain}`,
    odoo: image.odoo,
  };
}

async function stopVm(runId) {
  const v = live.get(runId);
  if (!v) return;
  live.delete(runId);
  clearTimeout(v.timer);
  await v.vm.delete().catch(() => undefined);
}

/** Keeps the VMs a while so their Odoo links in the report still open, then deletes them. */
function releaseLater(runIds, ms = KEEP_AFTER_RUN_MS) {
  for (const id of runIds) {
    const v = live.get(id);
    if (v) v.timer = setTimeout(() => void stopVm(id), ms);
  }
}

async function stopAll() {
  await Promise.all([...live.keys()].map(stopVm));
}

module.exports = { vmStatus, startTestVm, stopVm, releaseLater, stopAll, loadImage };
