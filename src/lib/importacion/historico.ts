/**
 * Importación de viajes históricos desde un Excel de control (una fila por
 * viaje) y de costos de mantenimiento por unidad y mes. Funciones puras: el
 * navegador arma la vista previa y el servidor repite todo contra la base
 * antes de guardar.
 *
 * Mapeo (hoja de viajes):
 * - Fecha: salida y llegada ese día a mediodía (hora del centro); el Excel no
 *   trae horas. Por eso los viajes importados no cuentan en días en ruta,
 *   utilización, ingreso por unidad por día ni tiempos de carga y descarga.
 * - No. Viaje: folio. "UL-1 / UL-2" en una fila es UN viaje con una remisión
 *   por remolque (folio = el primero; remisiones = ambos). El mismo texto en
 *   varias filas, con tantas partes como filas, son viajes distintos
 *   facturados juntos: cada fila toma su folio en orden de fecha.
 * - Km vacío y cargado: un tramo cada uno, sin odómetros. El vacío va de
 *   "(SIN DATO)" al origen; no se ligan a rutas (no hay desvíos falsos).
 * - Diésel: una carga validada con el importe del Excel (el total real, con
 *   el precio de muchos decimales), con factura 16 % salvo que diga otra cosa.
 * - Casetas, urea y mantenimiento en ruta con factura 16 %; otros y gastos
 *   operativos sin factura. Una suma escrita en la celda (=1178+464.5) entra
 *   como un gasto y sus partes quedan en las notas.
 * - Tarifa por tonelada × toneladas cargadas; pago al operador manual.
 * - Costo total e ingreso del Excel solo se comparan (aviso si no cuadran).
 *
 * Hoja de costos por unidad y mes: mantenimiento tracto, de equipo de
 * arrastre, otros y llantas son SUBTOTALES sin IVA: se guardan con factura,
 * costo = monto del Excel, IVA 16 % aparte y total = monto × 1.16.
 */
import { claveComparacion, normalizarTexto, parsearNumero } from "@/lib/catalogos/validacion";
import { desglosarIva } from "@/lib/costos/iva";
import { pesos } from "@/lib/formato";
import { parsearRemisiones } from "@/lib/viajes/formulario";
import { letraColumna, partesDeSuma } from "./formulas";

// ---------------------------------------------------------------------------
// Lectura de la hoja de viajes
// ---------------------------------------------------------------------------

const COLUMNAS_VIAJE = {
  fecha: ["fecha", "fecha de salida"],
  folio: ["no. viaje", "no viaje", "folio", "folio del viaje", "numero de viaje"],
  unidad: ["unidad", "no. economico", "numero economico"],
  operador: ["operador", "chofer"],
  origen: ["origen", "lugar de carga"],
  destino: ["destino", "lugar de descarga"],
  cliente: ["cliente"],
  kmVacio: ["km vacio", "kms vacio"],
  kmCargado: ["km cargado", "kms cargado"],
  litros: ["litros"],
  fuente: ["dispersion", "fuente", "fuente de diesel"],
  precio: ["precio por litro", "precio litro"],
  importeDiesel: ["costo diesel", "importe diesel", "importe del diesel"],
  dieselConFactura: ["diesel con factura"],
  casetas: ["peajes / casetas", "casetas", "peajes"],
  casetasConFactura: ["casetas con factura"],
  otros: ["otros"],
  urea: ["urea def.", "urea", "urea (def)"],
  gastosOperativos: ["gastos operativos"],
  mantenimiento: ["costo mantenimiento", "mantenimiento en ruta", "reparaciones en ruta"],
  costoTotal: ["costo total"],
  tarifa: ["tarifa", "tarifa por tonelada"],
  toneladas: ["toneladas carg.", "toneladas cargadas", "toneladas"],
  ingreso: ["ingreso"],
  pago: ["pago operador", "pago al operador"],
  remisiones: ["remisiones", "remisiones del cliente", "remision"],
  factura: ["no. de factura al cliente", "factura al cliente", "factura"],
} as const;
type ColumnaViaje = keyof typeof COLUMNAS_VIAJE;
const OBLIGATORIAS_VIAJE: ColumnaViaje[] = ["fecha", "folio", "unidad", "operador", "origen", "destino"];

const NUMERICAS = [
  "kmVacio", "kmCargado", "litros", "precio", "importeDiesel", "casetas", "otros", "urea",
  "gastosOperativos", "mantenimiento", "costoTotal", "tarifa", "toneladas", "ingreso", "pago",
] as const;
type Numerica = (typeof NUMERICAS)[number];

