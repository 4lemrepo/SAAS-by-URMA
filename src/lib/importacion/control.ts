/**
 * "Leer mi control de viajes": saca los catálogos de una hoja de viajes de Excel
 * (una fila por viaje). Busca la fila de encabezados por nombre de columna, así
 * no depende de una plantilla exacta. No guarda nada: arma la vista previa.
 */
import { claveComparacion, normalizarTexto, parsearNumero } from "@/lib/catalogos/validacion";

const COLUMNAS = {
  unidad: ["unidad", "no. economico", "numero economico"],
  placas: ["placas", "placa"],
  operador: ["operador", "chofer"],
  cliente: ["cliente"],
  origen: ["origen"],
  destino: ["destino"],
  kmVacio: ["km vacio", "kms vacio"],
  kmCargado: ["km cargado", "kms cargado"],
  litros: ["litros"],
  fuente: ["dispersion", "fuente", "fuente de diesel"],
} as const;
type Columna = keyof typeof COLUMNAS;
const OBLIGATORIAS: Columna[] = ["unidad", "operador", "origen", "destino"];

export interface Conteo {
  nombre: string;
  viajes: number;
}
export interface UnidadControl {
  numero_economico: string;
  placas: string | null;
  viajes: number;
  /** km/l real: km totales ÷ litros de los viajes que tienen ambos. No se guarda solo. */
  rendimientoSugerido: number | null;
  viajesConLitros: number;
}
export interface VarianteKm {
  /** null = viaje sin km cargado. */
  km: number | null;
  viajes: number;
}
export interface RutaControl {
  /** Llave estable para guardar la decisión de km del usuario. */
  clave: string;
  origen: string;
  destino: string;
  viajes: number;
  /** De la más usada a la menos usada. */
  variantes: VarianteKm[];
}
export interface ControlDeViajes {
  viajes: number;
  filaEncabezados: number;
  unidades: UnidadControl[];
  operadores: Conteo[];
  clientes: Conteo[];
  fuentes: Conteo[];
  rutas: RutaControl[];
  columnasFaltantes: string[];
}

/** Texto en mayúsculas sin espacios de más; los orígenes compuestos ("PUEBLA / BRISEÑAS") se quedan igual. */
const limpiar = (v: unknown) => normalizarTexto(v).toUpperCase();

/** Cuenta valores agrupando variantes de escritura; muestra la más común. */
class Agrupador {
  private grupos = new Map<string, { variantes: Map<string, number>; viajes: number }>();
  agregar(texto: string) {
    if (!texto) return;
    const llave = claveComparacion(texto);
    const g = this.grupos.get(llave) ?? { variantes: new Map(), viajes: 0 };
    g.variantes.set(texto, (g.variantes.get(texto) ?? 0) + 1);
    g.viajes++;
    this.grupos.set(llave, g);
  }
  lista(): Conteo[] {
    return [...this.grupos.values()]
      .map((g) => ({ nombre: masComun(g.variantes), viajes: g.viajes }))
      .sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));
  }
}

function masComun<T>(conteo: Map<T, number>): T {
  return [...conteo.entries()].sort((a, b) => b[1] - a[1])[0][0];
}

function buscarEncabezados(hoja: readonly (readonly unknown[])[]) {
  for (let fila = 0; fila < Math.min(hoja.length, 30); fila++) {
    const textos = hoja[fila].map((c) => claveComparacion(c));
    const indice = (col: Columna) => textos.findIndex((t) => (COLUMNAS[col] as readonly string[]).includes(t));
    if (OBLIGATORIAS.every((c) => indice(c) >= 0)) {
      const indices = Object.fromEntries(
        (Object.keys(COLUMNAS) as Columna[]).map((c) => [c, indice(c)]),
      ) as Record<Columna, number>;
      return { fila, indices };
    }
  }
  return null;
}

