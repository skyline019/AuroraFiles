import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import { deepSearchBusyLabel, previewFailHint } from './previewFail';
import { PreviewFail } from '@/components/PreviewPane';
import type { FSNode } from './fs';

describe('previewFailHint', () => {
  it('explains open-system / ffmpeg / office / default', () => {
    expect(previewFailHint('x', 'open-system')).toMatch(/系统默认应用/);
    expect(previewFailHint('需要 ffmpeg 转码')).toMatch(/内置转码|系统应用/);
    expect(previewFailHint('当前环境无法读取')).toMatch(/Electron/);
    expect(previewFailHint('旧版 .xls 可能无法解析')).toMatch(/Office|另存为/);
    expect(previewFailHint('图片损坏')).toMatch(/打开/);
  });
});

describe('deepSearchBusyLabel', () => {
  it('includes query when present', () => {
    expect(deepSearchBusyLabel('report')).toBe('正在深度搜索“report”…');
    expect(deepSearchBusyLabel('  ')).toBe('正在深度搜索…');
  });
});

describe('PreviewFail smoke', () => {
  it('renders message, hint and open CTA', () => {
    const node = {
      id: 'C:\\a.xlsx',
      name: 'a.xlsx',
      kind: 'file',
      parentId: 'C:\\',
      childrenIds: [],
      size: 1,
      createdAt: 0,
      modifiedAt: 0,
      accessedAt: 0,
      tags: [],
    } as FSNode;
    const html = renderToStaticMarkup(
      createElement(PreviewFail, {
        node,
        message: '旧版 .xls 可能无法解析，请另存为 .xlsx 或用 Excel 打开',
        hint: previewFailHint('旧版 .xls 可能无法解析'),
        canOpen: true,
      }),
    );
    expect(html).toContain('旧版 .xls');
    expect(html).toContain('用系统应用打开');
    expect(html).toMatch(/Office|另存为/);
  });
});

describe('deep search loading smoke', () => {
  it('busy label is stable for LocationHeader copy', () => {
    const label = deepSearchBusyLabel('发票');
    expect(label).toContain('发票');
    expect(label).toContain('深度搜索');
    // 模拟标题条片段
    const html = renderToStaticMarkup(
      createElement('span', { 'data-testid': 'deep-search-busy' }, label),
    );
    expect(html).toContain('data-testid="deep-search-busy"');
    expect(html).toContain(label);
  });
});