/** Columnas de gastos: categoría y si tiene factura por defecto. */
export const GASTOS_IMPORTACION = {
  casetas: { categoria: "Casetas", tieneFactura: true },
  otros: { categoria: "Otros", tieneFactura: false },
  urea: { categoria: "Urea (DEF)", tieneFactura: true },
  gastosOperativos: { categoria: "Gastos operativos", tieneFactura: false },
  mantenimiento: { categoria: "Reparaciones en ruta", tieneFactura: true },
} as const;
type ColumnaGasto = keyof typeof GASTOS_IMPORTACION;

/** Nombre de la columna para mensajes. */
export const NOMBRE_COLUMNA: Record<ColumnaViaje, string> = {
  fecha: "Fecha",
  folio: "No. Viaje",
  unidad: "Unidad",
  operador: "Operador",
  origen: "Origen",
  destino: "Destino",
  cliente: "Cliente",
  kmVacio: "Km vacío",
  kmCargado: "Km cargado",
  litros: "Litros",
  fuente: "Fuente de diésel",
  precio: "Precio por litro",
  importeDiesel: "Importe diésel",
  dieselConFactura: "Diésel con factura",
  casetas: "Casetas",
  casetasConFactura: "Casetas con factura",
  otros: "Otros",
  urea: "Urea",
  gastosOperativos: "Gastos operativos",
  mantenimiento: "Mantenimiento en ruta",
  costoTotal: "Costo total",
  tarifa: "Tarifa por tonelada",
  toneladas: "Toneladas cargadas",
  ingreso: "Ingreso",
  pago: "Pago al operador",
  remisiones: "Remisiones del cliente",
  factura: "No. de factura al cliente",
};

/** Una fila del Excel ya leída. Solo valores simples: viaja del navegador al servidor. */
export interface FilaHistorica {
  /** Número de fila en Excel. */
  fila: number;
  /** "aaaa-mm-dd" o null si no se entiende. */
  fecha: string | null;
  folio: string;
  unidad: string;
  operador: string;
  origen: string;
  destino: string;
  cliente: string;
  fuente: string;
  remisiones: string;
  factura: string;
  numeros: Record<Numerica, number | null>;
  dieselConFactura: boolean | null;
  casetasConFactura: boolean | null;
  /** Partes de las celdas de gasto escritas como suma (=1178+464.5). */
  partes: Partial<Record<ColumnaGasto, number[]>>;
  /** Columnas con algo que no es número. */
  invalidos: string[];
  /** Fórmula del ingreso si usa celdas de otra fila (=Y137*Z136 en la fila 137). */
  ingresoDeOtraFila: string | null;
}

export interface HojaLeida<T> {
  filas: T[];
  /** Número de fila de Excel de los encabezados. */
  filaEncabezados: number;
  /** Columnas opcionales que no vienen. */
  faltantes: string[];
}

const claveEncabezado = (v: unknown) =>
  claveComparacion(String(v ?? "").replace(/\*/g, ""))
    .replace(/\((si|sí)\s*\/\s*no\)/g, "")
    .trim();

function buscarEncabezados<C extends string>(
  hoja: readonly (readonly unknown[])[],
  columnas: Record<C, readonly string[]>,
  obligatorias: readonly C[],
): { fila: number; indices: Record<C, number> } | null {
  for (let fila = 0; fila < Math.min(hoja.length, 30); fila++) {
    const textos = (hoja[fila] ?? []).map(claveEncabezado);
    const indice = (c: C) => textos.findIndex((t) => columnas[c].includes(t));
    if (obligatorias.every((c) => indice(c) >= 0)) {
      const indices = Object.fromEntries((Object.keys(columnas) as C[]).map((c) => [c, indice(c)])) as Record<C, number>;
      return { fila, indices };
    }
  }
  return null;
}

/** Fecha de Excel (Date de la librería, número de serie o texto dd/mm/aaaa o aaaa-mm-dd) → "aaaa-mm-dd". */
export function fechaDeCelda(v: unknown): string | null {
  const aTexto = (d: Date) => (Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10));
  if (v instanceof Date) return aTexto(v);
  if (typeof v === "number" && v > 20000 && v < 80000) return aTexto(new Date(Date.UTC(1899, 11, 30) + Math.round(v) * 86_400_000));
  const t = normalizarTexto(v);
  let m = /^(\d{4})-(\d{2})-(\d{2})/.exec(t);
  if (m) return aTexto(new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])));
  m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(t);
  if (m) {
    const d = new Date(Date.UTC(+m[3], +m[2] - 1, +m[1]));
    return d.getUTCDate() === +m[1] ? aTexto(d) : null;
  }
  return null;
}

/** "Sí" / "no" de una celda; null si está vacía o no se entiende. */
export function siNo(v: unknown): boolean | null {
  if (typeof v === "boolean") return v;
  const t = claveComparacion(v);
  if (["si", "s", "x", "1", "true", "verdadero", "con factura"].includes(t)) return true;
  if (["no", "n", "0", "false", "falso", "sin factura"].includes(t)) return false;
  return null;
}

