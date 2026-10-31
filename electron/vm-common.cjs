// Shared pieces for Freestyle VMs: the image's services, setup helpers and publishing ports.
// Used by scripts/vm-build-image.ts (build once) and electron/vms.cjs (start test VMs).
// Freestyle's default image is Ubuntu 24.04 (4 vCPU / 8 GiB); commands run as a non-root user
// unless `linuxUser: 'root'` is passed, so every setup command here runs as root.

const { randomBytes } = require('node:crypto');
const { loadEnv } = require('./env.cjs');

/** The SDK is an ES module; load it on demand from this CommonJS file. */
async function freestyleClient(env = loadEnv()) {
  const key = env.FREESTYLE_API_KEY || process.env.FREESTYLE_API_KEY;
  if (!key) throw new Error('FREESTYLE_API_KEY is missing from .env.local.');
  const { Freestyle } = await import('freestyle');
  return new Freestyle({ apiKey: key });
}

/** Outbound internet for the VM; nothing inbound except the domains we publish. */
const FIREWALL = { rules: [{ action: 'allow', source: {}, destination: { public: true } }] };

const rand = (n = 6) => randomBytes(n).toString('hex');

async function root(vm, command, timeoutMs = 60000) {
  const r = await vm.exec({ command, linuxUser: 'root', timeoutMs });
  if (r.statusCode !== 0) throw new Error(`Command failed (${r.statusCode}): ${command.slice(0, 140)}\n${r.stdout || ''}\n${r.stderr || ''}`);
  return r;
}

async function writeRoot(vm, path, content) {
  const r = await vm.exec({ command: `mkdir -p "$(dirname ${path})" && cat > ${path}`, linuxUser: 'root', stdin: Buffer.from(content).toString('base64'), timeoutMs: 30000 });
  if (r.statusCode !== 0) throw new Error(`Could not write ${path}: ${r.stderr || ''}`);
}

/** Long installs run as a transient systemd unit, polled until a done-marker appears. */
async function runSetup(vm, name, script, { maxMinutes = 20, log = () => {} } = {}) {
  const scriptPath = `/root/setup-${name}.sh`;
  const donePath = `/root/setup-${name}.done`;
  const unit = `setup-${name}`;
  await writeRoot(vm, scriptPath, ['#!/bin/sh', 'set -eux', 'export DEBIAN_FRONTEND=noninteractive', script, `touch ${donePath}`, ''].join('\n'));
  await root(vm, `chmod +x ${scriptPath} && rm -f ${donePath} && systemd-run --unit=${unit} --collect ${scriptPath}`);
  const until = Date.now() + maxMinutes * 60000;
  let last = '';
  while (Date.now() < until) {
    await new Promise((r) => setTimeout(r, 8000));
    const probe = await vm.exec({
      command: `if test -f ${donePath}; then echo DONE; else systemctl show ${unit} -p LoadState -p ActiveState -p Result --no-pager; journalctl -u ${unit} --no-pager -n 3 -o cat; fi`,
      linuxUser: 'root',
      timeoutMs: 30000,
    });
    const out = `${probe.stdout || ''}${probe.stderr || ''}`;
    if (out.includes('DONE')) return;
    if (/Result=(oom-kill|exit-code|signal|timeout)/.test(out) || (out.includes('LoadState=not-found') && !out.includes('ActiveState=active'))) {
      throw new Error(`${unit} failed:\n${out}`);
    }
    const line = out.trim().split('\n').pop() || '';
    if (line !== last) log(`  ${name}: ${line.slice(0, 110)}`);
    last = line;
  }
  throw new Error(`${unit} did not finish within ${maxMinutes} minutes`);
}

const unit = (lines) => [...lines, ''].join('\n');
const WAIT_X = `ExecStartPre=/bin/bash -lc 'for i in {1..30}; do xdpyinfo >/dev/null 2>&1 && exit 0; sleep 1; done; exit 1'`;

