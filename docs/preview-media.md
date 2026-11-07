# Media preview

桌面版图片 / 视频预览链路（Electron 主进程 + `aurora-file://`）。

## Pipeline

```
渲染进程
  ├─ 原生可直解（jpg/png/gif/webp/bmp…）→ aurora-file:// URL（分段 percent-encode）
  │     onError → IPC imagePreview → JPEG data URL
  └─ 难解码（heic/tiff/avif/raw…）→ 直接 imagePreview
主进程 convertImagePreview
  1) nativeImage（\\?\ 长路径；失败则 readFile + createFromBuffer）
  2) ffmpeg 抽 1 帧 JPEG（CJK/非 ASCII 路径先拷到 ASCII 临时文件）
```

共享 MIME / URL：[`shared/auroraFileUrl.mjs`](../shared/auroraFileUrl.mjs)  
路径助手：[`electron/mediaPath.mjs`](../electron/mediaPath.mjs)  
协议：[`electron/main.mjs`](../electron/main.mjs) `aurora-file` 强制 `Content-Type`（Chromium 对 JPEG/WebP 常嗅探失败，PNG 往往仍可）。

## ffmpeg

- 开发：`node_modules/ffmpeg-static/ffmpeg.exe`（`npm run ffmpeg:ensure`）
- 打包：`extraResources` → `resources/ffmpeg/ffmpeg.exe`（见 `package.json` / `electron-builder.yml`）
- 解析：[`electron/ffmpegPath.mjs`](../electron/ffmpegPath.mjs)

**GPL**：随包装发须遵守 ffmpeg-static 许可。

## Smoke

```bash
npx electron scripts/perf/smoke-image-preview.mjs
```

覆盖 jpg / png / webp / bmp、空格路径、中文目录 webp。

## UX notes

- 缩略图：协议失败时 `ImageThumb` 会再走 `convertImageThumbUrl`
- 预览窗：`PreviewPane` 对非 `data:` 失败只转码一次（`convertTried`）
- 视频封面：`videoPoster` 同样走 CJK-safe ffmpeg 输入
