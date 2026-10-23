// ─────────────────────────────────────────────────────────────
// 极光文件 · 虚拟文件系统引擎
// ─────────────────────────────────────────────────────────────

import { allImageExts } from './mediaDecode';

export type TagColor = 'red' | 'orange' | 'yellow' | 'green' | 'blue' | 'purple' | 'gray';
export type SortKey = 'name' | 'modified' | 'size' | 'kind';
export type SortDir = 'asc' | 'desc';
export type ViewMode = 'grid' | 'list' | 'columns' | 'gallery';

export interface FSNode {
  id: string;
  name: string;
  kind: 'folder' | 'file' | 'drive' | 'special';
  parentId: string | null;
  childrenIds: string[];
  ext?: string;
  size: number;                 // bytes (files)
  createdAt: number;
  modifiedAt: number;
  accessedAt: number;
  tags: TagColor[];
  favorite?: boolean;
  system?: boolean;
  hidden?: boolean;
  locked?: boolean;
  imageUrl?: string;
  thumbUrl?: string;
  content?: string;             // text preview content
  appColor?: string;
  drive?: { label: string; total: number; used: number; removable?: boolean; format: string };
  deleted?: boolean;
  trashedFrom?: string | null;
}

export type Location = { t: 'node'; id: string } | { t: 'tag'; tag: TagColor };

export interface TabState {
  id: string;
  history: Location[];
  hi: number;
  view: ViewMode;
  sortKey: SortKey;
  sortDir: SortDir;
  iconSize: number;
  selection: string[];
  renaming: string | null;
  search: string;
  showHidden: boolean;
  /** 画廊底栏是否只显示文件（默认 true） */
  galleryFilesOnly: boolean;
}

export const ID = {
  pc: 'pc', c: 'c', d: 'd', e: 'e', od: 'od',
  desktop: 'desktop', docs: 'docs', dl: 'dl', pics: 'pics', music: 'music', vids: 'vids',
  quick: 'sp-quick', recent: 'sp-recent', trash: 'sp-trash',
};

export const TAGS: { color: TagColor; label: string; hex: string }[] = [
  { color: 'red', label: '重要', hex: '#ff453a' },
  { color: 'orange', label: '工作', hex: '#ff9f0a' },
  { color: 'yellow', label: '稍后', hex: '#ffd60a' },
  { color: 'green', label: '旅行', hex: '#32d74b' },
  { color: 'blue', label: '灵感', hex: '#0a84ff' },
  { color: 'purple', label: '项目', hex: '#bf5af2' },
  { color: 'gray', label: '其他', hex: '#98989d' },
];
export const tagHex = (c: TagColor) => TAGS.find(t => t.color === c)?.hex ?? '#98989d';
export const tagLabel = (c: TagColor) => TAGS.find(t => t.color === c)?.label ?? c;

export const QUICK_LIST = [
  { id: ID.desktop, icon: 'monitor', tint: '#3b82f6' },
  { id: ID.dl, icon: 'download', tint: '#0a84ff' },
  { id: ID.docs, icon: 'doc', tint: '#6366f1' },
  { id: ID.pics, icon: 'image', tint: '#a855f7' },
  { id: ID.music, icon: 'music', tint: '#ec4899' },
  { id: ID.vids, icon: 'film', tint: '#f43f5e' },
  { id: ID.recent, icon: 'clock', tint: '#8b8b90' },
] as const;

const GB = 1024 ** 3, MB = 1024 ** 2, KB = 1024;
const now = Date.now();
const H = 3600_000, DAY = 24 * H;

let seq = 0;
export const nid = () => `n${++seq}${Math.random().toString(36).slice(2, 7)}`;

