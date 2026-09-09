#!/bin/sh
# Install the local ERP vhost: http://127.0.0.1/ is canonical; localhost 301s there.
set -eu
ROOT="$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)"
CONF="$ROOT/deploy/nginx-local.conf"
if [ ! -f "$CONF" ]; then
  echo "missing $CONF" >&2
  exit 1
fi
sudo cp "$CONF" /etc/nginx/sites-available/tamkobi
if [ -e /etc/nginx/sites-enabled/tamkobi ] && [ ! -L /etc/nginx/sites-enabled/tamkobi ]; then
  sudo rm -f /etc/nginx/sites-enabled/tamkobi
fi
sudo ln -sfn /etc/nginx/sites-available/tamkobi /etc/nginx/sites-enabled/tamkobi
sudo nginx -t
sudo nginx -s reload
echo "Local ERP: http://127.0.0.1/  (http://localhost/ redirects here)"
