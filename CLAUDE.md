@AGENTS.md

# Control Diésel — guía para Claude Code

SaaS de control de diésel para flotillas de carga en México (5 a 80 unidades).
Primer cliente: URMA Logística. Luego se comercializa a otros transportistas.
Documento de producto: https://claude.ai/code/artifact/e2bffefb-b3d4-4377-a568-83c189371777

## Alcance del MVP (no construir nada fuera de esto sin que Alan lo pida)
Catálogos, viajes, cargas de diésel (con foto del ticket o del medidor del tanque, desde
computadora o celular, y validación), conciliación real vs teórico con semáforo, inventario de
tanque propio, tablero, alertas, multiempresa y roles, exportación a Excel.
**Fuera del MVP:** liquidaciones, mantenimiento, llantas, Carta Porte (irá vía API de un PAC),
GPS/telemetría, facturación y cobranza, captura sin señal (offline).

## Roles
El operador (chofer) **no es usuario**: es un registro del catálogo `operadores` para saber quién
manejó cada viaje y medir su rendimiento. Los usuarios (`miembros.rol`) son:
- `dueno`: todo (usuarios, parámetros, catálogos, viajes, cargas, tablero y conciliación).
- `administracion`: catálogos, viajes, cargas, validar cargas, tablero y conciliación. No administra usuarios ni parámetros.
- `captura`: da de alta viajes y cargas con foto; consulta catálogos. No edita catálogos ni
  parámetros, no valida cargas, no ve el tablero de pesos ni la conciliación.
Toda carga nace `pendiente`; la valida o rechaza dueño o administración. Administración y captura
nunca revisan lo que ellos capturaron; el dueño sí, y la carga queda `autovalidada` (lo impone un
trigger en la base). Tolerancia y precio del diésel viven en `parametros_empresa`, que captura no lee. Los permisos de pantalla viven en `src/lib/auth/permisos.ts`.

## Stack
Next.js (App Router, TypeScript, Tailwind) · Supabase (Postgres + Auth + Storage) · Vercel · Vitest.

## Reglas
- **Idioma:** UI, nombres de tablas, columnas y del dominio en español (`unidades`, `cargas_diesel`,
  `litrosTeoricos`). Términos técnicos genéricos pueden ir en inglés.
- **Multiempresa:** toda tabla de negocio lleva `empresa_id` y RLS. Nunca usar la service role key
  en código que corra con datos del usuario. Toda tabla nueva necesita políticas y una prueba en
  `supabase/pruebas/10_rls.sql`.
- **Migraciones:** nunca editar una migración ya aplicada; crear una nueva en `supabase/migrations/`.
- **Conciliación:** la lógica vive en `src/lib/conciliacion/` como funciones puras con pruebas.
  Cualquier cambio de fórmula requiere prueba que lo cubra. No duplicar la lógica en SQL ni en componentes.
- **Parámetros:** tolerancia, precio del diésel y rendimientos son datos de cada empresa, nunca constantes en código.
- Antes de cada commit: `npm test`, `npm run typecheck`, `npm run lint`, y si tocaste SQL,
  `supabase/pruebas/correr.sh`.

## Comandos
- `npm run dev` — servidor local
- `npm test` — pruebas de conciliación
- `npm run typecheck` / `npm run lint`
- `PGHOST=… PGPORT=… PGUSER=… ./supabase/pruebas/correr.sh` — pruebas de seguridad (RLS) en un Postgres local
