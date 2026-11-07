#include "mft_enum.hpp"
#include "path_rebuild.hpp"
#include "usn_read.hpp"

#include <windows.h>
#include <psapi.h>

#include <chrono>
#include <cstdio>
#include <iostream>
#include <string>
#include <vector>

static double rss_mb() {
  PROCESS_MEMORY_COUNTERS pmc{};
  pmc.cb = sizeof(pmc);
  if (GetProcessMemoryInfo(GetCurrentProcess(), &pmc, sizeof(pmc))) {
    return pmc.WorkingSetSize / (1024.0 * 1024.0);
  }
  return 0;
}

static std::string json_escape(const std::string& s) {
  std::string o;
  o.reserve(s.size() + 8);
  for (unsigned char c : s) {
    if (c == '"' || c == '\\') {
      o.push_back('\\');
      o.push_back(static_cast<char>(c));
    } else if (c < 0x20) {
      char buf[8];
      std::snprintf(buf, sizeof(buf), "\\u%04x", c);
      o += buf;
    } else {
      o.push_back(static_cast<char>(c));
    }
  }
  return o;
}

static std::string narrow(const std::wstring& w) {
  if (w.empty()) return {};
  const int n = WideCharToMultiByte(CP_UTF8, 0, w.c_str(), (int)w.size(), nullptr, 0, nullptr, nullptr);
  std::string s(n, '\0');
  WideCharToMultiByte(CP_UTF8, 0, w.c_str(), (int)w.size(), s.data(), n, nullptr, nullptr);
  return s;
}

static void print_summary(
  const char* mode,
  const std::string& root,
  size_t count,
  double ms,
  size_t path_bytes,
  bool ok,
  const std::string& error,
  bool to_stderr)
{
  const double eps = ms > 0 ? (count * 1000.0 / ms) : 0;
  char buf[1024];
  std::snprintf(
    buf,
    sizeof(buf),
    "{\"engine\":\"mft-cxx\",\"mode\":\"%s\",\"root\":\"%s\",\"count\":%zu,\"ms\":%.0f,"
    "\"entries_per_s\":%.1f,\"rss_mb\":%.1f,\"path_bytes\":%zu,\"ok\":%s,\"error\":%s}",
    mode,
    json_escape(root).c_str(),
    count,
    ms,
    eps,
    rss_mb(),
    path_bytes,
    ok ? "true" : "false",
    error.empty() ? "null" : ("\"" + json_escape(error) + "\"").c_str());
  if (to_stderr) {
    std::fprintf(stderr, "__AURORA_WALK_SUMMARY__%s\n", buf);
  } else {
    std::puts(buf);
  }
}

static void usage() {
  std::fprintf(stderr,
    "aurora-mft-enum --root E:\\ --mode count|store|stream|stream-nodes|usn-read\n"
    "  [--max-scan N] [--start-usn N] [--self-test]\n");
}

