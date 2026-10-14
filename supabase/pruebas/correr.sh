#!/usr/bin/env bash
# Corre las pruebas de seguridad (RLS) contra un Postgres local desechable.
# Uso: PGHOST=/tmp PGPORT=5432 PGUSER=postgres ./supabase/pruebas/correr.sh
set -euo pipefail
DIR="$(cd "$(dirname "$0")" && pwd)"
DB="prueba_rls_$$"
psql -q -c "create database $DB"
trap 'psql -q -c "drop database if exists $DB"' EXIT
psql -q -d "$DB" -v ON_ERROR_STOP=1 -f "$DIR/00_stub_supabase.sql"
psql -q -d "$DB" -v ON_ERROR_STOP=1 -f "$DIR/../migrations/20261014000000_esquema_inicial.sql"
psql -q -d "$DB" -c "grant all on all tables in schema public to authenticated; grant execute on all functions in schema public to authenticated;"
SALIDA=$(psql -d "$DB" -v ON_ERROR_STOP=1 -f "$DIR/10_rls.sql" 2>&1 | grep -E "NOTICE|ERROR" | sed 's/.*NOTICE:  //')
echo "$SALIDA"
if echo "$SALIDA" | grep -qE "FALLA|ERROR"; then echo "❌ Hay pruebas fallando"; exit 1; fi
echo "✅ Pruebas de RLS OK"
