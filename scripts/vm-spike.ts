// npm run vm:spike — Phase 0 of docs/vm-plan.md.
// One Freestyle VM with headed Chrome, a view-only noVNC screen and a token-protected CDP port,
// controlled from this PC with Playwright. Then: can this plan snapshot, and how fast does a VM boot
// from the snapshot? Writes the results to vm-spike.json. Pass --keep to leave the VMs running.
//
// Notes from the first attempt: the default image is Ubuntu 24.04 with 4 vCPU / 8 GiB, commands run
// as a non-root user unless told otherwise, and Ubuntu's `chromium` package is only a snap stub.
import { randomBytes } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { Freestyle } from 'freestyle';
import type { Vm } from 'freestyle';
import { chromium } from 'playwright-core';
import envMod from '../electron/env.cjs';

const env = (envMod as unknown as { loadEnv: () => Record<string, string> }).loadEnv();
if (!env.FREESTYLE_API_KEY && !process.env.FREESTYLE_API_KEY) {
  console.error('Put FREESTYLE_API_KEY in .env.local first.');
  process.exit(1);
}
process.env.FREESTYLE_API_KEY ||= env.FREESTYLE_API_KEY;

const keep = process.argv.includes('--keep');
const freestyle = new Freestyle();
const t0 = Date.now();
const timings: Record<string, number> = {};
const mark = (label: string, since: number) => {
  timings[label] = Date.now() - since;
  console.log(`${label}: ${(timings[label] / 1000).toFixed(1)} s`);
};
const rand = () => randomBytes(6).toString('hex');
const TOKEN = randomBytes(18).toString('base64url');
const VNC_PASSWORD = randomBytes(6).toString('hex');
const firewall = { rules: [{ action: 'allow' as const, source: {}, destination: { public: true } }] };

/** Runs a command as root and fails loudly on a non-zero exit. */
async function root(vm: Vm, command: string, timeoutMs = 60000) {
  const r = await vm.exec({ command, linuxUser: 'root', timeoutMs });
  if (r.statusCode !== 0) throw new Error(`Command failed (${r.statusCode}): ${command.slice(0, 120)}\n${r.stdout ?? ''}\n${r.stderr ?? ''}`);
  return r;
}

/** Writes a file as root, through stdin. */
async function writeRoot(vm: Vm, path: string, content: string) {
  const r = await vm.exec({
    command: `mkdir -p "$(dirname ${path})" && cat > ${path}`,
    linuxUser: 'root',
    stdin: Buffer.from(content).toString('base64'),
    timeoutMs: 30000,
  });
  if (r.statusCode !== 0) throw new Error(`Could not write ${path}: ${r.stderr ?? ''}`);
}

/** Long installs run as a transient systemd unit and are polled, as in Freestyle's Chromium guide. */
async function runSetup(vm: Vm, name: string, script: string, maxMinutes = 15) {
  const scriptPath = `/root/setup-${name}.sh`;
  const donePath = `/root/setup-${name}.done`;
  const unit = `setup-${name}`;
  await writeRoot(vm, scriptPath, ['#!/bin/sh', 'set -eux', 'export DEBIAN_FRONTEND=noninteractive', script, `touch ${donePath}`, ''].join('\n'));
  await root(vm, `chmod +x ${scriptPath} && rm -f ${donePath} && systemd-run --unit=${unit} --collect ${scriptPath}`);
  const until = Date.now() + maxMinutes * 60000;
  let lastLog = '';
  while (Date.now() < until) {
    await new Promise((r) => setTimeout(r, 8000));
    const probe = await vm.exec({
      command: `if test -f ${donePath}; then echo DONE; else systemctl show ${unit} -p LoadState -p ActiveState -p Result --no-pager; journalctl -u ${unit} --no-pager -n 3 -o cat; fi`,
      linuxUser: 'root',
      timeoutMs: 30000,
    });
    const out = `${probe.stdout ?? ''}${probe.stderr ?? ''}`;
    if (out.includes('DONE')) return;
    // A unit that exited non-zero failed; one that is gone without its marker failed too.
    if (/Result=(oom-kill|exit-code|signal|timeout)/.test(out) || (out.includes('LoadState=not-found') && !out.includes('ActiveState=active'))) {
      throw new Error(`${unit} failed:\n${out}`);
    }
    const last = out.trim().split('\n').pop() ?? '';
    if (last !== lastLog) console.log(`  ${name}: ${last.slice(0, 110)}`);
    lastLog = last;
  }
  throw new Error(`${unit} did not finish within ${maxMinutes} minutes`);
}

