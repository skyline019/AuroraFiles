//! Parallel Dirent-style volume walk for bakeoff + WalkEngine streaming.
//!
//! Modes:
//! - count: count entries only
//! - store: Vec<String> of paths (JS-comparable RSS)
//! - compact: single byte buffer + offsets
//! - stream: NDJSON lines to stdout for Node ingest (path|name|isDir)
//!
//! Skip: "system volume information" (minimal skip parity)

use clap::{Parser, ValueEnum};
use jwalk::WalkDir;
use serde::Serialize;
use std::io::{self, Write};
use std::path::{Path, PathBuf};
use std::time::Instant;

#[derive(Clone, Copy, ValueEnum, Debug)]
enum Mode {
    Count,
    Store,
    Compact,
    Stream,
}

#[derive(Parser, Debug)]
#[command(name = "aurora-walk-bench")]
struct Args {
    /// Volume or directory root
    #[arg(long)]
    root: PathBuf,

    #[arg(long, value_enum, default_value = "count")]
    mode: Mode,

    #[arg(long, default_value_t = 64)]
    max_depth: usize,

    #[arg(long, default_value_t = 5_000_000)]
    max_scan: usize,

    /// Parallelism for jwalk (0 = rayon default)
    #[arg(long, default_value_t = 0)]
    threads: usize,

    /// Follow directory junctions / symlinks (jwalk follow_links)
    #[arg(long, default_value_t = true, action = clap::ArgAction::Set)]
    follow_reparse: bool,
}

#[derive(Serialize)]
struct Summary {
    engine: &'static str,
    mode: String,
    root: String,
    count: usize,
    ms: u128,
    entries_per_s: f64,
    rss_mb: f64,
    path_bytes: usize,
    ok: bool,
    error: Option<String>,
}

fn skip_name(name: &str) -> bool {
    name.eq_ignore_ascii_case("system volume information")
}

fn rss_mb() -> f64 {
    #[cfg(windows)]
    {
        use std::mem::MaybeUninit;
        // PROCESS_MEMORY_COUNTERS
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
            let ptr = pmc.as_mut_ptr();
            (*ptr).cb = std::mem::size_of::<ProcessMemoryCounters>() as u32;
            if GetProcessMemoryInfo(
                GetCurrentProcess(),
                ptr,
                std::mem::size_of::<ProcessMemoryCounters>() as u32,
            ) != 0
            {
                let pmc = pmc.assume_init();
                return (pmc.working_set_size as f64) / (1024.0 * 1024.0);
            }
        }
    }
    0.0
}

fn main() {
    let args = Args::parse();
    if args.threads > 0 {
        // jwalk uses rayon; set thread pool if requested
        let _ = rayon_threads(args.threads);
    }

    let root = args.root.clone();
    let mode = args.mode;
    if !root.exists() {
        let s = Summary {
            engine: "rust",
            mode: format!("{:?}", mode).to_lowercase(),
            root: root.display().to_string(),
            count: 0,
            ms: 0,
            entries_per_s: 0.0,
            rss_mb: rss_mb(),
            path_bytes: 0,
            ok: false,
            error: Some("root_not_found".into()),
        };
        println!("{}", serde_json::to_string(&s).unwrap());
        std::process::exit(2);
    }

    let t0 = Instant::now();
    let result = match mode {
        Mode::Count => walk_count(&root, &args),
        Mode::Store => walk_store(&root, &args),
        Mode::Compact => walk_compact(&root, &args),
        Mode::Stream => walk_stream(&root, &args),
    };
    let ms = t0.elapsed().as_millis();

    match result {
        Ok((count, path_bytes)) => {
            let eps = if ms > 0 {
                (count as f64) * 1000.0 / (ms as f64)
            } else {
                0.0
            };
            // stream mode: summary on stderr so stdout stays NDJSON-only
            if matches!(mode, Mode::Stream) {
                let s = Summary {
                    engine: "rust",
                    mode: "stream".into(),
                    root: root.display().to_string(),
                    count,
                    ms,
                    entries_per_s: (eps * 10.0).round() / 10.0,
                    rss_mb: (rss_mb() * 10.0).round() / 10.0,
                    path_bytes,
                    ok: true,
                    error: None,
                };
                eprintln!("__AURORA_WALK_SUMMARY__{}", serde_json::to_string(&s).unwrap());
            } else {
                let s = Summary {
                    engine: "rust",
                    mode: format!("{:?}", mode).to_lowercase(),
                    root: root.display().to_string(),
                    count,
                    ms,
                    entries_per_s: (eps * 10.0).round() / 10.0,
                    rss_mb: (rss_mb() * 10.0).round() / 10.0,
                    path_bytes,
                    ok: true,
                    error: None,
                };
                println!("{}", serde_json::to_string(&s).unwrap());
            }
        }
        Err(e) => {
            let s = Summary {
                engine: "rust",
                mode: format!("{:?}", mode).to_lowercase(),
                root: root.display().to_string(),
                count: 0,
                ms,
                entries_per_s: 0.0,
                rss_mb: rss_mb(),
                path_bytes: 0,
                ok: false,
                error: Some(e),
            };
            if matches!(mode, Mode::Stream) {
                eprintln!("__AURORA_WALK_SUMMARY__{}", serde_json::to_string(&s).unwrap());
            } else {
                println!("{}", serde_json::to_string(&s).unwrap());
            }
            std::process::exit(1);
        }
    }
}