// ── 照片素材 ────────────────────────────────────────────────
const PHOTOS = [
  { u: 'https://images.pexels.com/photos/40126089/pexels-photo-40126089.jpeg?auto=compress&cs=tinysrgb&fit=crop&h=627&w=1200', t: 'https://images.pexels.com/photos/40126089/pexels-photo-40126089.jpeg?auto=compress&cs=tinysrgb&dpr=1&fit=crop&h=200&w=280', name: 'IMG_1204.HEIC', label: '棕榈公园' },
  { u: 'https://images.pexels.com/photos/36802510/pexels-photo-36802510.jpeg?auto=compress&cs=tinysrgb&fit=crop&h=627&w=1200', t: 'https://images.pexels.com/photos/36802510/pexels-photo-36802510.jpeg?auto=compress&cs=tinysrgb&dpr=1&fit=crop&h=200&w=280', name: 'IMG_2741.JPG', label: '伊斯坦布尔' },
  { u: 'https://images.pexels.com/photos/18700903/pexels-photo-18700903.jpeg?auto=compress&cs=tinysrgb&fit=crop&h=627&w=1200', t: 'https://images.pexels.com/photos/18700903/pexels-photo-18700903.jpeg?auto=compress&cs=tinysrgb&dpr=1&fit=crop&h=200&w=280', name: 'IMG_2856.JPG', label: '科英布拉秋色' },
  { u: 'https://images.pexels.com/photos/30540840/pexels-photo-30540840.jpeg?auto=compress&cs=tinysrgb&fit=crop&h=627&w=1200', t: 'https://images.pexels.com/photos/30540840/pexels-photo-30540840.jpeg?auto=compress&cs=tinysrgb&dpr=1&fit=crop&h=200&w=280', name: 'IMG_2988.JPG', label: '里约湖畔' },
  { u: 'https://images.pexels.com/photos/11687562/pexels-photo-11687562.jpeg?auto=compress&cs=tinysrgb&fit=crop&h=627&w=1200', t: 'https://images.pexels.com/photos/11687562/pexels-photo-11687562.jpeg?auto=compress&cs=tinysrgb&dpr=1&fit=crop&h=200&w=280', name: 'IMG_3017.JPG', label: '拉科鲁尼亚' },
  { u: 'https://images.pexels.com/photos/34061730/pexels-photo-34061730.jpeg?auto=compress&cs=tinysrgb&fit=crop&h=627&w=1200', t: 'https://images.pexels.com/photos/34061730/pexels-photo-34061730.jpeg?auto=compress&cs=tinysrgb&dpr=1&fit=crop&h=200&w=280', name: 'IMG_3102.JPG', label: '斯库台日落' },
  { u: 'https://images.pexels.com/photos/39917371/pexels-photo-39917371.jpeg?auto=compress&cs=tinysrgb&fit=crop&h=627&w=1200', t: 'https://images.pexels.com/photos/39917371/pexels-photo-39917371.jpeg?auto=compress&cs=tinysrgb&dpr=1&fit=crop&h=200&w=280', name: 'IMG_3177.JPG', label: '科托尔湾' },
  { u: 'https://images.pexels.com/photos/34886161/pexels-photo-34886161.jpeg?auto=compress&cs=tinysrgb&fit=crop&h=627&w=1200', t: 'https://images.pexels.com/photos/34886161/pexels-photo-34886161.jpeg?auto=compress&cs=tinysrgb&dpr=1&fit=crop&h=200&w=280', name: 'IMG_3390.JPG', label: '昆嵩黄昏' },
  { u: 'https://images.pexels.com/photos/40318401/pexels-photo-40318401.jpeg?auto=compress&cs=tinysrgb&fit=crop&h=627&w=1200', t: 'https://images.pexels.com/photos/40318401/pexels-photo-40318401.jpeg?auto=compress&cs=tinysrgb&dpr=1&fit=crop&h=200&w=280', name: 'IMG_3521.JPG', label: '萨拉热窝' },
  { u: 'https://images.pexels.com/photos/39207730/pexels-photo-39207730.png?auto=compress&cs=tinysrgb&fit=crop&h=627&w=1200', t: 'https://images.pexels.com/photos/39207730/pexels-photo-39207730.png?auto=compress&cs=tinysrgb&dpr=1&fit=crop&h=200&w=280', name: 'IMG_3655.PNG', label: '亚拉拉特山' },
];

