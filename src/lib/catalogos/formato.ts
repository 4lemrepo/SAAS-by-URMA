import type { Campo } from "./definiciones";

/** Valor de un campo tal como se muestra en una lista. */
export function formatearValor(campo: Campo, valor: string | number | null | undefined): string {
  if (valor === null || valor === undefined || valor === "") return "—";
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
