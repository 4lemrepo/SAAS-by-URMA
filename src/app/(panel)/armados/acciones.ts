"use server";

import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { fechaDelCambio, validarArmado } from "@/lib/armados/armado";
import { puede } from "@/lib/auth/permisos";
import { sesionDeAccion } from "@/lib/auth/sesion";

export interface EstadoArmado {
  mensaje?: string;
  exito?: boolean;
  errores?: Record<string, string | undefined>;
}

/** Cambia el armado de una unidad (o la desengancha si no se elige nada). */
export async function cambiarArmado(unidadId: string, _: EstadoArmado, form: FormData): Promise<EstadoArmado> {
  const sesion = await sesionDeAccion();
  if (!sesion) redirect("/login");
  if (!puede(sesion.empresa.rol, "editarCatalogos")) return { mensaje: "Tu rol solo puede consultar el armado" };

  const v = validarArmado(form);
  if (!v.ok) return { errores: v.errores };
  const desde = fechaDelCambio(form.get("desde_iso"));
  if (!desde) return { errores: { desde: "Fecha inválida o futura" } };

  // La base revisa empalmes, equipo inactivo y que la unidad sea de la empresa.
  const { error } = await sesion.supabase.rpc("cambiar_armado", {
    p_unidad: unidadId,
    p_remolque1: v.datos.remolque1,
    p_dolly: v.datos.dolly,
    p_remolque2: v.datos.remolque2,
    p_desde: desde.toISOString(),
  });
  if (error) {
    // P0001: mensajes de cambiar_armado pensados para el usuario.
    return { mensaje: error.code === "P0001" ? error.message : "No se pudo cambiar el armado. Intenta de nuevo." };
  }
  refresh();
  return { exito: true, mensaje: v.configuracion ? "Armado guardado." : "Unidad desenganchada." };
}