// ── 构建虚拟磁盘 ────────────────────────────────────────────
export function seedFS(): Record<string, FSNode> {
  const nodes: Record<string, FSNode> = {};
  const add = (n: FSNode) => {
    nodes[n.id] = n;
    if (n.parentId && nodes[n.parentId]) nodes[n.parentId].childrenIds.push(n.id);
    return n;
  };
  const pid = (p: string | FSNode | null): string | null => (typeof p === 'string' || p === null ? p : p.id);
  const F = (id: string, name: string, parent: string | FSNode | null, o: Partial<FSNode> = {}): FSNode =>
    add({ id, name, kind: 'folder', parentId: pid(parent), childrenIds: [], size: 0, createdAt: now - 300 * DAY, modifiedAt: now - 6 * DAY, accessedAt: now - 6 * DAY, tags: [], ...o });
  const f = (name: string, parent: string | FSNode, sizeMB: number, o: Partial<FSNode> = {}): FSNode =>
    add({ id: nid(), name, kind: 'file', parentId: pid(parent), childrenIds: [], size: Math.round(sizeMB * MB), createdAt: now - 40 * DAY, modifiedAt: now - 3 * DAY, accessedAt: now - 2 * DAY, tags: [], ...o });

  // 根
  nodes['root'] = { id: 'root', name: '', kind: 'folder', parentId: null, childrenIds: [], size: 0, createdAt: now, modifiedAt: now, accessedAt: now, tags: [] };

  // 特殊位置
  F(ID.quick, '快速访问', 'root', { kind: 'special', system: true });
  F(ID.recent, '最近使用', 'root', { kind: 'special', system: true });
  F(ID.trash, '回收站', 'root', { kind: 'special', system: true });

  // 此电脑 & 磁盘
  F(ID.pc, '此电脑', 'root', { system: true });
  F(ID.c, '本地磁盘 (C:)', ID.pc, { kind: 'drive', system: true, drive: { label: 'Windows', total: 476 * GB, used: 246 * GB, format: 'NTFS' } });
  F(ID.d, '数据 (D:)', ID.pc, { kind: 'drive', system: true, drive: { label: 'Data', total: 931 * GB, used: 618 * GB, format: 'NTFS' } });
  F(ID.e, '晨曦 U盘 (E:)', ID.pc, { kind: 'drive', system: true, drive: { label: 'USB', total: 58 * GB, used: 17 * GB, removable: true, format: 'exFAT' } });

  // C:\ 系统目录
  const pf = F(nid(), 'Program Files', ID.c, { modifiedAt: now - 12 * DAY });
  F(nid(), 'Aurora Files', pf); F(nid(), 'Microsoft Office', pf); F(nid(), 'Google', pf);
  const pf86 = F(nid(), 'Program Files (x86)', ID.c, { modifiedAt: now - 20 * DAY });
  F(nid(), 'Steam', pf86); F(nid(), 'Netease', pf86);
  const win = F(nid(), 'Windows', ID.c, { modifiedAt: now - 30 * DAY });
  const sys32 = F(nid(), 'System32', win);
  f('kernel32.dll', sys32, 0.7, { modifiedAt: now - 60 * DAY });
  f('user32.dll', sys32, 0.1, { modifiedAt: now - 60 * DAY });
  f('ntdll.dll', sys32, 1.6, { modifiedAt: now - 60 * DAY });
  F(nid(), 'Fonts', win);
  f('explorer.exe', win, 4.1, { appColor: '#3b82f6' });
  f('notepad.exe', win, 0.2, { appColor: '#64748b' });
  F(nid(), 'PerfLogs', ID.c);
  F(nid(), '.SystemRecovery', ID.c, { hidden: true });
  f('.bootcfg', ID.c, 0.001, { hidden: true });

  // 用户目录
  const users = F(nid(), 'Users', ID.c);
  const me = F(nid(), 'linwz', users, { modifiedAt: now - H * 5 });
  F(ID.desktop, '桌面', me, { system: true, modifiedAt: now - H * 3, accessedAt: now - H });
  F(ID.docs, '文档', me, { system: true, modifiedAt: now - DAY, accessedAt: now - H * 4 });
  F(ID.dl, '下载', me, { system: true, modifiedAt: now - H * 2, accessedAt: now - H * 2 });
  F(ID.pics, '图片', me, { system: true, modifiedAt: now - DAY * 2, accessedAt: now - DAY });
  F(ID.music, '音乐', me, { system: true, modifiedAt: now - DAY * 9 });
  F(ID.vids, '视频', me, { system: true, modifiedAt: now - DAY * 5 });
  f('ntuser.dat', me, 12, { hidden: true });

  // 桌面
  f('便签.txt', ID.desktop, 0.002, { modifiedAt: now - H * 6, accessedAt: now - H * 2, tags: ['blue'], content: '周五前完成极光文件 2.4 的提测：\n\n· 标签页拖拽排序回归\n· 分栏视图的键盘导航\n· 回收站还原路径缓存\n· 别忘了给安装包签名\n\n灵感常在，只是需要归档。' });
  f('季度汇报.pptx', ID.desktop, 18.4, { modifiedAt: now - DAY, accessedAt: now - H * 5, tags: ['orange'] });
  f('旅行计划.xlsx', ID.desktop, 0.8, { tags: ['green'], modifiedAt: now - DAY * 2 });
  const design = F(nid(), '设计稿', ID.desktop, { favorite: true, tags: ['purple'], accessedAt: now - H * 8 });
  f('主视觉-v3.psd', design, 248);
  f('图标导出.zip', design, 42);
  f('设计规范.pdf', design, 6.2);
  f('灵感笔记.md', ID.desktop, 0.004, { tags: ['blue'], accessedAt: now - H, content: '# 灵感笔记\n\n- 窗口即画布：毛玻璃 + 大圆角 + 轻投影\n- 交互动效尽量贴近「物理世界」\n- 颜色的职责是分层，而不是装饰\n- 好设计是看不见的\n\n> Simplicity is the ultimate sophistication.' });
  f('Aurora Files.lnk', ID.desktop, 0.001, { appColor: '#0a84ff' });

  // 文档
  const work = F(nid(), '工作', ID.docs, { tags: ['orange'] });
  f('产品白皮书.pdf', work, 8.4, { accessedAt: now - H * 3 });
  f('会议纪要-0512.docx', work, 0.3, { accessedAt: now - DAY });
  f('合同模板.docx', work, 0.2);
  f('预算表-2025.xlsx', work, 1.1, { tags: ['red', 'orange'] });
  const life = F(nid(), '个人', ID.docs);
  f('读书笔记.md', life, 0.01, { tags: ['blue'], content: '# 读书笔记\n\n《设计中的设计》—— 原研哉\n\n「再设计」不是推翻，而是回到原点重新审视日常。\n\n空白不是无，而是容纳万物的容器。' });
  f('家庭账单.xlsx', life, 0.6);
  f('简历-2025.pdf', ID.docs, 0.9, { tags: ['red'], accessedAt: now - DAY * 3 });
  f('体检报告.pdf', ID.docs, 2.1);

  // 下载
  f('aurora-files-setup-2.4.1.exe', ID.dl, 86, { appColor: '#0a84ff', modifiedAt: now - H * 2, accessedAt: now - H * 2 });
  f('Figma-Installer.exe', ID.dl, 124, { appColor: '#a259ff' });
  f('wechat-setup.exe', ID.dl, 256, { appColor: '#07c160' });
  f('设计资源合集.zip', ID.dl, 1024 * 1.6, { tags: ['purple'] });
  f('阿里普惠体-字体包.zip', ID.dl, 310);
  f('node-v22.11.0-x64.msi', ID.dl, 31);
  f('电子发票-0412.pdf', ID.dl, 0.2, { accessedAt: now - H * 9 });
  f('年报模板.pptx', ID.dl, 24);

  // 图片
  const roll = F(nid(), '相机胶卷', ID.pics, { accessedAt: now - DAY });
  PHOTOS.forEach((p, i) => f(p.name, roll, 3.2 + i * 0.7, { imageUrl: p.u, thumbUrl: p.t, modifiedAt: now - DAY * (i + 2), accessedAt: now - H * (i + 1), tags: i === 6 ? ['green'] : i === 5 ? ['yellow'] : [] }));
  const shots = F(nid(), '屏幕截图', ID.pics);
  for (let i = 0; i < 3; i++) f(`屏幕截图 2025-0${i + 3}-1${i} 1${i}24${i}0.png`, shots, 1.4 + i * 0.3, { modifiedAt: now - DAY * (i + 1) });
  const walls = F(nid(), '壁纸', ID.pics);
  f('极光-黎明.png', walls, 8.2); f('极光-夜幕.png', walls, 9.1); f('macOS-Sequoia-dark.heic', walls, 5.4);
  f('证件照.jpg', ID.pics, 0.8, { tags: ['red'] });

  // 音乐 / 视频
  f('晴天.flac', ID.music, 28, { tags: ['yellow'] });
  f('夜曲.mp3', ID.music, 9.2);
  f('Lover.mp3', ID.music, 8.7, { tags: ['yellow'] });
  f('Midnight Rain.mp3', ID.music, 7.9);
  f('钢琴纯音.m4a', ID.music, 12.4);
  f('年会剪辑-final.mp4', ID.vids, 486, {
    modifiedAt: now - DAY * 5,
    // demo：画廊视频封面（真盘由 ffmpeg poster 生成）
    thumbUrl: PHOTOS[0]?.t,
  });
  f('旅行vlog-云南.mov', ID.vids, 1024 * 2.3, { tags: ['green'] });
  f('快捷键教程.mp4', ID.vids, 204);

  // D:\ 项目（自指彩蛋）
  const proj = F(nid(), 'Projects', ID.d, { modifiedAt: now - H * 4, accessedAt: now - H * 6 });
  const aurora = F(nid(), 'aurora-files', proj, { favorite: true, tags: ['purple'], modifiedAt: now - H * 4 });
  f('package.json', aurora, 0.002, { content: '{\n  "name": "aurora-files",\n  "version": "2.4.1",\n  "private": true,\n  "scripts": {\n    "dev": "vite",\n    "build": "vite build"\n  }\n}' });
  f('README.md', aurora, 0.005, { tags: ['purple'], content: '# Aurora Files 极光文件\n\n运行在 Windows 上的苹果风文件管理器。\n\n## 特性\n\n- 标签页浏览\n- 空格快速查看（Quick Look）\n- 分栏 / 画廊视图\n- 彩色标签系统\n- 命令面板 Ctrl+K' });
  f('vite.config.ts', aurora, 0.001);
  f('tsconfig.json', aurora, 0.001);
  const srcDir = F(nid(), 'src', aurora);
  f('App.tsx', srcDir, 0.012); f('main.tsx', srcDir, 0.001); f('index.css', srcDir, 0.004); f('store.ts', srcDir, 0.009);
  F(nid(), 'portfolio-site', proj); F(nid(), 'eink-dashboard', proj);
  const bak = F(nid(), 'Backup', ID.d);
  const bakPics = F(nid(), '照片备份-2024', bak); f('DSC_0031.NEF', bakPics, 24); f('DSC_0032.NEF', bakPics, 23.4);
  f('系统镜像-Win11-24H2.iso', bak, 1024 * 5.4);
  const soft = F(nid(), 'Software', ID.d);
  f('Photoshop-2025.zip', soft, 1024 * 3.8); f('Office2021.iso', soft, 1024 * 4.1); f('JetBrains-Toolbox.exe', soft, 68, { appColor: '#fe2857' });
  const games = F(nid(), 'Games', ID.d);
  F(nid(), 'Cyberpunk 2077', games); F(nid(), 'Stardew Valley', games, { tags: ['yellow'] }); F(nid(), 'Elden Ring', games);
  const media = F(nid(), 'Media素材', ID.d);
  F(nid(), 'LUT 调色预设', media); F(nid(), '免版权音乐', media);
  f('.driveinfo', ID.d, 0.001, { hidden: true });

  // E:\ U盘
  f('论文终稿-v7.docx', ID.e, 1.2);
  f('答辩PPT.pptx', ID.e, 34);
  f('数据集.csv', ID.e, 86);

  // OneDrive
  F(ID.od, 'OneDrive', 'root', { system: true });
  const odDoc = F(nid(), '云端文档', ID.od);
  f('团队OKR.xlsx', odDoc, 0.4, { accessedAt: now - H * 12 });
  f('共享相册.url', odDoc, 0.001);
  f('周会记录.docx', ID.od, 0.3);

  // 回收站预置
  add({ id: nid(), name: '旧简历-2023.docx', kind: 'file', parentId: ID.trash, childrenIds: [], size: 412 * KB, createdAt: now - 500 * DAY, modifiedAt: now - 500 * DAY, accessedAt: now - DAY * 6, tags: [], deleted: true, trashedFrom: ID.docs });
  add({ id: nid(), name: 'temp-渲染缓存.tmp', kind: 'file', parentId: ID.trash, childrenIds: [], size: 4 * MB, createdAt: now - DAY, modifiedAt: now - DAY, accessedAt: now - DAY, tags: [], deleted: true, trashedFrom: ID.dl });
  add({ id: nid(), name: '屏幕截图 2024-11-02.png', kind: 'file', parentId: ID.trash, childrenIds: [], size: 1.1 * MB, createdAt: now - DAY * 20, modifiedAt: now - DAY * 20, accessedAt: now - DAY * 20, tags: [], deleted: true, trashedFrom: ID.desktop });

  return nodes;
}

