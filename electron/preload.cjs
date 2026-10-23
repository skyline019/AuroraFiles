const { contextBridge, ipcRenderer } = require('electron');

async function invoke(channel, ...args) {
  const res = await ipcRenderer.invoke(channel, ...args);
  if (!res?.ok) throw new Error(res?.error || '操作失败');
  return res.data;
}

contextBridge.exposeInMainWorld('aurora', {
  isElectron: true,
  listDrives: () => invoke('fs:listDrives'),
  knownFolders: () => invoke('fs:knownFolders'),
  listDir: (dir, opts) => invoke('fs:listDir', dir, opts),
  readText: (p, max) => invoke('fs:readText', p, max),
  readBinary: (p, max) => invoke('fs:readBinary', p, max),
  fileUrl: (p) => invoke('fs:fileUrl', p),
  videoPoster: (p, opts) => invoke('fs:videoPoster', p, opts),
  imagePreview: (p, opts) => invoke('fs:imagePreview', p, opts),
  search: (root, query, opts) => invoke('fs:search', root, query, opts),
  searchCancel: () => invoke('fs:searchCancel'),
  indexStatus: (root) => invoke('fs:indexStatus', root),
  indexPrefs: () => invoke('fs:indexPrefs'),
  setIndexPrefs: (partial) => invoke('fs:setIndexPrefs', partial),
  ensureIndex: (root, opts) => invoke('fs:ensureIndex', root, opts),
  ensureIndexes: (roots, opts) => invoke('fs:ensureIndexes', roots, opts),
  heicPreview: (p) => invoke('fs:heicPreview', p), // 兼容：等同 imagePreview 全尺寸
  readTags: (p) => invoke('fs:readTags', p),
  writeTags: (p, tags) => invoke('fs:writeTags', p, tags),
  renameMany: (entries) => invoke('fs:renameMany', entries),
  mkdir: (parent, name) => invoke('fs:mkdir', parent, name),
  rename: (target, name) => invoke('fs:rename', target, name),
  copy: (sources, dest) => invoke('fs:copy', sources, dest),
  move: (sources, dest) => invoke('fs:move', sources, dest),
  trash: (paths) => invoke('fs:trash', paths),
  deleteForever: (paths) => invoke('fs:deleteForever', paths),
  openPath: (p) => invoke('fs:openPath', p),
  showInFolder: (p) => invoke('fs:showInFolder', p),
  openWith: (p, app) => invoke('fs:openWith', p, app),
  appInfo: () => invoke('app:info'),
  relaunchElevated: () => invoke('app:relaunchElevated'),
  updateStatus: () => invoke('app:updateStatus'),
  checkUpdate: () => invoke('app:checkUpdate'),
  quitAndInstall: () => invoke('app:quitAndInstall'),
  onUpdateStatus: (cb) => {
    const handler = (_e, payload) => cb(payload);
    ipcRenderer.on('app:update-status', handler);
    return () => ipcRenderer.removeListener('app:update-status', handler);
  },
  openExternal: (url) => invoke('shell:openExternal', url),
});
