//! Compact resident index  -  parent-chain encoding (Everything-style).
//!
//! Arena holds **unique name components only** (not full paths).
//! Each entry: parent id + name ref + flags + frn + path_hash.
//! Full path is rebuilt on demand for IPC views / path lookup verify.

use rustc_hash::FxHashMap;
use serde::Serialize;
use std::fs::File;
use std::io::{BufWriter, Read, Write};
use std::path::Path;

const NO_PARENT: u32 = u32::MAX;
const LEN_MASK: u32 = 0x3fff_ffff;
const FLAG_DIR: u32 = 1 << 30;
const FLAG_LIVE: u32 = 1 << 31;
const FRN_EMPTY: u32 = u32::MAX;
/// Dense FRN table hard cap (~16MB); beyond   -  overflow map.
const FRN_DENSE_MAX: usize = 4_000_000;

const SNAP_MAGIC: &[u8; 4] = b"AIDX";
const SNAP_VERSION: u32 = 2;

#[derive(Clone, Copy)]
struct Entry {
  parent: u32,
  name_off: u32,
  name_len_flags: u32,
  frn: u64,
  path_hash: u64,
}

#[derive(Clone, Copy)]
struct NameRef {
  off: u32,
  len: u32,
}

pub struct IndexStore {
  arena: Vec<u8>,
  entries: Vec<Entry>,
  /// Open-addressing path_hash -> entry id (u32::MAX = empty). ~4B/slot vs FxHashMap ~24B.
  path_slots: Vec<u32>,
  path_slots_mask: usize,
  /// Rare path_hash collisions (full path string -> id)
  by_path_overflow: FxHashMap<String, u32>,
  name_intern: FxHashMap<u64, NameRef>,
  name_index: Vec<u32>,
  name_index_dirty: bool,
  /// FRN index (low 48 bits) -> entry id; denser than HashMap for MFT streams
  frn_dense: Vec<u32>,
  frn_overflow: FxHashMap<u64, u32>,
  /// entry id -> parent FRN not yet resolved (MFT stream ingest)
  pending_parent: FxHashMap<u32, u64>,
  free: Vec<u32>,
  live: usize,
  path_index_dirty: bool,
  /// path index built lazily -- name queries don't pay table RSS
  path_index_ready: bool,
  /// entries mutated since last persist_bin (incremental delta)
  dirty_ids: Vec<u32>,
  persist_gen: u64,
  /// Space-debt normalize cursor (entry index into `entries`)
  normalize_cursor: usize,
  /// 0=path, 1=shrink, 2=arena, 3=done
  normalize_phase: u8,
  /// One arena compact per normalize cycle (avoids path?arena loops)
  normalize_arena_done: bool,
}

#[derive(Serialize, Clone)]
pub struct EntryView {
  pub path: String,
  pub name: String,
  #[serde(skip_serializing_if = "Option::is_none")]
  pub kind: Option<&'static str>,
  #[serde(skip_serializing_if = "Option::is_none")]
  pub frn: Option<String>,
}

fn hash_bytes(b: &[u8]) -> u64 {
  let mut h: u64 = 0xcbf2_9ce4_8422_2325;
  for &x in b {
    h ^= u64::from(x);
    h = h.wrapping_mul(0x0100_0000_01b3);
  }
  h
}

fn hash_str(s: &str) -> u64 {
  hash_bytes(s.as_bytes())
}

/// Split `e:\foo\bar`   -  ["e:", "foo", "bar"]
fn split_components(path_lc: &str) -> Vec<&str> {
  let p = path_lc.trim_end_matches(['\\', '/']);
  if p.is_empty() {
    return vec![];
  }
  let bytes = p.as_bytes();
  let mut out = Vec::with_capacity(8);
  if bytes.len() >= 2 && bytes[1] == b':' {
    out.push(&p[..2]);
    let rest = p[2..].trim_start_matches(['\\', '/']);
    if !rest.is_empty() {
      for part in rest.split(['\\', '/']) {
        if !part.is_empty() {
          out.push(part);
        }
      }
    }
  } else {
    for part in p.split(['\\', '/']) {
      if !part.is_empty() {
        out.push(part);
      }
    }
  }
  out
}

fn join_components(parts: &[&str]) -> String {
  if parts.is_empty() {
    return String::new();
  }
  if parts.len() == 1 {
    return parts[0].to_string();
  }
  let mut s = String::with_capacity(64);
  s.push_str(parts[0]);
  if parts[0].ends_with(':') {
    s.push('\\');
  }
  for part in &parts[1..] {
    if !s.ends_with('\\') {
      s.push('\\');
    }
    s.push_str(part);
  }
  s
}

impl IndexStore {
  pub fn new() -> Self {
    Self {
      arena: Vec::with_capacity(8 * 1024 * 1024),
      entries: Vec::new(),
      path_slots: Vec::new(),
      path_slots_mask: 0,
      by_path_overflow: FxHashMap::default(),
      name_intern: FxHashMap::default(),
      name_index: Vec::new(),
      name_index_dirty: false,
      frn_dense: Vec::new(),
      frn_overflow: FxHashMap::default(),
      pending_parent: FxHashMap::default(),
      free: Vec::new(),
      live: 0,
      path_index_dirty: false,
      path_index_ready: false,
      dirty_ids: Vec::new(),
      persist_gen: 0,
      normalize_cursor: 0,
      normalize_phase: 0,
      normalize_arena_done: false,
    }
  }

  pub fn clear(&mut self) {
    self.arena.clear();
    self.entries.clear();
    self.path_slots.clear();
    self.path_slots_mask = 0;
    self.by_path_overflow.clear();
    self.name_intern.clear();
    self.name_index.clear();
    self.name_index_dirty = false;
    self.frn_dense.clear();
    self.frn_overflow.clear();
    self.pending_parent.clear();
    self.free.clear();
    self.live = 0;
    self.path_index_dirty = false;
    self.path_index_ready = false;
    self.dirty_ids.clear();
    self.normalize_cursor = 0;
    self.normalize_phase = 0;
    self.normalize_arena_done = false;
  }

  pub fn len(&self) -> usize {
    self.live
  }

  pub fn cursor_end(&self) -> usize {
    self.entries.len()
  }

  pub fn approx_bytes(&self) -> usize {
    self.arena.len()
      + self.entries.len() * std::mem::size_of::<Entry>()
      + self.path_slots.len() * 4
      + self.name_intern.capacity() * 24
      + self.name_index.len() * 4
      + self.frn_dense.len() * 4
      + self.frn_overflow.capacity() * 16
      + self.by_path_overflow.capacity() * 48
  }

  pub fn mem_breakdown(&self) -> serde_json::Value {
    serde_json::json!({
      "arena": self.arena.len(),
      "entries": self.entries.len() * std::mem::size_of::<Entry>(),
      "path_slots": self.path_slots.len() * 4,
      "path_index_ready": self.path_index_ready,
      "by_path_ready": self.path_index_ready,
      "name_intern": self.name_intern.capacity() * 24,
      "name_index": self.name_index.len() * 4,
      "frn_dense": self.frn_dense.len() * 4,
      "frn_overflow": self.frn_overflow.capacity() * 16,
      "free": self.free.len(),
      "live": self.live,
      "normalize_phase": self.normalize_phase,
      "approx": self.approx_bytes(),
    })
  }

