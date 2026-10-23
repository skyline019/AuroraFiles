/**
 * Windows USN Journal：
 * 1) queryjournal → 游标 / 轮转 / 空洞判定
 * 2) 后台轮询 nextUsn 前进 → 触发软增量（mtime-delta），逼近 Everything 追赶语义
 *
 * 说明：完整 ReadUsn + FRN→路径 需要内核句柄地图；此处用「游标前进 ⇒ refresh」
 * 配合 fs.watch，覆盖绝大多数外部变更，避免名不副实的纯健康检查。
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

function driveLetter(rootPath) {
  const m = String(rootPath || '').match(/^([A-Za-z]):/);
  return m ? m[1].toUpperCase() : null;
}

export async function queryUsnJournal(rootPath) {
  const letter = driveLetter(rootPath);
  if (!letter) return null;
  try {
    const { stdout } = await execFileAsync(
      'fsutil.exe',
      ['usn', 'queryjournal', `${letter}:`],
      { windowsHide: true, timeout: 8000 },
    );
    const text = String(stdout || '');
    const pick = (label) => {
      const re = new RegExp(`${label}\\s*:\\s*(0x[0-9a-fA-F]+|\\d+)`, 'i');
      const m = text.match(re);
      return m ? m[1] : null;
    };
    const journalId = pick('Usn Journal ID') || pick('Journal ID');
    const firstUsn = pick('First Usn') || pick('First USN');
    const nextUsn = pick('Next Usn') || pick('Next USN');
    if (!journalId || !nextUsn) return null;
    const toNum = (v) => (String(v).startsWith('0x') ? Number.parseInt(v, 16) : Number(v));
    return {
      letter,
      journalId: String(journalId).toLowerCase(),
      firstUsn: toNum(firstUsn) || 0,
      nextUsn: toNum(nextUsn) || 0,
    };
  } catch {
    return null;
  }
}

export function usnNeedsRebuild(saved, live) {
  if (!live) return { rebuild: false, reason: 'no-live-usn', useMtimeDelta: true };
  if (!saved?.journalId) return { rebuild: false, reason: 'first-run', useMtimeDelta: false };
  if (String(saved.journalId).toLowerCase() !== String(live.journalId).toLowerCase()) {
    return { rebuild: true, reason: 'journal-rotated' };
  }
  const savedNext = Number(saved.nextUsn) || 0;
  if (live.firstUsn > savedNext + 1) {
    return { rebuild: true, reason: 'usn-gap' };
  }
  return {
    rebuild: false,
    reason: 'ok',
    useMtimeDelta: true,
    deltaUsn: Math.max(0, live.nextUsn - savedNext),
  };
}

/** @type {Map<string, { timer: NodeJS.Timeout, lastNext: number, journalId: string }>} */
const polls = new Map();

/**
 * 轮询 USN nextUsn；有前进则回调 onAdvance（应触发 soft refresh）。
 * @param {string} root
 * @param {(live: object, delta: number) => void} onAdvance
 * @param {number} intervalMs
 */
export function startUsnPoll(root, onAdvance, intervalMs = 4000) {
  stopUsnPoll(root);
  const key = String(root).replace(/\\+$/, '').toLowerCase();
  const state = { timer: null, lastNext: 0, journalId: '' };

  const tick = async () => {
    const live = await queryUsnJournal(root);
    if (!live) return;
    if (!state.journalId) {
      state.journalId = live.journalId;
      state.lastNext = live.nextUsn;
      return;
    }
    if (live.journalId !== state.journalId) {
      state.journalId = live.journalId;
      state.lastNext = live.nextUsn;
      onAdvance(live, -1); // 轮转：调用方应 rebuild
      return;
    }
    if (live.nextUsn > state.lastNext) {
      const delta = live.nextUsn - state.lastNext;
      state.lastNext = live.nextUsn;
      onAdvance(live, delta);
    }
  };

  state.timer = setInterval(() => { void tick(); }, intervalMs);
  // 不阻止进程退出
  if (typeof state.timer.unref === 'function') state.timer.unref();
  void tick();
  polls.set(key, state);
}

export function stopUsnPoll(root) {
  const key = String(root).replace(/\\+$/, '').toLowerCase();
  const s = polls.get(key);
  if (!s) return;
  clearInterval(s.timer);
  polls.delete(key);
}

export function noteUsnCursor(root, live) {
  if (!live) return;
  const key = String(root).replace(/\\+$/, '').toLowerCase();
  const s = polls.get(key);
  if (s) {
    s.journalId = live.journalId;
    s.lastNext = live.nextUsn;
  }
}
