import "server-only";
import { litrosTeoricos, rendimientoEsperado } from "@/lib/conciliacion";
import type { ArmadoHistorico, Costo } from "@/lib/costos/asignacion";
import { sumarMeses } from "@/lib/costos/asignacion";
import { crearClienteServidor } from "@/lib/supabase/server";
import { leerViajes, paginar, type ViajeCompleto } from "@/lib/viajes/datos";
import { revisarKm } from "@/lib/viajes/km";
import type { EntradaKpis, ViajeKpi } from "./index";

type ClienteSupabase = Awaited<ReturnType<typeof crearClienteServidor>>;

const ultimoDia = (mes: string) => {
  const [a, m] = mes.split("-").map(Number);
  return `${mes}-${String(new Date(Date.UTC(a, m, 0)).getUTCDate()).padStart(2, "0")}`;
};

/**
 * Todo lo que necesitan los KPIs de `desdeMes` a `hastaMes` ("aaaa-mm"),
 * más los 12 meses anteriores (comparación y tendencia). Solo para dueño y
 * administración (ven tarifas y costos).
 */
export async function cargarEntradaKpis(empresaId: string, desdeMes: string, hastaMes: string): Promise<EntradaKpis> {
  const db = await crearClienteServidor();
  const inicio = sumarMeses(`${desdeMes}-01`, -12);
  const permisos = { veTarifas: true, esAdmin: true };
  const [delRango, abiertos, unidades, rutas, operadores, clientes, costos, categorias, armados, parametros] = await Promise.all([
    leerViajes(empresaId, { desde: `${inicio}-01`, hasta: ultimoDia(hastaMes) }, permisos, db),
    // Todos los abiertos, para la alerta de viajes con muchos días.
    leerViajes(empresaId, { estado: "abierto" }, permisos, db),
    db.from("unidades").select("id, numero_economico, activa, rend_cargado_kml, rend_vacio_kml").eq("empresa_id", empresaId),
    db.from("rutas").select("id, rend_cargado_kml, rend_vacio_kml").eq("empresa_id", empresaId),
    db.from("operadores").select("id, nombre").eq("empresa_id", empresaId),
    db.from("clientes").select("id, nombre").eq("empresa_id", empresaId),
    // Un costo de hasta 60 meses atrás puede seguir aplicando.
    paginar<{ fecha: string; mes: string; meses: number; monto: number; iva: number; categoria_id: string; unidad_id: string | null; remolque_id: string | null; dolly_id: string | null; cancelado: boolean }>((d, h) =>
      db.from("costos").select("fecha, mes, meses, monto, iva, categoria_id, unidad_id, remolque_id, dolly_id, cancelado").eq("empresa_id", empresaId).gte("mes", `${sumarMeses(`${inicio}-01`, -59)}-01`).lte("mes", `${hastaMes}-01`).order("id").range(d, h),
    ).then((data) => ({ data, error: null })),
    db.from("categorias_costo").select("id, nombre, incluir_en_rentabilidad").eq("empresa_id", empresaId),
    paginar<{ unidad_id: string; remolque1_id: string; dolly_id: string | null; remolque2_id: string | null; desde: string; hasta: string | null }>((d, h) =>
      db.from("armados").select("unidad_id, remolque1_id, dolly_id, remolque2_id, desde, hasta").eq("empresa_id", empresaId).order("id").range(d, h),
    ).then((data) => ({ data, error: null })),
    db.from("parametros_empresa").select("*").eq("empresa_id", empresaId).single(),
  ]);
  for (const r of [unidades, rutas, operadores, clientes, costos, categorias, armados, parametros]) {
    if (r.error) throw new Error("No se pudieron leer los datos del tablero");
  }
  const p = parametros.data as Record<string, number | string | null>;
  const toleranciaKm = Number(p.tolerancia_km_pct ?? 10);
  const unidadPorId = new Map((unidades.data ?? []).map((u) => [u.id as string, u]));
  const rutaPorId = new Map((rutas.data ?? []).map((r) => [r.id as string, r]));

  const vistos = new Set<string>();
  const viajes = [...delRango, ...abiertos].filter((v) => !vistos.has(v.id) && vistos.add(v.id)).map((v) => aViajeKpi(v, unidadPorId, rutaPorId, toleranciaKm));

  return {
    viajes,
    unidades: (unidades.data ?? []).map((u) => ({ id: u.id, nombre: u.numero_economico, activa: u.activa })),
    nombres: {
      operadores: Object.fromEntries((operadores.data ?? []).map((o) => [o.id, o.nombre])),
      clientes: Object.fromEntries((clientes.data ?? []).map((c) => [c.id, c.nombre])),
    },
    costos: (costos.data ?? []).map(
      (c): Costo => ({
        fecha: c.fecha,
        mes: c.mes,
        meses: c.meses,
        // Costo real (sin IVA acreditable) y lo pagado, para "mostrar con IVA".
        monto: Math.round((Number(c.monto) - Number(c.iva ?? 0)) * 100) / 100,
        total: Number(c.monto),
        categoriaId: c.categoria_id,
        unidadId: c.unidad_id,
        remolqueId: c.remolque_id,
        dollyId: c.dolly_id,
        cancelado: c.cancelado,
      }),
    ),
    armados: (armados.data ?? []).map(
      (a): ArmadoHistorico => ({
        unidadId: a.unidad_id,
        remolque1Id: a.remolque1_id,
        dollyId: a.dolly_id,
        remolque2Id: a.remolque2_id,
        desde: a.desde,
        hasta: a.hasta,
      }),
    ),
    incluirCategoria: Object.fromEntries((categorias.data ?? []).map((c) => [c.id, c.incluir_en_rentabilidad])),
    nombreCategoriaCosto: Object.fromEntries((categorias.data ?? []).map((c) => [c.id, c.nombre])),
    metodoProrrateo: p.prorrateo_generales === "km" ? "km" : "partes_iguales",
    parametros: {
      toleranciaPct: Number(p.tolerancia_pct ?? 5),
      precioDiesel: p.precio_diesel_litro === null ? null : Number(p.precio_diesel_litro),
      diasAlertaViajeAbierto: Number(p.dias_alerta_viaje_abierto ?? 5),
      horasLimiteEstadia: Number(p.horas_limite_estadia ?? 6),
    },
    ahora: new Date().toISOString(),
  };
}