  pub fn path_index_ready(&self) -> bool {
    self.path_index_ready
  }

  pub fn free_len(&self) -> usize {
    self.free.len()
  }

  fn frn_get(&self, frn: u64) -> Option<u32> {
    if frn == 0 {
      return None;
    }
    let i = frn as usize;
    if i < self.frn_dense.len() {
      let id = self.frn_dense[i];
      if id != FRN_EMPTY {
        return Some(id);
      }
      return None;
    }
    self.frn_overflow.get(&frn).copied()
  }

  fn frn_set(&mut self, frn: u64, id: u32) {
    if frn == 0 {
      return;
    }
    let i = frn as usize;
    if i < FRN_DENSE_MAX {
      if self.frn_dense.len() <= i {
        // Grow by powers of two to avoid O(n) realloc thrash on MFT streams
        let mut cap = self.frn_dense.capacity().max(1024);
        while cap <= i {
          cap = (cap * 2).min(FRN_DENSE_MAX);
          if cap <= self.frn_dense.capacity() {
            cap = i + 1;
            break;
          }
        }
        self.frn_dense.reserve(cap.saturating_sub(self.frn_dense.capacity()));
        self.frn_dense.resize(i + 1, FRN_EMPTY);
      }
      self.frn_dense[i] = id;
      self.frn_overflow.remove(&frn);
    } else {
      self.frn_overflow.insert(frn, id);
    }
  }

  fn frn_remove(&mut self, frn: u64) {
    if frn == 0 {
      return;
    }
    let i = frn as usize;
    if i < self.frn_dense.len() {
      self.frn_dense[i] = FRN_EMPTY;
    }
    self.frn_overflow.remove(&frn);
  }

  fn mark_dirty(&mut self, id: u32) {
    // Only track after an initial snapshot exists (USN-sized deltas).
    // Full MFT ingest must not push 1M ids into dirty_ids.
    if self.persist_gen == 0 {
      return;
    }
    self.dirty_ids.push(id);
  }

  fn push_bytes(&mut self, b: &[u8]) -> (u32, u32) {
    let off = self.arena.len() as u32;
    self.arena.extend_from_slice(b);
    (off, b.len() as u32)
  }

  fn slice(&self, off: u32, len: u32) -> &[u8] {
    let a = off as usize;
    let b = a + len as usize;
    &self.arena[a..b]
  }

  fn slice_str(&self, off: u32, len: u32) -> &str {
    std::str::from_utf8(self.slice(off, len)).unwrap_or("")
  }

  fn name_len(e: &Entry) -> u32 {
    e.name_len_flags & LEN_MASK
  }

  fn is_live(e: &Entry) -> bool {
    e.name_len_flags & FLAG_LIVE != 0
  }

  fn is_dir(e: &Entry) -> bool {
    e.name_len_flags & FLAG_DIR != 0
  }

  fn pack_flags(len: u32, is_dir: bool, live: bool) -> u32 {
    let mut f = len & LEN_MASK;
    if is_dir {
      f |= FLAG_DIR;
    }
    if live {
      f |= FLAG_LIVE;
    }
    f
  }

  fn intern_name(&mut self, name_lc: &str) -> (u32, u32) {
    let h = hash_str(name_lc);
    if let Some(r) = self.name_intern.get(&h) {
      if self.slice(r.off, r.len) == name_lc.as_bytes() {
        return (r.off, r.len);
      }
      return self.push_bytes(name_lc.as_bytes());
    }
    let (off, len) = self.push_bytes(name_lc.as_bytes());
    self.name_intern.insert(h, NameRef { off, len });
    (off, len)
  }

  fn build_path(&self, id: u32) -> String {
    let mut parts: Vec<&str> = Vec::with_capacity(8);
    let mut cur = id;
    let mut guard = 0u32;
    while cur != NO_PARENT && guard < 512 {
      let Some(e) = self.entries.get(cur as usize) else {
        break;
      };
      if !Self::is_live(e) {
        break;
      }
      parts.push(self.slice_str(e.name_off, Self::name_len(e)));
      cur = e.parent;
      guard += 1;
    }
    parts.reverse();
    join_components(&parts)
  }

  /// Hash logical path without allocating the full String (same bytes as `build_path`).
  fn hash_path_of(&self, id: u32) -> u64 {
    let mut stack: Vec<(u32, u32)> = Vec::with_capacity(8); // leaf ? root
    let mut cur = id;
    let mut guard = 0u32;
    while cur != NO_PARENT && guard < 512 {
      let Some(e) = self.entries.get(cur as usize) else {
        break;
      };
      if !Self::is_live(e) {
        break;
      }
      stack.push((e.name_off, Self::name_len(e)));
      cur = e.parent;
      guard += 1;
    }
    if stack.is_empty() {
      return 0;
    }
    let mut h: u64 = 0xcbf2_9ce4_8422_2325;
    let mut feed = |b: &[u8]| {
      for &x in b {
        h ^= u64::from(x);
        h = h.wrapping_mul(0x0100_0000_01b3);
      }
    };
    // root ? leaf (stack is leaf?root)
    let (r_off, r_len) = stack[stack.len() - 1];
    let root = self.slice(r_off, r_len);
    feed(root);
    let drive = root.ends_with(b":");
    if stack.len() == 1 {
      return h;
    }
    if drive {
      feed(b"\\");
    }
    for k in (0..stack.len() - 1).rev() {
      if !(drive && k == stack.len() - 2) {
        // first child after drive: separator already fed; deeper: need '\'
        if drive {
          if k < stack.len() - 2 {
            feed(b"\\");
          }
        } else {
          feed(b"\\");
        }
      }
      let (off, len) = stack[k];
      feed(self.slice(off, len));
    }
    h
  }

  fn view(&self, id: u32, e: &Entry) -> EntryView {
    let path = self.build_path(id);
    let name = self.slice_str(e.name_off, Self::name_len(e)).to_string();
    EntryView {
      path,
      name,
      kind: if Self::is_dir(e) {
        Some("folder")
      } else {
        None
      },
      frn: if e.frn != 0 {
        Some(e.frn.to_string())
      } else {
        None
      },
    }
  }

  fn path_slots_cap_for(live: usize) -> usize {
    // Load ~0.8; avoid pow2 jump (1.1M -> ~1.38M slots, not 2M)
    let n = (live.max(1) * 5) / 4;
    let n = n.max(16);
    // Use pow2 only when waste is small (<=12.5%)
    let p2 = n.next_power_of_two();
    if p2 <= n + (n / 8) {
      p2
    } else {
      n
    }
  }

  /// `live` = number of live entries to size for (not a raw slot count).
  fn path_slots_reset(&mut self, live: usize) {
    let cap = Self::path_slots_cap_for(live);
    self.path_slots.clear();
    self.path_slots.resize(cap, FRN_EMPTY);
    self.path_slots_mask = if cap.is_power_of_two() { cap - 1 } else { 0 };
  }

