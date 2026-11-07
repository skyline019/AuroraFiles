## Aurora Files v0.1.4

Windows x64 包，发布仓：**[skylinezhanghan-wq/AuroraFiles](https://github.com/skylinezhanghan-wq/AuroraFiles)**。  
Authenticode 签名主体：**CN=skyline019**（自签证书；SmartScreen 信誉仍需累积）。

### Highlights

- **文档与主仓对齐** — clone / CI 徽章 / Releases 指向当前账号仓库
- **CI 门禁修通** — typecheck（`vite-env` / `allowJs` / shared `.d.ts`）；Linux 单测保留 POSIX 路径（勿 `win32.normalize('/tmp')`）
- **签名发包** — Setup / Portable / 主程序由 `CN=skyline019` 签名；`latest.yml` 随包发布

### Downloads

| File | Notes |
|---|---|
| `AuroraFiles-Setup-0.1.4.exe` | NSIS（含 ffmpeg）；已签名 |
| `AuroraFiles-Portable-0.1.4.exe` | Portable；已签名 |
| `latest.yml` | electron-updater feed |

### Verify

```bash
npm ci
npm run typecheck
npm test -- --run
# signed pack (local):
#   CSC_LINK=…/skyline019-codesign.pfx CSC_KEY_PASSWORD=… npm run build:desktop:signed
AURORA_SMOKE_REQUIRE=1 npm run test:smoke-win
```

签名抽查（PowerShell）：

```powershell
Get-AuthenticodeSignature .\release\AuroraFiles-Setup-0.1.4.exe | Format-List *
```

### Known limitations

- 签名证书为 **自签 CN=skyline019**，非 EV/商业 CA；首次运行仍可能被 SmartScreen 拦截
- ffmpeg **GPL**；HEIC/部分 RAW 依赖编解码器
- 日常请保持索引 **UI 轨**；Perf 轨仅压测
- PPTX 预览仍为近似画布

MIT · © 2026 [skylinezhanghan-wq](https://github.com/skylinezhanghan-wq) · signed by skyline019
