mod store;

use serde::Deserialize;
use serde_json::json;
use store::IndexStore;
use std::io::{self, BufRead, Write};
use std::path::PathBuf;

#[cfg(windows)]
fn rss_mb() -> f64 {
  use std::mem::MaybeUninit;
  #[repr(C)]
  struct ProcessMemoryCounters {
    cb: u32,
    page_fault_count: u32,
    peak_working_set_size: usize,
    working_set_size: usize,
    quota_peak_paged_pool_usage: usize,
    quota_paged_pool_usage: usize,
    quota_peak_non_paged_pool_usage: usize,
    quota_non_paged_pool_usage: usize,
    pagefile_usage: usize,
    peak_pagefile_usage: usize,
  }
  #[link(name = "psapi")]
  extern "system" {
    fn GetProcessMemoryInfo(
      process: *mut core::ffi::c_void,
      ppsmemcounters: *mut ProcessMemoryCounters,
      cb: u32,
    ) -> i32;
  }
  #[link(name = "kernel32")]
  extern "system" {
    fn GetCurrentProcess() -> *mut core::ffi::c_void;
  }
  unsafe {
    let mut pmc = MaybeUninit::<ProcessMemoryCounters>::zeroed();
    (*pmc.as_mut_ptr()).cb = std::mem::size_of::<ProcessMemoryCounters>() as u32;
    if GetProcessMemoryInfo(
      GetCurrentProcess(),
      pmc.as_mut_ptr(),
      std::mem::size_of::<ProcessMemoryCounters>() as u32,
    ) != 0
    {
      return pmc.assume_init().working_set_size as f64 / (1024.0 * 1024.0);
    }
  }
  0.0
}

#[cfg(not(windows))]
fn rss_mb() -> f64 {
  0.0
}

#[derive(Deserialize)]
struct InMsg {
  id: Option<u64>,
  cmd: String,
  #[serde(default)]
  entry: Option<InEntry>,
  #[serde(default)]
  entries: Option<Vec<InEntry>>,
  #[serde(default)]
  node: Option<InNode>,
  #[serde(default)]
  nodes: Option<Vec<InNode>>,
  #[serde(default)]
  path: Option<String>,
  #[serde(default)]
  prefix: Option<String>,
  #[serde(default)]
  q: Option<String>,
  #[serde(default)]
  limit: Option<usize>,
  #[serde(default)]
  mode: Option<String>,
  #[serde(default)]
  frn: Option<String>,
  #[serde(default)]
  cursor: Option<usize>,
  #[serde(default)]
  n: Option<usize>,
  #[serde(default)]
  file: Option<String>,
  #[serde(default)]
  paths: Option<Vec<String>>,
  #[serde(default)]
  lite: Option<bool>,
}

#[derive(Deserialize)]
struct InEntry {
  path: String,
  name: String,
  #[serde(default)]
  kind: Option<String>,
  #[serde(default)]
  frn: Option<serde_json::Value>,
}

#[derive(Deserialize)]
struct InNode {
  name: String,
  #[serde(default)]
  kind: Option<String>,
  #[serde(default)]
  frn: Option<serde_json::Value>,
  #[serde(default)]
  parent: Option<serde_json::Value>,
}

fn parse_frn(v: &Option<serde_json::Value>) -> u64 {
  match v {
    Some(serde_json::Value::String(s)) => s.parse().unwrap_or(0),
    Some(serde_json::Value::Number(n)) => n.as_u64().unwrap_or(0),
    _ => 0,
  }
}

fn reply(id: Option<u64>, body: serde_json::Value) {
  let mut out = body;
  if let Some(obj) = out.as_object_mut() {
    if let Some(i) = id {
      obj.insert("id".into(), json!(i));
    }
  }
  let mut stdout = io::stdout().lock();
  let _ = serde_json::to_writer(&mut stdout, &out);
  let _ = stdout.write_all(b"\n");
  let _ = stdout.flush();
}

