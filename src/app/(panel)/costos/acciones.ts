"use server";

import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { puede } from "@/lib/auth/permisos";
import { sesionDeAccion } from "@/lib/auth/sesion";
import { desglosarIva, tasaIva, type TasaIva } from "@/lib/costos/iva";
import { validarCosto } from "@/lib/costos/validacion";

export interface EstadoCosto {
  mensaje?: string;
  exito?: boolean;
  errores?: Record<string, string | undefined>;
  valores?: Record<string, string>;
  enviadoEn?: number;
}

/** Dueño, o administración con "ve costos" (la base vuelve a revisar con ve_costos()). */
async function sesionAdmin() {
  const sesion = await sesionDeAccion();
  if (!sesion) redirect("/login");
  return puede(sesion.empresa.rol, "editarCatalogos") && sesion.empresa.veCostos ? sesion : null;
}

export async function guardarCosto(_: EstadoCosto, form: FormData): Promise<EstadoCosto> {
  const v: Record<string, string> = {};
  for (const [k, x] of form.entries()) if (typeof x === "string") v[k] = x;
  const sesion = await sesionAdmin();
  if (!sesion) return { mensaje: "No tienes permiso para ver costos", valores: v };
  const r = validarCosto(v, sesion.empresa.empresaId);
  if (!r.ok) return { errores: r.errores, valores: v };
  const folio = (v.folio ?? "").trim() || null;
  const { error } = await sesion.supabase.from("costos").insert({ ...r.datos, folio, empresa_id: sesion.empresa.empresaId });
  if (error) {
    return { mensaje: error.code === "23505" ? "Ese folio ya existe" : "No se pudo guardar el costo", valores: v };
  }
  refresh();
  return { exito: true, mensaje: "Costo registrado.", enviadoEn: Date.now() };
}

/** Nada se borra: un costo equivocado se cancela (queda en la bitácora). */
export async function cancelarCosto(id: string, cancelado: boolean): Promise<string | null> {
  const sesion = await sesionAdmin();
  if (!sesion) return "No tienes permiso para ver costos";
  const { error } = await sesion.supabase.from("costos").update({ cancelado }).eq("id", id).eq("empresa_id", sesion.empresa.empresaId);
  if (error) return "No se pudo cambiar el costo";
  refresh();
  return null;
}

/** "¿Tiene factura?" de un costo ya registrado: recalcula el IVA de su total. */
export async function cambiarFacturaCosto(id: string, tieneFactura: boolean, tasa: TasaIva): Promise<string | null> {
  const sesion = await sesionAdmin();
  if (!sesion) return "No tienes permiso para ver costos";
  const { data: costo } = await sesion.supabase.from("costos").select("monto").eq("id", id).eq("empresa_id", sesion.empresa.empresaId).maybeSingle();
  if (!costo) return "No se encontró el costo";
  const t = tasaIva(tasa);
  const { iva } = desglosarIva(Number(costo.monto), tieneFactura, t);
  const { error } = await sesion.supabase.from("costos").update({ tiene_factura: tieneFactura, tasa_iva: t, iva }).eq("id", id).eq("empresa_id", sesion.empresa.empresaId);
  if (error) return "No se pudo cambiar el costo";
  refresh();
  return null;
}