const waitX = `ExecStartPre=/bin/bash -lc 'for i in {1..30}; do xdpyinfo >/dev/null 2>&1 && exit 0; sleep 1; done; exit 1'`;
const units: Record<string, string> = {
  'xvfb.service': ['[Unit]', 'Description=Virtual X display', '[Service]', 'ExecStart=/usr/bin/Xvfb :0 -screen 0 1440x900x24 -nolisten tcp', 'Restart=always', '[Install]', 'WantedBy=multi-user.target', ''].join('\n'),
  'openbox.service': ['[Unit]', 'Description=Openbox', 'After=xvfb.service', 'Requires=xvfb.service', '[Service]', 'Environment=DISPLAY=:0', 'Environment=HOME=/root', waitX, 'ExecStart=/usr/bin/openbox', 'Restart=always', '[Install]', 'WantedBy=multi-user.target', ''].join('\n'),
  // View-only and password-protected: watching is fine, taking over is not.
  'x11vnc.service': ['[Unit]', 'Description=VNC (view only)', 'After=xvfb.service', 'Requires=xvfb.service', '[Service]', 'ExecStart=/usr/bin/x11vnc -display :0 -forever -shared -viewonly -rfbauth /root/.vnc/passwd -localhost -rfbport 5900', 'Restart=always', '[Install]', 'WantedBy=multi-user.target', ''].join('\n'),
  'novnc.service': ['[Unit]', 'Description=noVNC', 'After=x11vnc.service', 'Requires=x11vnc.service', '[Service]', 'ExecStart=/usr/bin/websockify --web /usr/share/novnc 6080 localhost:5900', 'Restart=always', '[Install]', 'WantedBy=multi-user.target', ''].join('\n'),
  'chromium-headed.service': [
    '[Unit]', 'Description=Chrome on the virtual display', 'After=xvfb.service openbox.service', 'Requires=xvfb.service', '[Service]', 'Environment=DISPLAY=:0', 'Environment=HOME=/root', waitX,
    `ExecStartPre=/bin/bash -lc 'mkdir -p /root/.config/chrome-headed; rm -f /root/.config/chrome-headed/Singleton*'`,
    'ExecStart=/usr/bin/google-chrome --no-sandbox --no-first-run --no-default-browser-check --disable-dev-shm-usage --remote-debugging-address=127.0.0.1 --remote-debugging-port=9222 --remote-allow-origins=* --user-data-dir=/root/.config/chrome-headed --window-size=1440,900 --window-position=0,0 https://example.com',
    'Restart=always', '[Install]', 'WantedBy=multi-user.target', '',
  ].join('\n'),
};

// CDP behind nginx: rewrites the Host header Chrome insists on, and refuses requests without the token.
const nginxCdp = `server {
  listen 9333;
  location / {
    if ($arg_token != "${TOKEN}") { return 403; }
    proxy_pass http://127.0.0.1:9222;
    proxy_http_version 1.1;
    proxy_set_header Host 127.0.0.1:9222;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_read_timeout 3600s;
    proxy_send_timeout 3600s;
    proxy_buffering off;
  }
}
`;

async function publish(vmId: string, label: string, port: number) {
  const domain = `mcl-${label}-${rand()}.style.dev`;
  await freestyle.tls.rules.create({ action: 'allow', domain, source: { public: true }, destination: { vmId, port } });
  return domain;
}

async function waitFor(url: string, ms: number) {
  const until = Date.now() + ms;
  let last = '';
  while (Date.now() < until) {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(4000) });
      if (r.ok) return r;
      last = `HTTP ${r.status}`;
    } catch (e) {
      last = (e as Error).message;
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error(`Timed out waiting for ${url.replace(TOKEN, '<token>')} (${last})`);
}

async function driveOverCdp(cdpDomain: string, shotPath: string) {
  const s = Date.now();
  const version = (await (await waitFor(`https://${cdpDomain}/json/version?token=${TOKEN}`, 90000)).json()) as { webSocketDebuggerUrl: string };
  const ws = `${version.webSocketDebuggerUrl.replace('ws://127.0.0.1:9222', `wss://${cdpDomain}`)}?token=${TOKEN}`;
  const browser = await chromium.connectOverCDP(ws);
  const context = browser.contexts()[0];
  const page = context.pages()[0] ?? (await context.newPage());
  await page.goto('https://example.com', { waitUntil: 'domcontentloaded' });
  await page.screenshot({ path: shotPath });
  const title = await page.title();
  await browser.close();
  return { ms: Date.now() - s, title };
}

const vncUrl = (domain: string) => `https://${domain}/vnc.html?autoconnect=true&reconnect=true&resize=scale&view_only=true&path=websockify&password=${VNC_PASSWORD}`;
const result: Record<string, unknown> = { startedAt: new Date().toISOString() };
const cleanup: Array<() => Promise<unknown>> = [];