const mayusculas = (v: unknown) => normalizarTexto(v).toUpperCase();

/**
 * Lee la hoja de viajes. Busca los encabezados por nombre (no depende de la
 * posición). `formulas` (referencia → fórmula) da las partes de las sumas.
 */
export function leerHojaViajes(
  hoja: readonly (readonly unknown[])[],
  formulas: Readonly<Record<string, string>> = {},
): HojaLeida<FilaHistorica> | { error: string } {
  const enc = buscarEncabezados<ColumnaViaje>(hoja, COLUMNAS_VIAJE, OBLIGATORIAS_VIAJE);
  if (!enc) {
    return { error: `No encontré los encabezados: ${OBLIGATORIAS_VIAJE.map((c) => NOMBRE_COLUMNA[c]).join(", ")}.` };
  }
  const { indices } = enc;
  const filas: FilaHistorica[] = [];
  for (let i = enc.fila + 1; i < hoja.length; i++) {
    const celdas = hoja[i];
    if (!celdas) continue;
    const celda = (c: ColumnaViaje) => (indices[c] >= 0 ? celdas[indices[c]] : null);
    const folio = mayusculas(celda("folio"));
    const unidad = mayusculas(celda("unidad"));
    // Renglones vacíos o con solo fórmulas arrastradas (MES, rutas…).
    if (!folio && !unidad) continue;
    const invalidos: string[] = [];
    const numeros = Object.fromEntries(
      NUMERICAS.map((c) => {
        const n = parsearNumero(celda(c));
        if (n !== null && Number.isNaN(n)) {
          // Un error de Excel (#DIV/0!) o texto en una columna de números.
          invalidos.push(NOMBRE_COLUMNA[c]);
          return [c, null];
        }
        return [c, n];
      }),
    ) as Record<Numerica, number | null>;
    const partes: FilaHistorica["partes"] = {};
    for (const c of Object.keys(GASTOS_IMPORTACION) as ColumnaGasto[]) {
      if (indices[c] < 0) continue;
      const p = partesDeSuma(formulas[`${letraColumna(indices[c])}${i + 1}`]);
      if (p) partes[c] = p;
    }
    const formulaIngreso = indices.ingreso >= 0 ? formulas[`${letraColumna(indices.ingreso)}${i + 1}`] : undefined;
    const otraFila = [...(formulaIngreso ?? "").matchAll(/\$?[A-Z]{1,3}\$?(\d+)/g)].some((m) => Number(m[1]) !== i + 1);
    filas.push({
      fila: i + 1,
      fecha: fechaDeCelda(celda("fecha")),
      folio,
      unidad,
      operador: mayusculas(celda("operador")),
      origen: mayusculas(celda("origen")),
      destino: mayusculas(celda("destino")),
      cliente: mayusculas(celda("cliente")),
      fuente: mayusculas(celda("fuente")),
      remisiones: normalizarTexto(celda("remisiones")),
      factura: normalizarTexto(celda("factura")),
      numeros,
      dieselConFactura: siNo(celda("dieselConFactura")),
      casetasConFactura: siNo(celda("casetasConFactura")),
      partes,
      invalidos,
      ingresoDeOtraFila: otraFila ? `=${formulaIngreso}` : null,
    });
  }
  return {
    filas,
    filaEncabezados: enc.fila + 1,
    faltantes: (Object.keys(COLUMNAS_VIAJE) as ColumnaViaje[]).filter((c) => indices[c] < 0).map((c) => NOMBRE_COLUMNA[c]),
  };
}

// ---------------------------------------------------------------------------
// Folios
// ---------------------------------------------------------------------------

/**
 * Partes de un folio escrito con diagonal: "UL-005928 / UL-005929" →
 * [UL-005928, UL-005929]. Una parte solo con números toma el prefijo de la
 * primera: "UL-005926/005930" → [UL-005926, UL-005930].
 */
export function partirFolio(texto: string): string[] {
  const partes = texto
    .split("/")
    .map((p) => p.replace(/\s+/g, "").toUpperCase())
    .filter(Boolean);
  const prefijo = /^(.*?)\d+$/.exec(partes[0] ?? "")?.[1] ?? "";
  return partes.map((p, i) => (i > 0 && /^\d+$/.test(p) ? `${prefijo}${p}` : p));
}

// ---------------------------------------------------------------------------
// Armar los viajes
// ---------------------------------------------------------------------------

