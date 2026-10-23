/** 瞬时搜索排序：前缀 > 包含 > 路径片段 */

export interface Rankable {
  name: string;
  path?: string;
  kind?: string;
}

export function normalizeQuery(q: string): string {
  return q.trim().toLowerCase();
}

export function scoreMatch(item: Rankable, query: string): number {
  const q = normalizeQuery(query);
  if (!q) return 0;
  const name = item.name.toLowerCase();
  const path = (item.path || '').toLowerCase();
  let score = 0;
  if (name === q) score += 1000;
  else if (name.startsWith(q)) score += 500;
  else if (name.includes(q)) score += 200;
  else if (path.includes(q)) score += 80;
  else return 0;

  // 文件略优先于深层路径噪声
  if (item.kind === 'file') score += 5;
  // 越短越靠前
  score += Math.max(0, 40 - name.length);
  return score;
}

export function rankSearchResults<T extends Rankable>(items: T[], query: string, limit = 200): T[] {
  const q = normalizeQuery(query);
  if (!q) return [];
  return items
    .map((it) => ({ it, s: scoreMatch(it, q) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s || a.it.name.localeCompare(b.it.name, 'zh-CN'))
    .slice(0, limit)
    .map((x) => x.it);
}

/** 解析高级查询：tag:红 或 type:pdf 前缀 */
export function parseSearchQuery(raw: string): { text: string; tag?: string; type?: string } {
  let text = raw.trim();
  let tag: string | undefined;
  let type: string | undefined;
  text = text.replace(/\btag:(\S+)/gi, (_, v) => {
    tag = String(v).toLowerCase();
    return ' ';
  });
  text = text.replace(/\btype:(\S+)/gi, (_, v) => {
    type = String(v).toLowerCase().replace(/^\./, '');
    return ' ';
  });
  return { text: text.trim().replace(/\s+/g, ' '), tag, type };
}
