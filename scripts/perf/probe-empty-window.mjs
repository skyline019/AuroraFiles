import { app, BrowserWindow } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const t0 = Date.now();
const mark = (n) => console.error('PROBE', n, Date.now()-t0);
app.whenReady().then(() => {
  mark('ready');
  const w = new BrowserWindow({ show: false, width: 800, height: 600, webPreferences: { sandbox: false } });
  mark('window');
  w.once('ready-to-show', () => { mark('ready-to-show'); w.show(); setTimeout(() => app.quit(), 300); });
  w.webContents.once('did-finish-load', () => mark('did-finish-load'));
  const html = path.join(process.resourcesPath, 'app.asar', 'dist', 'probe.html');
  // packaged: resourcesPath/app.asar/...
  const candidates = [
    path.join(process.resourcesPath, 'app.asar', 'dist', 'probe.html'),
    path.join(__dirname, 'dist', 'probe.html'),
  ];
  // For packaged exe, main is inside asar; use loadFile relative
  w.loadFile(path.join(__dirname, '../dist/probe.html'));
  mark('loadFile-called');
});