fn main() {
  let mut store = IndexStore::new();
  let stdin = io::stdin();
  for line in stdin.lock().lines() {
    let Ok(line) = line else { break };
    let t = line.trim();
    if t.is_empty() {
      continue;
    }
    let msg: InMsg = match serde_json::from_str(t) {
      Ok(m) => m,
      Err(e) => {
        reply(None, json!({"ok":false,"error":format!("parse:{e}")}));
        continue;
      }
    };
    let id = msg.id;
    match msg.cmd.as_str() {
      "ping" => reply(id, json!({"ok":true,"pong":true})),
      "clear" => {
        store.clear();
        reply(id, json!({"ok":true,"count":0}));
      }
      "upsert" => {
        // silent unless id present
        if let Some(e) = msg.entry {
          let is_dir = e.kind.as_deref() == Some("folder");
          store.upsert(&e.path, &e.name, is_dir, parse_frn(&e.frn));
        }
        if id.is_some() {
          reply(id, json!({"ok":true,"count":store.len()}));
        }
      }
      "upsert_batch" => {
        if let Some(entries) = msg.entries {
          for e in entries {
            let is_dir = e.kind.as_deref() == Some("folder");
            store.upsert(&e.path, &e.name, is_dir, parse_frn(&e.frn));
          }
        }
        if id.is_some() {
          reply(id, json!({"ok":true,"count":store.len()}));
        }
      }
      "ensure_root" => {
        let drive = msg.path.as_deref().unwrap_or("");
        let frn = msg
          .frn
          .as_deref()
          .and_then(|s| s.parse().ok())
          .unwrap_or(0);
        store.ensure_root(drive, frn);
        if id.is_some() {
          reply(id, json!({"ok":true,"count":store.len()}));
        }
      }
      "upsert_node" => {
        if let Some(n) = msg.node {
          let is_dir = n.kind.as_deref() == Some("folder");
          store.upsert_node(&n.name, parse_frn(&n.frn), parse_frn(&n.parent), is_dir);
        }
        if id.is_some() {
          reply(id, json!({"ok":true,"count":store.len()}));
        }
      }
      "upsert_node_batch" => {
        if let Some(nodes) = msg.nodes {
          for n in nodes {
            let is_dir = n.kind.as_deref() == Some("folder");
            store.upsert_node(&n.name, parse_frn(&n.frn), parse_frn(&n.parent), is_dir);
          }
        }
        if id.is_some() {
          reply(id, json!({"ok":true,"count":store.len()}));
        }
      }
      "barrier" => {
        store.seal();
        store.shrink();
        reply(id, json!({"ok":true,"count":store.len()}));
      }
      "remove" => {
        let n = msg.path.as_deref().map(|p| store.remove(p)).unwrap_or(false);
        reply(id, json!({"ok":true,"removed":n,"count":store.len()}));
      }
      "remove_frn" => {
        let frn = msg.frn.as_deref().and_then(|s| s.parse().ok()).unwrap_or(0);
        let n = if frn != 0 {
          store.remove_frn(frn)
        } else {
          false
        };
        reply(id, json!({"ok":true,"removed":n,"count":store.len()}));
      }
      "remove_prefix" => {
        let n = msg
          .prefix
          .as_deref()
          .or(msg.path.as_deref())
          .map(|p| store.remove_prefix(p))
          .unwrap_or(0);
        reply(id, json!({"ok":true,"removed":n,"count":store.len()}));
      }
      "get" => {
        let item = msg.path.as_deref().and_then(|p| store.get(p));
        reply(id, json!({"ok":true,"item":item}));
      }
      "get_many" => {
        let paths = msg.paths.unwrap_or_default();
        let items = store.get_many(&paths);
        reply(id, json!({"ok":true,"items":items}));
      }
      "resolve_frn" => {
        let frn = msg.frn.as_deref().and_then(|s| s.parse().ok()).unwrap_or(0);
        let item = store.resolve_frn(frn);
        reply(id, json!({"ok":true,"item":item}));
      }
      "query" => {
        let q = msg.q.unwrap_or_default();
        let limit = msg.limit.unwrap_or(400).min(2000);
        let mode = msg.mode.unwrap_or_else(|| "prefix".into());
        let items = store.query(&q, limit, &mode);
        reply(id, json!({"ok":true,"items":items,"truncated":items.len()>=limit}));
      }
      "stats" => reply(
        id,
        json!({
          "ok": true,
          "count": store.len(),
          "approx_bytes": store.approx_bytes(),
          "mem": store.mem_breakdown(),
          "path_index_ready": store.path_index_ready(),
          "free": store.free_len(),
          "rss_mb": (rss_mb() * 10.0).round() / 10.0,
        }),
      ),
      "normalize_slice" => {
        let ops = msg.n.unwrap_or(4000).max(1).min(100_000);
        let (did, done, phase) = store.normalize_slice(ops);
        reply(
          id,
          json!({
            "ok": true,
            "did": did,
            "done": done,
            "phase": phase,
            "path_index_ready": store.path_index_ready(),
            "count": store.len(),
          }),
        );
      }
      "normalize" => {
        store.reset_normalize();
        let mut total = 0usize;
        loop {
          let (did, done, _) = store.normalize_slice(50_000);
          total += did;
          if done {
            break;
          }
        }
        reply(
          id,
          json!({
            "ok": true,
            "did": total,
            "done": true,
            "path_index_ready": store.path_index_ready(),
            "count": store.len(),
          }),
        );
      }
      "export_slice" => {
        let cursor = msg.cursor.unwrap_or(0);
        let n = msg.n.unwrap_or(1000).min(50_000);
        let lite = msg.lite.unwrap_or(true);
        let (items, next) = if lite {
          let (v, next) = store.export_slice_lite(cursor, n);
          (json!(v), next)
        } else {
          let (v, next) = store.export_slice(cursor, n);
          (json!(v), next)
        };
        let done = next >= store.cursor_end();
        reply(id, json!({"ok":true,"items":items,"cursor":next,"done":done}));
      }
      "hydrate_ndjson" => {
        let Some(file) = msg.file else {
          reply(id, json!({"ok":false,"error":"missing_file"}));
          continue;
        };
        match store.hydrate_ndjson(&PathBuf::from(&file)) {
          Ok(n) => reply(id, json!({"ok":true,"hydrated":n,"count":store.len()})),
          Err(e) => reply(id, json!({"ok":false,"error":e})),
        }
      }
      "hydrate_bin" | "hydrate" => {
        let Some(file) = msg.file else {
          reply(id, json!({"ok":false,"error":"missing_file"}));
          continue;
        };
        let pb = PathBuf::from(&file);
        let res = if file.ends_with(".aidx") || msg.cmd == "hydrate_bin" {
          store.hydrate_bin(&pb)
        } else {
          store.hydrate_ndjson(&pb)
        };
        match res {
          Ok(n) => reply(id, json!({"ok":true,"hydrated":n,"count":store.len()})),
          Err(e) => reply(id, json!({"ok":false,"error":e})),
        }
      }
      "persist" | "persist_bin" => {
        let Some(file) = msg.file else {
          reply(id, json!({"ok":false,"error":"missing_file"}));
          continue;
        };
        let pb = PathBuf::from(&file);
        let res = if file.ends_with(".aidx") || msg.cmd == "persist_bin" {
          store.persist_bin(&pb)
        } else {
          store.persist_ndjson(&pb)
        };
        match res {
          Ok(n) => reply(id, json!({"ok":true,"persisted":n})),
          Err(e) => reply(id, json!({"ok":false,"error":e})),
        }
      }
      "persist_delta" => {
        let Some(file) = msg.file else {
          reply(id, json!({"ok":false,"error":"missing_file"}));
          continue;
        };
        match store.persist_delta(&PathBuf::from(&file)) {
          Ok(n) => reply(id, json!({"ok":true,"persisted":n,"delta":true})),
          Err(e) => reply(id, json!({"ok":false,"error":e})),
        }
      }
      "hydrate_delta" => {
        let Some(file) = msg.file else {
          reply(id, json!({"ok":false,"error":"missing_file"}));
          continue;
        };
        let delta = PathBuf::from(&file).with_extension("aidx.d");
        match store.apply_delta_file(&delta) {
          Ok(n) => {
            store.seal();
            reply(id, json!({"ok":true,"applied":n,"count":store.len()}))
          }
          Err(e) => reply(id, json!({"ok":false,"error":e})),
        }
      }
      other => reply(id, json!({"ok":false,"error":format!("unknown_cmd:{other}")})),
    }
  }
}
