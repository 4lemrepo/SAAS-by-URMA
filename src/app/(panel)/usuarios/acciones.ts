"use server";

import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { puede } from "@/lib/auth/permisos";
import { sesionDeAccion } from "@/lib/auth/sesion";

const PERMISOS = ["puede_reabrir_viajes", "ve_tarifas"] as const;

/** El dueño otorga o quita "puede reabrir viajes" y "ve tarifas e ingresos". */
export async function cambiarPermiso(usuarioId: string, permiso: string, valor: boolean): Promise<string | null> {
  const sesion = await sesionDeAccion();
  if (!sesion) redirect("/login");
  if (!puede(sesion.empresa.rol, "administrarUsuarios")) return "Solo el dueño cambia permisos";
  if (!(PERMISOS as readonly string[]).includes(permiso)) return "Permiso desconocido";
  const { data, error } = await sesion.supabase
    .from("miembros")
    .update({ [permiso]: valor })
    .eq("empresa_id", sesion.empresa.empresaId)
    .eq("usuario_id", usuarioId)
    .select("usuario_id");
  if (error || !data?.length) return "No se pudo cambiar el permiso";
  refresh();
  return null;
}
