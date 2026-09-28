// Windows print-queue access for the bridge (no dependencies): list queues and send RAW bytes through the spooler.
// Everything goes through PowerShell so nothing has to be installed. `run(script, env)` is injectable for tests.
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { unlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const PRELUDE = "$ErrorActionPreference='Stop'; [Console]::OutputEncoding=[System.Text.Encoding]::UTF8;\n";

const RAW_SCRIPT = PRELUDE + `try {
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class RawPrn {
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  public class DOCINFO {
    [MarshalAs(UnmanagedType.LPWStr)] public string pDocName;
    [MarshalAs(UnmanagedType.LPWStr)] public string pOutputFile;
    [MarshalAs(UnmanagedType.LPWStr)] public string pDataType;
  }
  [DllImport("winspool.drv", EntryPoint = "OpenPrinterW", SetLastError = true, CharSet = CharSet.Unicode, ExactSpelling = true)]
  static extern bool OpenPrinter(string name, out IntPtr h, IntPtr pd);
  [DllImport("winspool.drv", SetLastError = true, ExactSpelling = true)]
  static extern bool ClosePrinter(IntPtr h);
  [DllImport("winspool.drv", EntryPoint = "StartDocPrinterW", SetLastError = true, CharSet = CharSet.Unicode, ExactSpelling = true)]
  static extern int StartDocPrinter(IntPtr h, int level, [In, MarshalAs(UnmanagedType.LPStruct)] DOCINFO di);
  [DllImport("winspool.drv", SetLastError = true, ExactSpelling = true)]
  static extern bool EndDocPrinter(IntPtr h);
  [DllImport("winspool.drv", SetLastError = true, ExactSpelling = true)]
  static extern bool StartPagePrinter(IntPtr h);
  [DllImport("winspool.drv", SetLastError = true, ExactSpelling = true)]
  static extern bool EndPagePrinter(IntPtr h);
  [DllImport("winspool.drv", SetLastError = true, ExactSpelling = true)]
  static extern bool WritePrinter(IntPtr h, IntPtr p, int n, out int written);
  static Exception Fail(string what) { return new Exception(what + " failed (Windows error " + Marshal.GetLastWin32Error() + ")"); }
  public static void Send(string printer, byte[] data) {
    IntPtr h;
    if (!OpenPrinter(printer, out h, IntPtr.Zero)) throw Fail("OpenPrinter '" + printer + "'");
    try {
      DOCINFO di = new DOCINFO(); di.pDocName = "Photobooth receipt"; di.pDataType = "RAW";
      if (StartDocPrinter(h, 1, di) == 0) throw Fail("StartDocPrinter");
      try {
        if (!StartPagePrinter(h)) throw Fail("StartPagePrinter");
        IntPtr p = Marshal.AllocCoTaskMem(data.Length);
        try {
          Marshal.Copy(data, 0, p, data.Length);
          int w;
          if (!WritePrinter(h, p, data.Length, out w) || w != data.Length) throw Fail("WritePrinter");
        } finally { Marshal.FreeCoTaskMem(p); }
        EndPagePrinter(h);
      } finally { EndDocPrinter(h); }
    } finally { ClosePrinter(h); }
  }
}
'@
[RawPrn]::Send($env:PB_PRINTER, [System.IO.File]::ReadAllBytes($env:PB_FILE))
Write-Output 'OK'
} catch { [Console]::Error.WriteLine($_.Exception.Message); exit 1 }
`;

const LIST_SCRIPT = PRELUDE + 'Get-Printer | Select-Object Name,PortName,DriverName,PrinterStatus | ConvertTo-Json -Compress';
const INFO_SCRIPT = PRELUDE + 'Get-Printer -Name $env:PB_PRINTER | Select-Object Name,PortName,DriverName,PrinterStatus | ConvertTo-Json -Compress';

/** Runs a PowerShell script (Windows only). Env vars carry the data, so printer names are never spliced into code. */
export function runPowerShell(script, env = {}, timeoutMs = 30000) {
  return new Promise((resolve, reject) => {
    if (process.platform !== 'win32') return reject(Object.assign(new Error('Windows printing only works when the bridge runs on Windows'), { code: 'ENOTWIN' }));
    const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')],
      { env: { ...process.env, ...env }, windowsHide: true });
    let out = '', err = '';
    const t = setTimeout(() => { child.kill(); reject(new Error('PowerShell timed out')); }, timeoutMs);
    child.stdout.on('data', (d) => (out += d)); child.stderr.on('data', (d) => (err += d));
    child.on('error', (e) => { clearTimeout(t); reject(e); });
    child.on('close', (code) => { clearTimeout(t); code === 0 ? resolve(out.trim()) : reject(new Error(err.trim() || `PowerShell exited with ${code}`)); });
  });
}

const asArray = (j) => (j === '' ? [] : [].concat(JSON.parse(j)));

export async function listPrinters(run = runPowerShell) { return asArray(await run(LIST_SCRIPT, {})); }
export async function printerInfo(name, run = runPowerShell) { return asArray(await run(INFO_SCRIPT, { PB_PRINTER: name }))[0]; }

/** Sends bytes to a Windows print queue with the RAW datatype (the printer gets exactly these bytes). */
export async function sendRaw(name, bytes, run = runPowerShell) {
  const file = path.join(os.tmpdir(), `photobooth-${randomBytes(6).toString('hex')}.bin`);
  await writeFile(file, bytes);
  try { await run(RAW_SCRIPT, { PB_PRINTER: name, PB_FILE: file }, 30000); }
  finally { await unlink(file).catch(() => {}); }
}