// ── 查询与工具 ──────────────────────────────────────────────
/** 可按「图片」分类 / 画廊缩略的扩展名（含需 ffmpeg 转码的 TIFF/AVIF/HEIF/RAW） */
export const IMAGE_EXTS = allImageExts();
const CODE_EXTS = ['js', 'ts', 'tsx', 'jsx', 'css', 'scss', 'html', 'json', 'yml', 'yaml', 'toml', 'py', 'java', 'cpp', 'c', 'h', 'cs', 'go', 'rs', 'swift', 'kt', 'sh', 'ps1', 'psm1', 'psd1', 'xml', 'sql', 'vue', 'bat', 'cmd'];

export function extOf(name: string): string {
  const i = name.lastIndexOf('.');
  return i > 0 ? name.slice(i + 1).toLowerCase() : '';
}

export type Category = 'image' | 'video' | 'audio' | 'archive' | 'app' | 'code' | 'doc' | 'sheet' | 'slide' | 'pdf' | 'text' | 'font' | 'db' | 'sys' | 'link' | 'other';
export function categoryOf(ext: string): Category {
  if (IMAGE_EXTS.includes(ext)) return 'image';
  if (['mp4', 'mov', 'mkv', 'avi', 'webm', 'flv'].includes(ext)) return 'video';
  if (['mp3', 'flac', 'wav', 'aac', 'ogg', 'm4a', 'wma'].includes(ext)) return 'audio';
  if (['zip', 'rar', '7z', 'tar', 'gz', 'iso', 'dmg'].includes(ext)) return 'archive';
  if (['exe', 'msi'].includes(ext)) return 'app';
  if (CODE_EXTS.includes(ext)) return 'code';
  if (['doc', 'docx', 'pages', 'rtf'].includes(ext)) return 'doc';
  if (['xls', 'xlsx', 'csv', 'numbers'].includes(ext)) return 'sheet';
  if (['ppt', 'pptx', 'key'].includes(ext)) return 'slide';
  if (ext === 'pdf') return 'pdf';
  if (['txt', 'md', 'log'].includes(ext)) return 'text';
  if (['ttf', 'otf', 'woff', 'woff2'].includes(ext)) return 'font';
  if (['db', 'sqlite', 'mdb'].includes(ext)) return 'db';
  if (['dll', 'sys', 'ini', 'cfg', 'tmp', 'dat', 'reg', 'bat'].includes(ext)) return 'sys';
  if (['url', 'lnk'].includes(ext)) return 'link';
  return 'other';
}

