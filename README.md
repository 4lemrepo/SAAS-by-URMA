# Control Diésel

Software para que una flotilla de carga sepa, cada semana, cuántos litros y cuántos pesos
de diésel se perdieron por unidad, operador y ruta.

Primer cliente: **URMA Logística**. Después, otras flotillas de 5 a 80 unidades.

## Qué hay hoy

| Parte | Dónde | Estado |
| --- | --- | --- |
| Esquema de base de datos multiempresa con seguridad por empresa (RLS) | `supabase/migrations/` | Listo, con 23 pruebas de acceso |
| Lógica de conciliación: litros teóricos, semáforo, pesos faltantes, cuadre de tanque | `src/lib/conciliacion/` | Lista, con 15 pruebas |
| Conexión a Supabase (navegador, servidor y proxy de sesión) | `src/lib/supabase/`, `src/proxy.ts` | Lista |
| Login, registro, confirmación de correo y alta de empresa | `src/app/(acceso)/`, `src/app/auth/` | Listo |
| Catálogos, viajes, app del operador, tablero | — | Siguiente |

## Cómo correrlo

1. Instala Node 22 o más reciente y corre `npm install`.
2. **Crea el proyecto en [Supabase](https://supabase.com/dashboard)** (New project; región
   más cercana, p. ej. `us-east-1` o `us-west-1`). Guarda la contraseña de la base.
3. **Corre las migraciones en orden** (SQL Editor → New query → pega el archivo → Run):
   1. `supabase/migrations/20261014000000_esquema_inicial.sql`
   2. `supabase/migrations/20261014000100_endurecer_seguridad.sql`

   Nunca edites una migración ya aplicada: crea una nueva.
4. **Variables:** `cp .env.example .env.local` y llena `NEXT_PUBLIC_SUPABASE_URL` y
   `NEXT_PUBLIC_SUPABASE_ANON_KEY` (Project Settings → API). La `service_role` key **no** va aquí.
5. **Auth → URL Configuration:** *Site URL* = `http://localhost:3000` (en producción, el dominio
   de Vercel) y agrega `http://localhost:3000/auth/confirmar` a *Redirect URLs*.
6. `npm run dev` y abre http://localhost:3000 → *Crear cuenta* → confirma el correo →
   da de alta la empresa → tablero.

## Pruebas

- `npm test` — conciliación
- `npm run typecheck` y `npm run lint`
- `supabase/pruebas/correr.sh` — seguridad entre empresas y roles (requiere un Postgres local)

## Cómo funciona la conciliación

- **Litros teóricos** = km cargado ÷ rendimiento cargado + km vacío ÷ rendimiento vacío.
  El rendimiento de la ruta, si existe, manda sobre el de la unidad.
- **Semáforo** con la tolerancia de cada empresa (5% por defecto):
  verde dentro de tolerancia; amarillo entre 1× y 2×, o consumo muy bajo (posible carga sin registrar);
  rojo arriba de 2×.
- **Pesos faltantes** = litros de más × precio por litro.
- **Tanque propio:** lectura inicial + entradas de pipa + ajustes − despachos, contra la lectura física final.
