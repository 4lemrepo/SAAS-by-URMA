import { createBrowserClient } from "@supabase/ssr";
import { supabaseEnv } from "./env";

/** Cliente de Supabase para componentes que corren en el navegador. */
export function crearClienteNavegador() {
  const { url, anonKey } = supabaseEnv();
  return createBrowserClient(url, anonKey);
}
