/** 瞬时搜索排序：前缀 > 包含 > 路径片段；多词 AND */

export interface Rankable {
  name: string;
  path?: string;
  kind?: string;
}

export function normalizeQuery(q: string): string {
  return q.trim().toLowerCase();
}

export function queryTokens(query: string): string[] {
  return normalizeQuery(query).split(/\s+/).filter(Boolean);
}

function tokenScore(name: string, path: string, token: string): number {
  if (!token) return 0;
  if (name === token) return 1000;
  if (name.startsWith(token)) return 500;
  if (name.includes(token)) return 200;
  if (path.includes(token)) return 80;
  return 0;
}

export function scoreMatch(item: Rankable, query: string): number {
  const tokens = queryTokens(query);
  if (!tokens.length) return 0;
  const name = item.name.toLowerCase();
  const path = (item.path || '').toLowerCase();

  let score = 0;
  for (const t of tokens) {
    const s = tokenScore(name, path, t);
    if (s <= 0) return 0; // AND：任一词未命中则丢弃
    score += s;
  }

  // 整句连写仍加分（如「主视觉-v3」对查询「主视觉 v3」）
  const joined = tokens.join('');
  if (joined && (name.includes(joined) || name.replace(/[-_\s.]/g, '').includes(joined))) {
    score += 50;
  }

  if (item.kind === 'file') score += 5;
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
