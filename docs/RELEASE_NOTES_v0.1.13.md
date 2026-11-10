## Aurora Files v0.1.13

Windows x64。发布仓：[skylinezhanghan-wq/AuroraFiles](https://github.com/skylinezhanghan-wq/AuroraFiles)。  
签名：**CN=skyline019**（自签）。

### Highlights

- **深搜不再夹杂** — 命中结果文件夹稳定置顶，区内保留相关度序
- **退出搜索保留分组** — Esc / 清除搜索不清 `groupBy`；仅进新目录时复位
- **back/forward 不剥分组** — 历史前进后退保留分组与筛选
- **硬契约测试** — 分组/置顶/生命周期 unit + e2e 边缘覆盖

### Downloads

| File | Notes |
|---|---|
| `AuroraFiles-Setup-0.1.13.exe` | NSIS；已签名 |
| `AuroraFiles-Portable-0.1.13.exe` | Portable；已签名 |
| `latest.yml` | electron-updater feed |

### Verify

```bash
npx vitest run src/lib/groupItems*.test.ts src/lib/presentDeepHits.test.ts src/lib/searchGroupLifecycle.test.ts
npx playwright test e2e/search-group.contract.spec.ts e2e/category-browse.spec.ts e2e/deep-search.spec.ts
Get-AuthenticodeSignature .\release\AuroraFiles-Setup-0.1.13.exe
```

### Known limitations

- 自签非 EV；SmartScreen 可能提示
- 分组网格对超大目录不做跨节虚拟化（可先筛选再分组）

MIT · © 2026 [skylinezhanghan-wq](https://github.com/skylinezhanghan-wq) · signed by skyline019