  #[inline]
  fn path_slots_index(&self, path_hash: u64) -> usize {
    let len = self.path_slots.len();
    if len == 0 {
      0
    } else if self.path_slots_mask != 0 {
      (path_hash as usize) & self.path_slots_mask
    } else {
      (path_hash as usize) % len
    }
  }

  #[inline]
  fn path_slots_next(&self, i: usize) -> usize {
    let n = i + 1;
    if n >= self.path_slots.len() {
      0
    } else {
      n
    }
  }

  fn path_slots_clear(&mut self) {
    self.path_slots.clear();
    self.path_slots_mask = 0;
    self.by_path_overflow.clear();
  }

  /// Probe open-addressing table for entry id with matching path_hash.
  fn path_slots_find(&self, path_hash: u64) -> Option<u32> {
    if self.path_slots.is_empty() || path_hash == 0 {
      return None;
    }
    let mut i = self.path_slots_index(path_hash);
    for _ in 0..self.path_slots.len() {
      let id = self.path_slots[i];
      if id == FRN_EMPTY {
        return None;
      }
      if let Some(e) = self.entries.get(id as usize) {
        if Self::is_live(e) && e.path_hash == path_hash {
          return Some(id);
        }
      }
      i = self.path_slots_next(i);
    }
    None
  }

  fn path_slots_put(&mut self, path_hash: u64, id: u32) {
    if self.path_slots.is_empty() || path_hash == 0 {
      return;
    }
    let mut i = self.path_slots_index(path_hash);
    for _ in 0..self.path_slots.len() {
      let slot = self.path_slots[i];
      if slot == FRN_EMPTY || slot == id {
        self.path_slots[i] = id;
        return;
      }
      i = self.path_slots_next(i);
    }
  }

  fn path_slots_delete(&mut self, path_hash: u64, id: u32) {
    if self.path_slots.is_empty() {
      return;
    }
    let mut i = self.path_slots_index(path_hash);
    let mut found = None;
    for _ in 0..self.path_slots.len() {
      let slot = self.path_slots[i];
      if slot == FRN_EMPTY {
        return;
      }
      if slot == id {
        found = Some(i);
        break;
      }
      i = self.path_slots_next(i);
    }
    let Some(start) = found else {
      return;
    };
    self.path_slots[start] = FRN_EMPTY;
    // Rehash cluster (classic open-addressing delete)
    let mut j = self.path_slots_next(start);
    loop {
      let slot = self.path_slots[j];
      if slot == FRN_EMPTY {
        break;
      }
      self.path_slots[j] = FRN_EMPTY;
      let h = self.entries.get(slot as usize).map(|e| e.path_hash).unwrap_or(0);
      if h != 0 {
        self.path_slots_put(h, slot);
      }
      j = self.path_slots_next(j);
    }
  }

  fn path_slots_maybe_grow(&mut self) {
    if self.path_slots.is_empty() {
      return;
    }
    let want = Self::path_slots_cap_for(self.live + 1);
    if want <= self.path_slots.len() {
      return;
    }
    let ids: Vec<u32> = self
      .path_slots
      .iter()
      .copied()
      .filter(|&id| id != FRN_EMPTY)
      .collect();
    self.path_slots_reset(self.live + 1);
    for id in ids {
      let h = self.entries.get(id as usize).map(|e| e.path_hash).unwrap_or(0);
      self.path_slots_put(h, id);
    }
  }

  fn ensure_path_index(&mut self) {
    if self.path_index_ready {
      return;
    }
    self.by_path_overflow.clear();
    self.path_slots_reset(self.live);
    for i in 0..self.entries.len() {
      if !Self::is_live(&self.entries[i]) {
        continue;
      }
      let mut h = self.entries[i].path_hash;
      if h == 0 {
        h = self.hash_path_of(i as u32);
        if h == 0 {
          continue;
        }
        self.entries[i].path_hash = h;
      }
      // Overflow verify only on collision; rare collision uses build_path
      if let Some(existing) = self.path_slots_find(h) {
        if existing != i as u32 {
          let path = self.build_path(i as u32);
          self.path_insert_key(&path, h, i as u32);
          continue;
        }
      }
      self.path_slots_put(h, i as u32);
    }
    self.path_index_ready = true;
  }

  fn lookup_path_id(&mut self, path_lc: &str) -> Option<u32> {
    self.ensure_path_index();
    let h = hash_str(path_lc);
    if let Some(id) = self.path_slots_find(h) {
      if let Some(e) = self.entries.get(id as usize) {
        if Self::is_live(e) && e.path_hash == h {
          // cheap hash match; verify on overflow collisions only
          if self.by_path_overflow.is_empty() || self.build_path(id) == path_lc {
            return Some(id);
          }
        }
      }
    }
    self.by_path_overflow.get(path_lc).copied()
  }

  fn path_insert_key(&mut self, path_lc: &str, path_hash: u64, id: u32) {
    if self.path_slots.is_empty() {
      // Index not allocated yet (lazy); caller will ensure_path_index later
      return;
    }
    self.path_slots_maybe_grow();
    if let Some(existing) = self.path_slots_find(path_hash) {
      if existing != id {
        if let Some(e) = self.entries.get(existing as usize) {
          if Self::is_live(e) && e.path_hash == path_hash {
            let other = self.build_path(existing);
            if other != path_lc {
              self.by_path_overflow.insert(path_lc.to_string(), id);
              return;
            }
          }
        }
      }
    }
    self.path_slots_put(path_hash, id);
  }

  fn path_remove_key(&mut self, path_lc: &str, path_hash: u64) {
    if let Some(id) = self.path_slots_find(path_hash) {
      if self.build_path(id) == path_lc {
        self.path_slots_delete(path_hash, id);
        return;
      }
    }
    self.by_path_overflow.remove(path_lc);
  }

  fn alloc_entry(&mut self, ent: Entry) -> u32 {
    if let Some(id) = self.free.pop() {
      self.entries[id as usize] = ent;
      id
    } else {
      let id = self.entries.len() as u32;
      self.entries.push(ent);
      id
    }
  }

  /// Ensure directory chain exists; returns id of final component.
  fn ensure_components(&mut self, components: &[&str], leaf_is_dir: bool, leaf_frn: u64) -> u32 {
    let mut parent = NO_PARENT;
    let last = components.len().saturating_sub(1);
    for (i, &comp) in components.iter().enumerate() {
      let path_key = join_components(&components[..=i]);
      let is_last = i == last;
      let is_dir = !is_last || leaf_is_dir;
      let frn = if is_last { leaf_frn } else { 0 };
      let h = hash_str(&path_key);

      if let Some(id) = self.lookup_path_id(&path_key) {
        if is_last {
          let old = self.entries[id as usize];
          if old.frn != 0 && old.frn != frn && frn != 0 {
            self.frn_remove(old.frn);
          }
          let (no, nl) = self.intern_name(comp);
          let new_frn = if frn != 0 { frn } else { old.frn };
          self.entries[id as usize] = Entry {
            parent,
            name_off: no,
            name_len_flags: Self::pack_flags(nl, is_dir, true),
            frn: new_frn,
            path_hash: h,
          };
          if new_frn != 0 {
            self.frn_set(new_frn, id);
          }
          self.name_index_dirty = true;
        } else if !Self::is_dir(&self.entries[id as usize]) {
          self.entries[id as usize].name_len_flags |= FLAG_DIR;
        }
        parent = id;
        continue;
      }

      let (no, nl) = self.intern_name(comp);
      let ent = Entry {
        parent,
        name_off: no,
        name_len_flags: Self::pack_flags(nl, is_dir, true),
        frn,
        path_hash: h,
      };
      let id = self.alloc_entry(ent);
      self.path_insert_key(&path_key, h, id);
      if frn != 0 {
        self.frn_set(frn, id);
      }
      self.live += 1;
      self.name_index_dirty = true;
      parent = id;
    }
    parent
  }

