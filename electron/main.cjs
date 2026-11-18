const { app, BrowserWindow, shell } = require('electron');
const path = require('node:path');

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
  else win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
}

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
