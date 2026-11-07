/**
 * Smoke: convertImagePreview for jpg/png/webp/bmp (+ path encoding).
 * Usage: npx electron scripts/perf/smoke-image-preview.mjs
 */
import fs from 'node:fs/promises';
import fssync from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { app } from 'electron';
import { convertImagePreview, mimeFromPath, toAuroraFileUrl, fromAuroraFileUrl } from '../../electron/fs-service.mjs';

const FIX = path.join(os.tmpdir(), 'aurora-img-smoke');

async function ensureFixtures() {
  await fs.mkdir(FIX, { recursive: true });
  const jpg = Buffer.from(
    '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAn/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAAAAX/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIQAxAAAAGfAP/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAQUCf//EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQMBAT8Bf//EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQIBAT8Bf//Z',
    'base64',
  );
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcYJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64',
  );
  const jpgPath = path.join(FIX, 'sample.jpg');
  const pngPath = path.join(FIX, 'sample.png');
  const spaceJpg = path.join(FIX, 'My Photos', '测 试.jpg');
  await fs.writeFile(jpgPath, jpg);
  await fs.writeFile(pngPath, png);
  await fs.mkdir(path.dirname(spaceJpg), { recursive: true });
  await fs.writeFile(spaceJpg, jpg);
  return { jpgPath, pngPath, spaceJpg };
}

function assertDataJpeg(label, r) {
  if (!r?.url?.startsWith('data:image/jpeg;base64,')) {
    throw new Error(`${label}: expected jpeg data URL, got ${r?.url?.slice(0, 40)}`);
  }
  const b64 = r.url.slice('data:image/jpeg;base64,'.length);
  const buf = Buffer.from(b64, 'base64');
  if (buf[0] !== 0xff || buf[1] !== 0xd8) throw new Error(`${label}: not JPEG magic`);
  console.log(`OK ${label} meta=${r.meta} bytes=${buf.length}`);
}

app.whenReady().then(async () => {
  try {
    const { jpgPath, pngPath, spaceJpg } = await ensureFixtures();

    const u = toAuroraFileUrl(spaceJpg);
    const back = fromAuroraFileUrl(u);
    if (path.normalize(back).toLowerCase() !== path.normalize(spaceJpg).toLowerCase()) {
      throw new Error(`URL roundtrip failed: ${u} -> ${back}`);
    }
    if (mimeFromPath(jpgPath) !== 'image/jpeg') throw new Error('mime jpg');
    if (mimeFromPath(pngPath) !== 'image/png') throw new Error('mime png');
    if (mimeFromPath('x.webp') !== 'image/webp') throw new Error('mime webp');
    console.log('OK aurora-file URL + MIME');

    assertDataJpeg('jpg', await convertImagePreview(jpgPath, { maxEdge: 512 }));
    assertDataJpeg('png→jpeg', await convertImagePreview(pngPath, { maxEdge: 512 }));
    assertDataJpeg('space jpg', await convertImagePreview(spaceJpg, { maxEdge: 256 }));

    // CJK folder + webp (ffmpeg argv / nativeImage long-path)
    const cjkDir = path.join(FIX, '中文目录');
    await fs.mkdir(cjkDir, { recursive: true });
    const cjkWebp = path.join(cjkDir, '示例.webp');
    const webpSrc = path.join(FIX, 'sample.webp');
    if (fssync.existsSync(webpSrc)) {
      await fs.copyFile(webpSrc, cjkWebp);
      assertDataJpeg('cjk webp', await convertImagePreview(cjkWebp, { maxEdge: 64 }));
    } else {
      const cjkJpg = path.join(cjkDir, '示例.jpg');
      await fs.copyFile(jpgPath, cjkJpg);
      assertDataJpeg('cjk jpg', await convertImagePreview(cjkJpg, { maxEdge: 64 }));
    }

    for (const name of ['sample.webp', 'sample.bmp']) {
      const p = path.join(FIX, name);
      if (!fssync.existsSync(p)) {
        console.log(`SKIP ${name} (fixture missing)`);
        continue;
      }
      assertDataJpeg(name, await convertImagePreview(p, { maxEdge: 64 }));
    }

    console.log('ALL PASS');
    app.exit(0);
  } catch (err) {
    console.error('FAIL', err);
    app.exit(1);
  }
});
