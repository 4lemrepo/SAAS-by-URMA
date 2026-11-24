/**
 * Configuración del pago al operador: por empresa (por defecto) y, si se
 * quiere, por operador. Cada viaje guarda el esquema y los valores que usó.
 */
import { parsearNumero } from "@/lib/catalogos/validacion";
import { NOMBRE_ESQUEMA_PAGO, type BaseFlete, type EsquemaPago } from "./calculos";

export const ESQUEMAS_PAGO = (Object.keys(NOMBRE_ESQUEMA_PAGO) as EsquemaPago[]).map((valor) => ({
  valor,
  etiqueta: NOMBRE_ESQUEMA_PAGO[valor],
}));

/** Columnas que usa cada esquema. */
export const CAMPOS_ESQUEMA: Record<EsquemaPago, readonly ColumnaPago[]> = {
  pct_subtotal: ["pct"],
  pct_flete: ["pct"],
  por_km: ["tarifa_km_cargado", "tarifa_km_vacio"],
  por_tonelada: ["tarifa_tonelada"],
  fijo: ["monto_fijo"],
  sueldo_comision: ["sueldo_base_mensual", "pct"],
};

export type ColumnaPago = "pct" | "tarifa_km_cargado" | "tarifa_km_vacio" | "tarifa_tonelada" | "monto_fijo" | "sueldo_base_mensual";

export const ETIQUETA_COLUMNA_PAGO: Record<ColumnaPago, string> = {
  pct: "Porcentaje (%)",
  tarifa_km_cargado: "$ por km cargado",
  tarifa_km_vacio: "$ por km vacío",
  tarifa_tonelada: "$ por tonelada",
  monto_fijo: "Monto por viaje ($)",
  sueldo_base_mensual: "Sueldo base mensual ($)",
};

/** Base del "% del flete". */
export const BASES_FLETE: readonly { valor: BaseFlete; etiqueta: string }[] = [
  { valor: "cargado", etiqueta: "Peso cargado (tarifa × toneladas cargadas)" },
  { valor: "facturado", etiqueta: "Peso facturado (el flete de la factura)" },
];

export type ConfigPagoFila = { esquema: EsquemaPago; base_flete: BaseFlete } & Record<ColumnaPago, number | null>;

export function validarConfigPago(
  valores: Record<string, unknown>,
): { ok: true; datos: ConfigPagoFila } | { ok: false; errores: Record<string, string> } {
  const esquema = String(valores.esquema ?? "") as EsquemaPago;
  if (!(esquema in CAMPOS_ESQUEMA)) return { ok: false, errores: { esquema: "Elige un esquema" } };
  const datos = {
    esquema,
    // Solo cuenta en "% del flete"; por defecto peso cargado.
    base_flete: esquema === "pct_flete" && valores.base_flete === "facturado" ? "facturado" : "cargado",
    pct: null,
    tarifa_km_cargado: null,
    tarifa_km_vacio: null,
    tarifa_tonelada: null,
    monto_fijo: null,
    sueldo_base_mensual: null,
  } as ConfigPagoFila;
  const errores: Record<string, string> = {};
  for (const col of CAMPOS_ESQUEMA[esquema]) {
    const n = parsearNumero(valores[col]);
    // El sueldo base es informativo (el sueldo se registra en Costos): opcional.
    if (n === null) {
      if (col !== "sueldo_base_mensual") errores[col] = "Requerido";
    } else if (Number.isNaN(n) || n < 0) {
      errores[col] = "Escribe un número mayor o igual a cero";
    } else if (col === "pct" && n > 100) {
      errores[col] = "Máximo 100%";
    } else {
      datos[col] = Math.round(n * 100) / 100;
    }
  }
  return Object.keys(errores).length ? { ok: false, errores } : { ok: true, datos };
}

/** La configuración del operador si tiene una propia; si no, la de la empresa. */
export function configParaOperador<T extends { operador_id: string | null; activo?: boolean }>(
  configs: readonly T[],
  operadorId: string | null,
): T | null {
  const vigentes = configs.filter((c) => c.activo !== false);
  return (operadorId && vigentes.find((c) => c.operador_id === operadorId)) || vigentes.find((c) => c.operador_id === null) || null;
}

/** Texto corto para mostrar el esquema con sus valores. */
export function describirPago(c: ConfigPagoFila): string {
  const $ = (n: number | null) => (n === null ? "?" : `$${n.toLocaleString("es-MX")}`);
  switch (c.esquema) {
    case "pct_subtotal":
      return `${c.pct ?? "?"}% del subtotal (flete + cargos adicionales)`;
    case "pct_flete":
      return `${c.pct ?? "?"}% del flete con peso ${c.base_flete === "facturado" ? "facturado" : "cargado"}`;
    case "por_km":
      return `${$(c.tarifa_km_cargado)}/km cargado, ${$(c.tarifa_km_vacio)}/km vacío`;
    case "por_tonelada":
      return `${$(c.tarifa_tonelada)} por tonelada`;
    case "fijo":
      return `${$(c.monto_fijo)} por viaje`;
    case "sueldo_comision":
      return `Sueldo ${$(c.sueldo_base_mensual)}/mes + ${c.pct ?? "?"}% del subtotal`;
  }
}
