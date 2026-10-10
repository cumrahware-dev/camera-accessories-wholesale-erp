#!/usr/bin/env bash
# Runs a tsx test against a throw-away copy of the local database, then drops it. The real database is only read (pg_dump).
# Needs: local PostgreSQL, DATABASE_URL in .env, and a stub for the 'server-only' package on NODE_PATH (STUBS=dir).
set -euo pipefail
cd "$(dirname "$0")/../.."
URL=$(grep -E '^DATABASE_URL=' .env | head -1 | cut -d= -f2- | tr -d '"')
BASE=${URL%/*}; DB=${URL##*/}; DB=${DB%%\?*}
TMP="${DB}_test_$$"
export PGPASSWORD=$(echo "$URL" | sed -E 's#postgresql://[^:]*:([^@]*)@.*#\1#')
USERN=$(echo "$URL" | sed -E 's#postgresql://([^:]*):.*#\1#')
psql -h localhost -U "$USERN" -d postgres -qc "CREATE DATABASE \"$TMP\"" 
trap 'psql -h localhost -U "$USERN" -d postgres -qc "DROP DATABASE IF EXISTS \"$TMP\" WITH (FORCE)" >/dev/null' EXIT
pg_dump -h localhost -U "$USERN" "$DB" | psql -h localhost -U "$USERN" -d "$TMP" -q -v ON_ERROR_STOP=0 >/dev/null 2>&1
export DATABASE_URL="$BASE/$TMP"
NODE_PATH="${STUBS:-}" npx tsx "$@"
