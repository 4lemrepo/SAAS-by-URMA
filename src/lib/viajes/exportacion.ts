/**
 * Filas para exportar viajes a Excel. Sin "ve tarifas" no salen tarifa, cargos
 * ni ingreso; sin "ve utilidades", ni pago al operador, costo variable ni utilidad. Los pesos de diésel y gastos son el
 * costo para rentabilidad (sin IVA acreditable); "pagado" es con IVA.
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
  remisiones: string[];
  factura_cliente: string | null;
  toneladas_cargadas: number | null;
  toneladas_descargadas: number | null;
  tramos: { tipo: "vacio" | "cargado"; origen: string; destino: string }[];
  finanzas: { tipo_tarifa: string; tarifa: number } | null;
  resumen: ResumenViaje;
}

export type Celda = string | number | null;

export function filasExportacion(viajes: readonly ViajeParaExportar[], { veTarifas, veUtilidades }: { veTarifas: boolean; veUtilidades: boolean }) {
  const categorias = [...new Set(viajes.flatMap((v) => Object.keys(v.resumen.gastosPorCategoria)))].sort((a, b) =>
    a.localeCompare(b, "es"),
  );
  const encabezados = [
    "Folio", "Estado", "Salida", "Llegada", "Unidad", "Armado", "Operador", "Cliente", "Producto",
    "Remisiones del cliente", "Factura al cliente",
    "Tramo vacío", "Km vacío", "Tramo cargado", "Km cargado", "Km totales",
    "Ton. cargadas", "Ton. descargadas",
    ...(veTarifas ? ["Tarifa", "Flete", "Cargos adicionales", "Ingreso"] : []),
    "Litros", "Diésel pagado $", "Diésel $",
    ...categorias.map((c) => `Gasto: ${c}`),
    "Gastos pagados", "Gastos", "IVA acreditable",
    ...(veUtilidades ? ["Pago al operador", "Costo variable", "Utilidad", "Margen %"] : []),
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
      v.remisiones.join(", ") || null, v.factura_cliente,
      tramo(v, "vacio"), r.kmVacio, tramo(v, "cargado"), r.kmCargado, r.kmTotales,
      v.toneladas_cargadas, v.toneladas_descargadas,
      ...(veTarifas
        ? [v.finanzas ? `${v.finanzas.tarifa}${v.finanzas.tipo_tarifa === "por_tonelada" ? " /t" : " fija"}` : null, r.flete, r.cargosAdicionales, r.ingreso]
        : []),
      r.litros, r.dieselTotal, r.costoDiesel,
      ...categorias.map((c) => r.gastosPorCategoria[c] ?? null),
      r.gastosTotal, r.gastosCosto, r.ivaAcreditable,
      ...(veUtilidades ? [r.pagoOperador, r.costoVariable, r.utilidad, r.margenPct] : []),
    ];
  });
  return { encabezados, filas };
}
