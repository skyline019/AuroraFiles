/** Electron preload 桥接类型 */

export interface AuroraEntry {
  path: string;
  name: string;
  kind: 'folder' | 'file';
  size: number;
  createdAt: number;
  modifiedAt: number;
  accessedAt: number;
  hidden?: boolean;
  ext?: string;
  error?: string;
}

export interface AuroraDrive {
  path: string;
  name: string;
  letter: string;
  total: number;
  free: number;
  used: number;
}

export interface KnownFolders {
  home: string;
  desktop: string;
  documents: string;
  downloads: string;
  pictures: string;
  music: string;
  videos: string;
}

export interface AuroraAPI {
  isElectron: true;
  listDrives: () => Promise<AuroraDrive[]>;
  knownFolders: () => Promise<KnownFolders>;
  listDir: (dir: string, opts?: { showHidden?: boolean }) => Promise<AuroraEntry[]>;
  readText: (p: string, max?: number) => Promise<string | { base64: string; size: number; truncated?: boolean }>;
  readBinary: (p: string, max?: number) => Promise<{ base64: string; size: number; name: string }>;
  fileUrl: (p: string) => Promise<string>;
  /** 若本机有 ffmpeg，返回封面 data URL；opts.maxEdge 控制缩略边长 */
  videoPoster: (p: string, opts?: { maxEdge?: number }) => Promise<{ url: string } | null>;
  /** TIFF/AVIF/HEIF/RAW 等经 ffmpeg 转 JPEG */
  imagePreview: (p: string, opts?: { maxEdge?: number }) => Promise<{ url: string; meta?: string } | null>;
  search: (
    root: string,
    query: string,
    opts?: { maxResults?: number; maxDepth?: number; maxScan?: number },
  ) => Promise<{
    items: { path: string; name: string; kind: 'file' | 'folder'; size: number; modifiedAt: number }[];
    truncated: boolean;
    scanned: number;
    source?: string;
    cancelled?: boolean;
  }>;
  /** 中止主进程进行中的 fs:search（单飞作废旧任务） */
  searchCancel: () => Promise<{ cancelled: boolean; jobId: number }>;
  indexStatus: (root: string) => Promise<{
    ready: boolean;
    building: boolean;
    scanned: number;
    size: number;
    source?: string;
    usn?: { journalId?: string; nextUsn?: number } | null;
    lastPersistAt?: number;
    disk?: { exists: boolean; bytes?: number; size?: number; savedAt?: number; deltaLines?: number };
    segmentKeys?: number;
    queryCacheSize?: number;
    watching?: boolean;
    pendingDelta?: number;
    dirtyDirs?: number;
    frnSize?: number;
    fts?: { available: boolean; ok: boolean; size: number };
    usnReadable?: boolean | null;
    maxScan?: number;
    excludeNames?: string[];
    builtinSkip?: string[];
  }>;
  indexPrefs: () => Promise<{ maxScan: number; excludeNames: string[] }>;
  setIndexPrefs: (partial: { maxScan?: number; excludeNames?: string[] }) => Promise<{ maxScan: number; excludeNames: string[] }>;
  ensureIndex: (root: string, opts?: { maxDepth?: number; maxScan?: number; rebuild?: boolean }) => Promise<unknown>;
  ensureIndexes: (
    roots: (string | { path: string; removable?: boolean })[],
    opts?: { maxDepth?: number; maxScan?: number },
  ) => Promise<{ roots: string[] }>;
  /** @deprecated 用 imagePreview；保留兼容 */
  heicPreview: (p: string) => Promise<{ url: string; meta?: string } | null>;
  readTags: (p: string) => Promise<string[]>;
  writeTags: (p: string, tags: string[]) => Promise<string[]>;
  renameMany: (entries: { path: string; name: string }[]) => Promise<string[]>;
  mkdir: (parent: string, name: string) => Promise<string>;
  rename: (target: string, name: string) => Promise<string>;
  copy: (sources: string[], dest: string) => Promise<string[]>;
  move: (sources: string[], dest: string) => Promise<string[]>;
  trash: (paths: string[]) => Promise<{ ok: string[]; failed: { path: string; error: string }[] }>;
  deleteForever: (paths: string[]) => Promise<{ ok: string[]; failed: { path: string; error: string }[] }>;
  openPath: (p: string) => Promise<void>;
  showInFolder: (p: string) => Promise<void>;
  openWith: (p: string, app: 'default' | 'reveal' | 'notepad' | 'code' | 'picker') => Promise<void>;
  appInfo: () => Promise<{ name: string; version: string; userData: string; platform: string; elevated?: boolean }>;
  relaunchElevated: () => Promise<{ ok: boolean }>;
  updateStatus: () => Promise<{ state: string; message: string; version?: string; percent?: number }>;
  checkUpdate: () => Promise<{ state: string; message: string; version?: string; percent?: number }>;
  quitAndInstall: () => Promise<void>;
  onUpdateStatus?: (cb: (s: { state: string; message: string; version?: string; percent?: number }) => void) => () => void;
  openExternal: (url: string) => Promise<void>;
}

declare global {
  interface Window {
    aurora?: AuroraAPI;
  }
}

export const isElectron = (): boolean => typeof window !== 'undefined' && !!window.aurora?.isElectron;

export const api = (): AuroraAPI => {
  if (!window.aurora) throw new Error('未在 Electron 中运行');
  return window.aurora;
};

/** 真盘节点 id：绝对路径，或以 __ 开头的特殊位 */
export const isRealId = (id: string): boolean =>
  id === '__pc__' || id === '__demo__' || /^[A-Za-z]:[\\/]/.test(id);

export const REAL_PC = '__pc__';
export const REAL_DEMO = '__demo__';
