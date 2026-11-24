"use server";

import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { puede } from "@/lib/auth/permisos";
import { sesionDeAccion } from "@/lib/auth/sesion";

const PERMISOS = ["puede_reabrir_viajes", "ve_tarifas", "ve_utilidades", "ve_costos"] as const;

/**
 * El dueño otorga o quita "puede reabrir viajes", "ve tarifas e ingresos",
 * "ve utilidades" y "ve costos". "Ve utilidades" necesita "ve tarifas": prender
 * el primero prende el segundo, y apagar tarifas apaga utilidades.
 */
export async function cambiarPermiso(usuarioId: string, permiso: string, valor: boolean): Promise<string | null> {
  const sesion = await sesionDeAccion();
  if (!sesion) redirect("/login");
  if (!puede(sesion.empresa.rol, "administrarUsuarios")) return "Solo el dueño cambia permisos";
  if (!(PERMISOS as readonly string[]).includes(permiso)) return "Permiso desconocido";
  const cambios: Record<string, boolean> = { [permiso]: valor };
  if (permiso === "ve_utilidades" && valor) cambios.ve_tarifas = true;
  if (permiso === "ve_tarifas" && !valor) cambios.ve_utilidades = false;
  const { data, error } = await sesion.supabase
    .from("miembros")
    .update(cambios)
    .eq("empresa_id", sesion.empresa.empresaId)
    .eq("usuario_id", usuarioId)
    .select("usuario_id");
  if (error || !data?.length) return "No se pudo cambiar el permiso";
  refresh();
  return null;
}
