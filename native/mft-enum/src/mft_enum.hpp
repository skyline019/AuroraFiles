#pragma once
#include "path_rebuild.hpp"
#include <string>
#include <unordered_map>
#include <vector>

struct EnumResult {
  bool ok = false;
  std::string error; // skipped_no_priv | not_ntfs | ...
  std::unordered_map<uint64_t, MftNode> nodes;
  uint64_t root_frn = 0;
  wchar_t drive = L'?';
  size_t record_count = 0;
  double enum_ms = 0;
  double path_ms = 0;
};

/** Enumerate MFT via FSCTL_ENUM_USN_DATA. root like "E:\\" or "E:". */
EnumResult enumerate_mft(const std::wstring& root, size_t max_scan);

struct BuiltEntry {
  std::wstring path;
  std::wstring name;
  bool is_dir = false;
  uint64_t frn = 0;
};

/** Materialize logical paths for all nodes (skips orphans / root self). */
std::vector<BuiltEntry> materialize_paths(const EnumResult& er, size_t max_scan);
