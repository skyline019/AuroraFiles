import type { Category } from './fs';

/** 分类芯片 / 节头中文标签 */
export const CATEGORY_LABEL: Record<Category | 'folder', string> = {
  folder: '文件夹',
  image: '图片',
  video: '视频',
  audio: '音频',
  archive: '压缩包',
  app: '应用',
  code: '代码',
  doc: '文档',
  sheet: '表格',
  slide: '演示',
  pdf: 'PDF',
  text: '文本',
  font: '字体',
  db: '数据库',
  sys: '系统',
  link: '快捷方式',
  other: '其他',
};

/** 分类条优先展示顺序（出现才渲染） */
export const CATEGORY_CHIP_ORDER: Category[] = [
  'image',
  'video',
  'doc',
  'sheet',
  'pdf',
  'audio',
  'archive',
  'code',
  'text',
  'slide',
  'app',
  'other',
];

/** 分组节顺序：文件夹优先，再按常用类型 */
export const CATEGORY_SECTION_ORDER: Array<Category | 'folder'> = [
  'folder',
  'image',
  'video',
  'audio',
  'doc',
  'sheet',
  'slide',
  'pdf',
  'text',
  'code',
  'archive',
  'app',
  'font',
  'db',
  'sys',
  'link',
  'other',
];

/** 与 FileGlyph CAT_COLOR 对齐的色点 */
export const CATEGORY_DOT: Record<Category | 'folder', string> = {
  folder: '#0a84ff',
  image: '#c084fc',
  video: '#a88bff',
  audio: '#ff6482',
  archive: '#c07f2e',
  app: '#3b82f6',
  code: '#334155',
  doc: '#2b579a',
  sheet: '#217346',
  slide: '#d24726',
  pdf: '#e2574c',
  text: '#64748b',
  font: '#7048e8',
  db: '#0e7490',
  sys: '#75808f',
  link: '#0a84ff',
  other: '#8e8e93',
};

export function categoryLabel(key: Category | 'folder'): string {
  return CATEGORY_LABEL[key] ?? key;
}

/** type: 查询词 → Category（支持扩展名或中文/英文别名） */
export function typeTokenToCategory(token: string): Category | null {
  const t = String(token || '').trim().toLowerCase().replace(/^\./, '');
  if (!t) return null;
  const alias: Record<string, Category> = {
    image: 'image', img: 'image', photo: 'image', 图片: 'image',
    video: 'video', movie: 'video', 视频: 'video',
    audio: 'audio', music: 'audio', 音频: 'audio', 音乐: 'audio',
    archive: 'archive', zip: 'archive', 压缩: 'archive', 压缩包: 'archive',
    app: 'app', exe: 'app', 应用: 'app',
    code: 'code', 代码: 'code',
    doc: 'doc', word: 'doc', 文档: 'doc',
    sheet: 'sheet', excel: 'sheet', xls: 'sheet', xlsx: 'sheet', 表格: 'sheet',
    slide: 'slide', ppt: 'slide', 演示: 'slide',
    pdf: 'pdf',
    text: 'text', txt: 'text', 文本: 'text',
    font: 'font', 字体: 'font',
    db: 'db', 数据库: 'db',
    sys: 'sys', 系统: 'sys',
    link: 'link', 快捷方式: 'link',
    other: 'other', 其他: 'other',
  };
  if (alias[t]) return alias[t];
  // 单扩展名：由调用方用 categoryOf 判断；此处仅认已知别名
  return null;
}
