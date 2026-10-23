#!/usr/bin/env node
/**
 * 可选冒烟：检测 release/win-unpacked 产物完整性。
 * 无产物时 exit 0 + SKIP（本地/未打包 CI 不失败）。
 * 设置 AURORA_SMOKE_REQUIRE=1 则缺产物时失败。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const unpacked = path.join(root, 'release', 'win-unpacked');
const requireSmoke = process.env.AURORA_SMOKE_REQUIRE === '1';

function skip(msg) {
  console.log(`[win-unpacked-smoke] SKIP: ${msg}`);
  if (requireSmoke) process.exit(1);
  process.exit(0);
}

function fail(msg) {
  console.error(`[win-unpacked-smoke] FAIL: ${msg}`);
  process.exit(1);
}

function ok(msg) {
  console.log(`[win-unpacked-smoke] OK: ${msg}`);
}

if (!fs.existsSync(unpacked)) {
  skip(`missing ${unpacked}`);
}

const entries = fs.readdirSync(unpacked);
const exe = entries.find((n) => n.toLowerCase().endsWith('.exe') && !n.toLowerCase().includes('uninstall'));
if (!exe) fail('no main .exe in win-unpacked');
const exePath = path.join(unpacked, exe);
const exeSize = fs.statSync(exePath).size;
if (exeSize < 1_000_000) fail(`exe too small: ${exe} (${exeSize})`);
ok(`exe ${exe} (${Math.round(exeSize / 1e6)}MB)`);

const resources = path.join(unpacked, 'resources');
if (!fs.existsSync(resources)) fail('missing resources/');

const asar = path.join(resources, 'app.asar');
const appDir = path.join(resources, 'app');
if (!fs.existsSync(asar) && !fs.existsSync(appDir)) fail('missing app.asar / app');
ok(fs.existsSync(asar) ? 'app.asar present' : 'app/ present');

const ffmpegCandidates = [
  path.join(resources, 'app.asar.unpacked', 'node_modules', 'ffmpeg-static', 'ffmpeg.exe'),
  path.join(resources, 'app', 'node_modules', 'ffmpeg-static', 'ffmpeg.exe'),
];
const ffmpeg = ffmpegCandidates.find((p) => fs.existsSync(p) && fs.statSync(p).size > 1_000_000);
if (ffmpeg) {
  ok(`bundled ffmpeg (${Math.round(fs.statSync(ffmpeg).size / 1e6)}MB)`);
} else {
  console.warn('[win-unpacked-smoke] WARN: bundled ffmpeg.exe not found under asar.unpacked (preview decode may fall back)');
}

ok('win-unpacked smoke passed');
