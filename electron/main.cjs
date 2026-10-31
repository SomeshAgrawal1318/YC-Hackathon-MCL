// MonteCarlo Labs demo shell.
// - Main window: the MCL app (recordings, workflows, tests, reports, deploy).
// - Trace: a tray icon plus trace-helper.exe, which records input events and the UI Automation
//   element behind each one, across Windows. Events from Gmail and Odoo are forwarded to the app.
// - The demo Chrome (Gmail left, Odoo right), which the user does the chore in and the workflow
//   runner drives during tests (see hands.cjs).
// All windows talk over one message bus relayed through this process.

const { app, BrowserWindow, Tray, Menu, nativeImage, ipcMain, protocol, net, screen, session, desktopCapturer, shell } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const readline = require('node:readline');
const { spawn } = require('node:child_process');
const { pathToFileURL } = require('node:url');
const { loadEnv, ROOT } = require('./env.cjs');
const { ensureOdoo, stopKeepAlive } = require('./odoo.cjs');
const { openDemoApps, openUrl, isGmail, isOdoo } = require('./chrome.cjs');
const { createHands } = require('./hands.cjs');
const { createKnowledge } = require('./knowledge.cjs');
const { createActors } = require('./actors.cjs');
const vms = require('./vms.cjs');

const isDev = process.argv.includes('--dev');
const DEV_URL = 'http://localhost:5173';
const DIST = path.join(__dirname, '..', 'dist');
const ASSETS = path.join(__dirname, '..', 'assets');
const env = loadEnv();

protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } },
]);

if (!app.requestSingleInstanceLock()) app.quit();

let mainWin = null;
let mailWin = null;
let erpWin = null;
let tray = null;
let recording = false;
let executing = false;
let quitting = false;

const urlFor = (route) => (isDev ? `${DEV_URL}/` : 'app://mcl/index.html') + `#/${route}`;
const image = (name) => nativeImage.createFromPath(path.join(ASSETS, name));

function webPrefs(extra = {}) {
  return { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, ...extra };
}

function broadcast(channel, data, except) {
  const msg = { channel, data, from: 'main' };
  for (const win of BrowserWindow.getAllWindows()) {
    if (win.isDestroyed() || win.webContents === except) continue;
    win.webContents.send('bus', msg);
  }
}

function showMain() {
  if (!mainWin || mainWin.isDestroyed()) createMain();
  if (mainWin.isMinimized()) mainWin.restore();
  mainWin.show();
  mainWin.focus();
}

function createMain() {
  mainWin = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1100,
    minHeight: 720,
    title: 'MonteCarlo Labs',
    // Windows 11 acrylic: the desktop blurs through the app's glass (the page background is transparent).
    backgroundColor: '#00000000',
    backgroundMaterial: process.platform === 'win32' ? 'acrylic' : undefined,
    icon: image('icon.png'),
    autoHideMenuBar: true,
    // It records the screen while hidden, so it must not be throttled.
    webPreferences: webPrefs({ backgroundThrottling: false }),
  });
  mainWin.loadURL(urlFor(''));
  mainWin.on('close', (e) => {
    if (!quitting) {
      e.preventDefault();
      mainWin.hide();
    }
  });
}

// ---------- The real apps (demo Chrome) ----------

const workArea = () => screen.getPrimaryDisplay().workArea;

async function openRealApps() {
  try {
    if (!(await ensureOdoo({ env }))) throw new Error('Odoo did not start. Run "npm run odoo:start" and check the output.');
    await openDemoApps(env, workArea());
  } catch (e) {
    broadcast('shell:error', { message: e.message });
  }
}

// ---------- Mock apps (stage fallback only, from the presenter controls) ----------

function createMockWindow(route, title, bounds) {
  const win = new BrowserWindow({
    ...bounds,
    title,
    backgroundColor: '#FFFFFF',
    autoHideMenuBar: true,
    icon: image(route === 'mail' ? 'mail.png' : route === 'erp' ? 'erp.png' : 'icon.png'),
    webPreferences: webPrefs(),
  });
  win.loadURL(urlFor(route));
  return win;
}

function openMockApps() {
  const area = workArea();
  const half = Math.floor(area.width / 2);
  if (!mailWin || mailWin.isDestroyed()) mailWin = createMockWindow('mail', 'Mailbox', { x: area.x, y: area.y, width: half, height: area.height });
  else mailWin.show();
  if (!erpWin || erpWin.isDestroyed()) erpWin = createMockWindow('erp', 'NorthStar ERP', { x: area.x + half, y: area.y, width: area.width - half, height: area.height });
  else erpWin.show();
}

// ---------- Dana's approvals (the buyer's view of the ApprovalDesk actor) ----------

let danaWin = null;
function openDana() {
  if (danaWin && !danaWin.isDestroyed()) {
    danaWin.show();
    danaWin.focus();
    return;
  }
  const area = workArea();
  const width = 460;
  danaWin = createMockWindow('dana', 'Dana’s approvals', { x: area.x + area.width - width - 24, y: area.y + 24, width, height: Math.min(760, area.height - 48) });
}

