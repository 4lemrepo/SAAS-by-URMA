import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { supabaseEnv } from "./env";

/** Rutas que no piden sesión. Todo lo demás manda a /login. */
const RUTAS_PUBLICAS = ["/", "/login", "/registro", "/verificar", "/auth/confirmar", "/auth/salir"];
/** Con sesión iniciada no tiene sentido volver a estas. */
const RUTAS_SOLO_SIN_SESION = ["/login", "/registro", "/verificar"];

/**
 * Refresca la sesión de Supabase en cada petición (rota el token y reescribe cookies)
 * y hace la revisión optimista de acceso. La autorización real vive en RLS y en
 * cada Server Action; esto solo evita mostrar pantallas a quien no inició sesión.
 */
export async function actualizarSesion(request: NextRequest) {
  let response = NextResponse.next({ request });
  const { url, anonKey } = supabaseEnv();

  const supabase = createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) =>
          response.cookies.set(name, value, options),
        );
      },
    },
  });

  // getClaims valida la firma del JWT; no confiar en getSession() en el servidor.
  // No poner código entre createServerClient y esta llamada.
  const { data } = await supabase.auth.getClaims();
  const conSesion = Boolean(data?.claims?.sub);
  const ruta = request.nextUrl.pathname;

  const redirigir = (destino: string, siguiente?: string) => {
    const destinoUrl = request.nextUrl.clone();
    destinoUrl.pathname = destino;
    destinoUrl.search = siguiente ? `?siguiente=${encodeURIComponent(siguiente)}` : "";
    const r = NextResponse.redirect(destinoUrl);
    // Conserva las cookies de sesión recién refrescadas.
    response.cookies.getAll().forEach((c) => r.cookies.set(c));
    return r;
  };

  if (!conSesion && !RUTAS_PUBLICAS.includes(ruta)) {
    return redirigir("/login", ruta + request.nextUrl.search);
  }
  if (conSesion && RUTAS_SOLO_SIN_SESION.includes(ruta)) {
    return redirigir("/tablero");
  }
  return response;
}
