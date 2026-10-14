import "server-only";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { supabaseEnv } from "./env";

/**
 * Cliente de Supabase para Server Components, Server Actions y Route Handlers.
 * Usa la sesión del usuario (cookies), así que Row Level Security aplica siempre:
 * cada usuario solo ve los datos de su empresa.
 */
export async function crearClienteServidor() {
  const cookieStore = await cookies();
  const { url, anonKey } = supabaseEnv();

  return createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options),
          );
        } catch {
          // Llamado desde un Server Component: ahí no se pueden escribir cookies.
          // No pasa nada: src/proxy.ts refresca la sesión en cada petición.
        }
      },
    },
  });
}