export interface ContextoViajes {
  archivo: string;
  unidades: readonly { id: string; numero_economico: string }[];
  operadores: readonly string[];
  clientes: readonly string[];
  fuentes: readonly { nombre: string; tiene_factura: boolean }[];
  /** Folios que ya ocupa un viaje (en mayúsculas). */
  foliosExistentes: readonly string[];
}

export interface CargaImportada {
  fuente: string;
  litros: number;
  precio_litro: number | null;
  /** Total pagado (el importe del Excel). */
  importe: number | null;
  tiene_factura: boolean;
  iva: number;
}
export interface GastoImportado {
  categoria: string;
  monto: number;
  tiene_factura: boolean;
  iva: number;
  notas: string | null;
}
/** Lo que se manda a la base por cada viaje. */
export interface ViajeImportado {
  fila: number;
  folio: string;
  remisiones: string[];
  factura_cliente: string | null;
  /** "aaaa-mm-dd": salida y llegada ese día a mediodía. */
  dia: string;
  unidad_id: string;
  operador: string;
  cliente: string | null;
  origen: string;
  destino: string;
  km_vacio: number;
  km_cargado: number;
  toneladas: number | null;
  tarifa: number | null;
  pago_manual: number | null;
  carga: CargaImportada | null;
  gastos: GastoImportado[];
  notas: string;
}

export type EstadoImportacion = "nuevo" | "existe" | "error";

export interface PreviaViaje {
  fila: number;
  folio: string;
  estado: EstadoImportacion;
  errores: string[];
  avisos: string[];
  fecha: string | null;
  unidad: string;
  operador: string;
  ruta: string;
  km: number;
  litros: number;
  diesel: number | null;
  gastos: number;
  ingreso: number | null;
  pago: number | null;
  remisiones: string[];
  /** Listo para guardar (solo si es nuevo y sin errores). */
  viaje: ViajeImportado | null;
}

export interface ResultadoViajes {
  previas: PreviaViaje[];
  /** Catálogos que se darán de alta. */
  nuevos: { operadores: string[]; clientes: string[]; fuentes: string[] };
}

/** Límites de los avisos (revisión del Excel, no son parámetros del negocio). */
export const LIMITES_AVISO = { kmTotales: 3000, rendimientoMin: 0.8, rendimientoMax: 3 } as const;
export const ORIGEN_SIN_DATO = "(SIN DATO)";

const r1 = (n: number) => Math.round(n * 10) / 10;
const r2 = (n: number) => Math.round(n * 100) / 100;
const r3 = (n: number) => Math.round(n * 1000) / 1000;
const r4 = (n: number) => Math.round(n * 10_000) / 10_000;

/** Nombre del catálogo si ya existe (sin importar acentos ni mayúsculas); si no, el del Excel. */
function enCatalogo(nombre: string, existentes: readonly string[]): { nombre: string; nuevo: boolean } {
  const clave = claveComparacion(nombre);
  const hallado = existentes.find((e) => claveComparacion(e) === clave);
  return hallado ? { nombre: hallado, nuevo: false } : { nombre, nuevo: true };
}

