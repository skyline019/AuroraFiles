## Aurora Files v0.1.8

Windows x64。发布仓：[skylinezhanghan-wq/AuroraFiles](https://github.com/skylinezhanghan-wq/AuroraFiles)。  
签名：**CN=skyline019**（自签）。

### Highlights

- **任意词无延迟查找** — 索引有数据立刻 contains + 当前位置过滤；未命中则 **并行 Dirent** 深扫（满额早停）
- **多词 AND** — 空格分词，名/路径子串均需命中（真盘 walk + 演示盘深搜）
- **CJK 召回** — 索引空命中回退 walk；短词/汉字优先 contains
- **真盘冒烟** — `npm run test:real-search-cwd`（默认 `E:\canvas` ×「问」）
- **Playwright** — `e2e/deep-search.spec.ts` 覆盖嵌套 / 多词

### Downloads

| File | Notes |
|---|---|
| `AuroraFiles-Setup-0.1.8.exe` | NSIS；已签名 |
| `AuroraFiles-Portable-0.1.8.exe` | Portable；已签名 |
| `latest.yml` | electron-updater feed |

### Verify

```bash
npx vitest run electron/index/searchFiles.test.ts
npm run test:real-search-cwd
npx playwright test e2e/deep-search.spec.ts e2e/demo-ux.spec.ts
Get-AuthenticodeSignature .\release\AuroraFiles-Setup-0.1.8.exe
```

实测参考：`E:\canvas` 搜「问」→ `walk-parallel` · ~200ms · 命中评委问答页。

### Known limitations

- 自签非 EV；SmartScreen 可能提示
- 超大卷首次无索引时 walk 仍受磁盘速度限制；有索引后应为瞬时
- 结果数默认上限 800

MIT · © 2026 [skylinezhanghan-wq](https://github.com/skylinezhanghan-wq) · signed by skyline019
