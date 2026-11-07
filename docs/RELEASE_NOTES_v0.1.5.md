## Aurora Files v0.1.5

Windows x64。发布仓：[skylinezhanghan-wq/AuroraFiles](https://github.com/skylinezhanghan-wq/AuroraFiles)。  
签名：**CN=skyline019**（自签；SmartScreen 信誉仍需累积）。

### Highlights

- **右键菜单修复** — 外点关闭不再抢在菜单项 `click` 之前；Escape 优先关闭菜单
- **E2E 功能覆盖** — `context-menu` + `features-coverage`（导航 / 视图 / 剪贴板 / 回收站 / Quick Look / 重命名 / 命令面板 / 索引面板等）
- **脚本** — `npm run test:e2e:features`

### Downloads

| File | Notes |
|---|---|
| `AuroraFiles-Setup-0.1.5.exe` | NSIS；已签名 |
| `AuroraFiles-Portable-0.1.5.exe` | Portable；已签名 |
| `latest.yml` | electron-updater feed |

### Verify

```bash
npm ci
npm run typecheck
npm run test:e2e:features
Get-AuthenticodeSignature .\release\AuroraFiles-Setup-0.1.5.exe
```

### Known limitations

- 自签证书非 EV；首次运行仍可能被 SmartScreen 拦截
- ffmpeg **GPL**；PPTX 预览仍为近似画布
- 日常索引请保持 **UI 轨**

MIT · © 2026 [skylinezhanghan-wq](https://github.com/skylinezhanghan-wq) · signed by skyline019
