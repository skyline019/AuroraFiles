/**
 * USN Enum (FSCTL_ENUM_USN_DATA) microbench via PowerShell.
 * Without elevation typically returns skipped_no_priv.
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs/promises';
import fssync from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const execFileAsync = promisify(execFile);

const PS_ENUM = `
param([string]$Drive, [string]$OutFile, [int]$Max = 5000000)
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
using Microsoft.Win32.SafeHandles;
using System.IO;
public static class UsnEnum {
  [DllImport("kernel32.dll", SetLastError=true, CharSet=CharSet.Unicode)]
  public static extern SafeFileHandle CreateFile(string lpFileName, uint dwDesiredAccess,
    uint dwShareMode, IntPtr lpSecurityAttributes, uint dwCreationDisposition,
    uint dwFlagsAndAttributes, IntPtr hTemplateFile);
  [DllImport("kernel32.dll", SetLastError=true)]
  public static extern bool DeviceIoControl(SafeFileHandle hDevice, uint dwIoControlCode,
    IntPtr lpInBuffer, uint nInBufferSize, IntPtr lpOutBuffer, uint nOutBufferSize,
    out uint lpBytesReturned, IntPtr lpOverlapped);
  public const uint GENERIC_READ = 0x80000000;
  public const uint FILE_SHARE_READ = 0x1;
  public const uint FILE_SHARE_WRITE = 0x2;
  public const uint OPEN_EXISTING = 3;
  public const uint FILE_FLAG_BACKUP_SEMANTICS = 0x02000000;
  // FSCTL_ENUM_USN_DATA = CTL_CODE(FILE_DEVICE_FILE_SYSTEM, 44, METHOD_NEITHER, FILE_ANY_ACCESS)
  public const uint FSCTL_ENUM_USN_DATA = 0x000900b3;
}
"@
$vol = "\\\\.\\$($Drive.TrimEnd(':')):"
$h = [UsnEnum]::CreateFile($vol, [UsnEnum]::GENERIC_READ,
  ([UsnEnum]::FILE_SHARE_READ -bor [UsnEnum]::FILE_SHARE_WRITE),
  [IntPtr]::Zero, [UsnEnum]::OPEN_EXISTING, [UsnEnum]::FILE_FLAG_BACKUP_SEMANTICS, [IntPtr]::Zero)
if ($h.IsInvalid) {
  $err = [Runtime.InteropServices.Marshal]::GetLastWin32Error()
  "ERR|$err" | Set-Content -Path $OutFile -Encoding ascii
  exit 1
}
# MFT_ENUM_DATA_V0: StartFileReferenceNumber, LowUsn, HighUsn (3x Int64)
$inSize = 24
$inPtr = [Runtime.InteropServices.Marshal]::AllocHGlobal($inSize)
[Runtime.InteropServices.Marshal]::WriteInt64($inPtr, 0, 0)
[Runtime.InteropServices.Marshal]::WriteInt64($inPtr, 8, 0)
[Runtime.InteropServices.Marshal]::WriteInt64($inPtr, 16, [Int64]::MaxValue)
$bufSize = 1024 * 256
$outPtr = [Runtime.InteropServices.Marshal]::AllocHGlobal($bufSize)
$count = 0
$sw = [Diagnostics.Stopwatch]::StartNew()
try {
  while ($count -lt $Max) {
    $br = 0
    $ok = [UsnEnum]::DeviceIoControl($h, [UsnEnum]::FSCTL_ENUM_USN_DATA,
      $inPtr, [uint32]$inSize, $outPtr, [uint32]$bufSize, [ref]$br, [IntPtr]::Zero)
    if (-not $ok) {
      $err = [Runtime.InteropServices.Marshal]::GetLastWin32Error()
      if ($err -eq 38) { break } # ERROR_HANDLE_EOF
      "ERR|$err|$count" | Set-Content -Path $OutFile -Encoding ascii
      exit 2
    }
    if ($br -lt 8) { break }
    $next = [Runtime.InteropServices.Marshal]::ReadInt64($outPtr, 0)
    [Runtime.InteropServices.Marshal]::WriteInt64($inPtr, 0, $next)
    $offset = 8
    while ($offset + 60 -le $br) {
      $recLen = [Runtime.InteropServices.Marshal]::ReadInt32($outPtr, $offset)
      if ($recLen -le 0) { break }
      $count++
      $offset += $recLen
      if ($count -ge $Max) { break }
    }
  }
} finally {
  [Runtime.InteropServices.Marshal]::FreeHGlobal($inPtr)
  [Runtime.InteropServices.Marshal]::FreeHGlobal($outPtr)
  $h.Dispose()
}
$sw.Stop()
"$count|$($sw.ElapsedMilliseconds)" | Set-Content -Path $OutFile -Encoding ascii
`;

/**
 * @param {string} root e.g. E:\\
 */
