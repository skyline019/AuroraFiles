# Aurora Files — Build & Release

当前版本：**0.1.3**（见根目录 `package.json`）。发布说明：[`RELEASE_NOTES_v0.1.3.md`](./RELEASE_NOTES_v0.1.3.md)。

## 内置 ffmpeg

预览难解码图（HEIC/TIFF/AVIF/RAW）与视频封面使用 `ffmpeg-static`（GPL）。

已有可用二进制时 **`ffmpeg:ensure` 不会重新下载**。

```bash
# 缺二进制时再拉：默认镜像（清代理）
npm run ffmpeg:ensure

# 或用本机已装的 ffmpeg（仍不下载）
#   $env:FFMPEG_LOCAL='C:\path\to\ffmpeg.exe'; npm run ffmpeg:ensure

# 或代理拉 GitHub（不要同时开镜像）
#   $env:FFMPEG_FETCH='proxy'; $env:HTTPS_PROXY='http://127.0.0.1:10808'; npm run ffmpeg:ensure
```

规则：**走镜像就不要代理；走代理不要镜像**。

打包后二进制在：

```
release[-x.y.z]/win-unpacked/resources/ffmpeg/ffmpeg.exe
```

（`extraResources`，不在 asar 内。）解析逻辑见 `electron/ffmpegPath.mjs`。媒体预览说明：[`preview-media.md`](./preview-media.md)。

## 图标

透明圆角图标（四角 alpha=0，避免任务栏黑块）：

```bash
npm run icons:gen
```

`build:desktop` 会自动先跑图标生成。

## 本地打包（未签名试用包）

```bash
npm run build:desktop
```

若 `release/win-unpacked` 被占用（EBUSY），可改输出目录：

```bash
$env:CSC_IDENTITY_AUTO_DISCOVERY='false'
npx cross-env AURORA_ELECTRON=1 vite build
npx electron-builder --win --x64 --publish never --config.directories.output=release-0.1.3
```

然后将 `AuroraFiles-Setup-*.exe` / `Portable` / `latest.yml` 拷入 `release/`。

### 产物（0.1.3 未签名，约 148 MB）

| 文件 | 说明 |
|---|---|
| `release/AuroraFiles-Setup-0.1.3.exe` | NSIS installer |
| `release/AuroraFiles-Portable-0.1.3.exe` | Portable |
| `release/latest.yml` | electron-updater feed |
| `release-0.1.3/win-unpacked/AuroraFiles.exe` | 解包目录（推荐验证） |

仅解压目录（更快验证）：

```bash
npm run build:desktop:dir
```

打包后重测：

```bash
AURORA_SMOKE_REQUIRE=1 npm run test:smoke-win   # 须含 exe + asar + ffmpeg resource
npx electron scripts/perf/smoke-image-preview.mjs
npm run test:e2e:index
```

默认 `CSC_IDENTITY_AUTO_DISCOVERY=false`，避免本机无证书时卡住。

### asar 必含

| 路径 | 用途 |
|---|---|
| `shared/auroraFileUrl.mjs` | MIME + URL 编码 |
| `electron/index/indexTrack.mjs` | UI/Perf 双轨 |
| `electron/mediaPath.mjs` | 长路径 / CJK→ffmpeg |

## 签名（可选）

| 变量 | 说明 |
|---|---|
| `CSC_LINK` | `.pfx` 路径或 base64 |
| `CSC_KEY_PASSWORD` | 证书密码 |
| `CSC_IDENTITY_AUTO_DISCOVERY` | 设 `true` 以启用自动发现 |

## 自动更新

运行时依赖 `electron-updater`（`electron/updater.mjs`）。

1. **Feed URL**（二选一）  
   - 环境变量 `AURORA_UPDATE_URL=https://your.cdn/aurora-files/`  
   - 或 `package.json` → `build.publish`（generic / github）

2. **发布产物**  
   将 `latest.yml` + Setup exe 放到 feed 目录（`electron-builder --publish` 或手动上传）。

3. **应用内**  
   索引面板 →「检查更新」/「重启安装」；命令面板「检查应用更新」。

开发态与未打包不会检查更新。

### GitHub Releases 示例

```json
"publish": [{ "provider": "github", "owner": "skyline019", "repo": "AuroraFiles" }]
```

```bash
GH_TOKEN=... npm run build:desktop:publish
```

## CI 门禁

`.github/workflows/ci.yml`：

| Job | 内容 |
|---|---|
| `test` (ubuntu) | typecheck、单元、index-bench、双端 build |
| `windows-gate` | typecheck、单元、`test:real-search`、Playwright e2e |
| `package-win` (main push) | 未签名包 + `test:smoke-win`（`AURORA_SMOKE_REQUIRE=1`）+ artifact |

本地：

```bash
npm run ci
npm run test:smoke-win   # 无 win-unpacked 时 SKIP
```
