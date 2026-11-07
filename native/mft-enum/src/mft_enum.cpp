#include "mft_enum.hpp"

#include <windows.h>
#include <winioctl.h>

#include <chrono>
#include <cstdio>
#include <cstring>

#ifndef FSCTL_ENUM_USN_DATA
#define FSCTL_ENUM_USN_DATA CTL_CODE(FILE_DEVICE_FILE_SYSTEM, 44, METHOD_NEITHER, FILE_ANY_ACCESS)
#endif

#pragma pack(push, 1)
struct MftEnumDataV0 {
  ULONGLONG StartFileReferenceNumber;
  USN LowUsn;
  USN HighUsn;
};

struct UsnRecordV2Header {
  DWORD RecordLength;
  WORD MajorVersion;
  WORD MinorVersion;
  ULONGLONG FileReferenceNumber;
  ULONGLONG ParentFileReferenceNumber;
  USN Usn;
  LARGE_INTEGER TimeStamp;
  DWORD Reason;
  DWORD SourceInfo;
  DWORD SecurityId;
  DWORD FileAttributes;
  WORD FileNameLength;
  WORD FileNameOffset;
};
#pragma pack(pop)

static wchar_t drive_letter_of(const std::wstring& root) {
  if (root.size() >= 2 && root[1] == L':') {
    wchar_t c = root[0];
    if (c >= L'a' && c <= L'z') c = static_cast<wchar_t>(c - L'a' + L'A');
    return c;
  }
  return L'?';
}

static std::wstring volume_path(wchar_t letter) {
  // \\.\E:
  std::wstring p = L"\\\\.\\";
  p.push_back(letter);
  p.push_back(L':');
  return p;
}

/** NTFS FRN: low 48 bits = MFT record index, high 16 = sequence. Index is stable for parent links. */
static inline uint64_t frn_index(uint64_t frn) {
  return frn & 0x0000FFFFFFFFFFFFULL;
}

static bool is_ntfs(wchar_t letter) {
  wchar_t root[] = {letter, L':', L'\\', 0};
  wchar_t fs[32] = {};
  if (!GetVolumeInformationW(root, nullptr, 0, nullptr, nullptr, nullptr, fs, 32)) {
    return false;
  }
  return _wcsicmp(fs, L"NTFS") == 0;
}

EnumResult enumerate_mft(const std::wstring& root, size_t max_scan) {
  EnumResult er;
  er.drive = drive_letter_of(root);
  if (er.drive == L'?') {
    er.error = "bad_root";
    return er;
  }
  if (!is_ntfs(er.drive)) {
    er.error = "not_ntfs";
    return er;
  }

  const std::wstring vol = volume_path(er.drive);
  HANDLE h = CreateFileW(
    vol.c_str(),
    GENERIC_READ,
    FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE,
    nullptr,
    OPEN_EXISTING,
    FILE_FLAG_BACKUP_SEMANTICS,
    nullptr);
  if (h == INVALID_HANDLE_VALUE) {
    const DWORD err = GetLastError();
    if (err == ERROR_ACCESS_DENIED) er.error = "skipped_no_priv";
    else er.error = "open_volume_" + std::to_string(err);
    return er;
  }

  auto t0 = std::chrono::steady_clock::now();
  MftEnumDataV0 med{};
  med.StartFileReferenceNumber = 0;
  med.LowUsn = 0;
  med.HighUsn = MAXLONGLONG;

  constexpr DWORD kBuf = 1024 * 256;
  std::vector<BYTE> buf(kBuf);

  while (er.record_count < max_scan) {
    DWORD br = 0;
    const BOOL ok = DeviceIoControl(
      h,
      FSCTL_ENUM_USN_DATA,
      &med,
      sizeof(med),
      buf.data(),
      kBuf,
      &br,
      nullptr);
    if (!ok) {
      const DWORD err = GetLastError();
      if (err == ERROR_HANDLE_EOF) break;
      CloseHandle(h);
      if (err == ERROR_ACCESS_DENIED) er.error = "skipped_no_priv";
      else er.error = "enum_" + std::to_string(err);
      return er;
    }
    if (br < sizeof(USN)) break;

    // First 8 bytes: next USN / next FRN start
    ULONGLONG next = 0;
    std::memcpy(&next, buf.data(), sizeof(next));
    med.StartFileReferenceNumber = next;

    DWORD offset = sizeof(USN);
    while (offset + sizeof(UsnRecordV2Header) <= br && er.record_count < max_scan) {
      auto* rec = reinterpret_cast<UsnRecordV2Header*>(buf.data() + offset);
      if (rec->RecordLength == 0) break;
      if (offset + rec->RecordLength > br) break;

      if (rec->MajorVersion >= 2) {
        MftNode node;
        const uint64_t frn = frn_index(rec->FileReferenceNumber);
        const uint64_t parent = frn_index(rec->ParentFileReferenceNumber);
        node.parent = parent;
        node.is_dir = (rec->FileAttributes & FILE_ATTRIBUTE_DIRECTORY) != 0;
        const WORD nameBytes = rec->FileNameLength;
        const WORD nameOff = rec->FileNameOffset;
        if (nameOff + nameBytes <= rec->RecordLength && nameBytes > 0) {
          const wchar_t* nm = reinterpret_cast<const wchar_t*>(
            reinterpret_cast<const BYTE*>(rec) + nameOff);
          node.name.assign(nm, nameBytes / sizeof(wchar_t));
        }
        // Prefer first sight; keep directories
        auto it = er.nodes.find(frn);
        if (it == er.nodes.end()) {
          er.nodes.emplace(frn, std::move(node));
        } else if (node.is_dir) {
          it->second.is_dir = true;
          if (it->second.name.empty()) it->second.name = std::move(node.name);
        }
        // Detect root: parent == self (after index mask)
        if (parent == frn && er.root_frn == 0) {
          er.root_frn = frn;
        }
        er.record_count += 1;
      }
      offset += rec->RecordLength;
    }
  }

  CloseHandle(h);
  auto t1 = std::chrono::steady_clock::now();
  er.enum_ms = std::chrono::duration<double, std::milli>(t1 - t0).count();

  // Fallback root: self-parent node, else NTFS convention (MFT #5).
  // FSCTL_ENUM_USN_DATA often omits the root directory record itself.
  if (er.root_frn == 0) {
    for (const auto& kv : er.nodes) {
      if (frn_index(kv.second.parent) == kv.first) {
        er.root_frn = kv.first;
        break;
      }
    }
  }
  if (er.root_frn == 0) {
    er.root_frn = 5; // NTFS root directory file reference index
  }

  er.ok = true;
  return er;
}

