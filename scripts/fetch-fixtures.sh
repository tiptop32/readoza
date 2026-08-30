#!/usr/bin/env bash
# Перекачивает golden-фикстуры для парсера с живого Telegram.
# Запускать, когда падает parse.test.ts: сначала обновить фикстуры, затем посмотреть,
# что именно изменилось в вёрстке (git diff по HTML) и починить parse.ts.
set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/src/core/source/telegram/__fixtures__"
UA="Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36"

mkdir -p "$DIR"
fetch() {
  curl -sS -A "$UA" "$2" -o "$DIR/$1" -w "  %{http_code}  %{size_download}b  $1\n"
  sleep 0.7
}

echo "фикстуры -> $DIR"
fetch feed-start.html      "https://t.me/s/sys_sa?before=20"
fetch feed-mid.html        "https://t.me/s/sys_sa?after=143"
fetch feed-latest.html     "https://t.me/s/sys_sa"
fetch feed-media.html      "https://t.me/s/tginfo"
fetch feed-alias.html      "https://t.me/s/breakingmash"
fetch channel-page.html    "https://t.me/sys_sa"
fetch channel-alias.html   "https://t.me/breakingmash"
fetch channel-missing.html "https://t.me/thischanneldoesnotexist99xz"
fetch channel-group.html   "https://t.me/rustlang_ru"
