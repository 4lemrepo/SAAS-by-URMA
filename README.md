# Control Diésel

Software para que una flotilla de carga sepa, cada semana, cuántos litros y cuántos pesos
de diésel se perdieron por unidad, operador y ruta.

Primer cliente: **URMA Logística**. Después, otras flotillas de 5 a 80 unidades.

## Qué hay hoy

| Parte | Dónde | Estado |
| --- | --- | --- |
| Esquema de base de datos multiempresa con seguridad por empresa (RLS) | `supabase/migrations/` | Listo, con 10 pruebas de acceso |
| Lógica de conciliación: litros teóricos, semáforo, pesos faltantes, cuadre de tanque | `src/lib/conciliacion/` | Lista, con 15 pruebas |
| Conexión a Supabase (navegador y servidor) | `src/lib/supabase/` | Lista |
| Login, catálogos, viajes, app del operador, tablero | — | Siguiente |

## Cómo correrlo

1. Instala Node 22 o más reciente.
2. `npm install`
3. Crea un proyecto en [Supabase](https://supabase.com), corre la migración de
   `supabase/migrations/` (SQL Editor o Supabase CLI) y copia `.env.example` a `.env.local`
   con la URL y la anon key del proyecto.
4. `npm run dev` y abre http://localhost:3000

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