export function kindLabel(n: FSNode): string {
  if (n.kind === 'folder') return '文件夹';
  if (n.kind === 'drive') return n.drive?.removable ? '可移动磁盘' : '本地磁盘';
  if (n.kind === 'special') return '系统文件夹';
  const ext = n.ext ?? extOf(n.name);
  const map: Record<string, string> = {
    doc: 'Word 文档', docx: 'Word 文档', xls: 'Excel 工作表', xlsx: 'Excel 工作表', csv: 'CSV 文件',
    ppt: 'PowerPoint 演示文稿', pptx: 'PowerPoint 演示文稿', pdf: 'PDF 文档', txt: '文本文档', md: 'Markdown 文档',
    zip: 'ZIP 压缩文件', rar: 'RAR 压缩文件', iso: '光盘映像文件', exe: '应用程序', msi: 'Windows 安装包',
    mp3: 'MP3 音频', flac: 'FLAC 音频', m4a: 'AAC 音频', mp4: 'MP4 视频', mov: 'QuickTime 影片',
    png: 'PNG 图像', jpg: 'JPEG 图像', jpeg: 'JPEG 图像', heic: 'HEIC 图像', gif: 'GIF 图像',
    url: 'Internet 快捷方式', lnk: '快捷方式', psd: 'Photoshop 图像', dll: '应用程序扩展',
    json: 'JSON 源文件', ts: 'TypeScript 文件', tsx: 'TypeScript JSX 文件',
    ps1: 'PowerShell 脚本', psm1: 'PowerShell 模块', psd1: 'PowerShell 数据', bat: '批处理文件', cmd: '命令脚本',
  };
  return map[ext] ?? (ext ? `${ext.toUpperCase()} 文件` : '文件');
}

