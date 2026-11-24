"use server";

import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { puede, puedeRevisarCarga } from "@/lib/auth/permisos";
import { sesionDeAccion } from "@/lib/auth/sesion";
import { claveComparacion } from "@/lib/catalogos/validacion";
import { desglosarIva, tasaIva, type TasaIva } from "@/lib/costos/iva";
import { ultimoPuntoDeUnidad } from "@/lib/viajes/datos";
import { localAIso } from "@/lib/viajes/fechas";
import { validarViaje } from "@/lib/viajes/formulario";
import { validarCarga, validarCargoAdicional, validarGasto, validarPagoViaje, validarTarifa } from "@/lib/viajes/movimientos";

export interface EstadoFormulario {
  mensaje?: string;
  exito?: boolean;
  errores?: Record<string, string | undefined>;
  valores?: Record<string, string>;
  /** Momento del último guardado exitoso: reinicia el formulario. */
  enviadoEn?: number;
}

const PATRON_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function valores(form: FormData): Record<string, string> {
  const v: Record<string, string> = {};
  for (const [k, x] of form.entries()) if (typeof x === "string") v[k] = x;
  return v;
}

/** Mensajes de la base pensados para el usuario (raise exception) o uno genérico. */
function mensajeDeError(error: { code?: string; message: string }, generico: string) {
  if (error.code === "P0001") return error.message;
  if (error.code === "23505") return "Ese folio ya existe";
  if (error.code === "42501") return "No tienes permiso para hacer eso";
  return generico;
}

async function sesionQueCaptura() {
  const sesion = await sesionDeAccion();
  if (!sesion) redirect("/login");
  return puede(sesion.empresa.rol, "capturar") ? sesion : null;
}

// ---------------------------------------------------------------------------
// Viaje
// ---------------------------------------------------------------------------

/** Alta (id null) o edición de un viaje con sus tramos. */
export async function guardarViaje(id: string | null, _: EstadoFormulario, form: FormData): Promise<EstadoFormulario> {
  const v = valores(form);
  if (id !== null && !PATRON_UUID.test(id)) return { mensaje: "Viaje no válido" };
  const sesion = await sesionQueCaptura();
  if (!sesion) return { mensaje: "Tu rol no captura viajes", valores: v };
  const { supabase: db, empresa } = sesion;
  const esAdmin = puede(empresa.rol, "editarCatalogos");

  // Fechas capturadas en hora del centro de México.
  const entrada: Record<string, string | undefined> = { ...v };
  for (const campo of ["fecha_salida", "llegada_carga", "salida_carga", "llegada_descarga", "salida_descarga"]) {
    entrada[campo] = localAIso(v[campo]);
  }

  const salida = entrada.fecha_salida;
  const anterior =
    v.unidad_id && salida && !Number.isNaN(Date.parse(salida))
      ? await ultimoPuntoDeUnidad(db, v.unidad_id, { antesDe: new Date(salida).toISOString(), excluir: id ?? undefined })
      : null;
  const [{ data: tolerancia }, { data: rutas }] = await Promise.all([
    db.rpc("tolerancia_km", { p_empresa: empresa.empresaId }),
    db.from("rutas").select("id, origen, destino, km").eq("empresa_id", empresa.empresaId).eq("activa", true),
  ]);
  const rutaDe = (origen?: string, destino?: string) =>
    (rutas ?? []).find(
      (r) => claveComparacion(r.origen) === claveComparacion(origen) && claveComparacion(r.destino) === claveComparacion(destino),
    );
  const rutaVacio = rutaDe(v.origen, v.lugar_carga);
  const rutaCargado = rutaDe(v.lugar_carga, v.lugar_descarga);

  const r = validarViaje(entrada, {
    odometroAnterior: anterior?.odometro ?? null,
    kmRuta: { vacio: rutaVacio ? Number(rutaVacio.km) : null, cargado: rutaCargado ? Number(rutaCargado.km) : null },
    toleranciaKmPct: Number(tolerancia ?? 10),
  });
  if (!r.ok) return { errores: r.errores, valores: v, mensaje: "Revisa los campos marcados" };

  // El viaje guarda el armado que traía la unidad al salir.
  const { data: armado } = await db
    .from("armados")
    .select("id")
    .eq("unidad_id", r.viaje.unidad_id)
    .lte("desde", r.viaje.fecha_salida)
    .or(`hasta.is.null,hasta.gt.${r.viaje.fecha_salida}`)
    .maybeSingle();

  const { data: viajeId, error } = await db.rpc("guardar_viaje", {
    p_id: id,
    p_viaje: {
      ...r.viaje,
      empresa_id: empresa.empresaId,
      armado_id: armado?.id ?? null,
      // Folio a mano solo dueño o administración; vacío = consecutivo.
      folio: esAdmin ? (v.folio ?? "").trim() : "",
    },
    p_tramos: r.tramos.map((t) => ({
      ...t,
      ruta_id: (t.tipo === "vacio" ? rutaVacio : rutaCargado)?.id ?? null,
    })),
  });
  if (error) return { mensaje: mensajeDeError(error, "No se pudo guardar el viaje. Intenta de nuevo."), valores: v };

  // Rutas nuevas que pidió guardar (solo quien edita catálogos).
  if (esAdmin) {
    for (const t of r.tramos) {
      const yaExiste = t.tipo === "vacio" ? rutaVacio : rutaCargado;
      if (!yaExiste && v[`guardar_ruta_${t.tipo}`] === "on" && t.odometro_final > t.odometro_inicial) {
        await db.from("rutas").insert({
          empresa_id: empresa.empresaId,
          origen: t.origen,
          destino: t.destino,
          km: t.odometro_final - t.odometro_inicial,
        });
      }
    }
  }
  redirect(`/viajes/${viajeId}`);
}

