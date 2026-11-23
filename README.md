# Control Diésel

[![Pruebas](https://github.com/4lemrepo/SAAS-by-URMA/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/4lemrepo/SAAS-by-URMA/actions/workflows/ci.yml)

## English summary

**Diesel control for Mexican freight fleets.** It shows a fleet owner, every week, how many liters and pesos of diesel were lost per truck, driver and route.

I run a 13-truck carrier in Guadalajara (URMA Logística). Diesel theft and untracked fuel were our biggest cost leak, so I'm building the tool I needed. URMA is the first customer; the target is fleets of 5–80 trucks.

**Built so far**
- Multi-tenant Postgres schema with row-level security per company and per role (owner, admin, data entry)
- Trips with legs, fuel loads, expenses, rates, driver pay, closing and an audit log
- Fuel reconciliation logic: theoretical vs. actual liters, traffic-light alerts, missing pesos, tank balance
- Equipment and overhead cost allocation, plus a KPI dashboard with rankings, trends and Excel export
- Catalog import from spreadsheets

**Stack:** Next.js (App Router, TypeScript), Supabase (Postgres, Auth), Vercel. Business logic lives in pure functions covered by 155 Vitest tests. RLS security tests run against Postgres 16 in GitHub Actions.

**Next:** photo-validated fuel loads and reconciliation on the dashboard.

Built with Claude Code. The UI and code are in Spanish because the users are Mexican fleet operators.

---

Software para que una flotilla de carga sepa, cada semana, cuántos litros y cuántos pesos
de diésel se perdieron por unidad, operador y ruta.

Primer cliente: **URMA Logística**. Después, otras flotillas de 5 a 80 unidades.

## Qué hay hoy

| Parte | Dónde | Estado |
| --- | --- | --- |
| Esquema de base de datos multiempresa con seguridad por empresa (RLS) | `supabase/migrations/` | Listo, con pruebas de acceso por empresa y por rol |
| Lógica de conciliación: litros teóricos, semáforo, pesos faltantes, cuadre de tanque | `src/lib/conciliacion/` | Lista, con 15 pruebas |
| Conexión a Supabase (navegador, servidor y proxy de sesión) | `src/lib/supabase/`, `src/proxy.ts` | Lista |
| Login, registro, confirmación de correo y alta de empresa | `src/app/(acceso)/`, `src/app/auth/` | Listo |
| Roles: dueño, administración y captura | `src/lib/auth/permisos.ts` | Listo |
| Catálogos (unidades, remolques, dollies, tipos de remolque, operadores, clientes, rutas, fuentes) y parámetros | `src/app/(panel)/`, `src/lib/catalogos/` | Listo |
| Importación de catálogos (plantilla por catálogo o control de viajes) | `src/app/(panel)/catalogos/importar/`, `src/lib/importacion/` | Listo |
| Viajes: tramos, cargas, gastos, tarifa, pago al operador, cierre, bitácora y exportación | `src/app/(panel)/viajes/`, `src/lib/viajes/` | Listo |
| Usuarios (permisos; invitaciones después) | `src/app/(panel)/usuarios/` | Permisos listos |
| Costos de equipo y generales | `src/app/(panel)/costos/`, `src/lib/costos/` | Listo |
| Tablero de KPIs con comparación, rankings, alertas, tendencia y exportación | `src/app/(panel)/tablero/`, `src/lib/kpis/` | Listo |
| Usuarios con invitación por correo | — | Siguiente |
| Viajes, cargas con foto y validación, conciliación en el tablero | — | Pendiente |

## Cómo correrlo

1. Instala Node 22 o más reciente y corre `npm install`.
2. **Crea el proyecto en [Supabase](https://supabase.com/dashboard)** (New project; región
   más cercana, p. ej. `us-east-1` o `us-west-1`). Guarda la contraseña de la base.
3. **Corre las migraciones en orden** (SQL Editor → New query → pega el archivo → Run):
   1. `supabase/migrations/20261014000000_esquema_inicial.sql`
   2. `supabase/migrations/20261014000100_endurecer_seguridad.sql`
   3. `supabase/migrations/20261015000000_exigir_correo_confirmado.sql`
   4. `supabase/migrations/20261015000100_una_empresa_por_cuenta.sql`
   5. `supabase/migrations/20261015000200_rol_captura.sql`
   6. `supabase/migrations/20261015000300_catalogos.sql`
   7. `supabase/migrations/20261016000000_remolques_armados.sql`
   8. `supabase/migrations/20261016000100_autovalidacion_parametros.sql`
   9. `supabase/migrations/20261016000200_tramos_importacion.sql`
   10. `supabase/migrations/20261017000000_folios_permisos_bitacora.sql`
   11. `supabase/migrations/20261017000100_viajes.sql`
   12. `supabase/migrations/20261017000200_costos.sql`

   Nunca edites una migración ya aplicada: crea una nueva.
4. **Variables:** `cp .env.example .env.local` y llena `NEXT_PUBLIC_SUPABASE_URL` y
   `NEXT_PUBLIC_SUPABASE_ANON_KEY` (Project Settings → API). La `service_role` key **no** va aquí.
5. **Auth → URL Configuration:** *Site URL* = `http://localhost:3000` (en producción, el dominio
   de Vercel) y agrega `http://localhost:3000/auth/confirmar` a *Redirect URLs*.
6. **Auth → Sign In / Providers → Email:** deja **Confirm email encendido** y revisa que
   *Email OTP Length* sea `6` (la expiración, *Email OTP Expiration*, viene en 3600 s = 1 hora).
   Si la confirmación está apagada, Supabase da por confirmado cualquier correo sin mandar nada,
   y la app no deja entrar a nadie (lo avisa en el login).
7. **Auth → Emails → Templates → Confirm signup:** la app está hecha para confirmar con un
   **código de 6 dígitos**, no con enlace (los filtros de seguridad del correo corporativo abren
   los enlaces y los gastan antes que el usuario).

   > **Por ahora (sin SMTP propio)** Supabase no deja editar la plantilla, así que el correo trae
   > un enlace. Abrirlo confirma la cuenta; después se entra con correo y contraseña. La pantalla
   > del código lo explica en "¿Tu correo trae un enlace y no un código?". Cuando configures SMTP
   > (sección siguiente), cambia la plantilla por esta y guarda:

   - *Subject:* `Tu código para Control Diésel: {{ .Token }}`
   - *Body:*
     ```html
     <h2>Confirma tu cuenta de Control Diésel</h2>
     <p>Escribe este código en la app para confirmar tu correo:</p>
     <p style="font-size:32px;font-weight:bold;letter-spacing:8px;font-family:monospace">{{ .Token }}</p>
     <p>Vence en 1 hora. Si no creaste una cuenta, ignora este correo.</p>
     ```

   No dejes `{{ .ConfirmationURL }}` en ninguna parte: si el filtro abre ese enlace, también
   gasta el código.
8. `npm run dev` y abre http://localhost:3000 → *Crear cuenta* → escribe el código que llegó →
   da de alta la empresa → tablero. Si no llega: *Reenviar código* (o *Tengo un código* en el login).

## Roles

El operador (chofer) **no entra al sistema**: es un registro del catálogo para saber quién manejó
cada viaje y medir su rendimiento. Los usuarios son:

| Rol | Puede | No puede |
| --- | --- | --- |
| Dueño | Todo: usuarios, parámetros (tolerancia y precio del diésel), catálogos, viajes, cargas, validar, tablero y conciliación | — |
| Administración | Catálogos, viajes, cargas, validar cargas, tablero y conciliación | Administrar usuarios ni parámetros |
| Captura | Dar de alta viajes y cargas con foto del ticket o del medidor, desde computadora o celular; consultar catálogos | Editar catálogos o parámetros, validar cargas, ver cargas de otros, tablero de pesos y conciliación |

Toda carga nace **pendiente**; la valida o rechaza dueño o administración. Administración y captura
nunca revisan lo que ellos capturaron; el dueño sí puede, y la carga queda marcada como
**autovalidada**. Los parámetros (tolerancia y precio) están en una tabla que captura no puede leer.
La base de datos lo impone, no solo la pantalla.

## Antes del primer cliente externo: SMTP propio

El correo que trae Supabase es solo para pruebas: manda muy pocos correos por hora (Authentication
→ Rate Limits lo muestra) y puede negarse a enviar a direcciones que no sean del equipo del proyecto.
Con eso, tus usuarios (administración y captura) y otras empresas no recibirían su correo de confirmación.

1. Elige un proveedor de correo transaccional (Resend, Postmark, Amazon SES, SendGrid…) y
   **verifica el dominio** desde el que vas a enviar (p. ej. `notificaciones@tudominio.mx`):
   agrega en tu DNS los registros SPF, DKIM y DMARC que te dé el proveedor.
2. Crea en el proveedor una credencial SMTP (host, puerto, usuario y contraseña).
3. En Supabase: **Authentication → Emails → SMTP Settings → Enable custom SMTP**. Llena el remitente
   (correo y nombre, p. ej. "Control Diésel"), host, puerto (587 normalmente), usuario y contraseña. Guarda.
4. **Authentication → Rate Limits:** sube el límite de correos por hora a lo que esperes
   (p. ej. 100). Con el correo de Supabase ese límite no se puede subir.
5. **Authentication → Emails → Templates:** confirma que "Confirm signup" sigue usando el código
   (`{{ .Token }}`, ver paso 7 de arriba) y no un enlace.
6. Prueba: regístrate con un correo que no sea del equipo, revisa que llegue el código (y que no
   caiga en spam) y prueba *Reenviar código*.

## Unidades y armados

Una unidad es el tractocamión (número económico). Se le enganchan remolques y dolly:
**sencillo** = remolque 1; **full** = remolque 1 + dolly + remolque 2. La configuración sale
del armado vigente, no se captura. Cada cambio de armado cierra el anterior y abre uno nuevo
(`armados.desde` / `hasta`), así se sabe qué traía la unidad en cada fecha; el historial no se
edita. Un remolque o dolly no puede estar en dos unidades a la vez (lo revisa la base). Cada viaje
guarda el armado que llevó (`viajes.armado_id`).

## Rutas y tramos

Una ruta del catálogo es un tramo de **un sentido** (origen → destino) con los km de ese sentido;
la ida y el regreso son dos rutas. Un viaje tiene un tramo cargado y un tramo vacío opcional
(regreso o reposicionamiento), cada uno con su ruta. Los km se prellenan desde la ruta y son
editables; si se desvían más que la tolerancia de km de la empresa (10% por defecto, en
Parámetros) el viaje se marca para revisión (`src/lib/viajes/km.ts`).

## Viajes

Un viaje = **tramo vacío** (A → B, lugar de carga) + **tramo cargado** (B → C, lugar de descarga).
El siguiente viaje de la unidad se prellena desde C con su último odómetro; si el odómetro inicial no
coincide, la diferencia son **km sin viaje** y se pide explicación. Si un tramo se desvía de su ruta
más que la tolerancia de km, se pide motivo. Cada viaje guarda el armado que traía la unidad.

- **Folios** consecutivos por empresa (viajes, gastos y costos) con prefijo y número en Parámetros.
- **Ingreso** = flete (tarifa × toneladas facturadas, según el cliente factura por peso cargado o
  descargado; o monto fijo) + gastos que se facturan al cliente.
- **Pago al operador**: esquema por empresa, editable por operador y por viaje; cada viaje guarda lo
  que usó. Tarifa, ingreso, pago y utilidad viven en `viajes_finanzas`: sin el permiso
  "ve tarifas e ingresos" la base no los devuelve.
- **Cierre**: no con cargas pendientes ni tramos incompletos. Cerrado, nada del viaje se edita.
  Reabrir: el dueño, o administración con el permiso "puede reabrir viajes", con motivo.
- **Bitácora**: quién cambió qué campo, cuándo, valor anterior y nuevo (viaje, tramos, tarifa,
  gastos y cargas). La ven dueño y administración en la pantalla del viaje.
- Las fechas se capturan y muestran en hora del centro de México.

Los cálculos (km, flete, pago, diésel, utilidad, merma) están en `src/lib/viajes/calculos.ts`.

## Costos

Lo que no es de un viaje (mantenimiento, llantas, seguro, financiamiento, GPS, permisos, oficina…),
con folio, proveedor y comprobante. Un costo de **tracto** es de esa unidad; de **remolque o
dolly**, de la unidad que lo traía enganchado ese día (si no estaba enganchado: "equipo sin
asignar"); **sin equipo** es general y se prorratea entre las unidades activas del mes (partes
iguales o por km, en Parámetros). Se puede repartir en N meses. Cada categoría tiene "incluir en
rentabilidad"; "Sueldo y prestaciones del operador" nace apagada. Lógica en `src/lib/costos/`.

## Importar catálogos

*Catálogos → Importar desde Excel* (dueño y administración):

- **Plantilla por catálogo** (unidades, operadores, clientes, rutas): descarga la plantilla, llénala
  y súbela (.xlsx o .csv).
- **Mi control de viajes**: sube el Excel de viajes (una fila por viaje) y saca unidades, operadores,
  clientes, fuentes y rutas sin repetir. Muestra el rendimiento real por unidad como sugerencia (no
  lo guarda) y pide decidir los km de las rutas que aparecen con km distintos.

El archivo se lee en el navegador; la vista previa marca errores por fila y lo que ya existe. Al
confirmar, el servidor vuelve a validar y `importar_catalogos()` guarda todo o nada.

## Pruebas

En cada push y pull request a `main`, GitHub Actions corre `npm ci`, pruebas, tipos, lint, build
y las pruebas de RLS contra un Postgres 16 desechable (`.github/workflows/ci.yml`). Variables falsas, sin secretos.

- `npm test` — conciliación
- `npm run typecheck` y `npm run lint`
- `supabase/pruebas/correr.sh` — seguridad entre empresas y roles (requiere un Postgres local)

## Tablero de KPIs

Para dueño y administración (captura no lo ve). Filtros por meses, unidad, operador, cliente y ruta;
compara contra el periodo anterior del mismo largo. Por defecto solo cuenta viajes cerrados, en el
mes de su salida. Cada indicador muestra su fórmula (`src/lib/kpis/indicadores.ts`) y todas son
funciones puras con pruebas (`src/lib/kpis/`).

- **Costo variable** = diésel + gastos del viaje + pago al operador. **Costo total** = variable +
  costos de equipo + generales prorrateados + equipo sin asignar. **Utilidad** = ingreso − costo total.
- **Margen %** = utilidad ÷ ingreso; **utilidad sobre costo %** = utilidad ÷ costo (en el Excel
  anterior ambos se llamaban "% ROI").
- Con filtro de operador, cliente o ruta se muestra la contribución (sin costos fijos).
- Validación con el Excel de 2026: por viaje, el pago al operador (12.6 % del subtotal) y el costo
  coinciden al centavo; el costo variable/km de todo el año da 35.01 (el Excel da 34.76 porque su
  columna "Km totales" no siempre es km vacío + km cargado).

## Cómo funciona la conciliación

- **Litros teóricos** = km cargado ÷ rendimiento cargado + km vacío ÷ rendimiento vacío.
  El rendimiento de la ruta, si existe, manda sobre el de la unidad.
- **Semáforo** con la tolerancia de cada empresa (5% por defecto):
  verde dentro de tolerancia; amarillo entre 1× y 2×, o consumo muy bajo (posible carga sin registrar);
  rojo arriba de 2×.
- **Pesos faltantes** = litros de más × precio por litro.
- **Tanque propio:** lectura inicial + entradas de pipa + ajustes − despachos, contra la lectura física final.
