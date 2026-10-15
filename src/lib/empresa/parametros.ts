/**
 * Parámetros de conciliación de cada empresa. Son datos, nunca constantes en
 * código. Las mismas reglas que los checks de la tabla empresas.
 */
import type { CampoNumero } from "@/lib/catalogos/definiciones";
import { validarCampo } from "@/lib/catalogos/validacion";

export interface Parametros {
  tolerancia_pct: number;
  precio_diesel_litro: number | null;
}

export const CAMPOS_PARAMETROS: readonly CampoNumero[] = [
  {
    columna: "tolerancia_pct",
    etiqueta: "Tolerancia",
    tipo: "numero",
    requerido: true,
    min: 0,
    minExclusivo: true,
    max: 100,
    decimales: 2,
    unidad: "%",
    ayuda: "Diferencia aceptada entre litros reales y teóricos antes de marcar amarillo",
  },
  {
    columna: "precio_diesel_litro",
    etiqueta: "Precio del diésel por litro",
    tipo: "numero",
    min: 0,
    minExclusivo: true,
    max: 100,
    decimales: 2,
    unidad: "pesos",
    ayuda: "Para calcular los pesos faltantes. Déjalo vacío si aún no lo defines.",
  },
];

export function validarParametros(
  valores: Record<string, unknown>,
): { ok: true; datos: Parametros } | { ok: false; errores: Record<string, string> } {
  const datos: Record<string, number | null> = {};
  const errores: Record<string, string> = {};
  for (const campo of CAMPOS_PARAMETROS) {
    const r = validarCampo(campo, valores[campo.columna]);
    if ("error" in r) errores[campo.columna] = r.error;
    else datos[campo.columna] = r.valor as number | null;
  }
  if (Object.keys(errores).length) return { ok: false, errores };
  return { ok: true, datos: datos as unknown as Parametros };
}
