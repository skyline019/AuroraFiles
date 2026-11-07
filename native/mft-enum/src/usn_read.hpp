#pragma once
#include <cstdint>
#include <string>
#include <vector>

struct UsnRow {
  int64_t usn = 0;
  uint64_t frn = 0;
  uint64_t parent_frn = 0;
  uint32_t reason = 0;
  std::wstring name;
};

struct UsnReadResult {
  bool ok = false;
  std::string error;
  std::vector<UsnRow> rows;
  double ms = 0;
};

/** FSCTL_READ_USN_JOURNAL — same line semantics as usn-read.ps1 (no PowerShell). */
UsnReadResult read_usn_journal(wchar_t drive, int64_t start_usn, size_t max_rows);