export function descendantsAlive(nodes: Record<string, FSNode>, id: string, out: FSNode[] = []): FSNode[] {
  const n = nodes[id];
  if (!n || n.deleted) return out;
  for (const cid of n.childrenIds) {
    const c = nodes[cid];
    if (!c || c.deleted) continue;
    out.push(c);
    if (c.kind !== 'file') descendantsAlive(nodes, cid, out);
  }
  return out;
}
function descendantsAll(nodes: Record<string, FSNode>, id: string, out: FSNode[] = []): FSNode[] {
  const n = nodes[id];
  if (!n) return out;
  for (const cid of n.childrenIds) {
    const c = nodes[cid];
    if (!c) continue;
    out.push(c);
    descendantsAll(nodes, cid, out);
  }
  return out;
}

export function folderSize(nodes: Record<string, FSNode>, id: string): number {
  const n = nodes[id];
  if (!n) return 0;
  if (n.kind === 'file') return n.size;
  if (n.kind === 'drive') return n.drive?.used ?? 0;
  return descendantsAll(nodes, id).reduce((s, x) => s + (x.kind === 'file' ? x.size : 0), 0);
}
export function folderCount(nodes: Record<string, FSNode>, id: string): number {
  return descendantsAll(nodes, id).length;
}

export function getChain(nodes: Record<string, FSNode>, id: string): FSNode[] {
  const chain: FSNode[] = [];
  let cur: FSNode | undefined = nodes[id];
  let guard = 0;
  while (cur && cur.id !== 'root' && guard++ < 64) {
    chain.unshift(cur);
    cur = cur.parentId ? nodes[cur.parentId] : undefined;
  }
  return chain;
}

