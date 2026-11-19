const { app, BrowserWindow, shell, protocol, net } = require('electron');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

// The built app is served from app://bundle/ rather than file://, so the page has a secure origin
// that may call the local bot gateway (http://127.0.0.1:7878) and run module workers.
protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } },
]);
const DIST = path.join(__dirname, '..', 'dist');

// Smoke tests can point the app at a throwaway profile so they never touch the user's saved table.
if (process.env.ELECTRON_USER_DATA) app.setPath('userData', process.env.ELECTRON_USER_DATA);

function createWindow() {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 680,
    backgroundColor: '#1d3b2a',
    title: 'Poker Table',
    titleBarStyle: 'hiddenInset',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  // A crashed or killed renderer leaves only the green window background. Log why and reload.
  let lastRecovery = -Infinity;
  win.webContents.on('render-process-gone', (_e, details) => {
    console.error(`renderer gone: ${details.reason} (exit ${details.exitCode})`);
    if (details.reason === 'clean-exit' || process.env.ELECTRON_SMOKE_SHOT) return;
    const now = Date.now();
    if (now - lastRecovery < 30_000) return;
    lastRecovery = now;
    setTimeout(() => {
      if (!win.isDestroyed()) win.reload();
    }, 500);
  });
  win.webContents.on('unresponsive', () => console.error('renderer unresponsive'));
  win.webContents.on('console-message', ({ level, message }) => {
    if ((level === 'warning' || level === 'error') && process.env.ELECTRON_SMOKE_SHOT) console.error(`console: ${message}`);
  });

  // Open external links in the default browser, never inside the app.
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  // Smoke test: `ELECTRON_SMOKE_SHOT=/tmp/x.png electron .` renders, captures the window and quits.
  // Optional: ELECTRON_SMOKE_JS runs a script in the page first (it may return a promise),
  // and ELECTRON_SMOKE_WAIT sets the delay before capturing (ms, default 1500).
  const shot = process.env.ELECTRON_SMOKE_SHOT;
  if (shot) {
    win.webContents.once('did-finish-load', () =>
      setTimeout(async () => {
        const js = process.env.ELECTRON_SMOKE_JS;
        if (js) {
          const out = await win.webContents.executeJavaScript(js).catch((e) => `error: ${e}`);
          if (out !== undefined) console.log('smoke:', out);
        }
        const img = await win.webContents.capturePage();
        require('node:fs').writeFileSync(shot, img.toPNG());
        app.quit();
      }, Number(process.env.ELECTRON_SMOKE_WAIT) || 1500),
    );
  }

  const devUrl = process.env.VITE_DEV_SERVER_URL;
  if (devUrl) win.loadURL(devUrl);
  else win.loadURL('app://bundle/index.html');
}

app.whenReady().then(() => {
  protocol.handle('app', (req) => {
    const rel = decodeURIComponent(new URL(req.url).pathname);
    const file = path.normalize(path.join(DIST, rel));
    if (!file.startsWith(DIST)) return new Response('forbidden', { status: 403 });
    return net.fetch(pathToFileURL(file).toString());
  });
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
