/**
 * Filas para exportar viajes a Excel. Sin permiso de tarifas no salen tarifa,
 * ingreso, pago al operador ni utilidad.
 */
import type { ResumenViaje } from "./calculos";
import { formatearFechaHora } from "./fechas";

export interface ViajeParaExportar {
  folio: string;
  estado: string;
  fecha_salida: string;
  fecha_llegada: string | null;
  unidad: string;
  armado: string;
  operador: string;
  cliente: string | null;
  producto: string | null;
  toneladas_cargadas: number | null;
  toneladas_descargadas: number | null;
  tramos: { tipo: "vacio" | "cargado"; origen: string; destino: string }[];
  finanzas: { tipo_tarifa: string; tarifa: number } | null;
  resumen: ResumenViaje;
}

export type Celda = string | number | null;

export function filasExportacion(viajes: readonly ViajeParaExportar[], veTarifas: boolean) {
  const categorias = [...new Set(viajes.flatMap((v) => Object.keys(v.resumen.gastosPorCategoria)))].sort((a, b) =>
    a.localeCompare(b, "es"),
  );
  const encabezados = [
    "Folio", "Estado", "Salida", "Llegada", "Unidad", "Armado", "Operador", "Cliente", "Producto",
    "Tramo vacío", "Km vacío", "Tramo cargado", "Km cargado", "Km totales",
    "Ton. cargadas", "Ton. descargadas",
    ...(veTarifas ? ["Tarifa", "Flete", "Ingreso"] : []),
    "Litros", "Diésel $",
    ...categorias.map((c) => `Gasto: ${c}`),
    "Gastos totales",
    ...(veTarifas ? ["Pago al operador", "Costo variable", "Utilidad", "Margen %"] : []),
  ];
  const tramo = (v: ViajeParaExportar, tipo: "vacio" | "cargado") => {
    const t = v.tramos.find((x) => x.tipo === tipo);
    return t ? `${t.origen} → ${t.destino}` : null;
  };
  const filas: Celda[][] = viajes.map((v) => {
    const r = v.resumen;
    return [
      v.folio, v.estado, formatearFechaHora(v.fecha_salida), v.fecha_llegada ? formatearFechaHora(v.fecha_llegada) : null,
      v.unidad, v.armado, v.operador, v.cliente, v.producto,
      tramo(v, "vacio"), r.kmVacio, tramo(v, "cargado"), r.kmCargado, r.kmTotales,
      v.toneladas_cargadas, v.toneladas_descargadas,
      ...(veTarifas
        ? [v.finanzas ? `${v.finanzas.tarifa}${v.finanzas.tipo_tarifa === "por_tonelada" ? " /t" : " fija"}` : null, r.flete, r.ingreso]
        : []),
      r.litros, r.costoDiesel,
      ...categorias.map((c) => r.gastosPorCategoria[c] ?? null),
      Math.round((r.gastosFacturables + r.gastosPropios) * 100) / 100,
      ...(veTarifas ? [r.pagoOperador, r.costoVariable, r.utilidad, r.margenPct] : []),
    ];
  });
  return { encabezados, filas };
}
