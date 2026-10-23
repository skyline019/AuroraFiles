/**
 * 自动更新（electron-updater）
 * - 开发态 / 未配置 feed：空操作
 * - 生产：AURORA_UPDATE_URL 或 build.publish 提供的 generic/github feed
 */
import { app } from 'electron';

/** @type {import('electron-updater').AppUpdater | null} */
let updater = null;
let lastStatus = { state: 'idle', message: '' };

export function getUpdateStatus() {
  return { ...lastStatus };
}

async function loadUpdater() {
  if (updater) return updater;
  try {
    const mod = await import('electron-updater');
    updater = mod.autoUpdater;
    updater.autoDownload = true;
    updater.autoInstallOnAppQuit = true;
    return updater;
  } catch (err) {
    lastStatus = { state: 'unavailable', message: err?.message || String(err) };
    return null;
  }
}

/**
 * @param {{ send?: (channel: string, payload: unknown) => void }} [bridge]
 */
export async function setupAutoUpdater(bridge) {
  if (!app.isPackaged) {
    lastStatus = { state: 'dev', message: '开发模式不检查更新' };
    return lastStatus;
  }

  const autoUpdater = await loadUpdater();
  if (!autoUpdater) return lastStatus;

  const feed = process.env.AURORA_UPDATE_URL?.trim();
  if (feed) {
    autoUpdater.setFeedURL({ provider: 'generic', url: feed });
  }

  const emit = (state, message, extra = {}) => {
    lastStatus = { state, message, ...extra };
    bridge?.send?.('app:update-status', lastStatus);
  };

  autoUpdater.on('checking-for-update', () => emit('checking', '正在检查更新…'));
  autoUpdater.on('update-available', (info) => emit('available', `发现新版本 ${info.version}`, { version: info.version }));
  autoUpdater.on('update-not-available', () => emit('uptodate', '已是最新版本'));
  autoUpdater.on('download-progress', (p) => emit('downloading', `下载中 ${Math.round(p.percent || 0)}%`, { percent: p.percent }));
  autoUpdater.on('update-downloaded', (info) => emit('ready', `已下载 ${info.version}，重启后安装`, { version: info.version }));
  autoUpdater.on('error', (err) => emit('error', err?.message || String(err)));

  try {
    await autoUpdater.checkForUpdatesAndNotify();
  } catch (err) {
    emit('error', err?.message || String(err));
  }
  return lastStatus;
}

export async function checkForUpdates() {
  if (!app.isPackaged) {
    lastStatus = { state: 'dev', message: '开发模式不检查更新' };
    return lastStatus;
  }
  const autoUpdater = await loadUpdater();
  if (!autoUpdater) return lastStatus;
  const feed = process.env.AURORA_UPDATE_URL?.trim();
  if (feed) autoUpdater.setFeedURL({ provider: 'generic', url: feed });
  try {
    const result = await autoUpdater.checkForUpdates();
    return { ...lastStatus, updateInfo: result?.updateInfo?.version };
  } catch (err) {
    lastStatus = { state: 'error', message: err?.message || String(err) };
    return lastStatus;
  }
}

export async function quitAndInstall() {
  const autoUpdater = await loadUpdater();
  if (!autoUpdater) throw new Error('更新模块不可用');
  autoUpdater.quitAndInstall(false, true);
}