/** Cerrar: la base revisa que no haya cargas pendientes y que estén los dos tramos. */
export async function cerrarViaje(id: string): Promise<string | null> {
  const sesion = await sesionDeAccion();
  if (!sesion) redirect("/login");
  if (!puede(sesion.empresa.rol, "cerrarViajes")) return "Solo dueño y administración cierran viajes";
  const { data, error } = await sesion.supabase
    .from("viajes")
    .update({ estado: "cerrado" })
    .eq("id", id)
    .eq("empresa_id", sesion.empresa.empresaId)
    .select("id");
  if (error) return mensajeDeError(error, "No se pudo cerrar el viaje");
  if (!data?.length) return "No se encontró el viaje";
  refresh();
  return null;
}

export async function reabrirViaje(id: string, _: EstadoFormulario, form: FormData): Promise<EstadoFormulario> {
  const sesion = await sesionDeAccion();
  if (!sesion) redirect("/login");
  if (!sesion.empresa.puedeReabrir) return { mensaje: "No tienes permiso para reabrir viajes" };
  const motivo = String(form.get("motivo") ?? "").trim();
  if (motivo.length < 5) return { errores: { motivo: "Escribe el motivo (mínimo 5 caracteres)" } };
  const { error } = await sesion.supabase.rpc("reabrir_viaje", { p_viaje: id, p_motivo: motivo });
  if (error) return { mensaje: mensajeDeError(error, "No se pudo reabrir el viaje") };
  refresh();
  return { exito: true, mensaje: "Viaje reabierto." };
}

/** Cancelar un viaje abierto con motivo (dueño o quien puede reabrir). No se borra. */
export async function cancelarViaje(id: string, _: EstadoFormulario, form: FormData): Promise<EstadoFormulario> {
  const sesion = await sesionDeAccion();
  if (!sesion) redirect("/login");
  if (!sesion.empresa.puedeReabrir) return { mensaje: "No tienes permiso para cancelar viajes" };
  const motivo = String(form.get("motivo") ?? "").trim();
  if (motivo.length < 5) return { errores: { motivo: "Escribe el motivo (mínimo 5 caracteres)" } };
  const { error } = await sesion.supabase.rpc("cancelar_viaje", { p_viaje: id, p_motivo: motivo });
  if (error) return { mensaje: mensajeDeError(error, "No se pudo cancelar el viaje") };
  refresh();
  return { exito: true, mensaje: "Viaje cancelado." };
}

// ---------------------------------------------------------------------------
// Tarifa y pago al operador (solo quien ve tarifas)
// ---------------------------------------------------------------------------

/**
 * Tarifa (quien ve tarifas) y pago al operador (quien ve utilidades). Sin
 * "ve utilidades", el viaje toma el pago por defecto del operador o de la
 * empresa (lo pone la base al guardar la tarifa).
 */
