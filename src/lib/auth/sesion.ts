import "server-only";
import { cacheLife } from "next/cache";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import type { User } from "@supabase/supabase-js";
import { crearClienteServidor } from "@/lib/supabase/server";
import { supabaseEnv } from "@/lib/supabase/env";
import { destinoInicial, motivoBloqueo, type MotivoBloqueo } from "./acceso";
import type { Rol } from "./permisos";

export type { Rol };

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
 * connection(): la sesión y las empresas se leen en cada petición, nunca se
 * prerenderizan ni se cachean. Validar el token compara su expiración con la
 * hora actual (Date.now), y Cache Components no permite eso al prerenderizar.
 * No usar "use cache: private": guardaría las empresas en el navegador y, tras
 * el alta, el tablero podría seguir viendo "sin empresa".
 *
 * getUser() (no getClaims) porque el JWT no trae email_confirmed_at: se pregunta
 * al servidor de Auth, que además valida que la sesión siga viva.
 */
export async function usuarioActual(): Promise<UsuarioActual> {
  await connection();

  const supabase = await crearClienteServidor();
  const { data } = await supabase.auth.getUser();
  if (!data.user) redirect("/login");

  const bloqueo = await bloqueoDe(data.user);
  // Hay que borrar la cookie de sesión, y eso solo se puede en un Route Handler.
  if (bloqueo) redirect(`/auth/salir?motivo=${bloqueo}`);

  return {
    id: data.user.id,
    correo: data.user.email ?? null,
    membresias: await membresiasDe(supabase, data.user.id),
  };
}

/** Empresas a las que pertenece el usuario (RLS: solo puede ver las suyas). */
export async function membresiasDe(
  supabase: Awaited<ReturnType<typeof crearClienteServidor>>,
  usuarioId: string,
): Promise<Membresia[]> {
  const { data: filas, error } = await supabase
    .from("miembros")
    .select("empresa_id, rol, empresas(nombre)")
    .eq("usuario_id", usuarioId)
    .order("creado_en");
  // Mejor fallar que tratar un error como "sin empresa" y ofrecer crear otra.
  if (error) throw new Error("No se pudieron leer las empresas del usuario");

  return (filas ?? []).map((f) => ({
    empresaId: f.empresa_id,
    empresaNombre: (f.empresas as unknown as { nombre: string } | null)?.nombre ?? "",
    rol: f.rol as Rol,
  }));
}

/** Para el tablero y demás pantallas internas: sin empresa, al alta. */
export async function usuarioConEmpresa() {
  const usuario = await usuarioActual();
  const [empresa] = usuario.membresias;
  if (!empresa) redirect(destinoInicial(usuario.membresias));
  return { ...usuario, empresa };
}

/** Para el alta de empresa: si ya tiene una, al tablero (evita crear otra por accidente). */
export async function usuarioSinEmpresa() {
  const usuario = await usuarioActual();
  if (destinoInicial(usuario.membresias) === "/tablero") redirect("/tablero");
  return usuario;
}