export function armarViajes(filas: readonly FilaHistorica[], ctx: ContextoViajes): ResultadoViajes {
  const unidadPorClave = new Map(ctx.unidades.map((u) => [claveComparacion(u.numero_economico), u]));
  const existentes = new Set(ctx.foliosExistentes.map((f) => f.toUpperCase()));
  const nuevos = { operadores: new Set<string>(), clientes: new Set<string>(), fuentes: new Set<string>() };

  // 1. Folio y remisiones de cada fila.
  const grupos = new Map<string, FilaHistorica[]>();
  for (const f of filas) {
    const clave = f.folio.replace(/\s+/g, "");
    if (clave) grupos.set(clave, [...(grupos.get(clave) ?? []), f]);
  }
  const folioDe = new Map<number, { folio: string; remisiones: string[]; errores: string[]; avisos: string[] }>();
  for (const [, grupo] of grupos) {
    const partes = partirFolio(grupo[0].folio);
    if (grupo.length === 1) {
      folioDe.set(grupo[0].fila, { folio: partes[0], remisiones: partes.length > 1 ? partes : [], errores: [], avisos: [] });
    } else if (partes.length === grupo.length) {
      // Viajes distintos facturados juntos: cada fila toma su folio en orden de fecha.
      const ordenadas = [...grupo].sort((a, b) => (a.fecha ?? "").localeCompare(b.fecha ?? "") || a.fila - b.fila);
      ordenadas.forEach((f, i) => {
        const otros = partes.filter((_, j) => j !== i).join(", ");
        folioDe.set(f.fila, {
          folio: partes[i],
          remisiones: [],
          errores: [],
          avisos: [
            `«${f.folio}» está en ${grupo.length} filas: este viaje es ${partes[i]} (también ${otros}). Comparten factura al cliente: captura su número en ${grupo.length === 2 ? "ambos" : "todos"}.`,
          ],
        });
      });
    } else {
      for (const f of grupo) {
        folioDe.set(f.fila, {
          folio: partes[0],
          remisiones: [],
          errores: [`El folio «${f.folio}» se repite en las filas ${grupo.map((g) => g.fila).join(", ")}`],
          avisos: [],
        });
      }
    }
  }
  // Un folio que resulta igual en dos filas distintas.
  const usos = new Map<string, number[]>();
  for (const [fila, f] of folioDe) usos.set(f.folio, [...(usos.get(f.folio) ?? []), fila]);
  for (const [folio, enFilas] of usos) {
    if (enFilas.length > 1) {
      for (const fila of enFilas) {
        const f = folioDe.get(fila)!;
        if (!f.errores.length) f.errores.push(`El folio ${folio} queda repetido en las filas ${enFilas.join(", ")}`);
      }
    }
  }

  // 2. Cada viaje.
  const previas = filas.map((f): PreviaViaje => {
    const n = f.numeros;
    const asignado = folioDe.get(f.fila) ?? { folio: "", remisiones: [], errores: [], avisos: [] };
    const errores = [...asignado.errores];
    const avisos = [...asignado.avisos];
    if (!f.folio) errores.push("Falta el No. de viaje (folio)");
    if (!f.fecha) errores.push("Fecha inválida o vacía");
    const unidad = unidadPorClave.get(claveComparacion(f.unidad));
    if (!f.unidad) errores.push("Falta la unidad");
    else if (!unidad) errores.push(`La unidad ${f.unidad} no está en el catálogo`);
    if (!f.operador) errores.push("Falta el operador");
    if (!f.origen) errores.push("Falta el origen");
    if (!f.destino) errores.push("Falta el destino");
    if (f.invalidos.length) errores.push(`No es número: ${f.invalidos.join(", ")}`);
    const negativos = NUMERICAS.filter((c) => (n[c] ?? 0) < 0);
    if (negativos.length) errores.push(`Negativo: ${negativos.map((c) => NOMBRE_COLUMNA[c]).join(", ")}`);
    if ((n.toneladas ?? 0) >= 10_000) errores.push("Toneladas fuera de rango");
    const remisiones = [...asignado.remisiones];
    for (const r of parsearRemisiones(f.remisiones)) if (!remisiones.some((x) => x.toUpperCase() === r.toUpperCase())) remisiones.push(r);
    if (remisiones.length > 20 || remisiones.some((r) => r.length > 40)) errores.push("Remisiones: máximo 20, de hasta 40 caracteres");
    if (f.factura.length > 40) errores.push("No. de factura al cliente: máximo 40 caracteres");

    // Catálogos: operador, cliente y fuente nuevos se dan de alta.
    const operador = enCatalogo(f.operador, ctx.operadores);
    const cliente = f.cliente ? enCatalogo(f.cliente, ctx.clientes) : null;

    // Km
    const kmVacio = r1(n.kmVacio ?? 0);
    const kmCargado = r1(n.kmCargado ?? 0);
    const km = r1(kmVacio + kmCargado);
    if (!kmVacio) avisos.push("Km vacío en 0");
    if (!kmCargado) avisos.push("Km cargado en 0");
    if (km > LIMITES_AVISO.kmTotales) avisos.push(`Km totales mayores a ${LIMITES_AVISO.kmTotales.toLocaleString("es-MX")} (${km.toLocaleString("es-MX")})`);

    // Diésel
    const litros = r2(n.litros ?? 0);
    let carga: CargaImportada | null = null;
    if (litros > 0) {
      const fuente = f.fuente ? enCatalogo(f.fuente, ctx.fuentes.map((x) => x.nombre)) : null;
      if (!fuente) errores.push("Hay litros pero falta la fuente del diésel (dispersión)");
      else {
        const precio = n.precio && n.precio > 0 ? r4(n.precio) : null;
        const importe = n.importeDiesel && n.importeDiesel > 0 ? r2(n.importeDiesel) : precio !== null ? r2(litros * precio) : null;
        const tieneFactura = f.dieselConFactura ?? ctx.fuentes.find((x) => x.nombre === fuente.nombre)?.tiene_factura ?? true;
        if (importe === null) avisos.push("Diésel sin precio ni importe: se estima con el precio de Parámetros");
        carga = {
          fuente: fuente.nombre,
          litros,
          precio_litro: precio,
          importe,
          tiene_factura: tieneFactura,
          iva: importe === null ? 0 : desglosarIva(importe, tieneFactura, 16).iva,
        };
        const rend = km / litros;
        if (km > 0 && (rend < LIMITES_AVISO.rendimientoMin || rend > LIMITES_AVISO.rendimientoMax)) {
          avisos.push(`Rendimiento de ${rend.toFixed(2)} km/l (fuera de ${LIMITES_AVISO.rendimientoMin} a ${LIMITES_AVISO.rendimientoMax})`);
        }
        if (fuente.nuevo) nuevos.fuentes.add(fuente.nombre);
      }
    } else {
      avisos.push("Sin litros: el viaje entra sin carga de diésel");
    }

    // Gastos
    const gastos: GastoImportado[] = [];
    for (const c of Object.keys(GASTOS_IMPORTACION) as ColumnaGasto[]) {
      const monto = r2(n[c] ?? 0);
      if (monto <= 0) continue;
      const tieneFactura = c === "casetas" ? (f.casetasConFactura ?? true) : GASTOS_IMPORTACION[c].tieneFactura;
      const partes = f.partes[c];
      gastos.push({
        categoria: GASTOS_IMPORTACION[c].categoria,
        monto,
        tiene_factura: tieneFactura,
        iva: desglosarIva(monto, tieneFactura, 16).iva,
        notas: partes ? `Del Excel: ${partes.join(" + ")}` : null,
      });
    }

    // Ingreso y pago
    const tarifa = n.tarifa && n.tarifa > 0 ? r2(n.tarifa) : null;
    const toneladas = n.toneladas && n.toneladas > 0 ? r3(n.toneladas) : null;
    const ingreso = tarifa !== null && toneladas !== null ? r2(tarifa * toneladas) : null;
    if (tarifa === null) avisos.push("Sin tarifa: entra sin ingreso");
    else if (toneladas === null) avisos.push("Sin toneladas cargadas: no se calcula el ingreso");
    if (ingreso !== null && n.ingreso !== null && Math.abs(n.ingreso - ingreso) > 1) {
      avisos.push(`El ingreso del Excel (${pesos(n.ingreso)}) no es tarifa × toneladas (${pesos(ingreso)}): se usa tarifa × toneladas`);
    }
    if (f.ingresoDeOtraFila) {
      avisos.push(`La fórmula del ingreso en el Excel (${f.ingresoDeOtraFila}) usa datos de otra fila; aquí se calcula con los de esta`);
    }
    const pago = n.pago !== null && n.pago >= 0 ? r2(n.pago) : null;
    const gastosTotal = r2(gastos.reduce((s, g) => s + g.monto, 0));
    if (n.costoTotal !== null) {
      const nuestro = r2((carga?.importe ?? 0) + gastosTotal + (pago ?? 0));
      if (Math.abs(n.costoTotal - nuestro) > 1) {
        avisos.push(`El costo total del Excel (${pesos(n.costoTotal)}) no cuadra con diésel + gastos + pago (${pesos(nuestro)})`);
      }
    }

    const folio = asignado.folio;
    let estado: EstadoImportacion = errores.length ? "error" : "nuevo";
    if (estado === "nuevo" && existentes.has(folio.toUpperCase())) {
      estado = "existe";
      avisos.unshift(`Ya existe un viaje ${folio}: se omite y no se sobrescribe`);
    }
    if (estado === "nuevo") {
      if (operador.nuevo) nuevos.operadores.add(operador.nombre);
      if (cliente?.nuevo) nuevos.clientes.add(cliente.nombre);
    }
    return {
      fila: f.fila,
      folio: folio || f.folio,
      estado,
      errores,
      avisos,
      fecha: f.fecha,
      unidad: f.unidad,
      operador: operador.nombre,
      ruta: `${f.origen} → ${f.destino}`,
      km,
      litros,
      diesel: carga?.importe ?? null,
      gastos: gastosTotal,
      ingreso,
      pago,
      remisiones,
      viaje:
        estado === "nuevo"
          ? {
              fila: f.fila,
              folio,
              remisiones,
              factura_cliente: f.factura || null,
              dia: f.fecha!,
              unidad_id: unidad!.id,
              operador: operador.nombre,
              cliente: cliente?.nombre ?? null,
              origen: f.origen,
              destino: f.destino,
              km_vacio: kmVacio,
              km_cargado: kmCargado,
              toneladas,
              tarifa,
              pago_manual: pago,
              carga,
              gastos,
              notas: `Importado de «${ctx.archivo}», fila ${f.fila}`,
            }
          : null,
    };
  });

  // Fuentes nuevas solo si las usa un viaje que sí entra.
  const fuentesUsadas = new Set(previas.flatMap((p) => (p.viaje?.carga ? [p.viaje.carga.fuente] : [])));
  return {
    previas,
    nuevos: {
      operadores: [...nuevos.operadores].sort(),
      clientes: [...nuevos.clientes].sort(),
      fuentes: [...nuevos.fuentes].filter((x) => fuentesUsadas.has(x)).sort(),
    },
  };
}

