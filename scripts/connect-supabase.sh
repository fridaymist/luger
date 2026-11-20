#!/usr/bin/env bash
# Signs in to Supabase, links this folder to the Luger project and creates the database.
set -e
cd "$(dirname "$0")/.."
REF="$(node -p "require('./luger.config.json').functions.split('//')[1].split('.')[0]")"
echo "Step 1 of 3: sign in to Supabase (your browser will open)."
npx -y supabase@2.20.12 login
echo "Step 2 of 3: link this folder to project $REF. Type the DATABASE password you chose when creating the project."
npx -y supabase@2.20.12 link --project-ref "$REF"
echo "Step 3 of 3: create Luger's tables and your owner key."
npx -y supabase@2.20.12 db push
echo "Done. Supabase is ready."
