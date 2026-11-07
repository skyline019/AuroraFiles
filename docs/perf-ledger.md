# Perf optimization ledger

Baseline: `perf-out/ui-verify-1` S-mem — open **188ms**, longtasks **4** (88/226/319/52).

| Idea | Baseline → Result | Verdict | Why |
|---|---|---|---|
| rAF scroll only | longtasks still 4 | keep as infra | Needed for window skip; alone insufficient |
| `useGridWindow` skip same-range setState | longtasks **3**, peaks softer (73/152/276); open **153ms** | **keep** | Avoids React commit on sub-row scrolls |
| NameLabel narrow + GridCell memo + lite DocIcon (no Lucide on text) | open **104ms**; longtasks **4** (62/151/61/279) | **keep** | Open clearly better; scroll still warn (>2) under aggressive harness |

| Narrow `useFileHandlers` + grid event delegation + `key=slot-i` recycle | open **133ms**; longtasks **3** (65/154/260) | **keep** | Below baseline open; longtasks 4→3; demo-ux green |

| ListView delegation + slot keys; harness paced vs fling (fixed buffered leak) | S-mem open **139ms**, paced LT **1**, fling LT **0**, **warn=[]**; S-files(8k) paced/fling LT **0**, warn=[] (`ui-list-paced-2`) | **keep** | Scroll gate cleared on paced; list view parity |