// ---------------------------------------------------------------------------
// Costos por unidad y mes
// ---------------------------------------------------------------------------

const COLUMNAS_COSTO = {
  unidad: ["unidad", "no. economico", "numero economico"],
  mes: ["mes"],
  anio: ["ano", "año"],
  mttoTracto: ["mtto tracto", "mantenimiento tracto"],
  mttoArrastre: ["mtto equipo arrastre", "mtto equipo de arrastre", "mantenimiento equipo de arrastre"],
  mttoOtros: ["mmto otros", "mtto otros", "mantenimiento otros"],
  llantas: ["llantas/rines", "llantas y rines", "llantas"],
} as const;
type ColumnaCosto = keyof typeof COLUMNAS_COSTO;
type MontoCosto = "mttoTracto" | "mttoArrastre" | "mttoOtros" | "llantas";

/** Columna del Excel → categoría de costo. */
export const CATEGORIAS_COSTO_IMPORTACION: Record<MontoCosto, string> = {
  mttoTracto: "Mantenimiento tracto",
  mttoArrastre: "Mantenimiento equipo de arrastre",
  mttoOtros: "Otros",
  llantas: "Llantas y rines",
};
const MONTOS_COSTO = Object.keys(CATEGORIAS_COSTO_IMPORTACION) as MontoCosto[];

