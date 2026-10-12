// Автообновление Windows-сборки: скачать zip релиза → распаковать → заменить файлы → перезапустить
const { app } = require('electron');
const https = require('https');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile, spawn } = require('child_process');

const ALLOWED = /^https:\/\/github\.com\/egorqqa\/poostosh\/releases\/download\//;

function run(file, args) {
  return new Promise((res, rej) => execFile(file, args, { windowsHide: true, maxBuffer: 1 << 24 }, (err, out, errOut) => err ? rej(new Error(errOut || err.message)) : res(out)));
}

function download(url, dest, onProgress, hops = 0) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { 'User-Agent': 'Poostosh-Updater', Accept: 'application/octet-stream' } }, res => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
        res.resume();
        if (hops > 6) { reject(new Error('Слишком много перенаправлений')); return; }
        resolve(download(new URL(res.headers.location, url).toString(), dest, onProgress, hops + 1));
        return;
      }
      if (res.statusCode !== 200) { res.resume(); reject(new Error(`Сервер ответил ${res.statusCode}`)); return; }
      const total = +res.headers['content-length'] || 0;
      let got = 0, lastSent = 0;
      const out = fs.createWriteStream(dest);
      res.on('data', chunk => {
        got += chunk.length;
        if (Date.now() - lastSent > 150) { lastSent = Date.now(); onProgress({ stage: 'download', got, total }); }
      });
      res.on('error', reject);
      out.on('error', reject);
      out.on('finish', () => {
        onProgress({ stage: 'download', got, total: total || got });
        if (total && got !== total) reject(new Error('Загрузка прервалась')); else resolve();
      });
      res.pipe(out);
    });
    req.on('error', e => reject(new Error('Нет связи с GitHub: ' + e.message)));
    req.setTimeout(30000, () => req.destroy(new Error('таймаут')));
  });
}

async function extract(zip, dir) {
  fs.mkdirSync(dir, { recursive: true });
  const tar = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe');
  try {
    if (!fs.existsSync(tar)) throw new Error('нет tar');
    await run(tar, ['-xf', zip, '-C', dir]);
  } catch (e) {
    await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `Expand-Archive -LiteralPath '${zip.replace(/'/g, "''")}' -DestinationPath '${dir.replace(/'/g, "''")}' -Force`]);
  }
}

function findAppDir(dir, depth = 0) {
  if (fs.existsSync(path.join(dir, 'Poostosh.exe'))) return dir;
  if (depth > 2) return null;
  for (const n of fs.readdirSync(dir)) {
    const p = path.join(dir, n);
    if (fs.statSync(p).isDirectory()) { const r = findAppDir(p, depth + 1); if (r) return r; }
  }
  return null;
}

// PowerShell-скрипт: дождаться закрытия игры, скопировать новые файлы, запустить exe
function writeSwapScript(tmp, src, dst) {
  const q = s => `'${s.replace(/'/g, "''")}'`;
  const ps = `$ErrorActionPreference = 'SilentlyContinue'
$src = ${q(src)}
$dst = ${q(dst)}
$tmp = ${q(tmp)}
$exe = Join-Path $dst 'Poostosh.exe'
$deadline = (Get-Date).AddSeconds(40)
while ((Get-Date) -lt $deadline) {
  $busy = Get-Process | Where-Object { $_.Path -and $_.Path.StartsWith($dst, [StringComparison]::OrdinalIgnoreCase) }
  if (-not $busy) { break }
  Start-Sleep -Milliseconds 300
}
Start-Sleep -Milliseconds 400
$ok = $false
for ($i = 0; $i -lt 25 -and -not $ok; $i++) {
  try { Copy-Item -Path (Join-Path $src '*') -Destination $dst -Recurse -Force -ErrorAction Stop; $ok = $true }
  catch { Start-Sleep -Seconds 1 }
}
Start-Process -FilePath $exe -WorkingDirectory $dst
Start-Sleep -Seconds 2
Remove-Item -LiteralPath $tmp -Recurse -Force
`;
  const file = path.join(tmp, 'swap.ps1');
  fs.writeFileSync(file, '\ufeff' + ps, 'utf8');
  return file;
}

async function installUpdate(url, onProgress) {
  if (!app.isPackaged) throw new Error('Автообновление работает только в собранной версии (Poostosh.exe)');
  if (typeof url !== 'string' || !ALLOWED.test(url)) throw new Error('Недопустимый адрес обновления');
  const appDir = path.dirname(process.execPath);
  const probe = path.join(appDir, '.write-test');
  try { fs.writeFileSync(probe, ''); fs.unlinkSync(probe); }
  catch (e) { throw new Error('Нет прав на запись в папку игры. Переместите игру, например, на рабочий стол или в «Документы».'); }

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'poostosh-upd-'));
  const zip = path.join(tmp, 'update.zip');
  await download(url, zip, onProgress);
  onProgress({ stage: 'extract' });
  const unpacked = path.join(tmp, 'new');
  await extract(zip, unpacked);
  const src = findAppDir(unpacked);
  if (!src) throw new Error('В архиве не найден Poostosh.exe');
  fs.unlinkSync(zip);
  const script = writeSwapScript(tmp, src, appDir);
  onProgress({ stage: 'restart' });
  // Скрипт запускается через WMI, чтобы он не был дочерним процессом игры:
  // иначе Windows завершит его вместе с ней.
  const cmd = `powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "${script}"`;
  try {
    await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
      `$r = Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{ CommandLine = '${cmd.replace(/'/g, "''")}' }; exit [int]$r.ReturnValue`]);
  } catch (e) {
    const child = spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden', '-File', script], { detached: true, stdio: 'ignore', windowsHide: true });
    child.unref();
  }
  setTimeout(() => app.exit(0), 600);
}

module.exports = { installUpdate };
