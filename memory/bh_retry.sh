#!/bin/bash
API=http://localhost:8001/api
for i in $(seq 1 14); do
  R=$(curl -s -X POST $API/migration/bizimhesap/test -H 'Content-Type: application/json' -d '{"company_id":"comp_nexus_main_01"}')
  echo "$(date +%T) test: $(echo "$R" | head -c 300)" >> /app/memory/bh_import.log
  if echo "$R" | grep -q '"ok": *true'; then
    WH=$(echo "$R" | python3 -c "import sys,json;w=json.load(sys.stdin)['warehouses'];print([x['id'] for x in w if 'Ana' in x['name']][0] if any('Ana' in x['name'] for x in w) else w[0]['id'])")
    I=$(curl -s -X POST $API/migration/bizimhesap/import -H 'Content-Type: application/json' -d "{\"company_id\":\"comp_nexus_main_01\",\"with_stock\":true,\"warehouse_id\":\"$WH\",\"on_duplicate\":\"update\"}")
    echo "$(date +%T) import: $(echo "$I" | head -c 400)" >> /app/memory/bh_import.log
    break
  fi
  sleep 300
done