export function leerControlDeViajes(hoja: readonly (readonly unknown[])[]): ControlDeViajes | { error: string } {
  const encabezados = buscarEncabezados(hoja);
  if (!encabezados) {
    return { error: "No encontré una fila de encabezados con Unidad, Operador, Origen y Destino." };
  }
  const { indices } = encabezados;
  const celda = (fila: readonly unknown[], col: Columna) => (indices[col] >= 0 ? fila[indices[col]] : null);

  const unidades = new Map<string, { textos: Map<string, number>; placas: Map<string, number>; viajes: number; km: number; litros: number; viajesConLitros: number }>();
  const operadores = new Agrupador();
  const clientes = new Agrupador();
  const fuentes = new Agrupador();
  const rutas = new Map<string, { origenes: Map<string, number>; destinos: Map<string, number>; km: Map<number | null, number>; viajes: number }>();
  let viajes = 0;

  for (const fila of hoja.slice(encabezados.fila + 1)) {
    const unidad = limpiar(celda(fila, "unidad"));
    // Las filas sin unidad son fórmulas o renglones vacíos de la plantilla.
    if (!unidad) continue;
    viajes++;

    const llaveUnidad = claveComparacion(unidad);
    const u = unidades.get(llaveUnidad) ?? { textos: new Map(), placas: new Map(), viajes: 0, km: 0, litros: 0, viajesConLitros: 0 };
    u.textos.set(unidad, (u.textos.get(unidad) ?? 0) + 1);
    const placas = limpiar(celda(fila, "placas"));
    if (placas) u.placas.set(placas, (u.placas.get(placas) ?? 0) + 1);
    u.viajes++;
    const kmVacio = parsearNumero(celda(fila, "kmVacio"));
    const kmCargado = parsearNumero(celda(fila, "kmCargado"));
    const litros = parsearNumero(celda(fila, "litros"));
    const km = (Number.isFinite(kmVacio) ? (kmVacio ?? 0) : 0) + (Number.isFinite(kmCargado) ? (kmCargado ?? 0) : 0);
    if (litros !== null && Number.isFinite(litros) && litros > 0 && km > 0) {
      u.km += km;
      u.litros += litros;
      u.viajesConLitros++;
    }
    unidades.set(llaveUnidad, u);

    operadores.agregar(limpiar(celda(fila, "operador")));
    clientes.agregar(limpiar(celda(fila, "cliente")));
    fuentes.agregar(limpiar(celda(fila, "fuente")));

    const origen = limpiar(celda(fila, "origen"));
    const destino = limpiar(celda(fila, "destino"));
    if (origen && destino) {
      const llave = `${claveComparacion(origen)} → ${claveComparacion(destino)}`;
      const r = rutas.get(llave) ?? { origenes: new Map(), destinos: new Map(), km: new Map(), viajes: 0 };
      r.origenes.set(origen, (r.origenes.get(origen) ?? 0) + 1);
      r.destinos.set(destino, (r.destinos.get(destino) ?? 0) + 1);
      const kmRuta = kmCargado !== null && Number.isFinite(kmCargado) && kmCargado > 0 ? kmCargado : null;
      r.km.set(kmRuta, (r.km.get(kmRuta) ?? 0) + 1);
      r.viajes++;
      rutas.set(llave, r);
    }
  }

  return {
    viajes,
    filaEncabezados: encabezados.fila + 1,
    columnasFaltantes: (Object.keys(COLUMNAS) as Columna[]).filter((c) => indices[c] < 0),
    unidades: [...unidades.values()]
      .map((u) => ({
        numero_economico: masComun(u.textos),
        placas: u.placas.size ? masComun(u.placas) : null,
        viajes: u.viajes,
        rendimientoSugerido: u.litros > 0 ? Math.round((u.km / u.litros) * 100) / 100 : null,
        viajesConLitros: u.viajesConLitros,
      }))
      .sort((a, b) => a.numero_economico.localeCompare(b.numero_economico, "es")),
    operadores: operadores.lista(),
    clientes: clientes.lista(),
    fuentes: fuentes.lista(),
    rutas: [...rutas.entries()]
      .map(([clave, r]) => ({
        clave,
        origen: masComun(r.origenes),
        destino: masComun(r.destinos),
        viajes: r.viajes,
        variantes: [...r.km.entries()]
          .map(([km, n]) => ({ km, viajes: n }))
          .sort((a, b) => b.viajes - a.viajes || (a.km ?? Infinity) - (b.km ?? Infinity)),
      }))
      .sort((a, b) => a.origen.localeCompare(b.origen, "es") || a.destino.localeCompare(b.destino, "es")),
  };
}

/** Una ruta necesita que el usuario decida los km si tiene más de un valor o ninguno válido. */
export function rutaRequiereDecision(r: RutaControl): boolean {
  const validas = r.variantes.filter((v) => v.km !== null);
  return validas.length !== 1 || r.variantes.length > 1;
}

/** km de la ruta: el único valor si no hay dudas; si hay, lo que decidió el usuario (o null). */
export function kmDeRuta(r: RutaControl, decisiones: Readonly<Record<string, number | undefined>>): number | null {
  if (!rutaRequiereDecision(r)) return r.variantes[0].km;
  return decisiones[r.clave] ?? null;
}
