/**
 * Cold-start marks for AURORA_STARTUP_BENCH harness.
 * Times are ms since process start (performance.now() when available).
 */
import fssync from 'node:fs';
import path from 'node:path';

const t0 = typeof performance !== 'undefined' ? performance.now() : Date.now();
/** @type {Record<string, number>} */
const marks = { process_start: 0 };

const bench = process.env.AURORA_STARTUP_BENCH === '1';
const outFile = process.env.AURORA_STARTUP_OUT || '';

export function startupMark(name) {
  const ms = Math.round((typeof performance !== 'undefined' ? performance.now() : Date.now()) - t0);
  marks[name] = ms;
  if (bench) {
    const line = `AURORA_STARTUP ${JSON.stringify({ name, ms })}`;
    try { process.stderr.write(`${line}\n`); } catch { /* */ }
  }
  if (bench && outFile && (name === 'interactive' || name === 'ready-to-show')) {
    try {
      fssync.mkdirSync(path.dirname(outFile), { recursive: true });
      fssync.writeFileSync(outFile, JSON.stringify({ marks, at: new Date().toISOString() }, null, 2));
    } catch { /* */ }
  }
  return ms;
}

export function getStartupMarks() {
  return { ...marks };
}
