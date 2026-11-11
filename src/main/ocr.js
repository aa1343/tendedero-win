// Text in screenshots, read on this machine with the Windows OCR engine
// (Windows.Media.Ocr) through a small persistent PowerShell helper. Nothing
// leaves the computer: the helper only reads local image files.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const HELPER = path.join(os.tmpdir(), 'tendedero-ocr.ps1');

const SCRIPT = String.raw`
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Runtime.WindowsRuntime
$asTaskGeneric = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
  $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and
  $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation` + "`1" + String.raw`' })[0]
function Await($op, $type) {
  $task = $asTaskGeneric.MakeGenericMethod($type).Invoke($null, @($op))
  $task.Wait(-1) | Out-Null
  $task.Result
}
$null = [Windows.Media.Ocr.OcrEngine,Windows.Foundation,ContentType=WindowsRuntime]
$null = [Windows.Graphics.Imaging.BitmapDecoder,Windows.Foundation,ContentType=WindowsRuntime]
$null = [Windows.Storage.StorageFile,Windows.Foundation,ContentType=WindowsRuntime]
$engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromUserProfileLanguages()
if (-not $engine) { $engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromLanguage([Windows.Globalization.Language]::new('en-US')) }
[Console]::Out.WriteLine('READY')
[Console]::Out.Flush()
while ($true) {
  $line = [Console]::In.ReadLine()
  if ($null -eq $line) { break }
  $line = $line.Trim()
  if ($line -eq '') { continue }
  $out = ''
  try {
    if (Test-Path -LiteralPath $line) {
      $file = Await ([Windows.Storage.StorageFile]::GetFileFromPathAsync($line)) ([Windows.Storage.StorageFile])
      $stream = Await ($file.OpenAsync(0)) ([Windows.Storage.Streams.IRandomAccessStream])
      $decoder = Await ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($stream)) ([Windows.Graphics.Imaging.BitmapDecoder])
      $bitmap = Await ($decoder.GetSoftwareBitmapAsync()) ([Windows.Graphics.Imaging.SoftwareBitmap])
      $result = Await ($engine.RecognizeAsync($bitmap)) ([Windows.Media.Ocr.OcrResult])
      $out = ($result.Lines | ForEach-Object { $_.Text }) -join "` + "`n" + String.raw`"
      $stream.Dispose()
    }
  } catch {
    $out = ''
  }
  $b64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($out))
  [Console]::Out.WriteLine('BEGIN' + $b64 + 'END')
  [Console]::Out.Flush()
}
`;

let child = null;
let ready = false;
let waiters = [];
let buffer = '';
let starting = false;

function ensureHelper() {
  if (child) return;
  if (starting) return;
  starting = true;
  try {
    fs.writeFileSync(HELPER, SCRIPT, 'utf8');
  } catch (e) {
    starting = false;
    return;
  }
  const ps = path.join(
    process.env.SystemRoot || 'C:\\Windows',
    'System32\\WindowsPowerShell\\v1.0\\powershell.exe'
  );
  if (!fs.existsSync(ps)) {
    starting = false;
    return;
  }
  child = spawn(ps, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', HELPER], {
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
  });
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (chunk) => {
    buffer += chunk;
    let i;
    while ((i = buffer.indexOf('END')) >= 0) {
      const startIdx = buffer.lastIndexOf('BEGIN', i);
      if (startIdx < 0) {
        buffer = buffer.slice(i + 3);
        continue;
      }
      const b64 = buffer.slice(startIdx + 5, i);
      buffer = buffer.slice(i + 3);
      let text = '';
      try {
        text = Buffer.from(b64, 'base64').toString('utf8');
      } catch {}
      const w = waiters.shift();
      if (w) w(text);
    }
    if (buffer.includes('READY')) {
      buffer = buffer.replace(/READY\s*/g, '');
      ready = true;
    }
  });
  child.on('exit', () => {
    child = null;
    ready = false;
    starting = false;
    const ws = waiters;
    waiters = [];
    for (const w of ws) w('');
  });
  child.stderr.on('data', () => {});
  starting = false;
}

function recognizeFile(file) {
  return new Promise((resolve) => {
    ensureHelper();
    if (!child) return resolve('');
    const send = () => {
      waiters.push(resolve);
      try {
        child.stdin.write(file.replace(/[\r\n]/g, '') + '\n');
      } catch {
        waiters.pop();
        resolve('');
      }
    };
    if (ready) send();
    else {
      // wait for READY, at most 4 s
      const started = Date.now();
      const poll = () => {
        if (ready) return send();
        if (!child || Date.now() - started > 4000) return resolve('');
        setTimeout(poll, 60);
      };
      poll();
    }
  });
}

function shutdown() {
  if (child) {
    try {
      child.stdin.end();
    } catch {}
    try {
      child.kill();
    } catch {}
    child = null;
  }
}

module.exports = { recognizeFile, shutdown };
