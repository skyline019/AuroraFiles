/** 预览失败态文案：供 PreviewPane 与烟测共用 */

export function previewFailHint(message: string, meta?: string): string {
  if (meta === 'open-system') return '可双击或点下方按钮用系统默认应用打开';
  if (message.includes('ffmpeg') || /HEIC|HEIF|TIFF|AVIF|NEF|CR2|DNG|转码/.test(message)) {
    return '内置转码失败时可改用系统应用打开；开发环境请运行 npm run ffmpeg:ensure';
  }
  if (message.includes('环境')) return '请在桌面版（Electron）中打开本机文件';
  if (message.includes('.xls') || message.includes('.doc') || message.includes('.ppt')) {
    return '旧版 Office 格式内嵌支持有限，建议另存为新格式或用系统应用打开';
  }
  return '若文件损坏或受权限保护，请尝试「打开」或「在文件夹中显示」';
}

export function deepSearchBusyLabel(query: string): string {
  const q = query.trim();
  return q ? `正在深度搜索“${q}”…` : '正在深度搜索…';
}