int wmain(int argc, wchar_t** argv) {
  std::wstring root = L"E:\\";
  std::string mode = "count";
  size_t max_scan = 5'000'000;
  int64_t start_usn = 0;
  bool self_test = false;

  for (int i = 1; i < argc; ++i) {
    std::wstring a = argv[i];
    if (a == L"--root" && i + 1 < argc) root = argv[++i];
    else if (a == L"--mode" && i + 1 < argc) mode = narrow(argv[++i]);
    else if (a == L"--max-scan" && i + 1 < argc) max_scan = static_cast<size_t>(_wtoi64(argv[++i]));
    else if (a == L"--start-usn" && i + 1 < argc) start_usn = _wtoi64(argv[++i]);
    else if (a == L"--self-test") self_test = true;
    else if (a == L"--help" || a == L"-h") {
      usage();
      return 0;
    }
  }

  if (self_test) {
    const int rc = path_rebuild_self_test();
    print_summary("self-test", "", 0, 0, 0, rc == 0, rc == 0 ? "" : "path_rebuild_fail", false);
    return rc;
  }

  // Normalize root
  if (root.size() == 2 && root[1] == L':') root.push_back(L'\\');
  const std::string root_utf8 = narrow(root);

  if (mode == "usn-read") {
    wchar_t drive = root.size() >= 1 ? root[0] : L'E';
    if (drive >= L'a' && drive <= L'z') drive = static_cast<wchar_t>(drive - L'a' + L'A');
    UsnReadResult ur = read_usn_journal(drive, start_usn, max_scan);
    if (!ur.ok) {
      print_summary("usn-read", root_utf8, 0, ur.ms, 0, false, ur.error, true);
      return ur.error == "skipped_no_priv" ? 3 : 1;
    }
    size_t bytes = 0;
    for (const auto& r : ur.rows) {
      const std::string name = narrow(r.name);
      bytes += name.size();
      // Same pipe format as usn-read.ps1: usn|frn|parent|reasonHex|name
      char reason_hex[16];
      std::snprintf(reason_hex, sizeof(reason_hex), "%X", r.reason);
      std::string name_safe = name;
      for (char& c : name_safe) {
        if (c == '|') c = '/';
      }
      std::printf(
        "%lld|%llu|%llu|%s|%s\n",
        static_cast<long long>(r.usn),
        static_cast<unsigned long long>(r.frn),
        static_cast<unsigned long long>(r.parent_frn),
        reason_hex,
        name_safe.c_str());
    }
    std::fflush(stdout);
    print_summary("usn-read", root_utf8, ur.rows.size(), ur.ms, bytes, true, "", true);
    return 0;
  }

  auto t_all0 = std::chrono::steady_clock::now();
  EnumResult er = enumerate_mft(root, max_scan);
  if (!er.ok) {
    print_summary(mode.c_str(), root_utf8, 0, 0, 0, false, er.error, mode == "stream");
    return er.error == "skipped_no_priv" ? 3 : 1;
  }

  if (mode == "count") {
    auto t1 = std::chrono::steady_clock::now();
    const double ms = std::chrono::duration<double, std::milli>(t1 - t_all0).count();
    // count = records (MFT entries), path not built
    print_summary("count", root_utf8, er.record_count, ms + er.enum_ms > 0 ? ms : er.enum_ms, 0, true, "", false);
    return 0;
  }

  // FRN-link stream for indexd: name/frn/parent only — no full path materialization.
  if (mode == "stream-nodes") {
    const uint64_t root_frn = er.root_frn ? er.root_frn : 5;
    const char drive_ch = static_cast<char>(er.drive <= 0x7f ? er.drive : L'?');
    std::printf(
      "{\"fmt\":\"frn\",\"root_frn\":\"%llu\",\"drive\":\"%c\"}\n",
      static_cast<unsigned long long>(root_frn),
      drive_ch);
    size_t bytes = 0;
    size_t n = 0;
    for (const auto& kv : er.nodes) {
      if (n >= max_scan) break;
      const uint64_t frn = kv.first;
      if (frn == root_frn) continue;
      const auto& node = kv.second;
      if (node.name.empty()) continue;
      const std::string name = narrow(node.name);
      bytes += name.size();
      std::printf(
        "{\"name\":\"%s\",\"frn\":\"%llu\",\"parent\":\"%llu\"",
        json_escape(name).c_str(),
        static_cast<unsigned long long>(frn),
        static_cast<unsigned long long>(node.parent));
      if (node.is_dir) std::printf(",\"kind\":\"folder\"");
      std::printf("}\n");
      n += 1;
      if (n % 8192 == 0) std::fflush(stdout);
    }
    auto t1 = std::chrono::steady_clock::now();
    const double ms = std::chrono::duration<double, std::milli>(t1 - t_all0).count();
    print_summary("stream-nodes", root_utf8, n, ms, bytes, true, "", true);
    return 0;
  }

  auto entries = materialize_paths(er, max_scan);
  // annotate path_ms into total
  auto t1 = std::chrono::steady_clock::now();
  const double ms = std::chrono::duration<double, std::milli>(t1 - t_all0).count();

  if (mode == "store") {
    size_t bytes = 0;
    for (const auto& e : entries) bytes += e.path.size() * sizeof(wchar_t);
    // keep alive for RSS
    volatile size_t sink = entries.size();
    (void)sink;
    print_summary("store", root_utf8, entries.size(), ms, bytes, true, "", false);
    return 0;
  }

  if (mode == "stream") {
    size_t bytes = 0;
    size_t n = 0;
    for (const auto& e : entries) {
      if (n >= max_scan) break;
      const std::string path = narrow(e.path);
      const std::string name = narrow(e.name);
      bytes += path.size() + name.size();
      std::printf("{\"path\":\"%s\",\"name\":\"%s\"", json_escape(path).c_str(), json_escape(name).c_str());
      if (e.is_dir) std::printf(",\"kind\":\"folder\"");
      std::printf(",\"frn\":\"%llu\"}\n", static_cast<unsigned long long>(e.frn));
      n += 1;
      if (n % 8192 == 0) std::fflush(stdout);
    }
    print_summary("stream", root_utf8, n, ms, bytes, true, "", true);
    return 0;
  }

  print_summary(mode.c_str(), root_utf8, 0, 0, 0, false, "bad_mode", false);
  return 2;
}
