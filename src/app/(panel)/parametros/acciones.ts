"use server";

import { redirect } from "next/navigation";
import { puede } from "@/lib/auth/permisos";
import { sesionDeAccion } from "@/lib/auth/sesion";
import { validarParametros } from "@/lib/empresa/parametros";

export interface EstadoParametros {
  mensaje?: string;
  exito?: boolean;
  errores?: Record<string, string | undefined>;
  valores?: Record<string, string>;
}

export async function guardarParametros(_: EstadoParametros, form: FormData): Promise<EstadoParametros> {
  const valores = {
    tolerancia_pct: String(form.get("tolerancia_pct") ?? ""),
    precio_diesel_litro: String(form.get("precio_diesel_litro") ?? ""),
  };
  const sesion = await sesionDeAccion();
  if (!sesion) redirect("/login");
  if (!puede(sesion.empresa.rol, "editarParametros")) return { mensaje: "Solo el dueño cambia los parámetros", valores };

  const v = validarParametros(valores);
  if (!v.ok) return { errores: v.errores, valores };

  const { data, error } = await sesion.supabase
    .from("empresas")
    .update(v.datos)
    .eq("id", sesion.empresa.empresaId)
    .select("id");
  if (error || !data?.length) return { mensaje: "No se pudieron guardar los parámetros. Intenta de nuevo.", valores };
  return { exito: true, mensaje: "Parámetros guardados.", valores };
}
