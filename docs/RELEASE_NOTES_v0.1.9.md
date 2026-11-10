## Aurora Files v0.1.9

Windows x64。发布仓：[skylinezhanghan-wq/AuroraFiles](https://github.com/skylinezhanghan-wq/AuroraFiles)。  
签名：**CN=skyline019**（自签）。

### Highlights

- **输入即深搜** — 48ms 防抖自动走卷索引；不必再按 Enter
- **封口索引信任空结果** — 就绪索引无命中时禁止整卷 walk（E: 可省数秒）
- **冷启动加速** — NDJSON hydrate 后自动落盘 `.aidx`，避免下次数分钟卡住
- **walk 兜底** — 交互默认 2.5s deadline + 更高并发
- **冒烟脚本** — `test:real-search-index` 测完强制 dispose，不残留 indexd

### Downloads

| File | Notes |
|---|---|
| `AuroraFiles-Setup-0.1.9.exe` | NSIS；已签名 |
| `AuroraFiles-Portable-0.1.9.exe` | Portable；已签名 |
| `latest.yml` | electron-updater feed |

### Verify

```bash
npx vitest run electron/index/searchFiles.test.ts
npm run test:real-search-cwd
npm run test:real-search-index
npx playwright test e2e/deep-search.spec.ts e2e/demo-ux.spec.ts
Get-AuthenticodeSignature .\release\AuroraFiles-Setup-0.1.9.exe
```

实测参考：本机索引就绪后 E: 搜「问」→ `index-native-under` · ~8ms · 5 hits。

### Known limitations

- 自签非 EV；SmartScreen 可能提示
- 首次从 NDJSON 升级到 `.aidx` 仍可能慢一次
- 结果数默认上限 800

MIT · © 2026 [skylinezhanghan-wq](https://github.com/skylinezhanghan-wq) · signed by skyline019
