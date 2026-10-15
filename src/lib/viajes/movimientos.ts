/**
 * Validación de lo que se le agrega a un viaje: gastos, cargas de diésel y su
 * tarifa con el pago al operador. Puras; la base vuelve a validar.
 */
import { normalizarTexto, parsearNumero } from "@/lib/catalogos/validacion";
import { validarConfigPago, type ConfigPagoFila } from "./pago";

type Valores = Record<string, string | undefined>;
type Resultado<T> = { ok: true; datos: T } | { ok: false; errores: Record<string, string> };

export const FORMAS_PAGO = [
  { valor: "efectivo", etiqueta: "Efectivo" },
  { valor: "tarjeta", etiqueta: "Tarjeta" },
  { valor: "transferencia", etiqueta: "Transferencia" },
  { valor: "tag", etiqueta: "TAG / IAVE" },
  { valor: "credito", etiqueta: "Crédito" },
  { valor: "otro", etiqueta: "Otro" },
] as const;

const texto = (v: string | undefined) => normalizarTexto(v);
const opcional = (v: string | undefined, max: number, campo: string, errores: Record<string, string>) => {
  const t = texto(v);
  if (t.length > max) errores[campo] = `Máximo ${max} caracteres`;
  return t || null;
};

function numero(v: string | undefined, campo: string, errores: Record<string, string>, { requerido = false, min = 0, max = Infinity, minExclusivo = false } = {}) {
  const n = parsearNumero(v);
  if (n === null) {
    if (requerido) errores[campo] = "Requerido";
    return null;
  }
  if (Number.isNaN(n)) errores[campo] = "Escribe un número";
  else if (minExclusivo ? n <= min : n < min) errores[campo] = min === 0 && minExclusivo ? "Debe ser mayor que cero" : `Mínimo ${min}`;
  else if (n > max) errores[campo] = `Máximo ${max.toLocaleString("es-MX")}`;
  else return Math.round(n * 100) / 100;
  return null;
}

/** Ruta de un archivo subido a Storage: debe estar en la carpeta de la empresa. */
function archivo(v: string | undefined, empresaId: string, campo: string, errores: Record<string, string>) {
  const t = texto(v);
  if (!t) return null;
  if (!t.startsWith(`${empresaId}/`) || t.includes("..")) errores[campo] = "Archivo inválido";
  return t;
}

export interface GastoValidado {
  fecha: string;
  categoria_id: string;
  monto: number;
  forma_pago: string;
  proveedor: string | null;
  numero_comprobante: string | null;
  comprobante_path: string | null;
  facturable: boolean;
  notas: string | null;
}

export function validarGasto(v: Valores, empresaId: string): Resultado<GastoValidado> {
  const errores: Record<string, string> = {};
  const fecha = texto(v.fecha);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha) || Number.isNaN(Date.parse(fecha))) errores.fecha = "Fecha inválida";
  if (!texto(v.categoria_id)) errores.categoria_id = "Elige la categoría";
  const monto = numero(v.monto, "monto", errores, { requerido: true, minExclusivo: true, max: 10_000_000 });
  const forma = texto(v.forma_pago) || "efectivo";
  if (!FORMAS_PAGO.some((f) => f.valor === forma)) errores.forma_pago = "Forma de pago inválida";
  const datos = {
    fecha,
    categoria_id: texto(v.categoria_id),
    monto: monto ?? 0,
    forma_pago: forma,
    proveedor: opcional(v.proveedor, 120, "proveedor", errores),
    numero_comprobante: opcional(v.numero_comprobante, 60, "numero_comprobante", errores),
    comprobante_path: archivo(v.comprobante_path, empresaId, "comprobante_path", errores),
    facturable: v.facturable === "on" || v.facturable === "true",
    notas: opcional(v.notas, 500, "notas", errores),
  };
  return Object.keys(errores).length ? { ok: false, errores } : { ok: true, datos };
}

export interface CargaValidada {
  fecha: string;
  fuente_id: string;
  litros: number;
  precio_litro: number | null;
  importe: number | null;
  odometro: number | null;
  folio_ticket: string | null;
  foto_ticket_path: string | null;
}

