/**
 * Fórmulas de un .xlsx. read-excel-file entrega el valor ya calculado de cada
 * celda; aquí se leen las fórmulas escritas (p. ej. "=1178+464.5") para
 * guardar sus partes en las notas del gasto. Corre en el navegador y en las
 * pruebas: el .xlsx es un zip con un XML por hoja.
 */
import { strFromU8, unzipSync } from "fflate";

/** Fórmulas de cada hoja pedida: nombre de hoja → referencia ("T4") → fórmula sin "=". */
export type FormulasPorHoja = Record<string, Record<string, string>>;

const decodificar = (s: string) =>
  s.replace(/&(amp|lt|gt|quot|apos);/g, (_, e: string) => ({ amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" })[e] ?? "");

export function leerFormulas(xlsx: Uint8Array, hojas: readonly string[]): FormulasPorHoja {
  const base = unzipSync(xlsx, { filter: (f) => f.name === "xl/workbook.xml" || f.name === "xl/_rels/workbook.xml.rels" });
  const libro = base["xl/workbook.xml"] ? strFromU8(base["xl/workbook.xml"]) : "";
  const relaciones = base["xl/_rels/workbook.xml.rels"] ? strFromU8(base["xl/_rels/workbook.xml.rels"]) : "";
  const destinoDe = new Map<string, string>();
  for (const m of relaciones.matchAll(/<Relationship\b[^>]*>/g)) {
    const id = /\bId="([^"]+)"/.exec(m[0])?.[1];
    const destino = /\bTarget="([^"]+)"/.exec(m[0])?.[1];
    if (id && destino) destinoDe.set(id, destino.replace(/^\/?(xl\/)?/, "xl/"));
  }
  const archivoDe = new Map<string, string>();
  for (const m of libro.matchAll(/<sheet\b[^>]*>/g)) {
    const nombre = /\bname="([^"]+)"/.exec(m[0])?.[1];
    const id = /\br:id="([^"]+)"/.exec(m[0])?.[1];
    const archivo = id ? destinoDe.get(id) : undefined;
    if (nombre && archivo) archivoDe.set(decodificar(nombre), archivo);
  }
  const buscados = new Map(hojas.flatMap((h) => (archivoDe.has(h) ? [[archivoDe.get(h)!, h] as const] : [])));
  const archivos = unzipSync(xlsx, { filter: (f) => buscados.has(f.name) });
  const resultado: FormulasPorHoja = {};
  for (const [archivo, hoja] of buscados) {
    const xml = archivos[archivo] ? strFromU8(archivos[archivo]) : "";
    const formulas: Record<string, string> = {};
    // <c r="T4" s="8"><f>100+464</f><v>564</v></c>; las compartidas sin texto (<f t="shared" si="0"/>) no sirven aquí.
    for (const m of xml.matchAll(/<c\b[^>]*\br="([A-Z]+\d+)"[^>]*>\s*<f\b[^>]*>([^<]*)<\/f>/g)) {
      formulas[m[1]] = decodificar(m[2]);
    }
    resultado[hoja] = formulas;
  }
  return resultado;
}

/** Letra de columna de Excel para un índice desde 0 (0 → A, 26 → AA). */
export function letraColumna(indice: number): string {
  let n = indice + 1;
  let letras = "";
  while (n > 0) {
    const r = (n - 1) % 26;
    letras = String.fromCharCode(65 + r) + letras;
    n = Math.floor((n - 1) / 26);
  }
  return letras;
}

/**
 * Partes de una fórmula que solo suma números ("1178+464.5" → [1178, 464.5]).
 * null si es otra cosa (referencias, funciones) o si es un solo número.
 */
export function partesDeSuma(formula: string | null | undefined): number[] | null {
  const f = (formula ?? "").replace(/^=/, "").replace(/\s+/g, "");
  if (!/^\d+(\.\d+)?(\+\d+(\.\d+)?)+$/.test(f)) return null;
  return f.split("+").map(Number);
}
