import "server-only";
import { cacheLife, cacheTag } from "next/cache";
import { redirect } from "next/navigation";
import type { User } from "@supabase/supabase-js";
import { crearClienteServidor } from "@/lib/supabase/server";
import { supabaseEnv } from "@/lib/supabase/env";
import { motivoBloqueo, type MotivoBloqueo } from "./acceso";

export type Rol = "dueno" | "administracion" | "operador";

export interface Membresia {
  empresaId: string;
  empresaNombre: string;
  rol: Rol;
}

export interface UsuarioActual {
  id: string;
  correo: string | null;
  membresias: Membresia[];
}

/** Etiqueta de caché de todo lo derivado de la sesión. Las acciones de login/alta/salida la invalidan. */
export const TAG_SESION = "sesion";

/**
 * ¿Está apagada la confirmación de correo en Supabase? Se lee de /auth/v1/settings
 * (público, con la anon key) y se cachea unos minutos en el servidor.
 * Si no se puede leer, no se bloquea por esto: sigue aplicando email_confirmed_at.
 */
export async function confirmacionApagada(): Promise<boolean> {
  "use cache";
  cacheLife("minutes");
  const { url, anonKey } = supabaseEnv();
  try {
    const r = await fetch(`${url}/auth/v1/settings`, { headers: { apikey: anonKey } });
    if (!r.ok) return false;
    const ajustes = (await r.json()) as { mailer_autoconfirm?: boolean };
    return ajustes.mailer_autoconfirm === true;
  } catch {
    return false;
  }
}

/** Motivo por el que este usuario de Auth no puede entrar, o null si puede. */
export async function bloqueoDe(usuario: User | null): Promise<MotivoBloqueo | null> {
  return motivoBloqueo(usuario, { confirmacionApagada: await confirmacionApagada() });
}

/**
 * Capa de acceso: el único lugar que lee la sesión para pintar páginas.
 *
 * "use cache: private": la validación del token compara su expiración con la
 * hora actual, y con Cache Components eso no puede correr al prerenderizar.
 * La caché privada vive solo en el navegador de este usuario y nunca en el servidor.
 *
 * getUser() (no getClaims) porque el JWT no trae email_confirmed_at: se pregunta
 * al servidor de Auth, que además valida que la sesión siga viva.
 */
export async function usuarioActual(): Promise<UsuarioActual> {
  "use cache: private";
  cacheTag(TAG_SESION);

  const supabase = await crearClienteServidor();
  const { data } = await supabase.auth.getUser();
  if (!data.user) redirect("/login");

  const bloqueo = await bloqueoDe(data.user);
  // Hay que borrar la cookie de sesión, y eso solo se puede en un Route Handler.
  if (bloqueo) redirect(`/auth/salir?motivo=${bloqueo}`);

  const { data: filas, error } = await supabase
    .from("miembros")
    .select("empresa_id, rol, empresas(nombre)")
    .eq("usuario_id", data.user.id)
    .order("creado_en");
  if (error) throw new Error("No se pudieron leer las empresas del usuario");

  return {
    id: data.user.id,
    correo: data.user.email ?? null,
    membresias: (filas ?? []).map((f) => ({
      empresaId: f.empresa_id,
      empresaNombre: (f.empresas as unknown as { nombre: string } | null)?.nombre ?? "",
      rol: f.rol as Rol,
    })),
  };
}

/** Como usuarioActual, pero exige que el usuario ya pertenezca a una empresa. */
export async function usuarioConEmpresa() {
  const usuario = await usuarioActual();
  const [empresa] = usuario.membresias;
  if (!empresa) redirect("/alta-empresa");
  return { ...usuario, empresa };
}
