/**
 * Importación con plantilla: un archivo por catálogo, una fila por registro,
 * la primera fila con los nombres de las columnas.
 */
import type { DefinicionCatalogo } from "@/lib/catalogos/definiciones";
import {
  claveComparacion,
  llaveDuplicado,
  normalizarTexto,
  validarRegistro,
  type Referencias,
  type Registro,
} from "@/lib/catalogos/validacion";

/** Catálogos que se pueden importar con plantilla. */
export const CATALOGOS_IMPORTABLES = ["unidades", "operadores", "clientes", "rutas"] as const;
export type CatalogoImportable = (typeof CATALOGOS_IMPORTABLES)[number];

const sinOpcional = (etiqueta: string) => etiqueta.replace(/\s*\(opcional\)$/i, "");

/** Encabezados de la plantilla: la etiqueta de cada campo, con * si es obligatorio. */
export function encabezadosPlantilla(def: DefinicionCatalogo): string[] {
  return def.campos.map((c) => `${sinOpcional(c.etiqueta)}${c.requerido ? " *" : ""}`);
}

export interface MapeoEncabezados {
  /** Índice de la columna del archivo para cada campo encontrado. */
  indices: Record<string, number>;
  faltantes: string[];
  ignoradas: string[];
}

/** Relaciona los encabezados del archivo con los campos, sin importar acentos, mayúsculas ni el "*". */
export function mapearEncabezados(def: DefinicionCatalogo, encabezados: readonly unknown[]): MapeoEncabezados {
  const indices: Record<string, number> = {};
  const ignoradas: string[] = [];
  encabezados.forEach((e, i) => {
    const texto = claveComparacion(String(e ?? "").replace(/\*/g, ""));
    if (!texto) return;
    const campo = def.campos.find(
      (c) => claveComparacion(sinOpcional(c.etiqueta)) === texto || claveComparacion(c.etiqueta) === texto || c.columna === texto,
    );
    if (campo && !(campo.columna in indices)) indices[campo.columna] = i;
    else ignoradas.push(String(e).trim());
  });
  const faltantes = def.campos.filter((c) => c.requerido && !(c.columna in indices)).map((c) => sinOpcional(c.etiqueta));
  return { indices, faltantes, ignoradas };
}

export type EstadoFila = "nueva" | "existe" | "error";

export interface FilaPrevia {
  /** Número de fila en el archivo (1 = encabezados). */
  numero: number;
  /** Lo que venía en el archivo, como texto, por columna. */
  original: Record<string, string>;
  estado: EstadoFila;
  datos?: Registro;
  errores: Record<string, string>;
  /** Mensaje para toda la fila (duplicado, ya existe). */
  aviso?: string;
}

/** Un registro a importar: de dónde viene (fila o nombre) y sus valores por columna. */
export interface Entrada {
  numero: number;
  valores: Record<string, unknown>;
}

/**
 * Valida cada registro y marca duplicados: dentro del archivo es error; contra
 * lo que ya está en el catálogo se omite ("existe"). Los vacíos se saltan.
 */
export function validarRegistros(
  def: DefinicionCatalogo,
  entradas: readonly Entrada[],
  existentes: readonly Registro[],
  referencias: Referencias = {},
): FilaPrevia[] {
  const enCatalogo = new Set(existentes.map((r) => llaveDuplicado(def, r)));
  const vistas = new Map<string, number>();
  const resultado: FilaPrevia[] = [];

  for (const { numero, valores } of entradas) {
    const original: Record<string, string> = {};
    for (const campo of def.campos) original[campo.columna] = normalizarTexto(valores[campo.columna]);
    if (Object.values(original).every((v) => v === "")) continue;

    const v = validarRegistro(def, valores, referencias);
    if (!v.ok) {
      resultado.push({ numero, original, estado: "error", errores: v.errores });
      continue;
    }
    const llave = llaveDuplicado(def, v.datos);
    const repetida = vistas.get(llave);
    if (repetida !== undefined) {
      resultado.push({ numero, original, estado: "error", datos: v.datos, errores: {}, aviso: `Repetida: es igual a la fila ${repetida}` });
      continue;
    }
    vistas.set(llave, numero);
    if (enCatalogo.has(llave)) {
      resultado.push({ numero, original, estado: "existe", datos: v.datos, errores: {}, aviso: "Ya está en el catálogo: se omite" });
      continue;
    }
    resultado.push({ numero, original, estado: "nueva", datos: v.datos, errores: {} });
  }
  return resultado;
}

/** Pasa las filas del archivo (celdas) a registros por columna, según los encabezados. */
export function entradasDeFilas(
  filas: readonly (readonly unknown[])[],
  mapeo: MapeoEncabezados,
  primeraFila = 2,
): Entrada[] {
  return filas.map((celdas, i) => {
    const valores: Record<string, unknown> = {};
    for (const [columna, indice] of Object.entries(mapeo.indices)) valores[columna] = celdas[indice];
    return { numero: primeraFila + i, valores };
  });
}

export function resumen(filas: readonly FilaPrevia[]) {
  return {
    nuevas: filas.filter((f) => f.estado === "nueva").length,
    existentes: filas.filter((f) => f.estado === "existe").length,
    errores: filas.filter((f) => f.estado === "error").length,
  };
}
