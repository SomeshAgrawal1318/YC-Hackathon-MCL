// MonteCarlo Labs demo shell.
// - Main window: the MCL app (recordings, workflows, tests, reports, deploy).
// - Two "customer" windows: Mailbox and NorthStar ERP (mock apps the chore happens in).
// - A system tray icon standing in for Trace: Start / Stop recording.
// All windows talk over one message bus relayed through this process.

const { app, BrowserWindow, Tray, Menu, nativeImage, ipcMain, protocol, net, screen } = require('electron');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const isDev = process.argv.includes('--dev');
const DEV_URL = 'http://localhost:5173';
const DIST = path.join(__dirname, '..', 'dist');
const ASSETS = path.join(__dirname, '..', 'assets');

protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true } },
]);

if (!app.requestSingleInstanceLock()) app.quit();

let mainWin = null;
let mailWin = null;
let erpWin = null;
let tray = null;
let recording = false;
let quitting = false;

const urlFor = (route) => (isDev ? `${DEV_URL}/` : 'app://mcl/index.html') + `#/${route}`;
const image = (name) => nativeImage.createFromPath(path.join(ASSETS, name));

function webPrefs() {
  return { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false };
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
    backgroundColor: '#EDF0F3',
    icon: image('icon.png'),
    autoHideMenuBar: true,
    webPreferences: webPrefs(),
  });
  mainWin.loadURL(urlFor(''));
  // Closing the main window hides it, like a tray app. Quit from the tray menu.
  mainWin.on('close', (e) => {
    if (!quitting) {
      e.preventDefault();
      mainWin.hide();
    }
  });
}

function createMockWindow(route, title, bounds) {
  const win = new BrowserWindow({
    ...bounds,
    title,
    backgroundColor: '#FFFFFF',
    autoHideMenuBar: true,
    icon: image(route === 'mail' ? 'mail.png' : 'erp.png'),
    webPreferences: webPrefs(),
  });
  win.loadURL(urlFor(route));
  return win;
}

function openMockApps() {
  const area = screen.getPrimaryDisplay().workArea;
  const half = Math.floor(area.width / 2);
  if (!mailWin || mailWin.isDestroyed()) {
    mailWin = createMockWindow('mail', 'Mailbox', { x: area.x, y: area.y, width: half, height: area.height });
  } else mailWin.show();
  if (!erpWin || erpWin.isDestroyed()) {
    erpWin = createMockWindow('erp', 'NorthStar ERP', { x: area.x + half, y: area.y, width: area.width - half, height: area.height });
  } else erpWin.show();
}

function trayMenu() {
  return Menu.buildFromTemplate([
    {
      label: recording ? 'Stop recording' : 'Start recording',
      click: () => {
        broadcast('trace:command', { cmd: recording ? 'stop' : 'start' });
        if (recording) setTimeout(showMain, 150);
      },
    },
    { type: 'separator' },
    { label: 'Open MonteCarlo Labs', click: showMain },
    { label: 'Open Mailbox and ERP', click: openMockApps },
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

ipcMain.on('bus', (event, msg) => {
  // Relay to every other window.
  for (const win of BrowserWindow.getAllWindows()) {
    if (win.isDestroyed() || win.webContents === event.sender) continue;
    win.webContents.send('bus', msg);
  }
  if (msg.channel === 'trace:state') {
    recording = !!(msg.data && msg.data.recording);
    updateTray();
  }
  if (msg.channel === 'shell:show-main') showMain();
  if (msg.channel === 'shell:open-mock-apps') openMockApps();
});

app.on('second-instance', showMain);

app.whenReady().then(() => {
  protocol.handle('app', (request) => {
    const { pathname } = new URL(request.url);
    const file = path.join(DIST, decodeURIComponent(pathname));
    if (!file.startsWith(DIST)) return new Response('Not found', { status: 404 });
    return net.fetch(pathToFileURL(file).toString());
  });
  createMain();
  createTray();
});

app.on('before-quit', () => { quitting = true; });
app.on('window-all-closed', () => { /* keep running in the tray */ });
