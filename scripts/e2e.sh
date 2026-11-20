#!/usr/bin/env bash
# Full server test on a local Supabase (needs Docker running and `npx supabase start` done).
#   bash scripts/e2e.sh
set -euo pipefail
cd "$(dirname "$0")/.."
WORK="$(mktemp -d)"
trap 'kill ${SERVE_PID:-0} 2>/dev/null || true; rm -rf "$WORK"' EXIT

OWNER_ID=1
mkdir -p "$WORK/supabase/migrations" "$WORK/web"
( cd "$WORK" && node "$OLDPWD/scripts/setup-secrets.mjs" abcdefghijklmnopqrst "$OWNER_ID" > setup.out )
OWNER_KEY="$(grep -Eo 'LUGER-[0-9A-Z]{4}-[0-9A-Z]{4}-[0-9A-Z]{4}-[0-9A-Z]{4}' "$WORK/setup.out")"

# Fresh database, then the owner key row the setup script generated.
npx -y supabase@2.20.12 db reset --local >/dev/null
docker exec -i supabase_db_luger psql -U postgres -q < "$WORK/supabase/migrations/0002_owner_key.sql"

# Test-only values: a webhook secret we can sign with and a dummy LootLabs link.
sed -i.bak -e 's/^STRIPE_WEBHOOK_SECRET=.*/STRIPE_WEBHOOK_SECRET=whsec_e2e/' -e 's#^LOOTLABS_LINK=.*#LOOTLABS_LINK=https://loot-link.com/s?e2e#' "$WORK/.secrets.env"

npx -y supabase@2.20.12 functions serve --env-file "$WORK/.secrets.env" --no-verify-jwt > "$WORK/serve.log" 2>&1 &
SERVE_PID=$!
for _ in $(seq 1 60); do
  curl -s -o /dev/null -X POST http://127.0.0.1:54321/functions/v1/api -d '{}' && break
  sleep 2
done

set -a; . "$WORK/.secrets.env"; set +a
E2E_OWNER_KEY="$OWNER_KEY" OWNER_ROBLOX_ID="$OWNER_ID" SUPABASE_URL=http://127.0.0.1:54321 SUPABASE_SERVICE_ROLE_KEY=unused \
  npx -y deno@2.1.4 run --config supabase/functions/deno.json --allow-net --allow-env --allow-read --allow-run supabase/tests/e2e.ts || { tail -40 "$WORK/serve.log"; exit 1; }
