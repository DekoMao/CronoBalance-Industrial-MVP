#!/usr/bin/env sh
set -eu
cd "$(dirname "$0")"
printf 'CronoBalance Industrial disponível em http://localhost:4173\nPressione Ctrl+C para encerrar.\n'
exec python3 -m http.server 4173
