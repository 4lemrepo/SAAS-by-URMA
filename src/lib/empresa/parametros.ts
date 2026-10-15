/**
 * Parámetros de cada empresa. Son datos, nunca constantes en código. Las
 * mismas reglas que los checks de la tabla parametros_empresa.
 */
import type { CampoNumero, CampoTexto } from "@/lib/catalogos/definiciones";
import { validarCampo } from "@/lib/catalogos/validacion";

export type Parametros = Record<string, number | string | null>;

const decimal = (columna: string, etiqueta: string, unidad: string, max: number, ayuda: string, requerido = true): CampoNumero => ({
  columna,
  etiqueta,
  tipo: "numero",
  requerido,
  min: 0,
  minExclusivo: true,
  max,
  decimales: 2,
  unidad,
  ayuda,
});
const entero = (columna: string, etiqueta: string, min: number, max: number, ayuda?: string): CampoNumero => ({
  columna,
  etiqueta,
  tipo: "numero",
  requerido: true,
  min,
  max,
  decimales: 0,
  ayuda,
});
const prefijo = (columna: string, etiqueta: string): CampoTexto => ({
  columna,
  etiqueta,
  tipo: "texto",
  max: 10,
  patron: { regex: /^[A-Za-z0-9\-_/]*$/, mensaje: "Solo letras, números, - _ /" },
});

export const GRUPOS_PARAMETROS: readonly { titulo: string; campos: readonly (CampoNumero | CampoTexto)[] }[] = [
  {
    titulo: "Conciliación",
    campos: [
      decimal("tolerancia_pct", "Tolerancia de diésel", "%", 100, "Diferencia aceptada entre litros reales y teóricos antes de marcar amarillo"),
      decimal("tolerancia_km_pct", "Tolerancia de kilómetros", "%", 100, "Si los km de un tramo se desvían más que esto de su ruta, se pide motivo"),
      decimal("precio_diesel_litro", "Precio del diésel por litro", "pesos", 100, "Para cargas sin importe ni precio, y para los pesos faltantes", false),
    ],
  },
  {
    titulo: "Alertas",
    campos: [
      entero("dias_alerta_viaje_abierto", "Días para alertar un viaje abierto", 1, 90),
      decimal("horas_limite_estadia", "Horas libres en carga o descarga", "horas", 240, "Más tiempo que esto se señala (base para cobrar estadías)"),
    ],
  },
  {
    titulo: "Folios",
    campos: [
      prefijo("folio_viaje_prefijo", "Prefijo de viajes"),
      entero("folio_viaje_siguiente", "Siguiente número de viaje", 1, 99_999_999),
      prefijo("folio_gasto_prefijo", "Prefijo de gastos"),
      entero("folio_gasto_siguiente", "Siguiente número de gasto", 1, 99_999_999),
      prefijo("folio_costo_prefijo", "Prefijo de costos"),
      entero("folio_costo_siguiente", "Siguiente número de costo", 1, 99_999_999),
      entero("folio_digitos", "Dígitos del número", 1, 8, "Con 4: URMA-0182"),
    ],
  },
];

export const CAMPOS_PARAMETROS = GRUPOS_PARAMETROS.flatMap((g) => g.campos);

export function validarParametros(
  valores: Record<string, unknown>,
): { ok: true; datos: Parametros } | { ok: false; errores: Record<string, string> } {
  const datos: Parametros = {};
  const errores: Record<string, string> = {};
  for (const campo of CAMPOS_PARAMETROS) {
    const r = validarCampo(campo, valores[campo.columna]);
    if ("error" in r) errores[campo.columna] = r.error;
    // Un prefijo vacío se guarda como "" (la columna no acepta null).
    else datos[campo.columna] = campo.tipo === "texto" ? (r.valor ?? "") : r.valor;
  }
  return Object.keys(errores).length ? { ok: false, errores } : { ok: true, datos };
}

/** Ejemplo de folio con los valores dados: prefijo + número con ceros. */
export function ejemploFolio(prefijo: string, numero: number, digitos: number): string {
  return `${prefijo}${String(numero).padStart(digitos, "0")}`;
}
