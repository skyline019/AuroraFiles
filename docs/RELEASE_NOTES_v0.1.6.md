## Aurora Files v0.1.6

Windows x64。发布仓：[skylinezhanghan-wq/AuroraFiles](https://github.com/skylinezhanghan-wq/AuroraFiles)。  
签名：**CN=skyline019**（自签；SmartScreen 信誉仍需累积）。

### Highlights

- **索引状态** — 建索进度用 `scanned` 显示「索引中 · N 项」，不再长期卡在「正在建立索引…」（native 冷扫早期 `size` 为 0）
- **UI 轨多盘串行** — 桌面所在卷优先，避免多卷并行抢 IO
- **默认无上限** — `maxScan` 默认 `0`（不截断）；旧偏好 `12万` / `200万` 自动迁移到 `0`
- **技术文档** — `docs/tex/aurora-index-search.pdf`（索引/搜索算法与性能数据，WSL xelatex）

### Downloads

| File | Notes |
|---|---|
| `AuroraFiles-Setup-0.1.6.exe` | NSIS；已签名 |
| `AuroraFiles-Portable-0.1.6.exe` | Portable；已签名 |
| `latest.yml` | electron-updater feed |

### Verify

```bash
npm ci
npm run typecheck
npx vitest run electron/index/indexPrefs.test.ts src/lib/indexLabel.test.ts
Get-AuthenticodeSignature .\release\AuroraFiles-Setup-0.1.6.exe
```

### Known limitations

- 自签证书非 EV；首次运行仍可能被 SmartScreen 拦截
- ffmpeg **GPL**；PPTX 预览仍为近似画布
- 日常索引请保持 **UI 轨**；无上限首建索时间随卷体量增加

MIT · © 2026 [skylinezhanghan-wq](https://github.com/skylinezhanghan-wq) · signed by skyline019
