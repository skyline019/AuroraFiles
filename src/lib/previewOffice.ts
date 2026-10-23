/**
 * Office 预览分块：动态 import 时单独成 chunk，避免拖垮首屏
 */
import { extOf } from './fs';
import { api } from './aurora';

const MAX_OFFICE = 12_000_000;

export type OfficeProgress = (pct: number, label?: string) => void;

async function loadOfficeBuffer(absPath: string, onProgress?: OfficeProgress): Promise<ArrayBuffer> {
  onProgress?.(8, '读取文件…');
  const { base64, size } = await api().readBinary(absPath, MAX_OFFICE);
  if (size > MAX_OFFICE) throw new Error('文件过大，无法内嵌预览');
  onProgress?.(35, '解码…');
  const bin = atob(base64);
  const bytes = new Uint8Array(bin.length);
  const step = Math.max(1, Math.floor(bin.length / 40));
  for (let i = 0; i < bin.length; i++) {
    bytes[i] = bin.charCodeAt(i);
    if (i % step === 0) onProgress?.(35 + Math.floor((i / bin.length) * 25), '解码…');
  }
  onProgress?.(62, '解析文档…');
  return bytes.buffer;
}

export async function previewDocx(absPath: string, name: string, onProgress?: OfficeProgress) {
  if (extOf(name) === 'doc') {
    return { kind: 'docx' as const, error: '旧版 .doc 请用系统应用打开；建议另存为 .docx' };
  }
  const mammoth = await import('mammoth');
  const buf = await loadOfficeBuffer(absPath, onProgress);
  onProgress?.(75, '转换 HTML…');
  const result = await mammoth.convertToHtml({ arrayBuffer: buf });
  onProgress?.(100, '完成');
  return {
    kind: 'docx' as const,
    html: result.value || '<p>（空文档）</p>',
    meta: '版式为近似渲染 · 不含页眉页脚与复杂浮动图',
  };
}

export async function previewXlsx(absPath: string, name: string, onProgress?: OfficeProgress) {
  try {
    const XLSX = await import('xlsx');
    const buf = await loadOfficeBuffer(absPath, onProgress);
    onProgress?.(78, '解析工作表…');
    const wb = XLSX.read(buf, { type: 'array', cellDates: true });
    if (!wb.SheetNames?.length) {
      return { kind: 'xlsx' as const, error: '工作簿为空或无法解析' };
    }
    const sheets = wb.SheetNames.slice(0, 8).map((sheetName) => {
      const sheet = wb.Sheets[sheetName];
      const rows = XLSX.utils.sheet_to_json<(string | number | boolean | null)[]>(sheet, {
        header: 1,
        defval: '',
        raw: false,
      }) as string[][];
      return {
        name: sheetName,
        rows: rows.slice(0, 80).map((r) => (r as unknown[]).slice(0, 24).map((c) => String(c ?? ''))),
      };
    });
    onProgress?.(100, '完成');
    return { kind: 'xlsx' as const, sheets, meta: '前 80 行 × 24 列 · 不含图表与合并单元格样式' };
  } catch (err) {
    const tip = extOf(name) === 'xls'
      ? '旧版 .xls 可能无法解析，请另存为 .xlsx 或用 Excel 打开'
      : (err instanceof Error ? err.message : '表格解析失败');
    return { kind: 'xlsx' as const, error: tip };
  }
}

export async function previewPptx(absPath: string, name: string, onProgress?: OfficeProgress) {
  if (extOf(name) === 'ppt') {
    return { kind: 'pptx' as const, error: '旧版 .ppt 请用系统应用打开；建议另存为 .pptx' };
  }
  const buf = await loadOfficeBuffer(absPath, onProgress);
  onProgress?.(72, '解析幻灯片版式…');
  const { parsePptxVisual } = await import('./previewPptx');
  const { slides } = await parsePptxVisual(buf, onProgress);
  onProgress?.(100, '完成');
  return {
    kind: 'pptx' as const,
    slides,
    meta: '幻灯片级近似预览 · 含位置与图片 · 不含动画/SmartArt/图表',
  };
}