export async function bakeoffUsnEnum(root) {
  const letter = String(root).match(/^([A-Za-z]):/)?.[1];
  if (!letter) {
    return {
      engine: 'usn-enum',
      mode: 'enum',
      root,
      count: 0,
      ms: 0,
      entries_per_s: 0,
      rss_mb: null,
      ok: false,
      error: 'bad_root',
      verdict_hint: 'mft=defer',
    };
  }
  const outFile = path.join(os.tmpdir(), `aurora-usn-enum-${process.pid}.txt`);
  const ps1 = path.join(os.tmpdir(), `aurora-usn-enum-${process.pid}.ps1`);
  await fs.writeFile(ps1, PS_ENUM, 'utf8');
  const t0 = performance.now();
  try {
    await execFileAsync(
      'powershell.exe',
      ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', ps1, '-Drive', `${letter}:`, '-OutFile', outFile],
      { windowsHide: true, timeout: 120_000, maxBuffer: 2 * 1024 * 1024 },
    );
  } catch (err) {
    let body = '';
    try { body = await fs.readFile(outFile, 'utf8'); } catch { /* */ }
    const wall = Math.round(performance.now() - t0);
    const errCode = String(body).startsWith('ERR|') ? body.trim() : (err?.message || 'exec_fail');
    const noPriv = /ERR\|5\b/.test(errCode) || /access/i.test(errCode);
    return {
      engine: 'usn-enum',
      mode: 'enum',
      root: `${letter}:\\`,
      count: 0,
      ms: wall,
      entries_per_s: 0,
      rss_mb: null,
      ok: false,
      error: noPriv ? 'skipped_no_priv' : String(errCode).slice(0, 200),
      verdict_hint: 'mft=defer',
    };
  } finally {
    try { await fs.unlink(ps1); } catch { /* */ }
  }

  let text = '';
  try { text = (await fs.readFile(outFile, 'utf8')).trim(); } catch { /* */ }
  try { await fs.unlink(outFile); } catch { /* */ }

  if (text.startsWith('ERR|')) {
    const noPriv = /^ERR\|5\b/.test(text);
    return {
      engine: 'usn-enum',
      mode: 'enum',
      root: `${letter}:\\`,
      count: 0,
      ms: Math.round(performance.now() - t0),
      entries_per_s: 0,
      rss_mb: null,
      ok: false,
      error: noPriv ? 'skipped_no_priv' : text.slice(0, 200),
      verdict_hint: 'mft=defer',
    };
  }

  const [countStr, msStr] = text.split('|');
  const count = Number(countStr) || 0;
  const ms = Number(msStr) || Math.round(performance.now() - t0);
  const eps = ms > 0 ? Math.round((count / ms) * 1000 * 10) / 10 : 0;
  const spikeOk = eps >= 250_000 || (count > 0 && ms <= 5000);
  return {
    engine: 'usn-enum',
    mode: 'enum',
    root: `${letter}:\\`,
    count,
    ms,
    entries_per_s: eps,
    rss_mb: null,
    ok: true,
    error: null,
    note: 'FRN records only; path rebuild not included',
    verdict_hint: spikeOk ? 'mft=spike_ok' : 'mft=defer',
  };
}

async function main() {
  const root = process.argv.includes('--root')
    ? process.argv[process.argv.indexOf('--root') + 1]
    : 'E:\\';
  if (!fssync.existsSync(root)) {
    console.log(JSON.stringify({ ok: false, error: 'not_found', root }));
    process.exit(2);
  }
  console.log(JSON.stringify(await bakeoffUsnEnum(root)));
}

if (process.argv[1]?.endsWith('bakeoff-usn-enum.mjs')) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
