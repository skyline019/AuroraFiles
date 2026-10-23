import fs from 'node:fs';
import { chromium } from 'playwright';
import path from 'node:path';

const pngPath = path.resolve('electron/build/icon-512.png');
const b64 = fs.readFileSync(pngPath).toString('base64');
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 512, height: 512 } });
await page.setContent(`<!doctype html><html><body style="margin:0;background:#0f0"><img id="i" src="data:image/png;base64,${b64}"/></body></html>`);
await page.waitForSelector('img');
const samples = await page.evaluate(async () => {
  const img = document.getElementById('i');
  await img.decode();
  const c = document.createElement('canvas');
  c.width = img.naturalWidth;
  c.height = img.naturalHeight;
  const ctx = c.getContext('2d');
  ctx.drawImage(img, 0, 0);
  const pts = [[0, 0], [511, 0], [0, 511], [511, 511], [256, 256], [40, 40]];
  return pts.map(([x, y]) => {
    const d = ctx.getImageData(x, y, 1, 1).data;
    return { x, y, r: d[0], g: d[1], b: d[2], a: d[3] };
  });
});
console.log(JSON.stringify(samples, null, 2));
await browser.close();