export function validarCarga(v: Valores, empresaId: string): Resultado<CargaValidada> {
  const errores: Record<string, string> = {};
  const fecha = texto(v.fecha);
  if (!fecha || Number.isNaN(Date.parse(fecha))) errores.fecha = "Fecha inválida";
  if (!texto(v.fuente_id)) errores.fuente_id = "Elige dónde se cargó";
  const litros = numero(v.litros, "litros", errores, { requerido: true, minExclusivo: true, max: 3000 });
  const precio = numero(v.precio_litro, "precio_litro", errores, { minExclusivo: true, max: 100 });
  const importe = numero(v.importe, "importe", errores, { minExclusivo: true, max: 1_000_000 });
  const odometro = numero(v.odometro, "odometro", errores, { max: 9_999_999 });
  const datos = {
    fecha: fecha ? new Date(fecha).toISOString() : "",
    fuente_id: texto(v.fuente_id),
    litros: litros ?? 0,
    precio_litro: precio,
    // Si hay litros y precio pero no importe, se calcula.
    importe: importe ?? (litros !== null && precio !== null ? Math.round(litros * precio * 100) / 100 : null),
    odometro,
    folio_ticket: opcional(v.folio_ticket, 40, "folio_ticket", errores),
    foto_ticket_path: archivo(v.foto_ticket_path, empresaId, "foto_ticket_path", errores),
  };
  return Object.keys(errores).length ? { ok: false, errores } : { ok: true, datos };
}

export interface FinanzasValidadas {
  tipo_tarifa: "por_tonelada" | "fija";
  tarifa: number;
  factura_por: "cargado" | "descargado";
  pago_esquema: ConfigPagoFila["esquema"];
  pago_pct: number | null;
  pago_tarifa_km_cargado: number | null;
  pago_tarifa_km_vacio: number | null;
  pago_tarifa_tonelada: number | null;
  pago_monto_fijo: number | null;
  pago_operador_manual: number | null;
}

/** Tarifa del flete y pago al operador del viaje (campos de pago con prefijo "pago_"). */
export function validarFinanzas(v: Valores): Resultado<FinanzasValidadas> {
  const errores: Record<string, string> = {};
  const tipo = v.tipo_tarifa === "fija" ? "fija" : v.tipo_tarifa === "por_tonelada" ? "por_tonelada" : null;
  if (!tipo) errores.tipo_tarifa = "Elige el tipo de tarifa";
  const tarifa = numero(v.tarifa, "tarifa", errores, { requerido: true, max: 10_000_000 });
  const facturaPor = v.factura_por === "descargado" ? "descargado" : "cargado";
  const pago = validarConfigPago({
    esquema: v.pago_esquema,
    pct: v.pago_pct,
    tarifa_km_cargado: v.pago_tarifa_km_cargado,
    tarifa_km_vacio: v.pago_tarifa_km_vacio,
    tarifa_tonelada: v.pago_tarifa_tonelada,
    monto_fijo: v.pago_monto_fijo,
  });
  if (!pago.ok) for (const [k, m] of Object.entries(pago.errores)) errores[k === "esquema" ? "pago_esquema" : `pago_${k}`] = m;
  const manual = numero(v.pago_operador_manual, "pago_operador_manual", errores, { max: 10_000_000 });
  if (Object.keys(errores).length || !pago.ok) return { ok: false, errores };
  return {
    ok: true,
    datos: {
      tipo_tarifa: tipo!,
      tarifa: tarifa!,
      factura_por: facturaPor,
      pago_esquema: pago.datos.esquema,
      pago_pct: pago.datos.pct,
      pago_tarifa_km_cargado: pago.datos.tarifa_km_cargado,
      pago_tarifa_km_vacio: pago.datos.tarifa_km_vacio,
      pago_tarifa_tonelada: pago.datos.tarifa_tonelada,
      pago_monto_fijo: pago.datos.monto_fijo,
      pago_operador_manual: manual,
    },
  };
}
