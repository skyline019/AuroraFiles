# Aurora Files — Build & Release

当前版本：**0.1.7**（见根目录 `package.json`）。  
**发布仓：** [skylinezhanghan-wq/AuroraFiles](https://github.com/skylinezhanghan-wq/AuroraFiles)。  
发布说明：[`RELEASE_NOTES_v0.1.7.md`](./RELEASE_NOTES_v0.1.7.md)。

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

`build:desktop` / `build:desktop:signed` 会自动先跑图标生成。

## 本地打包

### 未签名（CI / 快速验证）

```bash
npm run build:desktop
```

默认 `CSC_IDENTITY_AUTO_DISCOVERY=false`，避免本机无证书时卡住。

### 签名（正式包 · CN=skyline019）

使用 **CN=skyline019** 的代码签名证书（`.pfx`）：

```bash
$env:CSC_LINK='C:\path\to\skyline019-codesign.pfx'
$env:CSC_KEY_PASSWORD='…'
npm run build:desktop:signed
```

或本机证书库已导入同一证书时：

```bash
$env:CSC_IDENTITY_AUTO_DISCOVERY='true'
# package.json win.certificateSubjectName = "skyline019"
npm run build:desktop:signed
```

抽查：

```powershell
Get-AuthenticodeSignature .\release\AuroraFiles-Setup-0.1.7.exe
Get-AuthenticodeSignature .\release\AuroraFiles-Portable-0.1.7.exe
Get-AuthenticodeSignature .\release\win-unpacked\AuroraFiles.exe
```

> 当前正式包使用的是 **自签** `CN=skyline019`（Issuer=Subject）。可验证发布者名称，但 **不会** 获得商业 EV 那种 SmartScreen 信誉。

若 `release/win-unpacked` 被占用（EBUSY），可改输出目录：

```bash
npx cross-env AURORA_ELECTRON=1 vite build
npx electron-builder --win --x64 --publish never --config.directories.output=release-0.1.7
```

然后将 `AuroraFiles-Setup-*.exe` / `Portable` / `latest.yml` 拷入 `release/`。

### 产物（0.1.7）

| 文件 | 说明 |
|---|---|
| `release/AuroraFiles-Setup-0.1.7.exe` | NSIS installer（签名） |
| `release/AuroraFiles-Portable-0.1.7.exe` | Portable（签名） |
| `release/latest.yml` | electron-updater feed |
| `release/win-unpacked/AuroraFiles.exe` | 解包目录（推荐验证） |

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

### asar 必含

| 路径 | 用途 |
|---|---|
| `shared/auroraFileUrl.mjs` | MIME + URL 编码 |
| `electron/index/indexTrack.mjs` | UI/Perf 双轨 |
| `electron/mediaPath.mjs` | 长路径 / CJK→ffmpeg |

## 签名变量

| 变量 | 说明 |
|---|---|
| `CSC_LINK` | `.pfx` 路径或 base64 |
| `CSC_KEY_PASSWORD` | 证书密码 |
| `CSC_IDENTITY_AUTO_DISCOVERY` | `true` 时允许从证书库发现；未签名包请 `false` |

## 自动更新

运行时依赖 `electron-updater`（`electron/updater.mjs`）。

1. **Feed URL**（二选一）  
   - 环境变量 `AURORA_UPDATE_URL=https://your.cdn/aurora-files/`  
   - 或 `package.json` → `build.publish`（当前默认 GitHub：`skylinezhanghan-wq/AuroraFiles`）

2. **发布产物**  
   将 `latest.yml` + Setup exe 放到 feed 目录（`electron-builder --publish` 或手动上传到本仓 Releases）。

3. **应用内**  
   索引面板 →「检查更新」/「重启安装」；命令面板「检查应用更新」。

开发态与未打包不会检查更新。

### GitHub Releases

```json
"publish": [{ "provider": "github", "owner": "skylinezhanghan-wq", "repo": "AuroraFiles" }]
```

```bash
# 需对本仓有 repo + 上传权限的 token（当前账号）
$env:GH_TOKEN=(gh auth token)
npm run build:desktop:publish
```

推荐流程：本地 `build:desktop:signed` → 校验 Authenticode → `gh release create` 上传 Setup / Portable / blockmap / `latest.yml`。

## CI 门禁

`.github/workflows/ci.yml`（跑在本仓）：

| Job | 内容 |
|---|---|
| `test` (ubuntu) | typecheck、单元、index-bench、双端 build |
| `windows-gate` | typecheck、单元、`test:real-search`、Playwright e2e |
| `package-win` (main push) | **未签名**包 + `test:smoke-win` + artifact（CI 不持有签名密钥） |

本地：

```bash
npm run ci
npm run test:smoke-win   # 无 win-unpacked 时 SKIP
```
