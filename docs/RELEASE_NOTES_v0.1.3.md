## Aurora Files v0.1.3

Windows x64 迭代包（相对 v0.1.0）。未签名；SmartScreen 可能提示。

### Highlights (0.1.1 → 0.1.3)

- **预览** — 非 PNG（JPEG/WebP/BMP…）经 MIME + nativeImage/ffmpeg 可预览；CJK / 长路径转码稳定
- **索引上限** — 默认 maxScan **200 万**（硬顶 5000 万；`0`≈不截断）；旧 12 万偏好自动迁移
- **UI / Perf 双轨** — 默认保交互建索；压测/面板可选 Perf 轨（见 `docs/index-tracks.md`）
- **进夹流畅** — 并发 `listDir`、索引就绪跳过重复 `ensureIndex`、有缓存静默刷新、活跟随只挂一次
- **冷启动** — 瘦 asar + splash 注入 `entry.js`；启动门禁见 `test:perf-startup`

### Downloads

| File | Notes |
|---|---|
| `AuroraFiles-Setup-0.1.3.exe` | NSIS（~148 MB，含 ffmpeg extraResource） |
| `AuroraFiles-Portable-0.1.3.exe` | Portable |
| `latest.yml` | electron-updater feed stub |

本地解包目录常为 `release-0.1.3/win-unpacked/`（若 `release/win-unpacked` 被占用）。

### Verify

```bash
npm ci
npm test
npx electron scripts/perf/smoke-image-preview.mjs
# after pack:
AURORA_SMOKE_REQUIRE=1 npm run test:smoke-win
```

### Known limitations

- Unsigned；ffmpeg **GPL**
- HEIC/部分 RAW 依赖本机 ffmpeg 编解码器；失败时可「用系统应用打开」
- Perf 轨建索仍会明显占用 CPU；日常请保持 **UI 轨**
- PPTX 预览仍为近似画布

MIT · © 2026 skyline019
