#!/usr/bin/env bash
# Integrationstests gegen die echte Datenbank.
# Braucht eine Nutzersitzung (`lovable auth-session --json`) und eine Datentabelle dieses Nutzers.
#   DB_TEST_DATASET=<dataset-uuid> scripts/test-db.sh
set -euo pipefail
cd "$(dirname "$0")/.."
SESSION="${SESSION_FILE:-$HOME/.cache/lovable-auth/session.json}"
set -a; source .env; set +a
export DB_TEST_URL="$VITE_SUPABASE_URL"
export DB_TEST_KEY="$VITE_SUPABASE_PUBLISHABLE_KEY"
export DB_TEST_TOKEN="$(python3 -c "import json,sys;print(json.load(open('$SESSION'))['session']['access_token'])")"
: "${DB_TEST_DATASET:?DB_TEST_DATASET fehlt}"
exec bunx vitest run src/lib/datasets.db.test.ts
