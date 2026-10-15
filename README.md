# Control Diésel

[![Pruebas](https://github.com/4lemrepo/SAAS-by-URMA/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/4lemrepo/SAAS-by-URMA/actions/workflows/ci.yml)

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
| Catálogos, viajes, cargas con foto y validación, tablero | — | Siguiente |

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

Toda carga nace **pendiente**; la valida o rechaza dueño o administración, nunca quien la capturó
(ni siquiera el dueño). La base de datos lo impone, no solo la pantalla.

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

## Pruebas

En cada push y pull request a `main`, GitHub Actions corre `npm ci`, pruebas, tipos, lint, build
y las pruebas de RLS contra un Postgres 16 desechable (`.github/workflows/ci.yml`). Variables falsas, sin secretos.

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
