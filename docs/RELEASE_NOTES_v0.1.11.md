## Aurora Files v0.1.11

Windows x64。发布仓：[skylinezhanghan-wq/AuroraFiles](https://github.com/skylinezhanghan-wq/AuroraFiles)。  
签名：**CN=skyline019**（自签）。

### Highlights

- **修复深搜极慢** — 查询不再默认触发整卷 `ensureIndexed(maxDepth:64)`（曾与 walk 抢磁盘）
- **损坏 `.aidx` 自愈** — 空壳/过小 aidx 自动回退 NDJSON 并重写二进制索引
- 深搜防抖 120ms；索引命中路径实测 E:「问」约 **8ms**

### Downloads

| File | Notes |
|---|---|
| `AuroraFiles-Setup-0.1.11.exe` | NSIS；已签名 |
| `AuroraFiles-Portable-0.1.11.exe` | Portable；已签名 |
| `latest.yml` | electron-updater feed |

### Verify

```bash
npx vitest run electron/index/searchFiles.test.ts
npm run test:real-search-index
Get-AuthenticodeSignature .\release\AuroraFiles-Setup-0.1.11.exe
```

MIT · © 2026 [skylinezhanghan-wq](https://github.com/skylinezhanghan-wq) · signed by skyline019
