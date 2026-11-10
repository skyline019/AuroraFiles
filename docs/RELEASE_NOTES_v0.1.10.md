## Aurora Files v0.1.10

Windows x64。发布仓：[skylinezhanghan-wq/AuroraFiles](https://github.com/skylinezhanghan-wq/AuroraFiles)。  
签名：**CN=skyline019**（自签）。

### Highlights

- **按类型筛选** — 分类芯片（图片/视频/文档/…）；文件夹始终保留便于导航
- **按类型分组** — 列表虚拟节头可折叠；网格流式分节；画廊共用同一过滤
- **`type:` 搜索** — 本地可见项与深搜结果支持类型过滤
- **轻量动效** — 芯片选中 / 视图切换 CSS 过渡（Electron 无 framer）
- **内存收敛** — 缩略图 LRU 收紧 + 离屏丢弃；深搜轻量节点并在清除时 prune

### Downloads

| File | Notes |
|---|---|
| `AuroraFiles-Setup-0.1.10.exe` | NSIS；已签名 |
| `AuroraFiles-Portable-0.1.10.exe` | Portable；已签名 |
| `latest.yml` | electron-updater feed |

### Verify

```bash
npx vitest run src/lib/groupItems.test.ts
npx playwright test e2e/category-browse.spec.ts e2e/deep-search.spec.ts
Get-AuthenticodeSignature .\release\AuroraFiles-Setup-0.1.10.exe
```

### Known limitations

- 自签非 EV；SmartScreen 可能提示
- 分组网格对超大目录不做跨节虚拟化（可先筛选再分组）

MIT · © 2026 [skylinezhanghan-wq](https://github.com/skylinezhanghan-wq) · signed by skyline019
