# Index tracks — UI vs Perf

建索 **UI 轨** 与 **Perf 轨** 完全分轨，默认互不掺旋钮。实现：[`electron/index/indexTrack.mjs`](../electron/index/indexTrack.mjs)。

## Why

| 问题 | 处理 |
|---|---|
| 高并发 walk + walk 中同步还 FTS 债 | 主进程饿死 → 进夹/拖动卡顿 |
| 压测要冲吞吐 | 需要另一套高并发 / 涓流参数 |

## Tracks

| | **UI**（默认） | **Perf** |
|---|---|---|
| 目标 | 建索时界面可操作 | 冲吞吐 / bakeoff / 体积压测 |
| `maxPerf` | `false` | `true` |
| 并发 | 低（约 `min(12, cpus)`） | 高（可达 32–128） |
| `yieldEvery` | 512 | 8192 |
| walk 中 FTS 涓流 | **关** | **开** |
| 债清偿节奏 | 较疏（interval ~40ms） | 较密 |

## Resolution order

1. `opts.maxPerf === true` → **perf**
2. `opts.track` / `opts.indexTrack`
3. env `AURORA_INDEX_TRACK=ui|perf`
4. persisted prefs `indexTrack`（索引面板可改）
5. default **`ui`**

IPC `fs:ensureIndex` / `ensureIndexes` 默认塞 `track: 'ui'`；压测脚本应显式 `track: 'perf'` 或 `maxPerf: true`。

## Prefs & UI

- `index-prefs.json`：`maxScan`（默认 **0 = 无上限**；正数夹到 5k–50M）、`excludeNames`、`indexTrack`
- 旧默认 `120000` / `2000000` 加载时自动迁移到 `0`
- 索引面板：「建索轨」单选 + 重建时带上当前轨

## Status

`indexStatus.indexTrack` 反映本卷最近一次建索轨。

## Related

- Walk：[`electron/index/fastWalk.mjs`](../electron/index/fastWalk.mjs) 读 `walkKnobsFromOpts`
- 编排：[`electron/index/fsIndex.mjs`](../electron/index/fsIndex.mjs) `applyIndexTrack` at `ensureIndexed` entry
- Volume perf：`npm run test:perf-volume`（`track: 'perf'`）
