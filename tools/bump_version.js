// Новая версия: vДДММГГ.НОМЕР (дата сегодня, номер сборки +1)
const fs = require('fs');
const path = require('path');
const file = path.join(__dirname, '..', 'game', 'js', 'version.js');
const src = fs.readFileSync(file, 'utf8');
const cur = /GAME_VERSION = 'v\d{6}\.(\d+)'/.exec(src);
const n = (cur ? +cur[1] : 0) + 1;
const d = new Date();
const p2 = x => String(x).padStart(2, '0');
const ver = `v${p2(d.getDate())}${p2(d.getMonth() + 1)}${p2(d.getFullYear() % 100)}.${String(n).padStart(3, '0')}`;
fs.writeFileSync(file, src.replace(/GAME_VERSION = '[^']*'/, `GAME_VERSION = '${ver}'`));
console.log(ver);