export interface FilaCostoHistorico {
  fila: number;
  unidad: string;
  mes: number | null;
  anio: number | null;
  montos: Record<MontoCosto, number | null>;
  partes: Partial<Record<MontoCosto, number[]>>;
  invalidos: string[];
}

/** Lee la hoja de costos por unidad y mes (KPIs_Unidad_Mes o la plantilla). */
export function leerHojaCostos(
  hoja: readonly (readonly unknown[])[],
  formulas: Readonly<Record<string, string>> = {},
): HojaLeida<FilaCostoHistorico> | { error: string } {
  const enc = buscarEncabezados<ColumnaCosto>(hoja, COLUMNAS_COSTO, ["unidad", "mes"]);
  if (!enc || MONTOS_COSTO.every((c) => enc.indices[c] < 0)) {
    return { error: "No encontré los encabezados Unidad, Mes y al menos uno de mantenimiento o llantas." };
  }
  const { indices } = enc;
  const filas: FilaCostoHistorico[] = [];
  for (let i = enc.fila + 1; i < hoja.length; i++) {
    const celdas = hoja[i];
    if (!celdas) continue;
    const celda = (c: ColumnaCosto) => (indices[c] >= 0 ? celdas[indices[c]] : null);
    const unidad = mayusculas(celda("unidad"));
    if (!unidad) continue;
    const invalidos: string[] = [];
    const montos = Object.fromEntries(
      MONTOS_COSTO.map((c) => {
        const n = parsearNumero(celda(c));
        if (n !== null && Number.isNaN(n)) {
          invalidos.push(CATEGORIAS_COSTO_IMPORTACION[c]);
          return [c, null];
        }
        return [c, n];
      }),
    ) as Record<MontoCosto, number | null>;
    // Sin ningún monto no hay nada que importar de esta fila.
    if (MONTOS_COSTO.every((c) => !montos[c]) && !invalidos.length) continue;
    const partes: FilaCostoHistorico["partes"] = {};
    for (const c of MONTOS_COSTO) {
      if (indices[c] < 0) continue;
      const p = partesDeSuma(formulas[`${letraColumna(indices[c])}${i + 1}`]);
      if (p) partes[c] = p;
    }
    const mes = parsearNumero(celda("mes"));
    const anio = parsearNumero(celda("anio"));
    filas.push({
      fila: i + 1,
      unidad,
      mes: mes !== null && Number.isInteger(mes) && mes >= 1 && mes <= 12 ? mes : null,
      anio: anio !== null && Number.isInteger(anio) && anio >= 2000 && anio <= 2100 ? anio : null,
      montos,
      partes,
      invalidos,
    });
  }
  return {
    filas,
    filaEncabezados: enc.fila + 1,
    faltantes: (Object.keys(COLUMNAS_COSTO) as ColumnaCosto[]).filter((c) => indices[c] < 0),
  };
}

export interface ContextoCostos {
  archivo: string;
  /** Año de las filas que no traen columna Año. */
  anio: number;
  unidades: readonly { id: string; numero_economico: string }[];
  /** Costos de importaciones anteriores vigentes: llaveCosto(unidad_id, "aaaa-mm-01", categoría). */
  existentes: readonly string[];
}

/** Lo que se manda a la base por cada costo. */
export interface CostoImportado {
  fila: number;
  unidad_id: string;
  categoria: string;
  /** "aaaa-mm-01" */
  mes: string;
  /** Total con IVA (subtotal × 1.16). */
  monto: number;
  iva: number;
  notas: string;
}