type Rend = { rend_cargado_kml: number | null; rend_vacio_kml: number | null };

function aViajeKpi(v: ViajeCompleto, unidades: Map<string, Rend>, rutas: Map<string, Rend>, toleranciaKm: number): ViajeKpi {
  const r = v.resumen;
  const cargado = v.tramos.find((t) => t.tipo === "cargado");
  const u = unidades.get(v.unidad_id);
  const ruta = cargado?.ruta_id ? rutas.get(cargado.ruta_id) : undefined;
  const rend = rendimientoEsperado(
    { cargado: num(u?.rend_cargado_kml), vacio: num(u?.rend_vacio_kml) },
    ruta ? { cargado: num(ruta.rend_cargado_kml), vacio: num(ruta.rend_vacio_kml) } : null,
  );
  const tarifaPorTonelada =
    v.finanzas && r.flete !== null
      ? v.finanzas.tipo_tarifa === "por_tonelada"
        ? Number(v.finanzas.tarifa)
        : r.toneladasFacturadas
          ? r.flete / r.toneladasFacturadas
          : null
      : null;
  return {
    id: v.id,
    folio: v.folio,
    estado: v.estado,
    fechaSalida: v.fecha_salida,
    fechaLlegada: v.fecha_llegada,
    llegadaCarga: v.llegada_carga,
    salidaCarga: v.salida_carga,
    llegadaDescarga: v.llegada_descarga,
    salidaDescarga: v.salida_descarga,
    unidadId: v.unidad_id,
    operadorId: v.operador_id,
    clienteId: v.cliente_id,
    ruta: cargado ? `${cargado.origen} → ${cargado.destino}` : null,
    kmVacio: r.kmVacio,
    kmCargado: r.kmCargado,
    kmSinViaje: Number(v.km_sin_viaje),
    toneladasCargadas: num(v.toneladas_cargadas),
    toneladasDescargadas: num(v.toneladas_descargadas),
    toneladasFacturadas: r.toneladasFacturadas,
    tarifaPorTonelada,
    ingreso: r.ingreso,
    costoDiesel: r.costoDiesel,
    litros: r.litros,
    litrosTeoricos: rend ? litrosTeoricos({ cargado: r.kmCargado, vacio: r.kmVacio }, rend) : null,
    gastosPorCategoria: r.gastosPorCategoria,
    gastosViaje: r.gastosCosto,
    pagoOperador: r.pagoOperador,
    costoVariable: r.costoVariable,
    conIva: {
      costoDiesel: r.dieselTotal,
      gastosPorCategoria: r.gastosPorCategoriaConIva,
      gastosViaje: r.gastosTotal,
      costoVariable: r.costoVariableConIva,
    },
    mermaToneladas: r.mermaToneladas,
    mermaPesos: r.mermaPesos,
    desvios: v.tramos
      .filter((t) => revisarKm(Number(t.km), num(t.km_ruta), toleranciaKm).revisar)
      .map((t) => ({ conMotivo: !!t.motivo_desvio })),
  };
}

const num = (x: unknown) => (x === null || x === undefined ? null : Number(x));

export type { ClienteSupabase };