std::vector<BuiltEntry> materialize_paths(const EnumResult& er, size_t max_scan) {
  std::vector<BuiltEntry> out;
  out.reserve(std::min(er.nodes.size(), max_scan));
  // Memoize full paths — shared parents dominate rebuild cost
  std::unordered_map<uint64_t, std::wstring> cache;
  cache.reserve(er.nodes.size() + 8);
  const uint64_t root = er.root_frn ? er.root_frn : 5;
  {
    std::wstring rootPath;
    rootPath.push_back(er.drive);
    rootPath.push_back(L':');
    rootPath.push_back(L'\\');
    cache.emplace(root, rootPath);
  }

  auto build_cached = [&](uint64_t frn) -> const std::wstring* {
    frn = frn & 0x0000FFFFFFFFFFFFULL;
    if (auto it = cache.find(frn); it != cache.end()) return &it->second;
    // iterative stack then fold with cache
    std::vector<uint64_t> stack;
    uint64_t cur = frn;
    int guard = 0;
    while (cur != 0 && cur != root && guard++ < 512) {
      if (cache.count(cur)) break;
      auto nit = er.nodes.find(cur);
      if (nit == er.nodes.end()) {
        if (cur == 5 || cur == root) break;
        return nullptr;
      }
      stack.push_back(cur);
      const uint64_t parent = nit->second.parent & 0x0000FFFFFFFFFFFFULL;
      if (parent == cur) break;
      cur = parent;
    }
    std::wstring base;
    if (auto it = cache.find(cur); it != cache.end()) {
      base = it->second;
    } else if (cur == root || cur == 5) {
      base = cache[root];
    } else {
      return nullptr;
    }
    // rebuild from root-side of stack toward frn
    for (auto it = stack.rbegin(); it != stack.rend(); ++it) {
      const uint64_t id = *it;
      auto nit = er.nodes.find(id);
      if (nit == er.nodes.end()) return nullptr;
      std::wstring path = base;
      if (!path.empty() && path.back() != L'\\') path.push_back(L'\\');
      path.append(nit->second.name);
      cache.emplace(id, path);
      base = std::move(path);
    }
    auto it = cache.find(frn);
    return it == cache.end() ? nullptr : &it->second;
  };

  size_t orphans = 0;
  for (const auto& kv : er.nodes) {
    if (out.size() >= max_scan) break;
    const uint64_t frn = kv.first;
    if (frn == root) {
      BuiltEntry e;
      e.path = cache[root];
      e.name = er.drive + std::wstring(L":");
      e.is_dir = true;
      e.frn = frn;
      out.push_back(std::move(e));
      continue;
    }
    const std::wstring* path = build_cached(frn);
    if (!path || path->empty()) {
      orphans += 1;
      continue;
    }
    BuiltEntry e;
    e.path = *path;
    e.name = kv.second.name;
    e.is_dir = kv.second.is_dir;
    e.frn = frn;
    out.push_back(std::move(e));
  }
  std::fprintf(
    stderr,
    "__AURORA_MFT_PATHS__{\"nodes\":%zu,\"built\":%zu,\"orphans\":%zu,\"root_frn\":%llu,\"cache\":%zu}\n",
    er.nodes.size(),
    out.size(),
    orphans,
    static_cast<unsigned long long>(er.root_frn),
    cache.size());
  return out;
}
