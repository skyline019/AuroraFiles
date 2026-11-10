## Aurora Files v0.1.7

Windows x64。发布仓：[skylinezhanghan-wq/AuroraFiles](https://github.com/skylinezhanghan-wq/AuroraFiles)。  
签名：**CN=skyline019**（自签）。

### Highlights

- **当前位置深搜** — 从当前文件夹起递归全部子目录/文件；深度默认 64（不再硬顶 6），`maxScan=0` 无上限
- **无延迟路径** — 卷索引就绪时按路径前缀瞬时过滤；否则立刻 Dirent walk（跳过 `warmShallow`）
- **演示盘对齐** — Enter 深搜同样递归子孙；Playwright `e2e/deep-search.spec.ts`

### Downloads

| File | Notes |
|---|---|
| `AuroraFiles-Setup-0.1.7.exe` | NSIS；已签名 |
| `AuroraFiles-Portable-0.1.7.exe` | Portable；已签名 |
| `latest.yml` | electron-updater feed |

### Verify

```bash
npm ci
npx vitest run electron/index/searchFiles.test.ts
npx playwright test e2e/deep-search.spec.ts e2e/demo-ux.spec.ts
Get-AuthenticodeSignature .\release\AuroraFiles-Setup-0.1.7.exe
```

### Known limitations

- 自签证书非 EV；SmartScreen 可能仍提示
- ffmpeg **GPL**；PPTX 预览仍为近似画布
- 超深超大目录 walk 仍可能截断于结果数上限（默认 800）

MIT · © 2026 [skylinezhanghan-wq](https://github.com/skylinezhanghan-wq) · signed by skyline019