// ---------- Trace helper (OS capture) ----------

let helper = null;
let capability = { os: false, reason: 'Starting Trace…' };
const selfExe = path.basename(process.execPath).toLowerCase();
/** Last app seen in each top-level window, learned from page URLs. */
const windowApp = new Map();

function helperPath() {
  return process.env.TRACE_HELPER || path.join(ROOT, 'native', 'trace-helper', 'target', 'release', 'trace-helper.exe');
}

function displayInfo() {
  const d = screen.getPrimaryDisplay();
  const sf = d.scaleFactor;
  return { x: Math.round(d.bounds.x * sf), y: Math.round(d.bounds.y * sf), width: Math.round(d.bounds.width * sf), height: Math.round(d.bounds.height * sf), scaleFactor: sf };
}

function setCapability(os, reason) {
  capability = { os, reason, display: displayInfo() };
  broadcast('trace:capability', capability);
  updateTray();
}

function syncHelper() {
  helperSend(recording && !executing ? 'start' : 'stop');
}

function helperSend(cmd) {
  if (helper && helper.stdin.writable) helper.stdin.write(`${cmd}\n`);
}

function startHelper() {
  if (process.platform !== 'win32') return setCapability(false, 'Trace capture needs Windows.');
  const exe = helperPath();
  if (!fs.existsSync(exe)) return setCapability(false, 'trace-helper.exe is not built yet. Run "npm run helper:build".');
  helper = spawn(exe, [], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
  readline.createInterface({ input: helper.stdout }).on('line', onHelperLine);
  helper.stderr.on('data', (d) => console.error('[trace-helper]', String(d).trim()));
  helper.on('error', (e) => setCapability(false, `Trace helper failed to start: ${e.message}`));
  helper.on('exit', (code) => {
    helper = null;
    if (!quitting) setCapability(false, `Trace helper stopped (exit code ${code}).`);
  });
}

function tagApp(ev) {
  if ((ev.process || '').toLowerCase() === selfExe) return null; // MCL itself, its tray menu
  const url = ev.url || (ev.element && ev.element.url);
  if (url) {
    const app = isGmail(url) ? 'mail' : isOdoo(env, url) ? 'erp' : 'other';
    windowApp.set(ev.hwnd, app);
    return app;
  }
  if (windowApp.has(ev.hwnd)) return windowApp.get(ev.hwnd);
  if ((ev.process || '').toLowerCase() === 'chrome.exe' && /gmail/i.test(ev.window || '')) return 'mail';
  return 'other';
}

function onHelperLine(line) {
  let msg;
  try {
    msg = JSON.parse(line);
  } catch {
    return;
  }
  if (msg.type === 'hello') return setCapability(true, 'Trace is capturing from Windows.');
  if (msg.type === 'error') {
    console.error('[trace-helper]', msg.message);
    return broadcast('trace:helper-error', msg);
  }
  if (msg.type !== 'event' || executing) return;
  const app = tagApp(msg);
  if (!app) return;
  broadcast('trace:raw', { ...msg, app });
}

// ---------- Tray (Trace) ----------

function trayMenu() {
  return Menu.buildFromTemplate([
    { label: capability.os ? (recording ? 'Trace: recording' : 'Trace: ready') : 'Trace: OS capture off', enabled: false },
    {
      label: recording ? 'Stop recording' : 'Start recording',
      click: () => {
        broadcast('trace:command', { cmd: recording ? 'stop' : 'start' });
        if (recording) setTimeout(showMain, 150);
      },
    },
    { type: 'separator' },
    { label: 'Open Gmail and Odoo', click: openRealApps },
    { label: 'Open Dana’s approvals', click: openDana },
    { label: 'Open MonteCarlo Labs', click: showMain },
    { type: 'separator' },
    { label: 'Quit', click: () => { quitting = true; app.quit(); } },
  ]);
}

function updateTray() {
  if (!tray) return;
  tray.setImage(image(recording ? 'tray-rec.png' : 'tray-idle.png').resize({ width: 16, height: 16 }));
  tray.setToolTip(recording ? 'Trace: recording' : 'Trace');
  tray.setContextMenu(trayMenu());
}

function createTray() {
  tray = new Tray(image('tray-idle.png').resize({ width: 16, height: 16 }));
  tray.on('click', () => tray.popUpContextMenu(trayMenu()));
  updateTray();
}

// ---------- Bus relay ----------

ipcMain.on('bus', (event, msg) => {
  for (const win of BrowserWindow.getAllWindows()) {
    if (win.isDestroyed() || win.webContents === event.sender) continue;
    win.webContents.send('bus', msg);
  }
  switch (msg.channel) {
    case 'trace:state':
      recording = !!(msg.data && msg.data.recording);
      syncHelper();
      updateTray();
      break;
    case 'trace:hello':
      broadcast('trace:capability', { ...capability, display: displayInfo() });
      break;
    case 'shell:show-main':
      showMain();
      break;
    case 'shell:open-mock-apps':
      openMockApps();
      break;
    case 'shell:open-real-apps':
      openRealApps();
      break;
    case 'shell:open-dana':
      openDana();
      break;
  }
});

// ---------- Workflow runs on this PC ----------

const hands = createHands(env, {
  area: workArea,
  onBusy: (busy) => {
    executing = busy;
    syncHelper();
    if (!busy) setTimeout(showMain, 300);
  },
});

// A runId means "the VM for that test"; without one, the hands drive the demo Chrome on this PC.
const vmHands = new Map();
ipcMain.handle('hands', async (_e, op, args, runId) => {
  if (!runId) return hands.exec(op, args);
  const h = vmHands.get(runId);
  if (!h) throw new Error('That test VM is no longer running.');
  return h.exec(op, args);
});

// ---------- Test VMs (Freestyle) ----------

ipcMain.handle('vm:status', async () => vms.vmStatus(loadEnv()));
ipcMain.handle('vm:start', async (_e, { runId, label }) => {
  const fresh = loadEnv(); // keys added to .env.local after launch count too
  const info = await vms.startTestVm(runId, label, { env: fresh });
  vmHands.set(runId, createHands(fresh, { area: workArea, target: { kind: 'vm', cdpWs: info.cdpWs, odooUrl: info.odooUrl, odoo: info.odoo } }));
  // The app only needs what it shows: the live screen and where the VM's Odoo is.
  return { runId, vmId: info.vmId, bootMs: info.bootMs, readyMs: info.readyMs, vncUrl: info.vncUrl, odooUrl: info.odooUrl };
});
ipcMain.handle('vm:release', async (_e, runIds) => {
  for (const id of runIds || []) {
    await vmHands.get(id)?.exec('finish').catch(() => undefined);
    vmHands.delete(id);
  }
  vms.releaseLater(runIds || []);
  return true;
});
ipcMain.handle('shell:open-url', async (_e, url) => {
  try {
    await openUrl(env, url);
  } catch {
    await shell.openExternal(url);
  }
});

/** desktopCapturer id of the primary screen, for the app's screen video. */
ipcMain.handle('trace:screen-source', async () => {
  const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 0, height: 0 } });
  const primary = String(screen.getPrimaryDisplay().id);
  const src = sources.find((s) => s.display_id === primary) || sources[0];
  return src ? src.id : null;
});