  pub fn upsert(&mut self, path: &str, name: &str, is_dir: bool, frn: u64) {
    let path_lc = path.to_ascii_lowercase();
    let name_lc = name.to_ascii_lowercase();
    let components = split_components(&path_lc);
    if components.is_empty() {
      return;
    }
    // Ensure leaf name matches last component (walk may send either)
    let last = components.last().copied().unwrap_or("");
    if last != name_lc.as_str() {
      // prefer explicit name as leaf
      let mut owned: Vec<String> = components.iter().map(|s| (*s).to_string()).collect();
      if let Some(x) = owned.last_mut() {
        *x = name_lc.clone();
      }
      let refs: Vec<&str> = owned.iter().map(|s| s.as_str()).collect();
      self.ensure_components(&refs, is_dir, frn);
      return;
    }
    self.ensure_components(&components, is_dir, frn);
  }

  /// Volume root for FRN-link ingest (`drive` like `e:` / `E:\`).
  pub fn ensure_root(&mut self, drive: &str, frn: u64) {
    let raw = drive.trim().trim_end_matches(['\\', '/']).to_ascii_lowercase();
    if raw.len() < 2 || raw.as_bytes()[1] != b':' {
      return;
    }
    let name = raw[..2].to_string();
    let h = hash_str(&name);
    if frn != 0 {
      if let Some(id) = self.frn_get(frn) {
        {
          let e = &mut self.entries[id as usize];
          e.parent = NO_PARENT;
          e.path_hash = h;
          e.name_len_flags |= FLAG_DIR | FLAG_LIVE;
        }
        self.path_insert_key(&name, h, id);
        return;
      }
    }
    if let Some(id) = self.lookup_path_id(&name) {
      let old_frn = self.entries[id as usize].frn;
      if frn != 0 {
        if old_frn != 0 && old_frn != frn {
          self.frn_remove(old_frn);
        }
        self.entries[id as usize].frn = frn;
        self.frn_set(frn, id);
      }
      {
        let e = &mut self.entries[id as usize];
        e.parent = NO_PARENT;
        e.path_hash = h;
        e.name_len_flags |= FLAG_DIR | FLAG_LIVE;
      }
      return;
    }
    let (no, nl) = self.intern_name(&name);
    let id = self.alloc_entry(Entry {
      parent: NO_PARENT,
      name_off: no,
      name_len_flags: Self::pack_flags(nl, true, true),
      frn,
      path_hash: h,
    });
    self.path_insert_key(&name, h, id);
    if frn != 0 {
      self.frn_set(frn, id);
    }
    self.live += 1;
    self.name_index_dirty = true;
  }

  /// MFT/USN node upsert   -  no full path string. Parent linked on `seal`/`barrier`.
  pub fn upsert_node(&mut self, name: &str, frn: u64, parent_frn: u64, is_dir: bool) {
    if frn == 0 || name.is_empty() {
      return;
    }
    let name_lc = name.to_ascii_lowercase();
    // Cold MFT ingest: skip name_intern HashMap (Windows won't reclaim it later).
    // USN/path updates after first persist use intern; space debt compact_arena dedupes.
    let (no, nl) = if self.persist_gen == 0 {
      self.push_bytes(name_lc.as_bytes())
    } else {
      self.intern_name(&name_lc)
    };

    if let Some(id) = self.frn_get(frn) {
      {
        let e = &mut self.entries[id as usize];
        e.name_off = no;
        e.name_len_flags = Self::pack_flags(nl, is_dir, true);
        e.frn = frn;
        e.path_hash = 0;
      }
      if parent_frn != 0 && parent_frn != frn {
        self.pending_parent.insert(id, parent_frn);
      } else {
        self.pending_parent.remove(&id);
        self.entries[id as usize].parent = NO_PARENT;
      }
      self.path_index_dirty = true;
      self.path_index_ready = false;
      self.name_index_dirty = true;
      self.mark_dirty(id);
      return;
    }

    let id = self.alloc_entry(Entry {
      parent: NO_PARENT,
      name_off: no,
      name_len_flags: Self::pack_flags(nl, is_dir, true),
      frn,
      path_hash: 0,
    });
    self.frn_set(frn, id);
    if parent_frn != 0 && parent_frn != frn {
      self.pending_parent.insert(id, parent_frn);
    }
    self.live += 1;
    self.path_index_dirty = true;
    self.path_index_ready = false;
    self.name_index_dirty = true;
    self.mark_dirty(id);
  }

  /// Resolve pending parent FRNs only. Path hashes deferred to `ensure_path_index`
  /// (name query / seal must not pay 1M String builds on T1).
  pub fn relink_parents(&mut self) {
    if self.pending_parent.is_empty() && !self.path_index_dirty {
      return;
    }
    let pending: Vec<(u32, u64)> = self.pending_parent.drain().collect();
    for (id, parent_frn) in pending {
      if id as usize >= self.entries.len() {
        continue;
      }
      if !Self::is_live(&self.entries[id as usize]) {
        continue;
      }
      if let Some(pid) = self.frn_get(parent_frn) {
        if pid != id {
          self.entries[id as usize].parent = pid;
        }
      }
      // else orphan: parent remains NO_PARENT
    }
    // Invalidate path index; hashes filled lazily
    self.path_slots_clear();
    self.path_index_ready = false;
    self.path_index_dirty = false;
  }

  pub fn remove_frn(&mut self, frn: u64) -> bool {
    let Some(id) = self.frn_get(frn) else {
      return false;
    };
    if !Self::is_live(&self.entries[id as usize]) {
      return false;
    }
    let path = self.build_path(id);
    if path.is_empty() {
      let old = self.entries[id as usize];
      self.frn_remove(old.frn);
      self.pending_parent.remove(&id);
      self.entries[id as usize].name_len_flags = 0;
      self.free.push(id);
      self.live = self.live.saturating_sub(1);
      self.name_index_dirty = true;
      return true;
    }
    self.remove(&path)
  }

