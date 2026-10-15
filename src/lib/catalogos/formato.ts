import type { Campo, DefinicionCatalogo, OpcionReferencia } from "./definiciones";

/** Valor de un campo tal como se muestra en una lista. */
export function formatearValor(
  campo: Campo | undefined,
  valor: string | number | null | undefined,
  opciones: readonly OpcionReferencia[] = [],
): string {
  if (valor === null || valor === undefined || valor === "") return "—";
  // Columna calculada: ya viene como texto.
  if (!campo) return String(valor);
  if (campo.tipo === "referencia") return opciones.find((o) => o.valor === valor)?.etiqueta ?? "—";
  if (campo.tipo === "opcion") return campo.opciones.find((o) => o.valor === valor)?.etiqueta ?? String(valor);
  if (campo.tipo === "numero") {
    const n = Number(valor);
    // Los enteros (el año) van sin separador de miles.
    if (campo.decimales === 0) return String(n);
    const texto = n.toLocaleString("es-MX", { maximumFractionDigits: campo.decimales });
    return campo.unidad ? `${texto} ${campo.unidad}` : texto;
  }
  return String(valor);
}

/** Valor de un campo para precargar un formulario. */
export function valorDeFormulario(valor: string | number | null | undefined): string {
  return valor === null || valor === undefined ? "" : String(valor);
}

/** Columnas de la lista: un campo del catálogo o una columna calculada. */
export function columnasDeLista(def: DefinicionCatalogo) {
  return def.columnasLista.map((columna) => {
    const campo = def.campos.find((c) => c.columna === columna);
    const etiqueta = campo?.etiqueta ?? def.calculadas?.find((c) => c.columna === columna)?.etiqueta ?? columna;
    return { columna, etiqueta: etiqueta.replace(/ \(opcional\)$/, ""), campo };
  });
}
