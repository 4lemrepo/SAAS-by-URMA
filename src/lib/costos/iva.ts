/**
 * IVA de lo que se paga (gastos del viaje, cargas de diésel y costos de
 * unidad). Regla: se captura el TOTAL que dice el ticket, tal cual, y si tiene
 * factura con su tasa. El sistema calcula el resto:
 * - Con factura: costo para rentabilidad = total ÷ (1 + tasa); el IVA se
 *   guarda aparte como IVA acreditable (la empresa lo recupera).
 * - Sin factura (o tasa 0 % / exento): costo = total.
 */

export type TasaIva = 16 | 8 | 0;

export const TASAS_IVA: readonly { valor: string; etiqueta: string }[] = [
  { valor: "16", etiqueta: "16 %" },
  { valor: "8", etiqueta: "8 % (frontera)" },
  { valor: "0", etiqueta: "0 % o exento" },
];

export interface Desglose {
  /** Lo que se pagó (con IVA si lo trae). */
  total: number;
  /** IVA acreditable (0 sin factura). */
  iva: number;
  /** Costo para rentabilidad = total − IVA acreditable. */
  costo: number;
}

const r2 = (n: number) => Math.round(n * 100) / 100;

export function desglosarIva(total: number, tieneFactura: boolean, tasa: TasaIva): Desglose {
  const t = r2(total);
  if (!tieneFactura || tasa === 0) return { total: t, iva: 0, costo: t };
  // Se redondea el costo y el IVA es la diferencia: total = costo + IVA, al centavo.
  const costo = r2(t / (1 + tasa / 100));
  return { total: t, iva: r2(t - costo), costo };
}

/** Tasa a partir de lo que llega de un formulario o de la base ("16", 16, "16.00"…); 16 si no se reconoce. */
export function tasaIva(v: unknown): TasaIva {
  const n = Number(v);
  return n === 8 ? 8 : n === 0 && v !== null && v !== undefined && String(v).trim() !== "" ? 0 : 16;
}
