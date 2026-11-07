import { app, BrowserWindow, ipcMain, shell, protocol, net } from 'electron';
import path from 'node:path';
import fssync from 'node:fs';
import { pathToFileURL, fileURLToPath } from 'node:url';
import * as fsSvc from './fs-service.mjs';
import { configureIndexDir } from './index/persist.mjs';
import { startupMark, getStartupMarks } from './startupMarks.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const isDev = !app.isPackaged;

startupMark('main_module_loaded');

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'aurora-file',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      stream: true,
      bypassCSP: true,
      corsEnabled: true,
    },
  },
]);

/** @type {BrowserWindow | null} */
let mainWindow = null;

function iconPath() {
  const ico = path.join(__dirname, 'build', 'icon.ico');
  const png = path.join(__dirname, 'build', 'icon.png');
  return fssync.existsSync(ico) ? ico : png;
}

function createWindow() {
  startupMark('create_window_begin');
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 960,
    minHeight: 640,
    show: false,
    backgroundColor: '#e3e9f4',
    title: 'Aurora Files',
    icon: iconPath(),
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      webSecurity: true,
      backgroundThrottling: false,
    },
  });

  let shown = false;
  const showOnce = (reason) => {
    if (shown || !mainWindow || mainWindow.isDestroyed()) return;
    shown = true;
    startupMark('ready-to-show');
    startupMark(`show_via_${reason}`);
    mainWindow.show();
    // Defer auto-updater off the critical path (network / electron-updater import)
    setTimeout(() => {
      void import('./updater.mjs')
        .then((u) => u.setupAutoUpdater({
          send: (channel, payload) => {
            if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, payload);
          },
        }))
        .catch(() => undefined);
    }, process.env.AURORA_STARTUP_BENCH === '1' ? 60_000 : 8_000);
  };

  // Paint splash ASAP — don't wait for the deferred React graph
  mainWindow.webContents.once('dom-ready', () => {
    startupMark('dom-ready');
    showOnce('dom-ready');
    // Inject app entry after first paint so module graph cannot delay splash
    if (!isDev && process.env.AURORA_STARTUP_HTML !== 'probe') {
      void mainWindow.webContents
        .executeJavaScript(
          `(() => { if (window.__auroraBoot) return; window.__auroraBoot = 1;
            const s = document.createElement('script');
            s.type = 'module'; s.src = './assets/entry.js';
            document.head.appendChild(s); })()`,
        )
        .catch(() => undefined);
    }
  });
  mainWindow.once('ready-to-show', () => showOnce('ready-to-show'));

  mainWindow.webContents.once('did-finish-load', () => {
    startupMark('did-finish-load');
  });

  if (isDev) {
    const url = process.env.VITE_DEV_SERVER_URL || 'http://127.0.0.1:5173/';
    mainWindow.loadURL(url);
  } else {
    const htmlName = process.env.AURORA_STARTUP_HTML;
    const page = (htmlName === 'probe' || htmlName === 'bigprobe')
      ? path.join(__dirname, `../dist/${htmlName}.html`)
      : path.join(__dirname, '../dist/splash.html');
    mainWindow.loadFile(page);
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
  startupMark('create_window_end');
}

function wrap(fn) {
  return async (_evt, ...args) => {
    try {
      return { ok: true, data: await fn(...args) };
    } catch (err) {
      return { ok: false, error: err?.message || String(err) };
    }
  };
}

