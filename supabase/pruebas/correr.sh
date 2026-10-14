#!/usr/bin/env bash
# Corre las pruebas de seguridad (RLS) contra un Postgres local desechable.
# Uso: PGHOST=/tmp PGPORT=5432 PGUSER=postgres ./supabase/pruebas/correr.sh
set -euo pipefail
DIR="$(cd "$(dirname "$0")" && pwd)"
DB="prueba_rls_$$"
psql -q -c "create database $DB"
trap 'psql -q -c "drop database if exists $DB"' EXIT
psql -q -d "$DB" -v ON_ERROR_STOP=1 -f "$DIR/00_stub_supabase.sql"
for MIGRACION in "$DIR"/../migrations/*.sql; do
  psql -q -d "$DB" -v ON_ERROR_STOP=1 -f "$MIGRACION"
done
psql -q -d "$DB" -c "grant all on all tables in schema public to authenticated; grant execute on all functions in schema public to authenticated;"
# Fallo visible también en la pestaña "Summary" de GitHub Actions.
falla() {
  echo "❌ $1"
  if [ -n "${GITHUB_ACTIONS:-}" ]; then echo "::error title=Pruebas RLS::$1"; fi
  exit 1
}

# Sin pipefail aquí: si psql aborta a medio archivo, igual hay que mostrar por qué.
ESTADO=0
CRUDO=$(psql -d "$DB" -v ON_ERROR_STOP=1 -f "$DIR/10_rls.sql" 2>&1) || ESTADO=$?
SALIDA=$(echo "$CRUDO" | grep -E "NOTICE|ERROR" | sed 's/.*NOTICE:  //' || true)
echo "$SALIDA"
if [ "$ESTADO" -ne 0 ]; then
  echo "$CRUDO" | grep -E "ERROR|FATAL" || echo "$CRUDO"
  falla "psql terminó con código $ESTADO al correr 10_rls.sql"
fi
FALLIDAS=$(echo "$SALIDA" | grep -E "FALLA|ERROR" || true)
if [ -n "$FALLIDAS" ]; then falla "Pruebas fallando: $(echo "$FALLIDAS" | tr '\n' ' ')"; fi
# Las líneas "(esperado N): M" fallan si M no es N.
DISTINTAS=$(echo "$SALIDA" | awk -F'esperado |\\): ' '/esperado/ && $2 != $3' || true)
if [ -n "$DISTINTAS" ]; then falla "Valor distinto al esperado: $(echo "$DISTINTAS" | tr '\n' ' ')"; fi
echo "✅ Pruebas de RLS OK"