try {
  let s = Date.now();
  const { vm: builder, vmId: builderId } = await freestyle.vms.create({ firewall, slug: `mcl-spike-${rand()}`, idleTimeoutSeconds: null, ttlSeconds: 3600 });
  cleanup.push(() => builder.delete());
  mark('create builder VM', s);
  result.builderSpecs = await builder.data().catch(() => null);

  s = Date.now();
  // Ubuntu's chromium package is only a snap stub, so install Google Chrome's own package.
  await runSetup(
    builder,
    'browser',
    [
      'apt-get update -qq',
      'apt-get install -y -qq --no-install-recommends ca-certificates curl wget fonts-liberation xvfb openbox x11vnc novnc websockify xauth x11-utils dbus-x11 nginx',
      'wget -q -O /tmp/chrome.deb https://dl.google.com/linux/direct/google-chrome-stable_current_amd64.deb',
      'apt-get install -y -qq /tmp/chrome.deb',
      'google-chrome --version',
    ].join('\n'),
  );
  mark('install Chrome + display stack', s);

  s = Date.now();
  for (const [name, body] of Object.entries(units)) await writeRoot(builder, `/etc/systemd/system/${name}`, body);
  await root(builder, `mkdir -p /root/.vnc && x11vnc -storepasswd ${VNC_PASSWORD} /root/.vnc/passwd`);
  await root(builder, 'rm -f /etc/nginx/sites-enabled/default');
  await writeRoot(builder, '/etc/nginx/sites-available/chromium-cdp', nginxCdp);
  await root(builder, 'ln -sf /etc/nginx/sites-available/chromium-cdp /etc/nginx/sites-enabled/chromium-cdp && nginx -t');
  await root(builder, 'systemctl daemon-reload && systemctl enable --now xvfb openbox chromium-headed x11vnc novnc nginx && systemctl reload nginx', 120000);
  const ready = await builder.exec({
    linuxUser: 'root',
    command: `for i in $(seq 1 45); do curl -fsS http://127.0.0.1:6080/vnc.html >/dev/null && curl -fsS "http://127.0.0.1:9333/json/version?token=${TOKEN}" >/dev/null && exit 0; sleep 1; done; journalctl -u chromium-headed -u novnc -u nginx --no-pager -n 60; exit 1`,
    timeoutMs: 120000,
  });
  if (ready.statusCode !== 0) throw new Error(`Services did not come up:\n${ready.stdout}\n${ready.stderr}`);
  mark('start services', s);

  s = Date.now();
  const vncDomain = await publish(builderId, 'vnc', 6080);
  const cdpDomain = await publish(builderId, 'cdp', 9333);
  mark('publish domains', s);
  result.cdpWithoutToken = await waitFor(`https://${vncDomain}/vnc.html`, 60000)
    .then(() => fetch(`https://${cdpDomain}/json/version`))
    .then((r) => r.status)
    .catch((e) => String(e));

  const drive = await driveOverCdp(cdpDomain, 'vm-spike-builder.png');
  timings['drive Chrome over CDP from this PC'] = drive.ms;
  console.log(`CDP from this PC: page "${drive.title}" in ${(drive.ms / 1000).toFixed(1)} s (without token: HTTP ${result.cdpWithoutToken})`);
  result.builder = { vmId: builderId, vncUrl: vncUrl(vncDomain) };

  // Snapshot: allowed on this plan?
  s = Date.now();
  let snapshotId: string | null = null;
  try {
    snapshotId = (await builder.snapshot()).snapshotId;
    mark('snapshot', s);
    result.snapshot = { ok: true, snapshotId };
  } catch (e) {
    result.snapshot = { ok: false, error: (e as Error).message };
    console.log(`Snapshot refused: ${(e as Error).message}`);
  }

  if (snapshotId) {
    s = Date.now();
    const { vm: clone, vmId: cloneId } = await freestyle.vms.create({ firewall, snapshotId, idleTimeoutSeconds: 600, ttlSeconds: 3600 });
    cleanup.push(() => clone.delete());
    mark('boot VM from snapshot', s);
    const cdp2 = await publish(cloneId, 'cdp', 9333);
    const vnc2 = await publish(cloneId, 'vnc', 6080);
    const s2 = Date.now();
    const d2 = await driveOverCdp(cdp2, 'vm-spike-clone.png');
    mark('clone: Chrome reachable and driven', s2);
    result.clone = { vmId: cloneId, title: d2.title, vncUrl: vncUrl(vnc2) };
  }
  result.ok = true;
} catch (e) {
  result.ok = false;
  result.error = (e as Error).stack ?? String(e);
  console.error('SPIKE FAILED:', (e as Error).message);
} finally {
  result.timings = timings;
  result.totalMs = Date.now() - t0;
  result.kept = keep;
  writeFileSync('vm-spike.json', JSON.stringify(result, null, 2));
  if (!keep) for (const c of cleanup.reverse()) await c().catch(() => undefined);
  console.log(keep ? 'VMs kept running (they delete themselves within an hour).' : 'VMs deleted.');
  console.log('Results: vm-spike.json');
}
