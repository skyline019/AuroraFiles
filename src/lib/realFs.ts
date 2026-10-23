import type { FSNode } from './fs';
import { ID, seedFS } from './fs';
import { api, REAL_DEMO, type AuroraEntry, type KnownFolders } from './aurora';
import { getPersistedTags } from './tagStore';

export function entryToNode(ent: AuroraEntry, parentId: string): FSNode {
  return {
    id: ent.path,
    name: ent.name,
    kind: ent.kind === 'folder' ? 'folder' : 'file',
    parentId,
    childrenIds: [],
    ext: ent.ext,
    size: ent.size,
    createdAt: ent.createdAt || Date.now(),
    modifiedAt: ent.modifiedAt || Date.now(),
    accessedAt: ent.accessedAt || Date.now(),
    tags: getPersistedTags(ent.path),
    hidden: !!ent.hidden,
  };
}

function displayName(key: string, abs: string): string {
  const map: Record<string, string> = {
    desktop: '桌面', docs: '文档', dl: '下载', pics: '图片', music: '音乐', vids: '视频', home: '用户目录',
  };
  return map[key] ?? abs.split(/[\\/]/).filter(Boolean).pop() ?? abs;
}

/** 真盘骨架：此电脑 + 盘符 + 快捷目录 + 演示入口 */
export async function buildRealSkeleton(): Promise<{
  nodes: Record<string, FSNode>;
  known: KnownFolders;
  /** 侧栏固定项 id → 绝对路径 */
  quickMap: Record<string, string>;
}> {
  const a = api();
  const [drives, known] = await Promise.all([a.listDrives(), a.knownFolders()]);
  const nodes: Record<string, FSNode> = {};
  const now = Date.now();

  nodes.root = {
    id: 'root', name: '', kind: 'folder', parentId: null, childrenIds: [],
    size: 0, createdAt: now, modifiedAt: now, accessedAt: now, tags: [],
  };

  nodes[ID.pc] = {
    id: ID.pc, name: '此电脑', kind: 'special', parentId: 'root', childrenIds: [],
    size: 0, createdAt: now, modifiedAt: now, accessedAt: now, tags: [], system: true,
  };
  nodes.root.childrenIds.push(ID.pc);

  for (const d of drives) {
    nodes[d.path] = {
      id: d.path,
      name: d.name,
      kind: 'drive',
      parentId: ID.pc,
      childrenIds: [],
      size: 0,
      createdAt: now,
      modifiedAt: now,
      accessedAt: now,
      tags: [],
      system: true,
      drive: {
        label: d.letter,
        total: d.total || 0,
        used: d.used || 0,
        format: 'NTFS',
      },
    };
    nodes[ID.pc].childrenIds.push(d.path);
  }

  nodes[REAL_DEMO] = {
    id: REAL_DEMO,
    name: '极光演示（虚拟盘）',
    kind: 'special',
    parentId: ID.pc,
    childrenIds: [],
    size: 0,
    createdAt: now,
    modifiedAt: now,
    accessedAt: now,
    tags: ['purple'],
    system: true,
  };
  nodes[ID.pc].childrenIds.push(REAL_DEMO);

  const quickMap: Record<string, string> = {
    [ID.desktop]: known.desktop,
    [ID.docs]: known.documents,
    [ID.dl]: known.downloads,
    [ID.pics]: known.pictures,
    [ID.music]: known.music,
    [ID.vids]: known.videos,
  };

  for (const [alias, abs] of Object.entries(quickMap)) {
    const driveRoot = abs.slice(0, 3);
    const parentId = nodes[driveRoot] ? driveRoot : ID.pc;
    nodes[abs] = {
      id: abs,
      name: displayName(
        alias === ID.desktop ? 'desktop'
          : alias === ID.docs ? 'docs'
            : alias === ID.dl ? 'dl'
              : alias === ID.pics ? 'pics'
                : alias === ID.music ? 'music' : 'vids',
        abs,
      ),
      kind: 'folder',
      parentId,
      childrenIds: [],
      size: 0,
      createdAt: now,
      modifiedAt: now,
      accessedAt: now,
      tags: [],
      system: true,
    };
    // 别名键：侧栏仍用 ID.desktop 等
    nodes[alias] = nodes[abs];
  }

  nodes[ID.recent] = {
    id: ID.recent, name: '最近使用', kind: 'special', parentId: 'root', childrenIds: [],
    size: 0, createdAt: now, modifiedAt: now, accessedAt: now, tags: [], system: true,
  };
  nodes[ID.trash] = {
    id: ID.trash, name: '回收站说明', kind: 'special', parentId: 'root', childrenIds: [],
    size: 0, createdAt: now, modifiedAt: now, accessedAt: now, tags: [], system: true,
  };
  nodes[ID.quick] = {
    id: ID.quick, name: '快速访问', kind: 'special', parentId: 'root', childrenIds: [],
    size: 0, createdAt: now, modifiedAt: now, accessedAt: now, tags: [], system: true,
  };
  nodes.root.childrenIds.push(ID.quick, ID.recent, ID.trash);

  return { nodes, known, quickMap };
}

export function resolvePathId(id: string, quickMap: Record<string, string> | null | undefined): string {
  if (quickMap?.[id]) return quickMap[id];
  return id;
}

export async function hydrateFolder(
  nodes: Record<string, FSNode>,
  folderId: string,
  showHidden: boolean,
  quickMap?: Record<string, string> | null,
): Promise<Record<string, FSNode>> {
  const abs = resolvePathId(folderId, quickMap);
  if (abs === ID.pc || abs === REAL_DEMO || abs === ID.trash || abs === ID.recent || abs === ID.quick) {
    return nodes;
  }
  if (!/^[A-Za-z]:[\\/]/.test(abs)) return nodes;

  const next = { ...nodes };
  const entries = await api().listDir(abs, { showHidden });
  const parent = next[abs] ?? next[folderId];
  if (!parent) return nodes;

  const childIds: string[] = [];
  // 小目录才批量读 ADS，大目录走 localStorage，避免拖慢列表
  const adsMap = new Map<string, string[]>();
  if (entries.length <= 150) {
    const tagPairs = await Promise.all(
      entries.map(async (ent) => {
        try {
          const t = await api().readTags(ent.path);
          return [ent.path, t] as const;
        } catch {
          return [ent.path, [] as string[]] as const;
        }
      }),
    );
    for (const [p, t] of tagPairs) if (t.length) adsMap.set(p, t);
  }

  for (const ent of entries) {
    const n = entryToNode(ent, abs);
    const prev = next[n.id];
    const adsTags = adsMap.get(ent.path);
    if (adsTags?.length) n.tags = adsTags as FSNode['tags'];
    if (prev) {
      if (!adsTags?.length && prev.tags.length) n.tags = prev.tags;
      n.favorite = prev.favorite;
      n.locked = prev.locked;
      n.childrenIds = prev.childrenIds;
    }
    next[n.id] = n;
    childIds.push(n.id);
  }
  const updated = { ...parent, id: abs, childrenIds: childIds, accessedAt: Date.now() };
  next[abs] = updated;
  if (folderId !== abs) next[folderId] = updated;
  return next;
}

export function demoNodes(): Record<string, FSNode> {
  return seedFS();
}
