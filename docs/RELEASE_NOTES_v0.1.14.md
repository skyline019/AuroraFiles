## Aurora Files v0.1.14

Windows x64。发布仓：[skylinezhanghan-wq/AuroraFiles](https://github.com/skylinezhanghan-wq/AuroraFiles)。  
签名：**CN=skyline019**（自签）。

### Highlights

- **真正修好深搜夹杂** — 索引为省空间会删掉 `kind==='file'`；旧逻辑把缺 kind 当「无文件」导致 `foldersFirstStable` 空转。现三层归一：`searchFiles` / store hydrate / `isFolderLike`
- **分组常驻** — `groupBy` 换目录不丢；E: 等仅文件夹卷根也始终显示「分组」开关（不再因没有类型芯片整条隐藏）
- **退出搜索保留分组** — Esc / 清搜索不清 `groupBy`
- **视觉自证契约** — `e2e/group-persist.visual.spec.ts` 自动截图 + 录屏 + `report.json` 断言

### Downloads

| File | Notes |
|---|---|
| `AuroraFiles-Setup-0.1.14.exe` | NSIS；已签名 |
| `AuroraFiles-Portable-0.1.14.exe` | Portable；已签名 |
| `latest.yml` | electron-updater feed |

### Verify

```bash
npx vitest run src/lib/groupItems*.test.ts src/lib/presentDeepHits.test.ts src/lib/searchGroupLifecycle.test.ts electron/index/searchFiles.test.ts
AURORA_PERF_RUN_ID=group-persist-1 npx playwright test e2e/group-persist.visual.spec.ts e2e/search-group.contract.spec.ts e2e/category-browse.spec.ts
Get-AuthenticodeSignature .\release\AuroraFiles-Setup-0.1.14.exe
```

### Known limitations

- 自签非 EV；SmartScreen 可能提示
- 须安装本版后验证：E: 卷根应始终能开「分组」；深搜短查询文件夹整块在前

MIT · © 2026 [skylinezhanghan-wq](https://github.com/skylinezhanghan-wq) · signed by skyline019
