/**
 * Validación de registros de catálogo. Funciones puras: las usan las Server
 * Actions (valores de un formulario) y el importador (celdas de Excel o CSV).
 * La base de datos vuelve a validar; esto es para dar buenos mensajes.
 */
import type { Campo, DefinicionCatalogo, OpcionReferencia } from "./definiciones";

export type Registro = Record<string, string | number | boolean | null>;

export type ResultadoRegistro =
  | { ok: true; datos: Registro }
  | { ok: false; errores: Record<string, string> };

/** Texto sin espacios sobrantes. Un número de Excel llega como número: se pasa a texto. */
export function normalizarTexto(valor: unknown): string {
  if (valor === null || valor === undefined) return "";
  if (typeof valor === "number") return Number.isFinite(valor) ? String(valor) : "";
  if (typeof valor !== "string") return "";
  return valor.trim().replace(/\s+/g, " ");
}

/** Para comparar sin acentos, mayúsculas ni espacios de más. */
export function claveComparacion(valor: unknown): string {
  return normalizarTexto(valor)
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase();
}

/**
 * Número escrito a mano o en Excel: "2.5", "2,5", "1,500", "1 500.5", 1500.
 * Vacío → null. Lo que no se entiende → NaN.
 */
export function parsearNumero(valor: unknown): number | null {
  if (valor === null || valor === undefined) return null;
  if (typeof valor === "number") return Number.isFinite(valor) ? valor : NaN;
  if (typeof valor !== "string") return NaN;
  let t = valor.trim().replace(/[\s ]/g, "");
  if (t === "") return null;
  if (t.includes(",") && t.includes(".")) {
    // 1,234.5 → separador de miles
    t = t.replace(/,/g, "");
  } else if (/^-?\d{1,3}(,\d{3})+$/.test(t)) {
    // 1,500 → mil quinientos
    t = t.replace(/,/g, "");
  } else if (/^-?\d*,\d+$/.test(t)) {
    // 2,5 → coma decimal
    t = t.replace(",", ".");
  }
  if (!/^-?(\d+\.?\d*|\.\d+)$/.test(t)) return NaN;
  return Number(t);
}

type ResultadoCampo = { valor: string | number | boolean | null } | { error: string };

/** Opciones válidas de cada campo de referencia, por columna. */
export type Referencias = Record<string, readonly OpcionReferencia[]>;

export function validarCampo(campo: Campo, crudo: unknown, opciones: readonly OpcionReferencia[] = []): ResultadoCampo {
  if (campo.tipo === "numero") {
    const n = parsearNumero(crudo);
    if (n === null) return campo.requerido ? { error: "Requerido" } : { valor: null };
    if (Number.isNaN(n)) return { error: "Escribe un número" };
    if (campo.decimales === 0 && !Number.isInteger(n)) return { error: "Escribe un número entero" };
    if (campo.minExclusivo ? n <= campo.min : n < campo.min) {
      return { error: campo.minExclusivo && campo.min === 0 ? "Debe ser mayor que cero" : `Mínimo ${campo.min}` };
    }
    if (n > campo.max) return { error: `Máximo ${campo.max.toLocaleString("es-MX")}${campo.unidad ? ` ${campo.unidad}` : ""}` };
    const factor = 10 ** campo.decimales;
    return { valor: Math.round(n * factor) / factor };
  }

  if (campo.tipo === "booleano") {
    if (typeof crudo === "boolean") return { valor: crudo };
    const b = claveComparacion(crudo);
    if (!b) return { valor: false };
    if (["on", "true", "si", "1", "x"].includes(b)) return { valor: true };
    if (["off", "false", "no", "0"].includes(b)) return { valor: false };
    return { error: "Usa Sí o No" };
  }
  const texto = normalizarTexto(crudo);
  if (campo.tipo === "referencia") {
    if (!texto) return campo.requerido ? { error: "Requerido" } : { valor: null };
    // Acepta el id (formulario) o el nombre (archivo importado).
    const buscada = claveComparacion(texto);
    const opcion = opciones.find((o) => o.valor === texto || claveComparacion(o.etiqueta) === buscada);
    return opcion ? { valor: opcion.valor } : { error: "Elige una opción de la lista" };
  }
  if (campo.tipo === "opcion") {
    if (!texto) {
      if (campo.porDefecto) return { valor: campo.porDefecto };
      return campo.requerido ? { error: "Requerido" } : { valor: null };
    }
    // Acepta el valor interno o la etiqueta, sin importar acentos ni mayúsculas.
    const buscada = claveComparacion(texto).replace(/[\s_]+/g, " ");
    const opcion = campo.opciones.find(
      (o) => claveComparacion(o.valor).replace(/_/g, " ") === buscada || claveComparacion(o.etiqueta) === buscada,
    );
    if (!opcion) return { error: `Usa: ${campo.opciones.map((o) => o.etiqueta).join(", ")}` };
    return { valor: opcion.valor };
  }

  if (!texto) return campo.requerido ? { error: "Requerido" } : { valor: null };
  const valor = campo.mayusculas ? texto.toUpperCase() : texto;
  if (campo.min && valor.length < campo.min) return { error: `Mínimo ${campo.min} caracteres` };
  if (valor.length > campo.max) return { error: `Máximo ${campo.max} caracteres` };
  if (campo.patron && !campo.patron.regex.test(valor)) return { error: campo.patron.mensaje };
  return { valor };
}

/** Valida todos los campos de un catálogo. `valores` va por nombre de columna. */
export function validarRegistro(
  def: DefinicionCatalogo,
  valores: Record<string, unknown>,
  referencias: Referencias = {},
): ResultadoRegistro {
  const datos: Registro = {};
  const errores: Record<string, string> = {};
  for (const campo of def.campos) {
    const r = validarCampo(campo, valores[campo.columna], referencias[campo.columna]);
    if ("error" in r) errores[campo.columna] = r.error;
    else datos[campo.columna] = r.valor;
  }
  return Object.keys(errores).length ? { ok: false, errores } : { ok: true, datos };
}

/** Lee del formulario solo los campos del catálogo. */
export function valoresDeFormulario(def: DefinicionCatalogo, form: FormData): Record<string, string> {
  const valores: Record<string, string> = {};
  for (const campo of def.campos) {
    const v = form.get(campo.columna);
    valores[campo.columna] = typeof v === "string" ? v : "";
  }
  return valores;
}

/**
 * Llave para detectar duplicados, con la misma regla que los índices únicos de
 * la base (sin mayúsculas ni espacios de más) y además sin acentos, para
 * avisar también de "Ocotlan" contra "Ocotlán".
 */
export function llaveDuplicado(def: DefinicionCatalogo, datos: Registro): string {
  return def.llaveUnica.map((c) => claveComparacion(datos[c])).join(" → ");
}