function registerIpc() {
  ipcMain.handle('fs:listDrives', wrap(() => fsSvc.listDrives()));
  ipcMain.handle('fs:knownFolders', wrap(() => fsSvc.knownFolders()));
  ipcMain.handle('fs:listDir', wrap((dir, opts) => fsSvc.listDir(dir, opts)));
  ipcMain.handle('fs:readText', wrap((p, max) => fsSvc.readTextPreview(p, max)));
  ipcMain.handle('fs:readBinary', wrap((p, max) => fsSvc.readBinaryPreview(p, max)));
  ipcMain.handle('fs:fileUrl', wrap((p) => fsSvc.toAuroraFileUrl(p)));
  ipcMain.handle('fs:search', wrap((root, query, opts) => fsSvc.searchFiles(root, query, opts)));
  ipcMain.handle('fs:searchCancel', wrap(() => fsSvc.cancelSearch()));
  ipcMain.handle('fs:indexStatus', wrap((root) => fsSvc.getIndexStatus(root)));
  ipcMain.handle('fs:indexPrefs', wrap(() => fsSvc.getIndexPrefs()));
  ipcMain.handle('fs:setIndexPrefs', wrap((partial) => fsSvc.setIndexPrefs(partial)));
  ipcMain.handle('fs:ensureIndex', wrap((root, opts) => fsSvc.buildIndex(root, opts)));
  ipcMain.handle('fs:ensureIndexes', wrap((roots, opts) => fsSvc.buildIndexes(roots, opts)));
  ipcMain.handle('fs:heicPreview', wrap((p) => fsSvc.convertImagePreview(p, { maxEdge: 2048 })));
  ipcMain.handle('fs:imagePreview', wrap((p, opts) => fsSvc.convertImagePreview(p, opts || {})));
  ipcMain.handle('fs:videoPoster', wrap((p, opts) => fsSvc.videoPoster(p, opts || {})));
  ipcMain.handle('fs:readTags', wrap((p) => fsSvc.readTags(p)));
  ipcMain.handle('fs:writeTags', wrap((p, tags) => fsSvc.writeTags(p, tags)));
  ipcMain.handle('fs:renameMany', wrap((entries) => fsSvc.renameMany(entries)));
  ipcMain.handle('fs:mkdir', wrap((parent, name) => fsSvc.mkdir(parent, name)));
  ipcMain.handle('fs:rename', wrap((target, name) => fsSvc.rename(target, name)));
  ipcMain.handle('fs:copy', wrap((sources, dest) => fsSvc.copyPaths(sources, dest)));
  ipcMain.handle('fs:move', wrap((sources, dest) => fsSvc.movePaths(sources, dest)));
  ipcMain.handle('fs:trash', wrap((paths) => fsSvc.trashPaths(paths)));
  ipcMain.handle('fs:deleteForever', wrap((paths) => fsSvc.deleteForever(paths)));
  ipcMain.handle('fs:openPath', wrap((p) => fsSvc.openPath(p)));
  ipcMain.handle('fs:showInFolder', wrap((p) => fsSvc.showInFolder(p)));
  ipcMain.handle('fs:openWith', wrap((p, appName) => fsSvc.openWith(p, appName)));
  ipcMain.handle('app:info', wrap(() => fsSvc.appInfo()));
  ipcMain.handle('app:relaunchElevated', wrap(() => fsSvc.relaunchElevated()));
  ipcMain.handle('app:updateStatus', wrap(async () => {
    const u = await import('./updater.mjs');
    return u.getUpdateStatus();
  }));
  ipcMain.handle('app:checkUpdate', wrap(async () => {
    const u = await import('./updater.mjs');
    return u.checkForUpdates();
  }));
  ipcMain.handle('app:quitAndInstall', wrap(async () => {
    const u = await import('./updater.mjs');
    return u.quitAndInstall();
  }));
  ipcMain.handle('shell:openExternal', wrap((url) => shell.openExternal(url)));
  ipcMain.handle('app:startupMarks', wrap(() => getStartupMarks()));
  ipcMain.handle('app:startupMark', wrap((name) => {
    if (typeof name === 'string' && name) startupMark(name);
    return getStartupMarks();
  }));
}

function registerProtocol() {
  protocol.handle('aurora-file', async (request) => {
    try {
      const local = fsSvc.fromAuroraFileUrl(request.url);
      const mime = fsSvc.mimeFromPath(local);
      // Prefer UTF-8 percent-encoded file URL; Chromium needs Content-Type for JPEG/WebP.
      // pathToFileURL handles CJK; do NOT pass \\?\ namespaced paths here.
      const upstream = await net.fetch(pathToFileURL(local).href);
      if (!upstream.ok) return upstream;
      const headers = new Headers(upstream.headers);
      if (mime && mime !== 'application/octet-stream') {
        headers.set('Content-Type', mime);
      }
      headers.set('Accept-Ranges', 'bytes');
      return new Response(upstream.body, {
        status: upstream.status,
        statusText: upstream.statusText,
        headers,
      });
    } catch (err) {
      return new Response(String(err?.message || err), { status: 400 });
    }
  });
}

app.whenReady().then(() => {
  startupMark('app_ready');
  configureIndexDir(path.join(app.getPath('userData'), 'index'));
  registerProtocol();
  registerIpc();
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