export async function guardarFinanzas(viajeId: string, _: EstadoFormulario, form: FormData): Promise<EstadoFormulario> {
  const v = valores(form);
  const sesion = await sesionDeAccion();
  if (!sesion) redirect("/login");
  const { veTarifas, veUtilidades, empresaId } = sesion.empresa;
  if (!veTarifas) return { mensaje: "No tienes permiso para ver tarifas e ingresos" };
  const tarifa = validarTarifa(v);
  const pago = veUtilidades ? validarPagoViaje(v) : null;
  const errores = { ...(tarifa.ok ? {} : tarifa.errores), ...(pago && !pago.ok ? pago.errores : {}) };
  if (!tarifa.ok || (pago && !pago.ok)) return { errores, valores: v };
  const { error } = await sesion.supabase.from("viajes_finanzas").upsert({ viaje_id: viajeId, empresa_id: empresaId, ...tarifa.datos });
  if (error) return { mensaje: mensajeDeError(error, "No se pudo guardar la tarifa"), valores: v };
  if (pago?.ok) {
    const { error: e2 } = await sesion.supabase.from("viajes_pago").upsert({ viaje_id: viajeId, empresa_id: empresaId, ...pago.datos });
    if (e2) return { mensaje: mensajeDeError(e2, "Se guardó la tarifa, pero no el pago al operador"), valores: v };
  }
  refresh();
  return { exito: true, mensaje: veUtilidades ? "Tarifa y pago guardados." : "Tarifa guardada." };
}

// ---------------------------------------------------------------------------
// Gastos
// ---------------------------------------------------------------------------

export async function guardarGasto(viajeId: string, _: EstadoFormulario, form: FormData): Promise<EstadoFormulario> {
  const v = valores(form);
  const sesion = await sesionQueCaptura();
  if (!sesion) return { mensaje: "Tu rol no captura gastos", valores: v };
  const r = validarGasto(v, sesion.empresa.empresaId);
  if (!r.ok) return { errores: r.errores, valores: v };
  const folio = puede(sesion.empresa.rol, "editarCatalogos") ? (v.folio ?? "").trim() || null : null;
  const { error } = await sesion.supabase
    .from("gastos_viaje")
    .insert({ ...r.datos, folio, viaje_id: viajeId, empresa_id: sesion.empresa.empresaId });
  if (error) return { mensaje: mensajeDeError(error, "No se pudo guardar el gasto"), valores: v };
  refresh();
  return { exito: true, mensaje: "Gasto agregado.", enviadoEn: Date.now() };
}

/** Nada se borra: un gasto equivocado se cancela y queda en la bitácora. */
export async function cancelarGasto(id: string, cancelado: boolean): Promise<string | null> {
  const sesion = await sesionQueCaptura();
  if (!sesion) return "Tu rol no captura gastos";
  const { error } = await sesion.supabase.from("gastos_viaje").update({ cancelado }).eq("id", id);
  if (error) return mensajeDeError(error, "No se pudo cambiar el gasto");
  refresh();
  return null;
}

/** "¿Tiene factura?" de un gasto ya capturado: recalcula el IVA de su total. */
export async function cambiarFacturaGasto(id: string, tieneFactura: boolean, tasa: TasaIva): Promise<string | null> {
  const sesion = await sesionQueCaptura();
  if (!sesion) return "Tu rol no captura gastos";
  const { data: gasto } = await sesion.supabase.from("gastos_viaje").select("monto").eq("id", id).maybeSingle();
  if (!gasto) return "No se encontró el gasto";
  const t = tasaIva(tasa);
  const { iva } = desglosarIva(Number(gasto.monto), tieneFactura, t);
  const { error } = await sesion.supabase.from("gastos_viaje").update({ tiene_factura: tieneFactura, tasa_iva: t, iva }).eq("id", id);
  if (error) return mensajeDeError(error, "No se pudo cambiar el gasto");
  refresh();
  return null;
}

// ---------------------------------------------------------------------------
// Cargos adicionales al cliente (solo quien ve tarifas)
// ---------------------------------------------------------------------------

