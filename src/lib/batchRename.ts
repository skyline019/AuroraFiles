/** 批量重命名规则（纯函数，便于单测） */

export type BatchPreset = 'sequence' | 'datePrefix' | 'lower' | 'upper' | 'replace';

export interface BatchRule {
  preset: BatchPreset;
  pattern?: string; // 自定义：{n} {name} {ext} {date}
  find?: string;
  replaceWith?: string;
  start?: number;
}

export function applyBatchName(
  original: string,
  index: number,
  rule: BatchRule,
  now = new Date(),
): string {
  const dot = original.lastIndexOf('.');
  const hasExt = dot > 0;
  const stem = hasExt ? original.slice(0, dot) : original;
  const ext = hasExt ? original.slice(dot) : '';
  const n = (rule.start ?? 1) + index;
  const date = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, '0'),
    String(now.getDate()).padStart(2, '0'),
  ].join('');

  if (rule.pattern) {
    return rule.pattern
      .split('{n}').join(String(n).padStart(3, '0'))
      .split('{name}').join(stem)
      .split('{ext}').join(ext)
      .split('{date}').join(date);
  }

  switch (rule.preset) {
    case 'sequence':
      return `${stem}-${String(n).padStart(3, '0')}${ext}`;
    case 'datePrefix':
      return `${date}_${stem}${ext}`;
    case 'lower':
      return original.toLowerCase();
    case 'upper':
      return stem.toUpperCase() + ext.toLowerCase();
    case 'replace': {
      const find = rule.find ?? '';
      if (!find) return original;
      return original.split(find).join(rule.replaceWith ?? '');
    }
    default:
      return `${stem}-${String(n).padStart(3, '0')}${ext}`;
  }
}
