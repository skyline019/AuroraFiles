param([string]$Drive, [Int64]$StartUsn, [string]$OutFile, [int]$Max = 4000)
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System;
using System.IO;
using System.Runtime.InteropServices;
using Microsoft.Win32.SafeHandles;
using System.Text;
using System.Collections.Generic;

public static class AuroraUsnRead {
  [DllImport("kernel32.dll", SetLastError=true, CharSet=CharSet.Unicode)]
  static extern SafeFileHandle CreateFile(string lpFileName, uint dwDesiredAccess,
    uint dwShareMode, IntPtr lpSecurityAttributes, uint dwCreationDisposition,
    uint dwFlagsAndAttributes, IntPtr hTemplateFile);

  [DllImport("kernel32.dll", SetLastError=true)]
  static extern bool DeviceIoControl(SafeFileHandle hDevice, uint dwIoControlCode,
    IntPtr lpInBuffer, uint nInBufferSize, IntPtr lpOutBuffer, uint nOutBufferSize,
    ref uint lpBytesReturned, IntPtr lpOverlapped);

  [DllImport("advapi32.dll", SetLastError=true)]
  static extern bool OpenProcessToken(IntPtr ProcessHandle, uint DesiredAccess, out IntPtr TokenHandle);

  [DllImport("advapi32.dll", SetLastError=true, CharSet=CharSet.Unicode)]
  static extern bool LookupPrivilegeValue(string lpSystemName, string lpName, out long lpLuid);

  [DllImport("advapi32.dll", SetLastError=true)]
  static extern bool AdjustTokenPrivileges(IntPtr TokenHandle, bool DisableAllPrivileges,
    ref TOKEN_PRIVILEGES NewState, uint BufferLength, IntPtr PreviousState, IntPtr ReturnLength);

  [DllImport("kernel32.dll")]
  static extern IntPtr GetCurrentProcess();

  [DllImport("kernel32.dll", SetLastError=true)]
  static extern bool CloseHandle(IntPtr hObject);

  [StructLayout(LayoutKind.Sequential)]
  struct TOKEN_PRIVILEGES {
    public uint PrivilegeCount;
    public long Luid;
    public uint Attributes;
  }

  const uint GENERIC_READ = 0x80000000;
  const uint FILE_SHARE_READ = 0x1, FILE_SHARE_WRITE = 0x2;
  const uint OPEN_EXISTING = 3;
  const uint FILE_FLAG_BACKUP_SEMANTICS = 0x02000000;
  const uint FSCTL_QUERY_USN_JOURNAL = 0x000900f4;
  const uint FSCTL_READ_USN_JOURNAL = 0x000900bb;
  const uint TOKEN_ADJUST_PRIVILEGES = 0x0020;
  const uint TOKEN_QUERY = 0x0008;
  const uint SE_PRIVILEGE_ENABLED = 0x00000002;

  static void EnableBackupPrivilege() {
    IntPtr token;
    if (!OpenProcessToken(GetCurrentProcess(), TOKEN_ADJUST_PRIVILEGES | TOKEN_QUERY, out token)) return;
    try {
      foreach (var name in new[] { "SeBackupPrivilege", "SeRestorePrivilege" }) {
        long luid;
        if (!LookupPrivilegeValue(null, name, out luid)) continue;
        var tp = new TOKEN_PRIVILEGES();
        tp.PrivilegeCount = 1;
        tp.Luid = luid;
        tp.Attributes = SE_PRIVILEGE_ENABLED;
        AdjustTokenPrivileges(token, false, ref tp, 0, IntPtr.Zero, IntPtr.Zero);
      }
    } finally { CloseHandle(token); }
  }

  [StructLayout(LayoutKind.Sequential)]
  struct USN_JOURNAL_DATA {
    public ulong UsnJournalID;
    public long FirstUsn;
    public long NextUsn;
    public long LowestValidUsn;
    public long MaxUsn;
    public ulong MaximumSize;
    public ulong AllocationDelta;
  }

  [StructLayout(LayoutKind.Sequential)]
  struct READ_USN_JOURNAL_DATA_V0 {
    public long StartUsn;
    public uint ReasonMask;
    public uint ReturnOnlyOnClose;
    public ulong Timeout;
    public ulong BytesToWaitFor;
    public ulong UsnJournalID;
  }

