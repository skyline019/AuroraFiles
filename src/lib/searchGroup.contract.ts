/**
 * 搜索 / 分组硬契约断言（纯函数，供 unit & e2e evaluate 复用）。
 * 任何违反都应让测试失败，不得用 skip / soft 吞掉。
 */
import type { FSNode } from './fs';
import type { BrowseRow, CategorySection } from './groupItems';

export type KindSlot = 'folder' | 'file';

export function kindSlot(n: Pick<FSNode, 'kind'>): KindSlot {
  // 与 isFolderLike 对齐：缺省 kind / 'file' → file；folder|drive|special → folder
  return n.kind === 'folder' || n.kind === 'drive' || n.kind === 'special' ? 'folder' : 'file';
}

/** 契约：不得出现 file 出现在任一 folder 之前的交错（允许仅一侧存在） */
export function assertNoFolderFileInterleave(
  items: Array<Pick<FSNode, 'kind'>>,
  label = 'items',
): void {
  const slots = items.map(kindSlot);
  const firstFile = slots.indexOf('file');
  const lastFolder = slots.lastIndexOf('folder');
  if (firstFile === -1 || lastFolder === -1) return;
  if (!(lastFolder < firstFile)) {
    throw new Error(
      `[contract] ${label}: folder/file interleave — slots=${JSON.stringify(slots)}`,
    );
  }
}

/** 契约：分区后两侧相对顺序与输入一致（稳定） */
export function assertStableWithinKind(input: FSNode[], output: FSNode[]): void {
  const inFolders = input.filter((n) => kindSlot(n) === 'folder').map((n) => n.id);
  const inFiles = input.filter((n) => kindSlot(n) === 'file').map((n) => n.id);
  const outFolders = output.filter((n) => kindSlot(n) === 'folder').map((n) => n.id);
  const outFiles = output.filter((n) => kindSlot(n) === 'file').map((n) => n.id);
  if (JSON.stringify(inFolders) !== JSON.stringify(outFolders)) {
    throw new Error(
      `[contract] folder order unstable: in=${JSON.stringify(inFolders)} out=${JSON.stringify(outFolders)}`,
    );
  }
  if (JSON.stringify(inFiles) !== JSON.stringify(outFiles)) {
    throw new Error(
      `[contract] file order unstable: in=${JSON.stringify(inFiles)} out=${JSON.stringify(outFiles)}`,
    );
  }
}

/** 契约：所有文件夹只出现在 key==='folder' 节；其它节不得含非 file */
export function assertFolderSectionExclusive(sections: CategorySection[]): void {
  const folderSec = sections.find((s) => s.key === 'folder');
  const folderIds = new Set(
    (folderSec?.items ?? []).map((n) => n.id),
  );
  for (const s of sections) {
    if (s.key === 'folder') {
      for (const n of s.items) {
        if (kindSlot(n) === 'file') {
          throw new Error(`[contract] file ${n.id} inside folder section`);
        }
      }
      continue;
    }
    for (const n of s.items) {
      if (kindSlot(n) !== 'file') {
        throw new Error(`[contract] non-file ${n.id} (${n.kind}) in section ${s.key}`);
      }
      if (folderIds.has(n.id)) {
        throw new Error(`[contract] ${n.id} duplicated across folder + ${s.key}`);
      }
    }
  }
}

/** 契约：分组扁平行 — header 后的 item 不得跨节混入错误 kind */
export function assertBrowseRowsFolderBlock(rows: BrowseRow[]): void {
  let inFolderSection = false;
  let seenFileSection = false;
  const itemKinds: KindSlot[] = [];
  for (const row of rows) {
    if (row.t === 'header') {
      inFolderSection = row.key === 'folder';
      if (row.key !== 'folder') seenFileSection = true;
      continue;
    }
    const slot = kindSlot(row.node);
    itemKinds.push(slot);
    if (inFolderSection && slot === 'file') {
      throw new Error(`[contract] file under folder header: ${row.node.id}`);
    }
    if (!inFolderSection && seenFileSection === false && slot === 'file' && rows.some((r) => r.t === 'header' && r.key === 'folder')) {
      // file before folder header exists elsewhere — caught by interleave on itemKinds
    }
    if (!inFolderSection && slot !== 'file') {
      throw new Error(`[contract] non-file under non-folder header: ${row.node.id}`);
    }
  }
  assertNoFolderFileInterleave(
    itemKinds.map((k) => ({ kind: k === 'file' ? 'file' : 'folder' })),
    'browseRows items',
  );
}

/** 契约：两侧都存在时必须真正分区（禁止用「缺一侧」逃掉） */
export function assertRequiresBothKindsAndPartitioned(
  items: Array<Pick<FSNode, 'kind'>>,
  label = 'items',
): void {
  const slots = items.map(kindSlot);
  if (!slots.includes('folder') || !slots.includes('file')) {
    throw new Error(
      `[contract] ${label}: expected BOTH folder and file present, got ${JSON.stringify(slots)}`,
    );
  }
  assertNoFolderFileInterleave(items, label);
}
