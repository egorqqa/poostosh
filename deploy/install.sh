#!/usr/bin/env bash
# Установка выделенного сервера «Пустошь» на Ubuntu/Debian без Docker.
# Запуск от root:  curl -fsSL https://raw.githubusercontent.com/egorqqa/poostosh/main/deploy/install.sh | bash
set -euo pipefail
REPO=https://github.com/egorqqa/poostosh.git
DIR=/opt/poostosh

if ! command -v node >/dev/null || [ "$(node -p 'process.versions.node.split(".")[0]')" -lt 18 ]; then
  echo "Устанавливаю Node.js 20..."
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y nodejs git
fi
command -v git >/dev/null || apt-get install -y git

id poostosh >/dev/null 2>&1 || useradd --system --home "$DIR" --shell /usr/sbin/nologin poostosh
if [ -d "$DIR/.git" ]; then git -C "$DIR" pull --ff-only; else git clone --depth 1 "$REPO" "$DIR"; fi
cd "$DIR/server" && npm install --omit=dev --no-audit --no-fund
mkdir -p /var/lib/poostosh
[ -f "$DIR/.env" ] || cp "$DIR/deploy/.env.example" "$DIR/.env"
chown -R poostosh:poostosh "$DIR" /var/lib/poostosh
cp "$DIR/deploy/poostosh.service" /etc/systemd/system/poostosh.service
systemctl daemon-reload
systemctl enable --now poostosh
command -v ufw >/dev/null && ufw allow "$(grep -E '^PORT=' "$DIR/.env" | cut -d= -f2 || echo 7777)/tcp" || true

echo
echo "Готово. Отредактируйте пароль и название: nano $DIR/.env  затем  systemctl restart poostosh"
echo "Журнал: journalctl -u poostosh -f"
echo "Обновление сервера: повторно запустите этот скрипт."