export function driveFor(nodes: Record<string, FSNode>, id: string): FSNode | undefined {
  return getChain(nodes, id).find(n => n.kind === 'drive');
}

export function locationNode(loc: Location): string | null {
  return loc.t === 'node' ? loc.id : null;
}

export function poolFor(nodes: Record<string, FSNode>, loc: Location): FSNode[] {
  if (loc.t === 'tag') {
    return Object.values(nodes).filter(n => !n.deleted && n.kind !== 'drive' && n.kind !== 'special' && n.tags.includes(loc.tag));
  }
  const id = loc.id;
  if (id === ID.recent) {
    return Object.values(nodes)
      .filter(n => n.kind === 'file' && !n.deleted && !n.hidden)
      .sort((a, b) => (b.accessedAt || b.modifiedAt) - (a.accessedAt || a.modifiedAt))
      .slice(0, 80);
  }
  if (id === ID.trash) return Object.values(nodes).filter(n => n.deleted);
  if (id === ID.quick) {
    const all = Object.values(nodes).filter(n => !n.deleted);
    const favs = all.filter(n => n.favorite);
    const recents = all.filter(n => n.kind === 'file' && !n.hidden && !n.favorite)
      .sort((a, b) => (b.accessedAt || b.modifiedAt) - (a.accessedAt || a.modifiedAt)).slice(0, 12);
    return [...favs, ...recents];
  }
  const n = nodes[id];
  if (!n) return [];
  return n.childrenIds.map(c => nodes[c]).filter((x): x is FSNode => !!x && !x.deleted);
}

export function sortNodes(nodes: Record<string, FSNode>, list: FSNode[], key: SortKey, dir: SortDir): FSNode[] {
  const mul = dir === 'asc' ? 1 : -1;
  const rank = (n: FSNode) => (n.kind === 'file' ? 1 : 0);
  const cmp = (a: FSNode, b: FSNode): number => {
    switch (key) {
      case 'name': return a.name.localeCompare(b.name, 'zh-Hans-CN', { numeric: true, sensitivity: 'base' });
      case 'modified': return b.modifiedAt - a.modifiedAt;
      case 'size': return (a.kind === 'file' ? a.size : folderSize(nodes, a.id)) - (b.kind === 'file' ? b.size : folderSize(nodes, b.id));
      case 'kind': return kindLabel(a).localeCompare(kindLabel(b), 'zh-Hans-CN') || a.name.localeCompare(kindLabel(b), 'zh-Hans-CN', { numeric: true });
    }
  };
  return [...list].sort((a, b) => {
    const r = rank(a) - rank(b);
    if (r !== 0) return r;
    return cmp(a, b) * mul;
  });
}

