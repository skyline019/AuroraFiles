#include "usn_read.hpp"

#include <windows.h>
#include <winioctl.h>

#include <chrono>
#include <cstring>
#include <vector>

#ifndef FSCTL_READ_USN_JOURNAL
#define FSCTL_READ_USN_JOURNAL CTL_CODE(FILE_DEVICE_FILE_SYSTEM, 46, METHOD_NEITHER, FILE_ANY_ACCESS)
#endif
#ifndef FSCTL_QUERY_USN_JOURNAL
#define FSCTL_QUERY_USN_JOURNAL CTL_CODE(FILE_DEVICE_FILE_SYSTEM, 61, METHOD_BUFFERED, FILE_ANY_ACCESS)
#endif

#pragma pack(push, 1)
struct UsnJournalDataV0 {
  ULONGLONG UsnJournalID;
  USN FirstUsn;
  USN NextUsn;
  USN LowestValidUsn;
  USN MaxUsn;
  ULONGLONG MaximumSize;
  ULONGLONG AllocationDelta;
};

struct ReadUsnJournalDataV0 {
  USN StartUsn;
  DWORD ReasonMask;
  DWORD ReturnOnlyOnClose;
  ULONGLONG Timeout;
  ULONGLONG BytesToWaitFor;
  ULONGLONG UsnJournalID;
};

struct UsnRecordV2Hdr {
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

static inline uint64_t frn_index(uint64_t frn) {
  return frn & 0x0000FFFFFFFFFFFFULL;
}

UsnReadResult read_usn_journal(wchar_t drive, int64_t start_usn, size_t max_rows) {
  UsnReadResult out;
  if (drive < L'A' || drive > L'Z') {
    if (drive >= L'a' && drive <= L'z') drive = static_cast<wchar_t>(drive - L'a' + L'A');
    else {
      out.error = "bad_drive";
      return out;
    }
  }

  wchar_t vol[] = {L'\\', L'\\', L'.', L'\\', drive, L':', 0};
  HANDLE h = CreateFileW(
    vol,
    GENERIC_READ,
    FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE,
    nullptr,
    OPEN_EXISTING,
    FILE_FLAG_BACKUP_SEMANTICS,
    nullptr);
  if (h == INVALID_HANDLE_VALUE) {
    const DWORD err = GetLastError();
    out.error = (err == ERROR_ACCESS_DENIED) ? "skipped_no_priv" : ("open_" + std::to_string(err));
    return out;
  }

  auto t0 = std::chrono::steady_clock::now();

  UsnJournalDataV0 jd{};
  DWORD br = 0;
  if (!DeviceIoControl(h, FSCTL_QUERY_USN_JOURNAL, nullptr, 0, &jd, sizeof(jd), &br, nullptr)) {
    CloseHandle(h);
    out.error = "query_usn_" + std::to_string(GetLastError());
    return out;
  }

  USN cur = start_usn > 0 ? start_usn : jd.FirstUsn;
  constexpr DWORD kBuf = 256 * 1024;
  std::vector<BYTE> buf(kBuf);
  out.rows.reserve(std::min(max_rows, size_t(4096)));

  while (out.rows.size() < max_rows) {
    ReadUsnJournalDataV0 rd{};
    rd.StartUsn = cur;
    rd.ReasonMask = 0xFFFFFFFF;
    rd.ReturnOnlyOnClose = 0;
    rd.Timeout = 0;
    rd.BytesToWaitFor = 0;
    rd.UsnJournalID = jd.UsnJournalID;
    br = 0;
    if (!DeviceIoControl(
          h,
          FSCTL_READ_USN_JOURNAL,
          &rd,
          sizeof(rd),
          buf.data(),
          kBuf,
          &br,
          nullptr)
        || br < sizeof(USN)) {
      break;
    }

    USN nextUsn = 0;
    std::memcpy(&nextUsn, buf.data(), sizeof(nextUsn));
    DWORD offset = sizeof(USN);
    bool any = false;
    while (offset + sizeof(UsnRecordV2Hdr) <= br && out.rows.size() < max_rows) {
      auto* rec = reinterpret_cast<UsnRecordV2Hdr*>(buf.data() + offset);
      if (rec->RecordLength < sizeof(UsnRecordV2Hdr)) break;
      if (offset + rec->RecordLength > br) break;

      UsnRow row;
      row.usn = rec->Usn;
      row.frn = frn_index(rec->FileReferenceNumber);
      row.parent_frn = frn_index(rec->ParentFileReferenceNumber);
      row.reason = rec->Reason;
      if (rec->FileNameLength > 0
          && rec->FileNameOffset > 0
          && offset + rec->FileNameOffset + rec->FileNameLength <= br) {
        const wchar_t* nm = reinterpret_cast<const wchar_t*>(
          reinterpret_cast<const BYTE*>(rec) + rec->FileNameOffset);
        row.name.assign(nm, rec->FileNameLength / sizeof(wchar_t));
      }
      out.rows.push_back(std::move(row));
      any = true;
      offset += rec->RecordLength;
      cur = rec->Usn + 1;
    }
    if (!any) {
      cur = nextUsn;
      break;
    }
    if (nextUsn <= cur) break;
    cur = nextUsn;
  }

  CloseHandle(h);
  auto t1 = std::chrono::steady_clock::now();
  out.ms = std::chrono::duration<double, std::milli>(t1 - t0).count();
  out.ok = true;
  return out;
}