| sortNodes: Collator + size cache | unit <50ms for 200 folders | **keep** | size 排序不再反复 folderSize |
| Real-disk hang on USERPROFILE | AppData/junctions → expand BUILTIN_SKIP, skip reparse, deadline, no default home | **keep** | `test:perf-real` 默认 Downloads/Desktop/Documents/E:\\Agent |
| Volume high-pressure (整卷+隐藏) | `skipMode=minimal` + followReparse + realpath de-dup; `test:perf-volume` | **measure** | Only skip System Volume Information; include `$Recycle.Bin` / hidden |
| Volume scan algo | sequential lstat+per-file FTS → **parallel Dirent BFS + bulk ingest + deferred 2° indexes + one FTS rebuild** | **keep** | E:\\: **38k/300s (~128/s) → 1.10M/42s (~26k/s)**; hot **32ms**; mid-scan RSS ~0.8GB→seal ~2.8GB |
| Lean + IndexDebt 错峰 | 热路径 meta+byName；`debt.fts/frn/persist` 切片清偿；高压 `persist:false`；深路径 `winPath` | **keep** | 旧封口 ~2.8GB → lean T1 **~755MB/24s** → FTS 清 **~738MB/35s** → 搜后 **~592MB**；hot **20ms**；`volume-2026-11-06T23-31-42-731Z` warn=[] |
| 秒级口径 | 非承诺首次 Node 冷扫秒完百万 | **research** | 秒级 = hydrate + diff + 错峰债；见 `docs/research-volume-scan-diff.md` |
| Diff 夹具 | `test:perf-diff` 小树 K=100；FRN sync 后 softRefresh | **keep** | index 129ms；refresh ~839ms（脏目录路径）；USN 提权后可再压 |
| nameKey pathTag + slim Dirent | byName 键不再复制整 path；entry 省略 0 字段；默认不欠全量 FRN | **keep** | USN miss 才 nudge FRN；`memEstimate` 入 status |
| FRN 策略 | 全量 backfill 改为显式 `frnDebt` / USN 懒补 | **keep** | 整卷不再后台百万 stat |
| T1 谷期涓流 FTS | 修空 meta 误 clear；50k 阈值 + 自适应 ops + onIdle | **keep** | T1 还 **14万** FTS（~13%）；T1~24.7s T2~8.6s；`volume-2026-11-06T23-45-42-520Z` |
| 现栈极限 maxPerf | 队列 head 去 shift；join 手写；FTS 数组游标；禁 bulk 中 endRebuild 重来；高并发/yield | **keep** | E:\\：**T1 10.2s / 总 index 18.4s**（原 ~25s/~34s）；热搜 21ms；`volume-2026-11-07T00-00-19-003Z` |
| 空间极限（性能持平） | path↔Map 键共用；lean+FTS **弃 byName**；name 驻留池；文件省略 `kind` | **keep** | E:\\ ~110万：T1 **9.1s / 494MB** → 债清 **~512MB峰** → 搜后 **~370MB**；总 index **17.4s**；hot **28ms**；`volume-2026-11-07T00-07-54-204Z`（对照原稳态 ~592MB / T1~755MB） |
| Bakeoff JS vs Rust vs USN | 同机 E:\\ store/count；门槛 rss≤0.55× 或 thr≥1.5× | **rust adopt** | Rust store **14.5MB / 195k/s** vs JS **320MB / 125k/s**；USN Enum `skipped_no_priv` → mft=defer；`bakeoff-2026-11-07T00-23-33` |
| WalkEngine + rust child | NDJSON 流式 upsert；`AURORA_WALK_ENGINE` / verdict | **keep** | 120k smoke `full-scan-lean-hp-rust` 1.4s FTS hits；见 `docs/bakeoff-engine.md` |
| Hydrate-first 秒开 | 盘缓存可搜 → 异步 softRefresh | **keep** | sample searchable **40ms** hot **1ms** `disk-hydrate-first`；`test:perf-hydrate` |
| C++ MFT-enum + WalkEngine | `FSCTL_ENUM_USN_DATA` + FRN 拼路径；stream 含 `frn`；降级 mft→rust→js | **wired / mft=defer** | 无特权 `skipped_no_priv`；self-test OK；强制 mft 回退 rust 已验证；`bakeoff-2026-11-07T00-42-23` |
| Index resident (`aurora-indexd`) | 权威索引进 Rust 常驻；Node 编排 + FTS 侧车 + hydrate-first；不上 napi | **keep / measure** | `AURORA_INDEX_BACKEND=native`；`meta` 不持百万；门槛 Node≤150MB / indexd≤180MB / hot≤40ms；`docs/indexd-resident.md`；`test:perf-indexd` |
| indexd E:\\ 实测 | 1.100M · rust walk · `metaSize=0` · T1 **12.1s** · 总 **27.5s** · Node **252MB** · indexd **425MB** · 冷搜 508ms / 热缓存 **0ms** · png 50 hits | **partial** | 功能验收过（条目出 V8）；RSS 双双超门槛（Node 150 / indexd 180）；`indexd-2026-11-07T01-10-51-423Z` |
| indexd 深优 E:\\ | 同上体量 · T1 **8.9s** · 总 **9.7s** · Node **113MB** · indexd **170MB** · 冷 **1.4ms** / 热 **0ms** · warn=[] | **keep** | 去重 String 键→FxHash；name 别名 path 后缀；walk 直通 raw NDJSON；native 默认可跳过 FTS；`indexd-2026-11-07T01-24-49-509Z` |
| 父链 + `.aidx` | T1 **9.4s** · Node **49MB** · indexd **92MB** · 合计 **141MB** (~128MB/M) · 多词冷 **15ms** · warn=[] | **keep** | Everything 带 RSS；`AIDX` v2 快照；多词 AND 无 FTS；`indexd-2026-11-07T01-42-37-909Z` |
| bakeoff 再跑 | rust adopt；mft **仍 defer** (`skipped_no_priv`) | **defer mft** | `bakeoff-2026-11-07T01-41-31-313Z`；Admin 下 `test:perf-bakeoff:elevated` |
| 特权 bakeoff | MFT count/store **绿**（1.098M / 5.6s / 196k/s）；`mft=adopt` | **adopt** | FRN 48-bit + root#5 + path cache；`bakeoff-2026-11-07T01-51-06-129Z` |
| mft→indexd e2e | T1 **29s** / indexd 127MB（不如 rust T1~9s / 92MB） | **rust 优先** | sticky `engine_priority: [rust,mft,js]`；MFT 枚举可用，ingest 仍优化中 |
| **MFT FRN→indexd 直通** | T1 **7.3s** · searchable **7.3s** · Node **50MB** · indexd **126MB** · cold **4ms** · vs rust T1 **10.1s**/94MB | **mft 优先** | `stream-nodes` 无 path 物化；`upsert_node`+barrier relink；persist 异步（盘写 ~32s 不挡可搜）；USN 1.2s debounce / remove_frn / node upsert；`indexd-2026-11-07T02-05-05-915Z` |
| **RSS≤100 + aidx快写 + USN原生** | indexd **62MB** · persist **~0.13s** · Node ~107 · T1 ~11s · cold **4ms** · warn=[] | **keep** | dense FRN Vec + lazy `by_path`；BufWriter 整表写入；`persist_delta`；`mft-enum usn-read`；`indexd-2026-11-07T02-15-56-139Z` |
| **收尾：延迟 path_hash + delta hydrate** | T1 **4.4s** · persist **49ms** · indexd **62MB** · Node **105** · cold **1.7ms** · warn=[] | **keep** | barrier 不再 1M×`build_path`；`hydrate` 回放 `.aidx.d`；T1 后 `gc`；`indexd-2026-11-07T02-20-42-666Z` |
| **空间债 space + normalize_slice** | T1 **4.3s** · space **0.68s** · persist **42ms** · indexd **96MB**（path 就绪）· path_index_ready · warn=[] | **keep** | `debt.space` prio=3；path→shrink→arena；`.aidx.d`>8MB coalesce；`indexd-2026-11-07T02-26-40-205Z` |
| **path_slots + Node GC + coalesce** | T1 **6.2s** · space **2.6s** · Node **82** · indexd **69** · path ready · warn=[] | **keep** | OA `path_slots`(~5.5MB) 替 FxHashMap；MFT 跳过 name_intern；shrink 清 intern；小 walk 缓冲+双 GC；arena 单次 compact；`AURORA_AIDX_COALESCE_BYTES`；gate≤90；`indexd-2026-11-07T02-46-48-577Z` |
| **完整评估 ×3 + bakeoff** | T1 **6.2–7.1s** · Node **77–79** · indexd **68–70** · path✓ · cold **3–8ms** · hot **0** · bakeoff mft/rust **adopt** · warn=[]×3 | **keep** | unit 11+5 pass；`bakeoff-2026-11-07T02-50-56`；latest `indexd-2026-11-07T02-51-04-870Z` |
| **GUI 渲染全包（四视图虚拟化）** | S-mem open **357ms** paced/fling LT **0**；S-files open **208ms** LT **0**；virt DOM list/col/gal/grid **28/43/15/42** ≪ N；warn=[] | **keep** | `useVirtualWindow` 同窗跳过；ColumnPane+Gallery strip 虚拟化；thumb 并发≤4+IO；`ui-virt-1` |
| **Playwright 视觉+录像迭代** | 四视图截图+session.webm；DOM ≪ N；columns sh **75k**；gallery hero 跟随选中；warn=[] | **keep** | 末列 `column-scroll`；去掉列 `flex-col` 防内容被 shrink；Preview 嵌入图秒开；夹具 demo+idempotent inject；`ui-visual-11` |
| **前端体验打磨** | toast 抬高；状态栏「演示盘」；选中滚入可视；图库 Home/End；`ui-visual-14` 绿 | **keep** | `useEnsureSelectionVisible`；条带 scroll `auto` 减抖 |
| **冷启动自动化** | asar 291MB→5.6MB；无脚本 splash + 注入 `entry.js`；`listDrives`→`statfs`；median **ready 516ms / interactive 748ms**（弃首跑 AV） | **keep** | 门槛 ready≤2500 / interactive≤4500；`test:perf-startup`；首启仍可能 ~9s（Defender） |
| **索引状态栏显示** | softRefresh 不再冒充「正在建立索引」；chip `building/refreshing/ready` 色态；`test:e2e:index` 7 绿 | **keep** | 共用 `StatusBar`；`ready` 优先于陈旧 `building`；截图 `perf-out/index-status/` |
| **全链路 GUI 视觉** | `test:e2e:full-gui` 26 步截图+webm；`test:e2e:all-visual` 17 绿；修 AppWeb 中文/Dock 文案；overlay testid | **keep** | 产物 `perf-out/gui-full-latest/`；vite 忽略 `perf-out` 防 EBUSY |
| **非 PNG 预览 + CJK** | `aurora-file` 强制 MIME；`nativeImage`→ffmpeg；CJK 路径 ASCII 临时输入；烟测 jpg/webp/bmp/中文 webp | **keep** | `shared/auroraFileUrl`；`electron/mediaPath`；`scripts/perf/smoke-image-preview.mjs`；见 `docs/preview-media.md` |
| **索引上限解除** | 默认 maxScan **2M**（顶 50M；`0`≈不截断）；旧 120k 自动迁移；启动建索不再硬编码 120k | **keep** | `indexPrefs`；索引面板；`docs/index-tracks.md` |
| **UI / Perf 建索分轨** | UI：低并发、不涓流 FTS；Perf：`maxPerf` 高吞吐；prefs/`AURORA_INDEX_TRACK`/面板可选 | **keep** | `electron/index/indexTrack.mjs`；IPC 默认 UI；压测显式 `track:'perf'` |
| **进夹流畅（建索后）** | `listDir` 并发 48；就绪跳过 `ensureIndex`；hydrate 代数合并；有缓存静默刷新；活跟随只挂一次；USN/softRefresh/债清偿降频 | **keep** | v0.1.3；`hydrateFolder` patch 合并；避免每次进夹 attach USN |

Next candidates: T1 再压（arena 重建占 space~2.5s）；非特权路径体验；代码签名压低首启 AV；进夹与缩略图预算联合剖析（大图目录）。