export function visibleItems(nodes: Record<string, FSNode>, tab: TabState): FSNode[] {
  const loc = tab.history[tab.hi];
  const q = tab.search.trim().toLowerCase();
  let list: FSNode[];
  if (q) {
    const nid0 = locationNode(loc);
    const base = loc.t === 'tag'
      ? poolFor(nodes, loc)
      : (nid0 === ID.recent || nid0 === ID.quick || nid0 === ID.trash)
        ? poolFor(nodes, loc)
        : descendantsAlive(nodes, nid0 ?? 'root');
    list = base.filter(n =>
      (n.name.toLowerCase().includes(q) || (n.ext ?? extOf(n.name)) === q.replace(/^\./, '') || n.tags.some(t => tagLabel(t).includes(q))),
    );
  } else {
    list = poolFor(nodes, loc);
  }
  if (!tab.showHidden) list = list.filter(n => !n.hidden);
  return sortNodes(nodes, list, tab.sortKey, tab.sortDir);
}

export function nodeTitle(nodes: Record<string, FSNode>, loc: Location): string {
  if (loc.t === 'tag') return `${tagLabel(loc.tag)}标签`;
  return nodes[loc.id]?.name ?? '未知位置';
}

export function pathString(nodes: Record<string, FSNode>, id: string): string {
  if (/^[A-Za-z]:[\\/]/.test(id)) return id;
  return getChain(nodes, id).map(n => n.name).join(' \\ ');
}

export function findByPath(nodes: Record<string, FSNode>, input: string): Location | null {
  const segs = input.split(/[\\/]+/).map(s => s.trim()).filter(Boolean);
  if (!segs.length) return null;
  const anchors: [RegExp, string][] = [
    [/^桌面|desktop$/i, ID.desktop], [/^下载|downloads$/i, ID.dl], [/^文档|documents$/i, ID.docs],
    [/^图片|pictures$/i, ID.pics], [/^音乐|music$/i, ID.music], [/^视频|videos$/i, ID.vids],
    [/^此电脑|计算机|this.?pc$/i, ID.pc], [/^回收站|recycle/i, ID.trash], [/^快速访问|quick/i, ID.quick],
    [/^(c[:：]?|本地磁盘)$/i, ID.c], [/^(d[:：]?|数据)$/i, ID.d], [/^(e[:：]?|.*u盘.*)$/i, ID.e],
    [/^onedrive/i, ID.od],
  ];
  let cur: FSNode | undefined;
  let start = 0;
  for (const [re, id] of anchors) {
    if (re.test(segs[0])) { cur = nodes[id]; start = 1; break; }
  }
  if (!cur) {
    // 尝试从所有一级位置模糊起步
    const first = segs[0].toLowerCase();
    cur = Object.values(nodes).find(n => n.parentId === 'root' && n.name.toLowerCase() === first)
      ?? Object.values(nodes).find(n => n.kind === 'drive' && (n.name.toLowerCase().includes(first) || first.includes(n.id)));
    if (!cur) return null;
    start = 1;
  }
  for (let i = start; i < segs.length; i++) {
    if (!cur) return null;
    const next: FSNode | undefined = cur.childrenIds
      .map(c => nodes[c])
      .find((c): c is FSNode => !!c && c.name.toLowerCase() === segs[i].toLowerCase());
    if (!next) return null;
    cur = next;
  }
  return cur ? { t: 'node', id: cur.id } : null;
}

export function formatSize(bytes: number): string {
  if (bytes <= 0) return '0 字节';
  if (bytes < KB) return `${bytes} 字节`;
  if (bytes < MB) return `${(bytes / KB).toFixed(0)} KB`;
  if (bytes < GB) return `${(bytes / MB).toFixed(1)} MB`;
  if (bytes < 1024 * GB) return `${(bytes / GB).toFixed(1)} GB`;
  return `${(bytes / GB / 1024).toFixed(2)} TB`;
}

export function formatDate(ts: number): string {
  const d = new Date(ts);
  const nowD = new Date();
  const today = new Date(nowD.getFullYear(), nowD.getMonth(), nowD.getDate()).getTime();
  const pad = (x: number) => String(x).padStart(2, '0');
  const hm = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  if (ts >= today) return `今天 ${hm}`;
  if (ts >= today - DAY) return `昨天 ${hm}`;
  if (d.getFullYear() === nowD.getFullYear()) return `${d.getMonth() + 1}月${d.getDate()}日 ${hm}`;
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`;
}
export function formatDateFull(ts: number): string {
  const d = new Date(ts);
  const pad = (x: number) => String(x).padStart(2, '0');
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日 ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function trashCount(nodes: Record<string, FSNode>): number {
  return Object.values(nodes).filter(n => n.deleted).length;
}
