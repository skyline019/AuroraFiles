# Aurora Files — Build & Release

## 内置 ffmpeg

预览 TIFF/AVIF/HEIF/RAW 与视频封面使用 `node_modules/ffmpeg-static/ffmpeg.exe`（随包装入，GPL）。

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

打包后应落在 `release/win-unpacked/resources/app.asar.unpacked/node_modules/ffmpeg-static/ffmpeg.exe`（`asarUnpack`）。  
本机 full_build 约 **217MB**，安装包体积会明显增大；上线前宜换成官方 `ffmpeg-static` 小包或裁剪构建。

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

产物（0.1.0 未签名，含内置 ffmpeg 后实测约 **154MB**）：

| 文件 | 说明 |
|---|---|
| `release/AuroraFiles-Setup-0.1.0.exe` | NSIS installer |
| `release/AuroraFiles-Portable-0.1.0.exe` | Portable |
| `release/latest.yml` | electron-updater feed |
| `release/win-unpacked/AuroraFiles.exe` | Unpacked app (`productName`: Aurora Files) |

仅解压目录（更快验证）：

```bash
npm run build:desktop:dir
```

打包后重测：

```bash
AURORA_SMOKE_REQUIRE=1 npm run test:smoke-win   # 须含 exe + asar + 内置 ffmpeg
npm run test:e2e
```

默认 `CSC_IDENTITY_AUTO_DISCOVERY=false`，避免本机无证书时卡住。

## 签名（可选）

| 变量 | 说明 |
|---|---|
| `CSC_LINK` | `.pfx` 路径或 base64 |
| `CSC_KEY_PASSWORD` | 证书密码 |
| `CSC_IDENTITY_AUTO_DISCOVERY` | 设 `true` 以启用自动发现 |

## 自动更新

运行时依赖 `electron-updater`（已接入 `electron/updater.mjs`）。

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
"publish": [{ "provider": "github", "owner": "YOUR_ORG", "repo": "aurora-files" }]
```

```bash
GH_TOKEN=... npx electron-builder --win --x64 --publish always
```

## CI 门禁

`.github/workflows/ci.yml`：

| Job | 内容 |
|---|---|
| `test` (ubuntu) | typecheck、单元、index-bench、双端 build |
| `windows-gate` | typecheck、单元、`test:real-search`、Playwright e2e（含 preview-media） |
| `package-win` | 未签名包 + `test:smoke-win`（`AURORA_SMOKE_REQUIRE=1`） |

本地可选冒烟（无 `win-unpacked` 时 SKIP）：

```bash
npm run test:smoke-win
```
| `package-win` (main push) | 未签名桌面包 + artifact 上传 |

本地一键：

```bash
npm run ci
```