// ---------- Knowledge base ----------

let knowledge = null;
const kb = () => {
  if (!knowledge) knowledge = createKnowledge({ file: path.join(app.getPath('userData'), 'knowledge.json'), hands, broadcast });
  return knowledge;
};
ipcMain.handle('kb:get', async () => ({ kb: kb().get(), hasKey: kb().hasKey() }));
ipcMain.handle('kb:sync', async () => kb().sync());
ipcMain.handle('kb:ask', async (_e, question) => kb().ask(String(question || '')));
ipcMain.handle('kb:ingest-recording', async (_e, payload) => kb().ingestRecording(payload));
ipcMain.handle('kb:reset', async () => kb().reset());

// ---------- Durable Actors (shadow mode, buyer approvals) ----------

const actors = createActors({ broadcast });
ipcMain.handle('actors', async (_e, op, args) => actors.exec(op, args));

// ---------- Export a recording for experiments ----------

ipcMain.handle('trace:export', async (_e, { id, json, video }) => {
  const dir = path.join(app.getPath('userData'), 'exports', id);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'recording.json'), json);
  if (video) fs.writeFileSync(path.join(dir, 'video.webm'), Buffer.from(video));
  shell.showItemInFolder(path.join(dir, 'recording.json'));
  return dir;
});

app.on('second-instance', showMain);

app.whenReady().then(() => {
  protocol.handle('app', (request) => {
    const { pathname } = new URL(request.url);
    const file = path.join(DIST, decodeURIComponent(pathname));
    if (!file.startsWith(DIST)) return new Response('Not found', { status: 404 });
    return net.fetch(pathToFileURL(file).toString());
  });
  // Screen video for Trace: give the app the primary screen without a picker.
  session.defaultSession.setDisplayMediaRequestHandler((_request, callback) => {
    desktopCapturer.getSources({ types: ['screen'] }).then((sources) => {
      const primary = String(screen.getPrimaryDisplay().id);
      callback({ video: sources.find((s) => s.display_id === primary) || sources[0] });
    }).catch(() => callback({}));
  });
  createMain();
  createTray();
  startHelper();
  // Warm up Odoo in the background so it's ready when the chore starts.
  ensureOdoo({ env }).catch(() => undefined);
  // Start the actors server if needed and re-arm its alarms (the dev runtime keeps them in memory).
  actors.warmUp();
});

let vmsStopped = false;
app.on('before-quit', (e) => {
  // Delete any test VMs before leaving (Freestyle would also delete them after 40 minutes).
  if (!vmsStopped) {
    e.preventDefault();
    vmsStopped = true;
    Promise.race([vms.stopAll(), new Promise((r) => setTimeout(r, 8000))]).finally(() => app.quit());
    return;
  }
  quitting = true;
  helperSend('quit');
  stopKeepAlive();
});
app.on('window-all-closed', () => { /* keep running in the tray */ });