  public static int Read(string drive, long startUsn, string outFile, int max) {
    EnableBackupPrivilege();
    string vol = "\\\\.\\" + drive.TrimEnd(':', '\\') + ":";
    using (var h = CreateFile(vol, GENERIC_READ,
      FILE_SHARE_READ|FILE_SHARE_WRITE, IntPtr.Zero, OPEN_EXISTING, FILE_FLAG_BACKUP_SEMANTICS, IntPtr.Zero)) {
      if (h.IsInvalid) return -1;
      int qsz = Marshal.SizeOf(typeof(USN_JOURNAL_DATA));
      IntPtr qbuf = Marshal.AllocHGlobal(qsz);
      uint br = 0;
      if (!DeviceIoControl(h, FSCTL_QUERY_USN_JOURNAL, IntPtr.Zero, 0, qbuf, (uint)qsz, ref br, IntPtr.Zero)) {
        Marshal.FreeHGlobal(qbuf); return -2;
      }
      var jd = (USN_JOURNAL_DATA)Marshal.PtrToStructure(qbuf, typeof(USN_JOURNAL_DATA));
      Marshal.FreeHGlobal(qbuf);

      long cur = startUsn > 0 ? startUsn : jd.FirstUsn;
      var lines = new List<string>();
      int bufSize = 256 * 1024;
      IntPtr buf = Marshal.AllocHGlobal(bufSize);
      IntPtr inPtr = Marshal.AllocHGlobal(Marshal.SizeOf(typeof(READ_USN_JOURNAL_DATA_V0)));
      try {
        while (lines.Count < max) {
          var rd = new READ_USN_JOURNAL_DATA_V0();
          rd.StartUsn = cur;
          rd.ReasonMask = 0xFFFFFFFF;
          rd.ReturnOnlyOnClose = 0;
          rd.Timeout = 0;
          rd.BytesToWaitFor = 0;
          rd.UsnJournalID = jd.UsnJournalID;
          Marshal.StructureToPtr(rd, inPtr, false);
          br = 0;
          if (!DeviceIoControl(h, FSCTL_READ_USN_JOURNAL, inPtr,
              (uint)Marshal.SizeOf(typeof(READ_USN_JOURNAL_DATA_V0)),
              buf, (uint)bufSize, ref br, IntPtr.Zero) || br < 8) break;
          long nextUsn = Marshal.ReadInt64(buf);
          int offset = 8;
          bool any = false;
          while (offset + 60 <= (int)br && lines.Count < max) {
            int recLen = Marshal.ReadInt32(buf, offset);
            if (recLen < 60) break;
            long frn = Marshal.ReadInt64(buf, offset + 8);
            long pfrn = Marshal.ReadInt64(buf, offset + 16);
            long usn = Marshal.ReadInt64(buf, offset + 24);
            uint reason = (uint)Marshal.ReadInt32(buf, offset + 40);
            short nameLen = Marshal.ReadInt16(buf, offset + 56);
            short nameOff = Marshal.ReadInt16(buf, offset + 58);
            string name = "";
            if (nameLen > 0 && nameOff > 0 && offset + nameOff + nameLen <= (int)br) {
              string n = Marshal.PtrToStringUni(IntPtr.Add(buf, offset + nameOff), nameLen / 2);
              if (n != null) name = n;
            }
            lines.Add(usn + "|" + ((ulong)frn) + "|" + ((ulong)pfrn) + "|" + reason.ToString("X") + "|" + name.Replace("|", "/"));
            any = true;
            offset += recLen;
            cur = usn + 1;
          }
          if (!any) { cur = nextUsn; break; }
          if (nextUsn <= cur) break;
          cur = nextUsn;
        }
      } finally {
        Marshal.FreeHGlobal(buf);
        Marshal.FreeHGlobal(inPtr);
      }
      File.WriteAllLines(outFile, lines, new UTF8Encoding(false));
      return lines.Count;
    }
  }
}
'@
$letter = $Drive.Substring(0,1).ToUpper()
$n = [AuroraUsnRead]::Read($letter, $StartUsn, $OutFile, $Max)
Write-Output $n