export interface PreviaCosto {
  fila: number;
  unidad: string;
  mes: string | null;
  categoria: string;
  /** Subtotal sin IVA (el monto del Excel). */
  subtotal: number | null;
  estado: EstadoImportacion;
  errores: string[];
  avisos: string[];
  costo: CostoImportado | null;
}

export const llaveCosto = (unidadId: string, mes: string, categoria: string) =>
  `${unidadId}|${mes.slice(0, 7)}|${claveComparacion(categoria)}`;

export function armarCostos(filas: readonly FilaCostoHistorico[], ctx: ContextoCostos): PreviaCosto[] {
  const unidadPorClave = new Map(ctx.unidades.map((u) => [claveComparacion(u.numero_economico), u]));
  const existentes = new Set(ctx.existentes);
  const vistas = new Set<string>();
  return filas.flatMap((f) => {
    const unidad = unidadPorClave.get(claveComparacion(f.unidad));
    const anio = f.anio ?? ctx.anio;
    const mes = f.mes === null ? null : `${anio}-${String(f.mes).padStart(2, "0")}-01`;
    const erroresFila: string[] = [];
    if (!unidad) erroresFila.push(`La unidad ${f.unidad} no está en el catálogo`);
    if (!mes) erroresFila.push("Mes inválido (1 a 12)");
    if (f.invalidos.length) erroresFila.push(`No es número: ${f.invalidos.join(", ")}`);
    const conMonto = MONTOS_COSTO.filter((c) => f.montos[c]);
    if (!conMonto.length) {
      return [{ fila: f.fila, unidad: f.unidad, mes, categoria: "—", subtotal: null, estado: "error" as const, errores: erroresFila, avisos: [], costo: null }];
    }
    return conMonto.map((c): PreviaCosto => {
      const categoria = CATEGORIAS_COSTO_IMPORTACION[c];
      const subtotal = r2(f.montos[c]!);
      const errores = [...erroresFila];
      const avisos: string[] = [];
      if (subtotal < 0) errores.push("Monto negativo");
      let estado: EstadoImportacion = errores.length ? "error" : "nuevo";
      if (estado === "nuevo") {
        const llave = llaveCosto(unidad!.id, mes!, categoria);
        if (existentes.has(llave)) {
          estado = "existe";
          avisos.push("Ya se importó en un lote anterior: se omite");
        } else if (vistas.has(llave)) {
          estado = "error";
          errores.push("Misma unidad, mes y categoría en otra fila");
        }
        vistas.add(llave);
      }
      const iva = r2(subtotal * 0.16);
      const partes = f.partes[c];
      return {
        fila: f.fila,
        unidad: f.unidad,
        mes,
        categoria,
        subtotal,
        estado,
        errores,
        avisos,
        costo:
          estado === "nuevo"
            ? {
                fila: f.fila,
                unidad_id: unidad!.id,
                categoria,
                mes: mes!,
                monto: r2(subtotal + iva),
                iva,
                notas: `Importado de «${ctx.archivo}», fila ${f.fila}: subtotal sin IVA${partes ? ` (${partes.join(" + ")})` : ""}`,
              }
            : null,
      };
    });
  });
}

/** Año más común de las fechas de los viajes (para los costos sin columna Año). */
export function anioMasComun(filas: readonly FilaHistorica[], porDefecto: number): number {
  const cuenta = new Map<number, number>();
  for (const f of filas) if (f.fecha) cuenta.set(+f.fecha.slice(0, 4), (cuenta.get(+f.fecha.slice(0, 4)) ?? 0) + 1);
  return [...cuenta.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? porDefecto;
}

/** Encabezados de la plantilla de viajes (los mismos nombres que se reconocen al leer). */
export const PLANTILLA_VIAJES = [
  "Fecha", "No. Viaje", "Unidad", "Operador", "Origen", "Destino", "Cliente", "Km vacío", "Km cargado",
  "Litros", "Fuente de diésel", "Precio por litro", "Importe diésel", "Diésel con factura (sí/no)",
  "Casetas", "Casetas con factura (sí/no)", "Otros", "Urea", "Gastos operativos", "Mantenimiento en ruta",
  "Tarifa por tonelada", "Toneladas cargadas", "Pago al operador", "Remisiones del cliente", "No. de factura al cliente",
];
/** Encabezados de la plantilla de mantenimiento por unidad y mes (subtotales sin IVA). */
export const PLANTILLA_COSTOS = ["Unidad", "Año", "Mes", "MTTO TRACTO", "MTTO EQUIPO ARRASTRE", "MTTO OTROS", "Llantas y rines"];
