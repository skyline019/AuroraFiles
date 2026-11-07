import fs from 'node:fs/promises';
import path from 'node:path';

/**
 * Build a synthetic Windows-style tree for index/search benches.
 * @returns {Promise<{ created: number, dirs: number }>}
 */
export async function seedTree(root, fileCount, depth, { namePrefix = 'file', needleEvery = 17 } = {}) {
  const dirs = [root];
  await fs.mkdir(root, { recursive: true });
  for (let d = 0; d < depth; d++) {
    const next = [];
    for (const dir of dirs) {
      for (let i = 0; i < 5; i++) {
        const sub = path.join(dir, `L${d}_${i}`);
        await fs.mkdir(sub, { recursive: true });
        next.push(sub);
      }
    }
    dirs.push(...next);
  }
  let created = 0;
  let di = 0;
  while (created < fileCount) {
    const dir = dirs[di % dirs.length];
    const isNeedle = created % needleEvery === 0;
    const base = isNeedle ? `needle_${created}` : `${namePrefix}_${created}_report`;
    const fp = path.join(dir, `${base}.txt`);
    await fs.writeFile(fp, `payload ${created}\n`, 'utf8');
    created += 1;
    di += 1;
  }
  return { created, dirs: dirs.length };
}

export function rssMb() {
  return Math.round((process.memoryUsage().rss / (1024 * 1024)) * 10) / 10;
}
