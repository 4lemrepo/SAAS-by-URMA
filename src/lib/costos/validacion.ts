/** Validación del formulario de costo. Pura; la base vuelve a validar. */
import { normalizarTexto, parsearNumero } from "@/lib/catalogos/validacion";
import { desglosarIva, tasaIva, type TasaIva } from "./iva";

export interface CostoValidado {
  fecha: string;
  mes: string;
  meses: number;
  categoria_id: string;
  /** Total pagado, como dice el comprobante. */
  monto: number;
  tiene_factura: boolean;
  tasa_iva: TasaIva;
  /** IVA acreditable (0 sin factura). */
  iva: number;
  unidad_id: string | null;
  remolque_id: string | null;
  dolly_id: string | null;
  proveedor: string | null;
  numero_comprobante: string | null;
  comprobante_path: string | null;
  notas: string | null;
}

/**
 * `equipo` viene del selector como "u:<id>" (tracto), "r:<id>" (remolque),
 * "d:<id>" (dolly) o "" (costo general de la empresa).
 * `mes` viene de <input type="month"> ("aaaa-mm"); si falta, el de la fecha.
 */
export function validarCosto(
  v: Record<string, string | undefined>,
  empresaId: string,
): { ok: true; datos: CostoValidado } | { ok: false; errores: Record<string, string> } {
  const errores: Record<string, string> = {};
  const t = (x: string | undefined) => normalizarTexto(x);

  const fecha = t(v.fecha);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha) || Number.isNaN(Date.parse(fecha))) errores.fecha = "Fecha inválida";
  const mes = t(v.mes) || fecha.slice(0, 7);
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(mes)) errores.mes = "Mes inválido";
  const meses = parsearNumero(v.meses || "1");
  if (meses === null || Number.isNaN(meses) || !Number.isInteger(meses) || meses < 1 || meses > 60) errores.meses = "Entre 1 y 60 meses";
  if (!t(v.categoria_id)) errores.categoria_id = "Elige la categoría";
  const monto = parsearNumero(v.monto);
  if (monto === null) errores.monto = "Requerido";
  else if (Number.isNaN(monto) || monto <= 0) errores.monto = "Debe ser mayor que cero";
  else if (monto > 100_000_000) errores.monto = "Monto demasiado grande";

  const equipo = t(v.equipo);
  const [tipo, id] = equipo ? equipo.split(":") : ["", ""];
  if (equipo && (!["u", "r", "d"].includes(tipo) || !id)) errores.equipo = "Equipo inválido";

  const largo = (campo: string, max: number) => {
    const x = t(v[campo]);
    if (x.length > max) errores[campo] = `Máximo ${max} caracteres`;
    return x || null;
  };
  const comprobante = t(v.comprobante_path) || null;
  if (comprobante && (!comprobante.startsWith(`${empresaId}/`) || comprobante.includes(".."))) errores.comprobante_path = "Archivo inválido";

  const total = monto !== null && !Number.isNaN(monto) ? Math.round(monto * 100) / 100 : 0;
  const tieneFactura = v.tiene_factura === "on" || v.tiene_factura === "true";
  const tasa = tasaIva(v.tasa_iva);
  const datos: CostoValidado = {
    fecha,
    mes: `${mes}-01`,
    meses: meses ?? 1,
    categoria_id: t(v.categoria_id),
    monto: total,
    tiene_factura: tieneFactura,
    tasa_iva: tasa,
    iva: desglosarIva(total, tieneFactura, tasa).iva,
    unidad_id: tipo === "u" ? id : null,
    remolque_id: tipo === "r" ? id : null,
    dolly_id: tipo === "d" ? id : null,
    proveedor: largo("proveedor", 120),
    numero_comprobante: largo("numero_comprobante", 60),
    comprobante_path: comprobante,
    notas: largo("notas", 500),
  };
  return Object.keys(errores).length ? { ok: false, errores } : { ok: true, datos };
}
