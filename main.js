const { app, BrowserWindow, ipcMain, dialog, shell, session, powerSaveBlocker } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { collectSystemInfo, listUsb, gpuTemps } = require('./src/main/system');
const bench = require('./src/main/bench');
const { runPS } = require('./src/main/ps');
const { listBusyApps, closeApp } = require('./src/main/apps');

// Laptops with two GPUs: make sure the graphics test runs on the real one.
app.commandLine.appendSwitch('force_high_performance_gpu');

let win;

function createWindow() {
  win = new BrowserWindow({
    width: 1200,
    height: 820,
    minWidth: 920,
    minHeight: 640,
    backgroundColor: '#17120f',
    title: 'Is It Cooked?',
    icon: path.join(__dirname, 'src', 'renderer', 'assets', 'icon.png'),
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false,
    },
  });
  win.loadFile(path.join(__dirname, 'src', 'renderer', 'index.html'));
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (e) => e.preventDefault());
}

app.whenReady().then(() => {
  // Camera + microphone are only used by the hands-on tests, nothing else is allowed.
  session.defaultSession.setPermissionRequestHandler((_wc, permission, cb) => cb(permission === 'media'));
  session.defaultSession.setPermissionCheckHandler((_wc, permission) => permission === 'media');
  createWindow();
});

app.on('window-all-closed', () => {
  bench.cancelAll();
  app.quit();
});

const send = (channel, data) => {
  if (win && !win.isDestroyed()) win.webContents.send(channel, data);
};

// Both scans spawn PowerShell heavily; running them at the same time makes each crawl, so they queue.
let scanQueue = Promise.resolve();
const queued = (fn) => (scanQueue = scanQueue.catch(() => {}).then(fn));

ipcMain.handle('sys:info', () => queued(collectSystemInfo));
ipcMain.handle('sys:usb', () => listUsb());
ipcMain.handle('sys:gpuTemps', () => gpuTemps());
// Our own Electron processes are never offered for closing.
ipcMain.handle('apps:list', () => queued(() => listBusyApps(app.getAppMetrics().map((m) => m.pid))));
ipcMain.handle('apps:close', (_e, id, force) => closeApp(String(id), !!force));

// Keep the PC (and screen) awake while it cooks.
let blocker = null;
ipcMain.handle('bench:start', () => {
  bench.resetCancel();
  if (blocker == null) blocker = powerSaveBlocker.start('prevent-display-sleep');
});
ipcMain.handle('bench:end', () => {
  if (blocker != null) powerSaveBlocker.stop(blocker);
  blocker = null;
});
ipcMain.handle('bench:cancel', () => bench.cancelAll());
ipcMain.handle('bench:cpu', () => bench.cpuBench((p) => send('bench:progress', { test: 'cpu', ...p })));
ipcMain.handle('bench:ram', (_e, quick) => bench.ramTest(quick, (pct) => send('bench:progress', { test: 'ram', pct })));
ipcMain.handle('bench:disk', (_e, quick, isAdmin) => bench.diskTest(quick, isAdmin, (pct) => send('bench:progress', { test: 'disk', pct })));
ipcMain.handle('bench:stress', (_e, seconds, isAdmin) => bench.stressTest(seconds, isAdmin, (s) => send('bench:stress', s)));

ipcMain.handle('win:fullscreen', (_e, on) => {
  win?.setFullScreen(!!on);
  return win?.isFullScreen();
});

// Only Windows settings pages can be opened from the app (e.g. "fix your refresh rate").
ipcMain.handle('app:openSettings', (_e, uri) => {
  if (typeof uri === 'string' && /^ms-settings:[a-z-]+$/i.test(uri)) shell.openExternal(uri);
});

ipcMain.handle('app:restartAdmin', async () => {
  const target = process.env.PORTABLE_EXECUTABLE_FILE || process.execPath;
  const args = app.isPackaged ? '' : `-ArgumentList '"${app.getAppPath().replace(/'/g, "''")}"'`;
  const out = await runPS(`try { Start-Process -FilePath '${target.replace(/'/g, "''")}' ${args} -Verb RunAs -ErrorAction Stop; 'ok' } catch { 'no' }`);
  if (out.includes('ok')) {
    bench.cancelAll();
    app.quit();
    return true;
  }
  return false;
});

ipcMain.handle('report:save', async (_e, html, suggestedName) => {
  const { canceled, filePath } = await dialog.showSaveDialog(win, {
    title: 'Save your Is It Cooked? report',
    defaultPath: path.join(app.getPath('documents'), suggestedName || 'is-it-cooked-report.html'),
    filters: [{ name: 'Web page', extensions: ['html'] }],
  });
  if (canceled || !filePath) return null;
  fs.writeFileSync(filePath, html, 'utf8');
  shell.openPath(filePath);
  return filePath;
});