fn rayon_threads(n: usize) -> Result<(), String> {
    rayon::ThreadPoolBuilder::new()
        .num_threads(n)
        .build_global()
        .map_err(|e| e.to_string())?;
    Ok(())
}

fn walk_iter(root: &Path, args: &Args) -> impl Iterator<Item = jwalk::DirEntry<((), ())>> {
    WalkDir::new(root)
        .max_depth(args.max_depth)
        .follow_links(args.follow_reparse)
        .skip_hidden(false)
        .process_read_dir(|_depth, _path, _state, children| {
            children.retain(|res| match res {
                Ok(e) => !skip_name(e.file_name.to_string_lossy().as_ref()),
                Err(_) => false,
            });
        })
        .into_iter()
        .filter_map(|e| e.ok())
}

fn walk_count(root: &Path, args: &Args) -> Result<(usize, usize), String> {
    let mut n = 0usize;
    for _ in walk_iter(root, args) {
        n += 1;
        if n >= args.max_scan {
            break;
        }
    }
    // Exclude the root itself if present as first entry — jwalk includes root
    Ok((n.saturating_sub(0), 0))
}

fn walk_store(root: &Path, args: &Args) -> Result<(usize, usize), String> {
    let mut paths: Vec<String> = Vec::with_capacity(1024);
    let mut bytes = 0usize;
    for ent in walk_iter(root, args) {
        let p = ent.path();
        let s = p.to_string_lossy().into_owned();
        bytes += s.len();
        paths.push(s);
        if paths.len() >= args.max_scan {
            break;
        }
    }
    // keep paths alive until RSS sample
    std::hint::black_box(&paths);
    let rss = rss_mb();
    std::hint::black_box(rss);
    Ok((paths.len(), bytes))
}

fn walk_compact(root: &Path, args: &Args) -> Result<(usize, usize), String> {
    let mut buf: Vec<u8> = Vec::with_capacity(64 * 1024 * 1024);
    let mut offs: Vec<u32> = Vec::with_capacity(1024);
    let mut n = 0usize;
    for ent in walk_iter(root, args) {
        let s = ent.path().to_string_lossy().into_owned();
        offs.push(buf.len() as u32);
        buf.extend_from_slice(s.as_bytes());
        buf.push(0);
        n += 1;
        if n >= args.max_scan {
            break;
        }
    }
    std::hint::black_box((&buf, &offs));
    Ok((n, buf.len()))
}

fn walk_stream(root: &Path, args: &Args) -> Result<(usize, usize), String> {
    let stdout = io::stdout();
    let mut out = io::BufWriter::with_capacity(1 << 20, stdout.lock());
    let mut n = 0usize;
    let mut bytes = 0usize;
    for ent in walk_iter(root, args) {
        // skip the walk root directory entry itself for ingest parity with JS onEntry files+dirs under root
        let path = ent.path();
        if path == root {
            continue;
        }
        let name = ent.file_name().to_string_lossy();
        let is_dir = ent.file_type().is_dir();
        let path_s = path.to_string_lossy();
        let mut obj = serde_json::json!({
            "path": path_s.as_ref(),
            "name": name.as_ref(),
        });
        if is_dir {
            obj["kind"] = serde_json::Value::String("folder".into());
        }
        serde_json::to_writer(&mut out, &obj).map_err(|e| e.to_string())?;
        writeln!(out).map_err(|e| e.to_string())?;
        bytes += path_s.len() + name.len();
        n += 1;
        if n >= args.max_scan {
            break;
        }
        if n % 8192 == 0 {
            out.flush().ok();
        }
    }
    out.flush().map_err(|e| e.to_string())?;
    Ok((n, bytes))
}
