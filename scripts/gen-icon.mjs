/**
 * 生成透明背景的极光文件图标（PNG 多尺寸 + ICO）
 * 用法: node scripts/gen-icon.mjs
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import pngToIco from 'png-to-ico';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.resolve(__dirname, '../electron/build');
const SIZE = 512;

const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}" viewBox="0 0 512 512">
  <defs>
    <linearGradient id="g" x1="12%" y1="8%" x2="88%" y2="92%">
      <stop offset="0%" stop-color="#5eead4"/>
      <stop offset="48%" stop-color="#38bdf8"/>
      <stop offset="100%" stop-color="#a78bfa"/>
    </linearGradient>
  </defs>
  <!-- 透明画布；仅圆角方块不透明（无阴影滤镜，避免栅格化黑底） -->
  <rect x="36" y="36" width="440" height="440" rx="104" fill="#0b1224"/>
  <rect x="58" y="58" width="396" height="396" rx="92" fill="url(#g)"/>
  <g fill="#ffffff" fill-opacity="0.96">
    <path d="M152 200h74c10 0 16 4 22 12l10 12c4 5 9 8 16 8h86c22 0 36 14 36 36v108c0 24-16 40-40 40H156c-24 0-40-16-40-40V236c0-22 14-36 36-36z"/>
    <path d="M152 232h208c18 0 30 12 30 30v92c0 18-12 30-30 30H152c-18 0-30-12-30-30v-92c0-18 12-30 30-30z" fill-opacity="0.88"/>
  </g>
  <g fill="#ffffff" fill-opacity="0.92">
    <path d="M368 122l8 22 22 8-22 8-8 22-8-22-22-8 22-8z"/>
    <path d="M408 162l5 12 12 5-12 5-5 12-5-12-12-5 12-5z" fill-opacity="0.75"/>
  </g>
</svg>`;

async function main() {
  await fs.mkdir(outDir, { recursive: true });
  const browser = await chromium.launch();
  const page = await browser.newPage({
    viewport: { width: SIZE, height: SIZE },
    deviceScaleFactor: 1,
  });
  await page.setContent(
    `<!doctype html><html style="background:transparent"><head><style>
      html,body{margin:0;padding:0;background:transparent!important;overflow:hidden;width:512px;height:512px}
    </style></head><body>${svg}</body></html>`,
    { waitUntil: 'load' },
  );
  const master = path.join(outDir, 'icon-512.png');
  const loc = page.locator('svg');
  await loc.screenshot({ path: master, omitBackground: true, type: 'png' });
  await browser.close();

  // 缩小多尺寸（canvas 在 Playwright 页内做）
  const sizes = [256, 128, 64, 48, 32, 24, 16];
  const browser2 = await chromium.launch();
  const page2 = await browser2.newPage();
  const buf512 = await fs.readFile(master);
  const b64 = buf512.toString('base64');
  const pngPaths = [master];
  for (const s of sizes) {
    await page2.setViewportSize({ width: s, height: s });
    await page2.setContent(`<!doctype html><html><body style="margin:0;background:transparent">
      <canvas id="c" width="${s}" height="${s}"></canvas>
      <script>
        const img = new Image();
        img.onload = () => {
          const c = document.getElementById('c');
          const ctx = c.getContext('2d');
          ctx.clearRect(0,0,${s},${s});
          ctx.drawImage(img, 0, 0, ${s}, ${s});
          window.__done = c.toDataURL('image/png');
        };
        img.src = 'data:image/png;base64,${b64}';
      </script></body></html>`);
    await page2.waitForFunction(() => window.__done);
    const dataUrl = await page2.evaluate(() => window.__done);
    const out = path.join(outDir, `icon-${s}.png`);
    await fs.writeFile(out, Buffer.from(dataUrl.split(',')[1], 'base64'));
    pngPaths.push(out);
  }
  await browser2.close();

  await fs.copyFile(path.join(outDir, 'icon-256.png'), path.join(outDir, 'icon.png'));
  const ico = await pngToIco(pngPaths.filter((p) => /icon-(256|128|64|48|32|16)\.png$/.test(p)));
  await fs.writeFile(path.join(outDir, 'icon.ico'), ico);
  console.log('Wrote transparent icons →', outDir);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
