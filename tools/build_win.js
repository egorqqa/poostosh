// Сборка Windows-версии: dist/Poostosh/Poostosh.exe и архив dist/Poostosh-<версия>-win64.zip
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { packager } = require('@electron/packager');

const ROOT = path.join(__dirname, '..');
const DIST = path.join(ROOT, 'dist');
const ver = /GAME_VERSION = '([^']+)'/.exec(fs.readFileSync(path.join(ROOT, 'game/js/version.js'), 'utf8'))[1];
const m = /^v(\d\d)(\d\d)(\d\d)\.(\d+)$/.exec(ver);
const fileVer = `${+m[3]}.${+m[2]}.${+m[1]}.${+m[4]}`;

(async () => {
  fs.rmSync(DIST, { recursive: true, force: true });
  const [out] = await packager({
    dir: ROOT, out: DIST, name: 'Poostosh', executableName: 'Poostosh', platform: 'win32', arch: 'x64',
    overwrite: true, asar: true, prune: true, icon: path.join(ROOT, 'desktop/icon.ico'),
    appVersion: fileVer, buildVersion: fileVer, appCopyright: 'egorqqa',
    win32metadata: { ProductName: 'Пустошь', FileDescription: 'Пустошь', CompanyName: 'egorqqa', InternalName: 'Poostosh', OriginalFilename: 'Poostosh.exe' },
    ignore: [/^\/dist($|\/)/, /^\/tools($|\/)/, /^\/\.[^/]+($|\/)/, /^\/hex_tiles($|\/)/, /^\/large_terrain($|\/)/, /^\/[^/]+\.(png|bat|md)$/i, /^\/data($|\/)/],
  });
  const folder = path.join(DIST, 'Poostosh');
  fs.renameSync(out, folder);
  if (fs.existsSync(path.join(ROOT, 'server/server.js'))) fs.writeFileSync(path.join(folder, 'Сервер.bat'), '@echo off\r\nchcp 65001 >nul\r\ncd /d "%~dp0"\r\nset /p PORT=Порт [7777]: \r\nif "%PORT%"=="" set PORT=7777\r\nset /p PASS=Пароль: \r\nstart "" Poostosh.exe --server --port %PORT% --password "%PASS%"\r\necho Сервер запущен на порту %PORT%. Закрыть: диспетчер задач или этот .bat с ключом stop.\r\npause\r\n');
  const zip = path.join(DIST, `Poostosh-${ver}-win64.zip`);
  execFileSync('powershell', ['-NoProfile', '-Command', `Compress-Archive -Path '${folder}' -DestinationPath '${zip}' -Force`], { stdio: 'inherit' });
  console.log('Готово:', path.join(folder, 'Poostosh.exe'));
  console.log('Архив:', zip);
})().catch(e => { console.error(e); process.exit(1); });
