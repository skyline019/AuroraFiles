## Aurora Files v0.1.12

Windows x64。发布仓：[skylinezhanghan-wq/AuroraFiles](https://github.com/skylinezhanghan-wq/AuroraFiles)。  
签名：**CN=skyline019**（自签）。

### Highlights

- **文件夹独立成组** — 开启「分组」时所有文件夹归入「文件夹」一节，不再混进图片/文档等分类
- **分类芯片不带文件夹** — 点类型筛选只显示该类文件；分组开启时才保留文件夹节
- **分组不常驻** — 换目录 / 前进 / 后退自动清除分组、筛选与折叠状态

### Downloads

| File | Notes |
|---|---|
| `AuroraFiles-Setup-0.1.12.exe` | NSIS；已签名 |
| `AuroraFiles-Portable-0.1.12.exe` | Portable；已签名 |
| `latest.yml` | electron-updater feed |

### Verify

```bash
npx vitest run src/lib/groupItems.test.ts
npx playwright test e2e/category-browse.spec.ts
Get-AuthenticodeSignature .\release\AuroraFiles-Setup-0.1.12.exe
```

### Known limitations

- 自签非 EV；SmartScreen 可能提示
- 分组网格对超大目录不做跨节虚拟化（可先筛选再分组）

MIT · © 2026 [skylinezhanghan-wq](https://github.com/skylinezhanghan-wq) · signed by skyline019
