import "server-only";
import { cacheLife } from "next/cache";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { cache } from "react";
import type { User } from "@supabase/supabase-js";
import { crearClienteServidor } from "@/lib/supabase/server";
import { supabaseEnv } from "@/lib/supabase/env";
import { destinoInicial, motivoBloqueo, type MotivoBloqueo } from "./acceso";
import { permisosFinancieros, puede, type Permiso, type PermisosFinancieros, type Rol } from "./permisos";

export type { Rol };

export interface Membresia extends PermisosFinancieros {
  empresaId: string;
  empresaNombre: string;
  rol: Rol;
  /** Puede reabrir y cancelar viajes (dueño siempre; administración si el dueño se lo dio). */
  puedeReabrir: boolean;
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
 * cache(): el layout y la página la piden en la misma petición; se consulta una vez.
 *
 * getUser() (no getClaims) porque el JWT no trae email_confirmed_at: se pregunta
 * al servidor de Auth, que además valida que la sesión siga viva.
 */
export const usuarioActual = cache(async (): Promise<UsuarioActual> => {
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
});

/** Empresas a las que pertenece el usuario (RLS: solo puede ver las suyas). */
export async function membresiasDe(
  supabase: Awaited<ReturnType<typeof crearClienteServidor>>,
  usuarioId: string,
): Promise<Membresia[]> {
  const { data: filas, error } = await supabase
    .from("miembros")
    .select("empresa_id, rol, ve_tarifas, ve_utilidades, ve_costos, puede_reabrir_viajes, empresas(nombre)")
    .eq("usuario_id", usuarioId)
    .order("creado_en");
  // Mejor fallar que tratar un error como "sin empresa" y ofrecer crear otra.
  if (error) throw new Error("No se pudieron leer las empresas del usuario");

  return (filas ?? []).map((f) => {
    const rol = f.rol as Rol;
    return {
      empresaId: f.empresa_id,
      empresaNombre: (f.empresas as unknown as { nombre: string } | null)?.nombre ?? "",
      rol,
      ...permisosFinancieros(rol, f),
      puedeReabrir: rol === "dueno" || (rol === "administracion" && f.puede_reabrir_viajes === true),
    };
  });
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

/** Para pantallas de pesos (costos…): sin el interruptor, al tablero. */
export async function usuarioQueVe(permiso: keyof PermisosFinancieros) {
  const usuario = await usuarioConEmpresa();
  if (!usuario.empresa[permiso]) redirect("/tablero");
  return usuario;
}

/** Para pantallas de un permiso (catálogos, parámetros…): sin permiso, al tablero. */
export async function usuarioConPermiso(permiso: Permiso) {
  const usuario = await usuarioConEmpresa();
  if (!puede(usuario.empresa.rol, permiso)) redirect("/tablero");
  return usuario;
}

/**
 * Para Server Actions: se pueden llamar con un POST directo, así que cada una
 * revisa sesión, correo confirmado y rol. RLS vuelve a revisar en la base.
 * Devuelve null si no hay sesión válida o el usuario no tiene empresa.
 */
export async function sesionDeAccion() {
  const supabase = await crearClienteServidor();
  const { data } = await supabase.auth.getUser();
  if (!data.user || (await bloqueoDe(data.user))) return null;
  const [empresa] = await membresiasDe(supabase, data.user.id);
  if (!empresa) return null;
  return { supabase, usuarioId: data.user.id, empresa };
}