  pub fn remove(&mut self, path: &str) -> bool {
    let path_lc = path.to_ascii_lowercase();
    // Also try trimmed / volume forms
    let keys = [
      path_lc.clone(),
      path_lc.trim_end_matches('\\').to_string(),
    ];
    let mut id_opt = None;
    for k in &keys {
      if let Some(id) = self.lookup_path_id(k) {
        id_opt = Some((id, k.clone()));
        break;
      }
    }
    // volume root "e:\"   -  "e:"
    if id_opt.is_none() && path_lc.len() >= 2 && path_lc.as_bytes()[1] == b':' {
      let drive = &path_lc[..2];
      if let Some(id) = self.lookup_path_id(drive) {
        id_opt = Some((id, drive.to_string()));
      }
    }
    let Some((id, key)) = id_opt else {
      return false;
    };
    let old = self.entries[id as usize];
    if old.frn != 0 {
      self.frn_remove(old.frn);
    }
    self.path_remove_key(&key, old.path_hash);
    self.entries[id as usize].name_len_flags = 0;
    self.free.push(id);
    self.live = self.live.saturating_sub(1);
    self.name_index_dirty = true;
    true
  }

  pub fn remove_prefix(&mut self, prefix: &str) -> usize {
    let p = prefix.to_ascii_lowercase();
    let p_trim = p.trim_end_matches('\\').to_string();
    let pref = format!("{p_trim}\\");
    let mut keys = Vec::new();
    for i in 0..self.entries.len() {
      let e = &self.entries[i];
      if !Self::is_live(e) {
        continue;
      }
      let path = self.build_path(i as u32);
      if path == p_trim || path == p || path.starts_with(&pref) {
        keys.push(path);
      }
    }
    let mut n = 0;
    for k in keys {
      if self.remove(&k) {
        n += 1;
      }
    }
    n
  }

  pub fn get(&mut self, path: &str) -> Option<EntryView> {
    let path_lc = path.to_ascii_lowercase();
    let id = self
      .lookup_path_id(&path_lc)
      .or_else(|| {
        let t = path_lc.trim_end_matches('\\').to_string();
        self.lookup_path_id(&t)
      })?;
    let e = self.entries.get(id as usize)?;
    if !Self::is_live(e) {
      return None;
    }
    Some(self.view(id, e))
  }

  pub fn get_many(&mut self, paths: &[String]) -> Vec<Option<EntryView>> {
    paths.iter().map(|p| self.get(p)).collect()
  }

  pub fn resolve_frn(&self, frn: u64) -> Option<EntryView> {
    let id = self.frn_get(frn)?;
    let e = self.entries.get(id as usize)?;
    if !Self::is_live(e) {
      return None;
    }
    Some(self.view(id, e))
  }

  pub fn shrink(&mut self) {
    self.arena.shrink_to_fit();
    self.entries.shrink_to_fit();
    self.path_slots.shrink_to_fit();
    self.by_path_overflow.shrink_to_fit();
    // Drop bulk name intern after MFT ? USN upserts re-seed lazily (big RSS win)
    self.name_intern.clear();
    self.name_intern.shrink_to_fit();
    self.name_index.shrink_to_fit();
    // Trim trailing empty FRN slots
    while self.frn_dense.last().copied() == Some(FRN_EMPTY) {
      self.frn_dense.pop();
    }
    self.frn_dense.shrink_to_fit();
    self.frn_overflow.shrink_to_fit();
    self.pending_parent.shrink_to_fit();
    self.free.shrink_to_fit();
    self.dirty_ids.shrink_to_fit();
  }

  /// Begin or continue space-debt normalization. Returns (did, done, phase_name).
  pub fn normalize_slice(&mut self, ops: usize) -> (usize, bool, &'static str) {
    let ops = ops.max(1);
    // Phase 0: fill path_hash + path_slots in batches
    if self.normalize_phase == 0 {
      if self.path_index_ready {
        self.normalize_phase = 1;
        self.normalize_cursor = 0;
      } else {
        if self.normalize_cursor == 0 {
          self.by_path_overflow.clear();
          self.path_slots_reset(self.live);
        }
        let mut did = 0usize;
        while self.normalize_cursor < self.entries.len() && did < ops {
          let i = self.normalize_cursor;
          self.normalize_cursor += 1;
          if !Self::is_live(&self.entries[i]) {
            continue;
          }
          let mut h = self.entries[i].path_hash;
          if h == 0 {
            h = self.hash_path_of(i as u32);
            if h == 0 {
              continue;
            }
            self.entries[i].path_hash = h;
          }
          if let Some(existing) = self.path_slots_find(h) {
            if existing != i as u32 {
              let path = self.build_path(i as u32);
              self.path_insert_key(&path, h, i as u32);
              did += 1;
              continue;
            }
          }
          self.path_slots_put(h, i as u32);
          did += 1;
        }
        if self.normalize_cursor >= self.entries.len() {
          self.path_index_ready = true;
          self.normalize_phase = 1;
          self.normalize_cursor = 0;
        }
        return (did, false, "path");
      }
    }

    // Phase 1: shrink maps (one shot)
    if self.normalize_phase == 1 {
      self.shrink();
      self.normalize_phase = 2;
      return (1, false, "shrink");
    }

    // Phase 2: at most one arena compact per cycle, then always rebuild path
    if self.normalize_phase == 2 {
      let free_waste = self.live > 0 && self.free.len() * 20 > self.live; // >5%
      let arena_fat = self.live > 0 && self.arena.len() > self.live.saturating_mul(12);
      if !self.normalize_arena_done && (free_waste || arena_fat) {
        self.normalize_arena_done = true;
        self.compact_arena_entries(); // invalidates path_index -- rebuild via phase 0
        self.normalize_phase = 0;
        self.normalize_cursor = 0;
        return (1, false, "arena");
      }
      self.normalize_phase = 3;
      return (1, false, "arena");
    }

    // Phase 3: done -- reset for next owe cycle
    self.normalize_phase = 0;
    self.normalize_cursor = 0;
    self.normalize_arena_done = false;
    (0, true, "done")
  }

  /// Repack live entries densely and rebuild arena of referenced names only.
  fn compact_arena_entries(&mut self) {
    let old_entries = std::mem::take(&mut self.entries);
    let old_arena = std::mem::take(&mut self.arena);
    let mut new_entries = Vec::with_capacity(self.live);
    let mut id_map: Vec<u32> = vec![NO_PARENT; old_entries.len()];
    let mut name_cache: FxHashMap<(u32, u32), (u32, u32)> = FxHashMap::default();

    for (old_id, e) in old_entries.iter().enumerate() {
      if !Self::is_live(e) {
        continue;
      }
      let key = (e.name_off, Self::name_len(e));
      let (no, nl) = if let Some(&x) = name_cache.get(&key) {
        x
      } else {
        let a = e.name_off as usize;
        let b = a + (e.name_len_flags & LEN_MASK) as usize;
        let bytes = if b <= old_arena.len() {
          &old_arena[a..b]
        } else {
          &[]
        };
        let off = self.arena.len() as u32;
        self.arena.extend_from_slice(bytes);
        let len = bytes.len() as u32;
        name_cache.insert(key, (off, len));
        (off, len)
      };
      let new_id = new_entries.len() as u32;
      id_map[old_id] = new_id;
      new_entries.push(Entry {
        parent: e.parent, // remap below
        name_off: no,
        name_len_flags: Self::pack_flags(nl, Self::is_dir(e), true),
        frn: e.frn,
        path_hash: e.path_hash,
      });
    }

    for e in &mut new_entries {
      if e.parent != NO_PARENT {
        let p = e.parent as usize;
        e.parent = if p < id_map.len() { id_map[p] } else { NO_PARENT };
      }
    }

    self.entries = new_entries;
    self.free.clear();
    self.live = self.entries.len();
    self.frn_dense.clear();
    self.frn_overflow.clear();
    self.path_slots_clear();
    self.path_index_ready = false;
    self.name_intern.clear();
    let frns: Vec<(u64, u32)> = self
      .entries
      .iter()
      .enumerate()
      .filter(|(_, e)| e.frn != 0)
      .map(|(i, e)| (e.frn, i as u32))
      .collect();
    for (frn, id) in frns {
      self.frn_set(frn, id);
    }
    for i in 0..self.entries.len() {
      let e = self.entries[i];
      let name = self.slice_str(e.name_off, Self::name_len(&e));
      let h = hash_str(name);
      self.name_intern.entry(h).or_insert(NameRef {
        off: e.name_off,
        len: Self::name_len(&e),
      });
    }
    self.name_index_dirty = true;
    // Re-seal name index; path index filled by next normalize or ensure_path_index
    self.seal();
  }

