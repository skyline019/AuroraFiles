#pragma once
#include <cstdint>
#include <string>
#include <unordered_map>
#include <vector>

struct MftNode {
  uint64_t parent = 0;
  std::wstring name;
  bool is_dir = false;
};

/** Build logical path like E:\foo\bar from FRN parent links. Returns empty on orphan. */
std::wstring rebuild_path(
  uint64_t frn,
  const std::unordered_map<uint64_t, MftNode>& nodes,
  wchar_t drive_letter,
  uint64_t root_frn);

/** Synthetic FRN tree self-check (no privileges). Returns 0 on success. */
int path_rebuild_self_test();