/** systemd units for the headed browser, the view-only screen and the protected CDP port. */
function serviceFiles({ cdpToken, startUrl }) {
  return {
    '/etc/systemd/system/xvfb.service': unit(['[Unit]', 'Description=Virtual X display', '[Service]', 'ExecStart=/usr/bin/Xvfb :0 -screen 0 1440x900x24 -nolisten tcp', 'Restart=always', '[Install]', 'WantedBy=multi-user.target']),
    '/etc/systemd/system/openbox.service': unit(['[Unit]', 'Description=Openbox', 'After=xvfb.service', 'Requires=xvfb.service', '[Service]', 'Environment=DISPLAY=:0', 'Environment=HOME=/root', WAIT_X, 'ExecStart=/usr/bin/openbox', 'Restart=always', '[Install]', 'WantedBy=multi-user.target']),
    '/etc/systemd/system/x11vnc.service': unit(['[Unit]', 'Description=VNC (view only)', 'After=xvfb.service', 'Requires=xvfb.service', '[Service]', 'ExecStart=/usr/bin/x11vnc -display :0 -forever -shared -viewonly -rfbauth /root/.vnc/passwd -localhost -rfbport 5900', 'Restart=always', '[Install]', 'WantedBy=multi-user.target']),
    '/etc/systemd/system/novnc.service': unit(['[Unit]', 'Description=noVNC', 'After=x11vnc.service', 'Requires=x11vnc.service', '[Service]', 'ExecStart=/usr/bin/websockify --web /usr/share/novnc 6080 localhost:5900', 'Restart=always', '[Install]', 'WantedBy=multi-user.target']),
    '/etc/systemd/system/chrome-headed.service': unit([
      '[Unit]', 'Description=Chrome on the virtual display', 'After=xvfb.service openbox.service odoo.service', 'Requires=xvfb.service', '[Service]', 'Environment=DISPLAY=:0', 'Environment=HOME=/root', WAIT_X,
      `ExecStartPre=/bin/bash -lc 'mkdir -p /root/.config/chrome-headed; rm -f /root/.config/chrome-headed/Singleton*'`,
      `ExecStart=/usr/bin/google-chrome --no-sandbox --test-type --no-first-run --no-default-browser-check --disable-dev-shm-usage --disable-session-crashed-bubble --remote-debugging-address=127.0.0.1 --remote-debugging-port=9222 --remote-allow-origins=* --user-data-dir=/root/.config/chrome-headed --window-size=1440,900 --window-position=0,0 ${startUrl}`,
      'Restart=always', '[Install]', 'WantedBy=multi-user.target',
    ]),
    // nginx rewrites the Host header Chrome insists on, and refuses CDP requests without the token.
    '/etc/nginx/sites-available/chrome-cdp': `server {
  listen 9333;
  location / {
    if ($arg_token != "${cdpToken}") { return 403; }
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
`,
  };
}

/** Publishes a VM port on a random, unguessable style.dev subdomain. */
async function publish(freestyle, vmId, label, port) {
  const domain = `mcl-${label}-${rand(8)}.style.dev`;
  await freestyle.tls.rules.create({ action: 'allow', domain, source: { public: true }, destination: { vmId, port } });
  return domain;
}

async function waitForUrl(url, ms, isReady = (r) => r.ok) {
  const until = Date.now() + ms;
  let last = '';
  while (Date.now() < until) {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(5000) });
      if (isReady(r)) return r;
      last = `HTTP ${r.status}`;
    } catch (e) {
      last = e.message;
    }
    await new Promise((r) => setTimeout(r, 800));
  }
  throw new Error(`Timed out waiting for ${url.replace(/token=[^&]+/, 'token=…')} (${last})`);
}

/** The websocket URL for Playwright's connectOverCDP, through the published, token-protected port. */
async function cdpWebSocket(cdpDomain, token, ms = 90000) {
  const r = await waitForUrl(`https://${cdpDomain}/json/version?token=${token}`, ms);
  const { webSocketDebuggerUrl } = await r.json();
  return `${webSocketDebuggerUrl.replace('ws://127.0.0.1:9222', `wss://${cdpDomain}`)}?token=${token}`;
}

/** Hides noVNC's own status bar, so the app shows only the VM's screen. Safe to run more than once. */
const HIDE_VNC_BAR = `grep -q mcl-hide-bar /usr/share/novnc/vnc_lite.html || sed -i 's|</head>|<style id="mcl-hide-bar">#top_bar{display:none !important}</style></head>|' /usr/share/novnc/vnc_lite.html`;

const vncUrl = (domain, password) => `https://${domain}/vnc_lite.html?scale=true&path=websockify&password=${encodeURIComponent(password)}`;

module.exports = { freestyleClient, FIREWALL, rand, root, writeRoot, runSetup, serviceFiles, publish, waitForUrl, cdpWebSocket, vncUrl, HIDE_VNC_BAR };