  /// Reset normalize machine so a fresh space debt starts at path phase.
  pub fn reset_normalize(&mut self) {
    self.normalize_phase = 0;
    self.normalize_cursor = 0;
    self.normalize_arena_done = false;
  }

  pub fn seal(&mut self) {
    if self.path_index_dirty || !self.pending_parent.is_empty() {
      self.relink_parents();
    }
    if !self.name_index_dirty && !self.name_index.is_empty() {
      return;
    }
    self.name_index.clear();
    self.name_index.reserve(self.live);
    for (i, e) in self.entries.iter().enumerate() {
      if Self::is_live(e) {
        self.name_index.push(i as u32);
      }
    }
    let entries = &self.entries;
    let arena = &self.arena;
    self.name_index.sort_unstable_by(|&ia, &ib| {
      let a = &entries[ia as usize];
      let b = &entries[ib as usize];
      let sa = &arena[a.name_off as usize..a.name_off as usize + (a.name_len_flags & LEN_MASK) as usize];
      let sb = &arena[b.name_off as usize..b.name_off as usize + (b.name_len_flags & LEN_MASK) as usize];
      sa.cmp(sb)
    });
    self.name_index_dirty = false;
  }

  fn matches_rest(view: &EntryView, rest: &[&str]) -> bool {
    if rest.is_empty() {
      return true;
    }
    let hay = format!("{} {}", view.name, view.path).to_ascii_lowercase();
    rest.iter().all(|t| hay.contains(t))
  }

  pub fn query(&mut self, q: &str, limit: usize, mode: &str) -> Vec<EntryView> {
    self.seal();
    let needle = q.to_ascii_lowercase();
    if needle.is_empty() || limit == 0 {
      return vec![];
    }
    let tokens: Vec<&str> = needle.split_whitespace().filter(|t| !t.is_empty()).collect();
    let primary = tokens.first().copied().unwrap_or(needle.as_str());
    let rest = &tokens[1..];
    let mut out = Vec::with_capacity(limit.min(64));

    let use_contains = mode == "contains" || tokens.len() > 1 || primary.len() <= 4;
    if use_contains {
      // Avoid cloning the full name_index (1M+ ids) on every contains query.
      let n = self.name_index.len();
      for i in 0..n {
        let id = self.name_index[i];
        let Some(e) = self.entries.get(id as usize).copied() else { continue };
        if !Self::is_live(&e) {
          continue;
        }
        let name = self.slice_str(e.name_off, Self::name_len(&e));
        if !name.contains(primary) {
          continue;
        }
        let view = self.view(id, &e);
        if !Self::matches_rest(&view, rest) {
          continue;
        }
        out.push(view);
        if out.len() >= limit {
          return out;
        }
      }
      return out;
    }

    let needle_b = primary.as_bytes();
    let start = {
      let entries = &self.entries;
      let arena = &self.arena;
      self.name_index.partition_point(|&id| {
        let e = &entries[id as usize];
        let len = e.name_len_flags & LEN_MASK;
        let name = &arena[e.name_off as usize..e.name_off as usize + len as usize];
        name < needle_b
      })
    };
    for &id in &self.name_index[start..] {
      let Some(e) = self.entries.get(id as usize).copied() else { break };
      if !Self::is_live(&e) {
        continue;
      }
      let name = self.slice(e.name_off, Self::name_len(&e));
      if !name.starts_with(needle_b) {
        break;
      }
      let view = self.view(id, &e);
      if !Self::matches_rest(&view, rest) {
        continue;
      }
      out.push(view);
      if out.len() >= limit {
        return out;
      }
    }
    out
  }

  pub fn export_slice(&self, cursor: usize, n: usize) -> (Vec<EntryView>, usize) {
    let mut out = Vec::new();
    let mut i = cursor;
    let mut emitted = 0usize;
    while i < self.entries.len() && emitted < n {
      let e = &self.entries[i];
      if Self::is_live(e) {
        out.push(self.view(i as u32, e));
        emitted += 1;
      }
      i += 1;
    }
    (out, i)
  }

  pub fn export_slice_lite(&self, cursor: usize, n: usize) -> (Vec<serde_json::Value>, usize) {
    let mut out = Vec::new();
    let mut i = cursor;
    let mut emitted = 0usize;
    while i < self.entries.len() && emitted < n {
      let e = &self.entries[i];
      if Self::is_live(e) {
        let path = self.build_path(i as u32);
        let name = self.slice_str(e.name_off, Self::name_len(e));
        out.push(serde_json::json!({ "path": path, "name": name }));
        emitted += 1;
      }
      i += 1;
    }
    (out, i)
  }

  //  -  NDJSON (compat)  - 

  pub fn hydrate_ndjson(&mut self, path: &Path) -> Result<usize, String> {
    let f = File::open(path).map_err(|e| e.to_string())?;
    let reader = std::io::BufReader::new(f);
    let mut n = 0usize;
    for line in std::io::BufRead::lines(reader) {
      let line = line.map_err(|e| e.to_string())?;
      let t = line.trim();
      if t.is_empty() {
        continue;
      }
      let v: serde_json::Value = serde_json::from_str(t).map_err(|e| e.to_string())?;
      let path = v.get("path").and_then(|x| x.as_str()).unwrap_or("");
      let name = v.get("name").and_then(|x| x.as_str()).unwrap_or("");
      if path.is_empty() || name.is_empty() {
        continue;
      }
      let is_dir = v.get("kind").and_then(|x| x.as_str()) == Some("folder");
      let frn = v
        .get("frn")
        .and_then(|x| x.as_str().and_then(|s| s.parse().ok()).or_else(|| x.as_u64()))
        .unwrap_or(0);
      self.upsert(path, name, is_dir, frn);
      n += 1;
    }
    self.seal();
    self.shrink();
    Ok(n)
  }