export async function guardarCargoAdicional(viajeId: string, _: EstadoFormulario, form: FormData): Promise<EstadoFormulario> {
  const v = valores(form);
  const sesion = await sesionDeAccion();
  if (!sesion) redirect("/login");
  if (!sesion.empresa.veTarifas) return { mensaje: "No tienes permiso para ver tarifas e ingresos" };
  const r = validarCargoAdicional(v);
  if (!r.ok) return { errores: r.errores, valores: v };
  const { error } = await sesion.supabase
    .from("cargos_adicionales")
    .insert({ ...r.datos, viaje_id: viajeId, empresa_id: sesion.empresa.empresaId });
  if (error) return { mensaje: mensajeDeError(error, "No se pudo guardar el cargo"), valores: v };
  refresh();
  return { exito: true, mensaje: "Cargo agregado.", enviadoEn: Date.now() };
}

/** Nada se borra: un cargo equivocado se cancela y queda en la bitácora. */
export async function cancelarCargoAdicional(id: string, cancelado: boolean): Promise<string | null> {
  const sesion = await sesionDeAccion();
  if (!sesion) redirect("/login");
  if (!sesion.empresa.veTarifas) return "No tienes permiso para ver tarifas e ingresos";
  const { error } = await sesion.supabase.from("cargos_adicionales").update({ cancelado }).eq("id", id);
  if (error) return mensajeDeError(error, "No se pudo cambiar el cargo");
  refresh();
  return null;
}

// ---------------------------------------------------------------------------
// Cargas de diésel
// ---------------------------------------------------------------------------

export async function guardarCarga(viajeId: string, _: EstadoFormulario, form: FormData): Promise<EstadoFormulario> {
  const v = valores(form);
  const sesion = await sesionQueCaptura();
  if (!sesion) return { mensaje: "Tu rol no captura cargas", valores: v };
  const r = validarCarga({ ...v, fecha: localAIso(v.fecha) }, sesion.empresa.empresaId);
  if (!r.ok) return { errores: r.errores, valores: v };
  const { data: viaje } = await sesion.supabase.from("viajes").select("unidad_id, operador_id").eq("id", viajeId).maybeSingle();
  if (!viaje) return { mensaje: "No se encontró el viaje", valores: v };
  const { error } = await sesion.supabase.from("cargas_diesel").insert({
    ...r.datos,
    viaje_id: viajeId,
    empresa_id: sesion.empresa.empresaId,
    unidad_id: viaje.unidad_id,
    operador_id: viaje.operador_id,
  });
  if (error) return { mensaje: mensajeDeError(error, "No se pudo guardar la carga"), valores: v };
  refresh();
  return { exito: true, mensaje: "Carga agregada. Queda pendiente hasta que se valide.", enviadoEn: Date.now() };
}

/** "¿Tiene factura?" de una carga ya capturada: recalcula el IVA de su importe. */
export async function cambiarFacturaCarga(id: string, tieneFactura: boolean, tasa: TasaIva): Promise<string | null> {
  const sesion = await sesionQueCaptura();
  if (!sesion) return "Tu rol no captura cargas";
  const { data: carga } = await sesion.supabase.from("cargas_diesel").select("importe").eq("id", id).maybeSingle();
  if (!carga) return "No se encontró la carga";
  const t = tasaIva(tasa);
  const iva = carga.importe === null ? 0 : desglosarIva(Number(carga.importe), tieneFactura, t).iva;
  const { data, error } = await sesion.supabase
    .from("cargas_diesel")
    .update({ tiene_factura: tieneFactura, tasa_iva: t, iva })
    .eq("id", id)
    .select("id");
  if (error) return mensajeDeError(error, "No se pudo cambiar la carga");
  if (!data?.length) return "No puedes cambiar esta carga";
  refresh();
  return null;
}

/** Validar o rechazar. La base impide que administración revise lo que capturó. */
export async function revisarCarga(id: string, estado: "validada" | "rechazada"): Promise<string | null> {
  const sesion = await sesionDeAccion();
  if (!sesion) redirect("/login");
  const { data: carga } = await sesion.supabase.from("cargas_diesel").select("capturado_por, estado").eq("id", id).maybeSingle();
  if (!carga) return "No se encontró la carga";
  if (!puedeRevisarCarga(sesion.empresa.rol, sesion.usuarioId, { capturadoPor: carga.capturado_por, estado: carga.estado })) {
    return "No puedes revisar esta carga";
  }
  const { error } = await sesion.supabase.from("cargas_diesel").update({ estado }).eq("id", id);
  if (error) return mensajeDeError(error, "No se pudo revisar la carga");
  refresh();
  return null;
}
