"use server";

import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { puede } from "@/lib/auth/permisos";
import { sesionDeAccion } from "@/lib/auth/sesion";
import { leerContextoImportacion } from "@/lib/importacion/datos";
import { armarCostos, armarViajes, type FilaCostoHistorico, type FilaHistorica } from "@/lib/importacion/historico";

export type ResultadoImportacionHistorica =
  | { ok: true; viajes: number; omitidos: number; costos: number; costosOmitidos: number }
  | { ok: false; mensaje: string };

/**
 * Máximos por importación (protegen al servidor de archivos enormes y caben en
 * el límite de 1 MB de una Server Action). Un control más grande se importa por partes.
 */
const MAXIMO_VIAJES = 1200;
const MAXIMO_COSTOS = 3000;

/**
 * Guarda una importación de históricos completa o nada. El navegador ya
 * mostró la vista previa, pero aquí se arma todo otra vez contra lo que hay en
 * la base: una acción del servidor se puede llamar sin pasar por la pantalla.
 */
export async function importarHistorico(entrada: {
  archivo: string;
  anio: number;
  viajes: FilaHistorica[];
  costos: FilaCostoHistorico[];
}): Promise<ResultadoImportacionHistorica> {
  const sesion = await sesionDeAccion();
  if (!sesion) redirect("/login");
  if (!puede(sesion.empresa.rol, "importarHistorico")) return { ok: false, mensaje: "Solo el dueño importa viajes históricos" };
  const viajes = Array.isArray(entrada?.viajes) ? entrada.viajes : [];
  const costos = Array.isArray(entrada?.costos) ? entrada.costos : [];
  const archivo = String(entrada?.archivo ?? "").trim().slice(0, 200) || "Excel";
  const anio = Number(entrada?.anio);
  if (!viajes.length && !costos.length) return { ok: false, mensaje: "No hay nada que importar" };
  if (viajes.length > MAXIMO_VIAJES || costos.length > MAXIMO_COSTOS) {
    return {
      ok: false,
      mensaje: `Son demasiados renglones (máximo ${MAXIMO_VIAJES} viajes y ${MAXIMO_COSTOS} costos por importación): divide el archivo por periodos`,
    };
  }
  if (!Number.isInteger(anio) || anio < 2000 || anio > 2100) return { ok: false, mensaje: "Año de los costos inválido" };

  const { supabase: db, empresa } = sesion;
  let datos: { archivo: string; viajes: unknown[]; costos: unknown[] };
  try {
    const ctx = await leerContextoImportacion(db, empresa.empresaId);
    const rv = armarViajes(viajes, { archivo, ...ctx });
    const conError = rv.previas.find((p) => p.estado === "error");
    if (conError) return { ok: false, mensaje: `Fila ${conError.fila}: ${conError.errores[0]}. No se guardó nada.` };
    const rc = armarCostos(costos, { archivo, anio, unidades: ctx.unidades, existentes: ctx.costosExistentes });
    const costoConError = rc.find((p) => p.estado === "error");
    if (costoConError) return { ok: false, mensaje: `Costos, fila ${costoConError.fila}: ${costoConError.errores[0]}. No se guardó nada.` };
    datos = {
      archivo,
      viajes: rv.previas.flatMap((p) => (p.viaje ? [p.viaje] : [])),
      costos: rc.flatMap((p) => (p.costo ? [p.costo] : [])),
    };
  } catch {
    return { ok: false, mensaje: "No se pudo revisar el archivo contra tus datos. Vuelve a subirlo." };
  }
  if (!datos.viajes.length && !datos.costos.length) return { ok: false, mensaje: "Todo lo del archivo ya existe: no hay nada nuevo" };

  const { data, error } = await db.rpc("importar_historico", { p_empresa: empresa.empresaId, p_lote: datos });
  if (error) {
    if (error.code === "P0001") return { ok: false, mensaje: `${error.message}. No se guardó nada.` };
    if (error.code === "23505") return { ok: false, mensaje: "Alguien capturó uno de estos folios mientras importabas. No se guardó nada; vuelve a subir el archivo." };
    if (error.code === "42501") return { ok: false, mensaje: "No tienes permiso para importar" };
    return { ok: false, mensaje: "No se pudo importar. No se guardó nada." };
  }
  const r = data as { viajes: number; omitidos: number; costos: number; costos_omitidos: number };
  refresh();
  return { ok: true, viajes: r.viajes, omitidos: r.omitidos, costos: r.costos, costosOmitidos: r.costos_omitidos };
}

export interface EstadoAnular {
  mensaje?: string;
  exito?: boolean;
}

/** Anular una importación: cancela sus viajes y costos (nada se borra) y libera sus folios. */
export async function anularLote(loteId: string, _: EstadoAnular, form: FormData): Promise<EstadoAnular> {
  const sesion = await sesionDeAccion();
  if (!sesion) redirect("/login");
  if (!puede(sesion.empresa.rol, "importarHistorico")) return { mensaje: "Solo el dueño anula importaciones" };
  if (!/^[0-9a-f-]{36}$/i.test(loteId)) return { mensaje: "Importación no válida" };
  const motivo = String(form.get("motivo") ?? "").trim();
  if (motivo.length < 5) return { mensaje: "Escribe el motivo (mínimo 5 caracteres)" };
  const { error } = await sesion.supabase.rpc("anular_lote", { p_lote: loteId, p_motivo: motivo });
  if (error) return { mensaje: error.code === "P0001" ? error.message : "No se pudo anular la importación" };
  refresh();
  return { exito: true, mensaje: "Importación anulada: sus viajes y costos quedaron cancelados." };
}