  pub fn persist_ndjson(&mut self, path: &Path) -> Result<usize, String> {
    if let Some(parent) = path.parent() {
      std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let f = File::create(path).map_err(|e| e.to_string())?;
    let mut w = std::io::BufWriter::new(f);
    let mut n = 0usize;
    for i in 0..self.entries.len() {
      let e = &self.entries[i];
      if !Self::is_live(e) {
        continue;
      }
      let view = self.view(i as u32, e);
      serde_json::to_writer(&mut w, &view).map_err(|e| e.to_string())?;
      w.write_all(b"\n").map_err(|e| e.to_string())?;
      n += 1;
    }
    w.flush().map_err(|e| e.to_string())?;
    Ok(n)
  }

  //  -  Binary snapshot v2  - 

  fn pack_entries_bytes(&self) -> Vec<u8> {
    let mut packed = Vec::with_capacity(self.entries.len() * 28);
    for e in &self.entries {
      packed.extend_from_slice(&e.parent.to_le_bytes());
      packed.extend_from_slice(&e.name_off.to_le_bytes());
      packed.extend_from_slice(&e.name_len_flags.to_le_bytes());
      packed.extend_from_slice(&e.frn.to_le_bytes());
      packed.extend_from_slice(&e.path_hash.to_le_bytes());
    }
    packed
  }

  pub fn persist_bin(&mut self, path: &Path) -> Result<usize, String> {
    if let Some(parent) = path.parent() {
      std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let packed = self.pack_entries_bytes();
    let arena = self.arena.clone();
    let live = self.live as u64;
    let n = self.entries.len() as u64;
    let tmp = path.with_extension("aidx.tmp");
    let path_buf = path.to_path_buf();
    let tmp_buf = tmp.clone();

    let write_res = std::thread::spawn(move || -> Result<usize, String> {
      let f = File::create(&tmp_buf).map_err(|e| e.to_string())?;
      let mut w = BufWriter::with_capacity(8 * 1024 * 1024, f);
      w.write_all(SNAP_MAGIC).map_err(|e| e.to_string())?;
      w.write_all(&SNAP_VERSION.to_le_bytes()).map_err(|e| e.to_string())?;
      w.write_all(&(arena.len() as u64).to_le_bytes())
        .map_err(|e| e.to_string())?;
      w.write_all(&arena).map_err(|e| e.to_string())?;
      w.write_all(&n.to_le_bytes()).map_err(|e| e.to_string())?;
      w.write_all(&packed).map_err(|e| e.to_string())?;
      w.write_all(&live.to_le_bytes()).map_err(|e| e.to_string())?;
      w.flush().map_err(|e| e.to_string())?;
      drop(w);
      std::fs::rename(&tmp_buf, &path_buf).map_err(|e| e.to_string())?;
      Ok(live as usize)
    })
    .join()
    .map_err(|_| "persist_thread_panic".to_string())?;

    let nlive = write_res?;
    self.dirty_ids.clear();
    self.persist_gen = self.persist_gen.wrapping_add(1);
    let _ = std::fs::remove_file(path.with_extension("aidx.d"));
    Ok(nlive)
  }

  /// Append dirty entries to `.aidx.d` (USN-sized updates; skip full rewrite).
  pub fn persist_delta(&mut self, path: &Path) -> Result<usize, String> {
    if self.dirty_ids.is_empty() {
      return Ok(0);
    }
    if let Some(parent) = path.parent() {
      std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    self.dirty_ids.sort_unstable();
    self.dirty_ids.dedup();
    let delta_path = path.with_extension("aidx.d");
    let mut f = std::fs::OpenOptions::new()
      .create(true)
      .append(true)
      .open(&delta_path)
      .map_err(|e| e.to_string())?;
    let mut w = BufWriter::with_capacity(256 * 1024, &mut f);
    let mut n = 0usize;
    for &id in &self.dirty_ids {
      if id as usize >= self.entries.len() {
        continue;
      }
      let e = self.entries[id as usize];
      w.write_all(&id.to_le_bytes()).map_err(|e| e.to_string())?;
      w.write_all(&e.parent.to_le_bytes()).map_err(|e| e.to_string())?;
      w.write_all(&e.name_off.to_le_bytes()).map_err(|e| e.to_string())?;
      w.write_all(&e.name_len_flags.to_le_bytes())
        .map_err(|e| e.to_string())?;
      w.write_all(&e.frn.to_le_bytes()).map_err(|e| e.to_string())?;
      w.write_all(&e.path_hash.to_le_bytes()).map_err(|e| e.to_string())?;
      n += 1;
    }
    w.flush().map_err(|e| e.to_string())?;
    self.dirty_ids.clear();
    Ok(n)
  }

  pub fn hydrate_bin(&mut self, path: &Path) -> Result<usize, String> {
    let mut f = File::open(path).map_err(|e| e.to_string())?;
    let mut magic = [0u8; 4];
    f.read_exact(&mut magic).map_err(|e| e.to_string())?;
    if &magic != SNAP_MAGIC {
      return Err("bad_magic".into());
    }
    let mut u32buf = [0u8; 4];
    f.read_exact(&mut u32buf).map_err(|e| e.to_string())?;
    let ver = u32::from_le_bytes(u32buf);
    if ver != SNAP_VERSION {
      return Err(format!("bad_version:{ver}"));
    }
    let mut u64buf = [0u8; 8];
    f.read_exact(&mut u64buf).map_err(|e| e.to_string())?;
    let arena_len = u64::from_le_bytes(u64buf) as usize;
    self.clear();
    self.arena.resize(arena_len, 0);
    f.read_exact(&mut self.arena).map_err(|e| e.to_string())?;
    f.read_exact(&mut u64buf).map_err(|e| e.to_string())?;
    let n = u64::from_le_bytes(u64buf) as usize;
    self.entries.clear();
    self.entries.reserve(n);
    let mut ebuf = [0u8; 28]; // 4+4+4+8+8
    for _ in 0..n {
      f.read_exact(&mut ebuf).map_err(|e| e.to_string())?;
      let parent = u32::from_le_bytes(ebuf[0..4].try_into().unwrap());
      let name_off = u32::from_le_bytes(ebuf[4..8].try_into().unwrap());
      let name_len_flags = u32::from_le_bytes(ebuf[8..12].try_into().unwrap());
      let frn = u64::from_le_bytes(ebuf[12..20].try_into().unwrap());
      let path_hash = u64::from_le_bytes(ebuf[20..28].try_into().unwrap());
      self.entries.push(Entry {
        parent,
        name_off,
        name_len_flags,
        frn,
        path_hash,
      });
    }
    let _live_hint = {
      f.read_exact(&mut u64buf).ok();
      u64::from_le_bytes(u64buf)
    };
    // Rebuild indexes
    self.path_slots_clear();
    self.frn_dense.clear();
    self.frn_overflow.clear();
    self.free.clear();
    self.live = 0;
    self.path_index_ready = false;
    for (i, e) in self.entries.iter().enumerate() {
      if !Self::is_live(e) {
        self.free.push(i as u32);
        continue;
      }
      self.live += 1;
      if e.frn != 0 {
        // defer frn_set borrow: collect then apply
      }
    }
    // Second pass for FRN + name intern (need slice after live counted)
    let frns: Vec<(u64, u32)> = self
      .entries
      .iter()
      .enumerate()
      .filter(|(_, e)| Self::is_live(e) && e.frn != 0)
      .map(|(i, e)| (e.frn, i as u32))
      .collect();
    for (frn, id) in frns {
      self.frn_set(frn, id);
    }
    for i in 0..self.entries.len() {
      let e = self.entries[i];
      if !Self::is_live(&e) {
        continue;
      }
      let name = self.slice_str(e.name_off, Self::name_len(&e));
      let h = hash_str(name);
      self.name_intern.entry(h).or_insert(NameRef {
        off: e.name_off,
        len: Self::name_len(&e),
      });
    }
    self.name_index_dirty = true;
    self.seal();
    // Apply sidecar delta if present
    let delta = path.with_extension("aidx.d");
    if delta.exists() {
      let _ = self.apply_delta_file(&delta);
      self.seal();
    }
    self.shrink();
    self.persist_gen = self.persist_gen.wrapping_add(1);
    Ok(self.live)
  }

  /// Replay `.aidx.d` records written by `persist_delta`.
  pub fn apply_delta_file(&mut self, path: &Path) -> Result<usize, String> {
    let mut f = match File::open(path) {
      Ok(f) => f,
      Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(0),
      Err(e) => return Err(e.to_string()),
    };
    let mut n = 0usize;
    let mut rec = [0u8; 32]; // id(4) + entry(28)
    loop {
      match f.read_exact(&mut rec) {
        Ok(()) => {}
        Err(e) if e.kind() == std::io::ErrorKind::UnexpectedEof => break,
        Err(e) => return Err(e.to_string()),
      }
      let id = u32::from_le_bytes(rec[0..4].try_into().unwrap());
      let parent = u32::from_le_bytes(rec[4..8].try_into().unwrap());
      let name_off = u32::from_le_bytes(rec[8..12].try_into().unwrap());
      let name_len_flags = u32::from_le_bytes(rec[12..16].try_into().unwrap());
      let frn = u64::from_le_bytes(rec[16..24].try_into().unwrap());
      let path_hash = u64::from_le_bytes(rec[24..32].try_into().unwrap());
      let ent = Entry {
        parent,
        name_off,
        name_len_flags,
        frn,
        path_hash,
      };
      if (id as usize) < self.entries.len() {
        let old = self.entries[id as usize];
        if Self::is_live(&old) && old.frn != 0 {
          self.frn_remove(old.frn);
        }
        let was_live = Self::is_live(&old);
        self.entries[id as usize] = ent;
        if Self::is_live(&ent) {
          if !was_live {
            self.live += 1;
          }
          if frn != 0 {
            self.frn_set(frn, id);
          }
        } else if was_live {
          self.live = self.live.saturating_sub(1);
          self.free.push(id);
        }
      } else {
        // extend with empties then set
        while self.entries.len() < id as usize {
          self.entries.push(Entry {
            parent: NO_PARENT,
            name_off: 0,
            name_len_flags: 0,
            frn: 0,
            path_hash: 0,
          });
          let hole = (self.entries.len() - 1) as u32;
          self.free.push(hole);
        }
        self.entries.push(ent);
        if Self::is_live(&ent) {
          self.live += 1;
          if frn != 0 {
            self.frn_set(frn, id);
          }
        }
      }
      n += 1;
    }
    self.path_index_ready = false;
    self.name_index_dirty = true;
    Ok(n)
  }
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn frn_node_ingest_builds_paths() {
    let mut s = IndexStore::new();
    s.ensure_root("E:\\", 5);
    s.upsert_node("foo", 10, 5, true);
    s.upsert_node("bar.txt", 20, 10, false);
    s.seal();
    assert_eq!(s.len(), 3);
    let got = s.get("e:\\foo\\bar.txt").expect("path");
    assert_eq!(got.name, "bar.txt");
    let by_frn = s.resolve_frn(20).expect("frn");
    assert_eq!(by_frn.path.to_ascii_lowercase(), "e:\\foo\\bar.txt");
    assert!(s.remove_frn(20));
    assert!(s.get("e:\\foo\\bar.txt").is_none());
  }

  #[test]
  fn hash_path_matches_build_path() {
    let mut s = IndexStore::new();
    s.ensure_root("E:\\", 5);
    s.upsert_node("foo", 10, 5, true);
    s.upsert_node("bar.txt", 20, 10, false);
    s.seal();
    for i in 0..s.entries.len() {
      if !IndexStore::is_live(&s.entries[i]) {
        continue;
      }
      let path = s.build_path(i as u32);
      assert_eq!(s.hash_path_of(i as u32), hash_str(&path), "path={path}");
    }
  }

  #[test]
  fn normalize_slice_builds_path_index() {
    let mut s = IndexStore::new();
    s.ensure_root("E:\\", 5);
    s.upsert_node("foo", 10, 5, true);
    s.upsert_node("bar.txt", 20, 10, false);
    s.seal();
    assert!(!s.path_index_ready());
    s.reset_normalize();
    loop {
      let (_did, done, _) = s.normalize_slice(2);
      if done {
        break;
      }
    }
    assert!(s.path_index_ready());
    assert!(s.get("e:\\foo\\bar.txt").is_some());
    // Compact open-addressing: ~1.25x live (plus small floor)
    assert!(s.path_slots.len() <= (s.len() * 5 / 4).max(16) + 8);
  }

  #[test]
  fn persist_delta_coalesce_removes_sidecar() {
    let dir = std::env::temp_dir().join(format!(
      "aurora-aidx-coalesce-{}",
      std::process::id()
    ));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).unwrap();
    let base = dir.join("t.aidx");

    let mut s = IndexStore::new();
    s.ensure_root("E:\\", 5);
    s.upsert_node("foo", 10, 5, true);
    s.upsert_node("bar.txt", 20, 10, false);
    s.seal();
    s.persist_bin(&base).unwrap();

    s.upsert_node("baz.txt", 21, 10, false);
    s.seal();
    let wrote = s.persist_delta(&base).unwrap();
    assert!(wrote >= 1);
    let delta = base.with_extension("aidx.d");
    assert!(delta.exists());
    let delta_bytes = std::fs::metadata(&delta).unwrap().len();
    assert!(delta_bytes >= 32);

    // Coalesce: full persist_bin drops sidecar
    s.persist_bin(&base).unwrap();
    assert!(!delta.exists());

    // Hydrate still sees coalesced entry
    let mut s2 = IndexStore::new();
    s2.hydrate_bin(&base).unwrap();
    assert!(s2.get("e:\\foo\\baz.txt").is_some());

    let _ = std::fs::remove_dir_all(&dir);
  }

  #[test]
  fn path_slots_lookup_after_remove() {
    let mut s = IndexStore::new();
    s.upsert("e:\\a\\b.txt", "b.txt", false, 0);
    s.upsert("e:\\a\\c.txt", "c.txt", false, 0);
    assert!(s.get("e:\\a\\b.txt").is_some());
    assert!(s.remove("e:\\a\\b.txt"));
    assert!(s.get("e:\\a\\b.txt").is_none());
    assert!(s.get("e:\\a\\c.txt").is_some());
  }
}
