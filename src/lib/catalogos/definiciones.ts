/**
 * Definición de cada catálogo: tabla, campos y cómo se muestran. Las pantallas
 * y el importador leen de aquí, así un campo se valida igual en ambos lados.
 */

export type ClaveCatalogo = "unidades" | "operadores" | "clientes" | "rutas" | "fuentes";

interface CampoBase {
  /** Nombre de la columna en la base de datos. */
  columna: string;
  etiqueta: string;
  requerido?: boolean;
  ayuda?: string;
}

export interface CampoTexto extends CampoBase {
  tipo: "texto";
  max: number;
  min?: number;
  mayusculas?: boolean;
  /** Expresión que debe cumplir (ya normalizado) y mensaje si no. */
  patron?: { regex: RegExp; mensaje: string };
  sugerencias?: readonly string[];
}

export interface CampoNumero extends CampoBase {
  tipo: "numero";
  min: number;
  max: number;
  /** Decimales permitidos; 0 = entero. */
  decimales: number;
  /** El mínimo es exclusivo (> min en vez de >= min). */
  minExclusivo?: boolean;
  unidad?: string;
}

export interface CampoOpcion extends CampoBase {
  tipo: "opcion";
  opciones: readonly { valor: string; etiqueta: string }[];
  porDefecto?: string;
}

export type Campo = CampoTexto | CampoNumero | CampoOpcion;

export interface DefinicionCatalogo {
  clave: ClaveCatalogo;
  tabla: string;
  /** "Unidades" / "unidad": para títulos y mensajes. */
  titulo: string;
  singular: string;
  /** "una unidad" / "un operador". */
  conArticulo: string;
  descripcion: string;
  columnaActivo: string;
  campos: readonly Campo[];
  /** Columnas que identifican un duplicado (normalizadas sin mayúsculas ni espacios). */
  llaveUnica: readonly string[];
  mensajeDuplicado: string;
  /** Columnas que se ven en la lista, en orden. */
  columnasLista: readonly string[];
  orden: string;
}

/** RFC de persona moral (12) o física (13). Misma regla que validarEmpresa. */
const PATRON_RFC = /^[A-ZÑ&]{3,4}[0-9]{6}[A-Z0-9]{3}$/;

const rendimiento = (columna: string, etiqueta: string, ayuda?: string): CampoNumero => ({
  columna,
  etiqueta,
  tipo: "numero",
  min: 0,
  minExclusivo: true,
  max: 15,
  decimales: 2,
  unidad: "km/l",
  ayuda,
});

export const OPCIONES_CONFIGURACION = [
  { valor: "sencillo", etiqueta: "Sencillo" },
  { valor: "full", etiqueta: "Full" },
] as const;

export const OPCIONES_TIPO_FUENTE = [
  { valor: "tanque_propio", etiqueta: "Tanque propio" },
  { valor: "estacion", etiqueta: "Estación" },
  { valor: "tarjeta", etiqueta: "Tarjeta" },
] as const;

export const CATALOGOS: Record<ClaveCatalogo, DefinicionCatalogo> = {
  unidades: {
    clave: "unidades",
    tabla: "unidades",
    titulo: "Unidades",
    singular: "unidad",
    conArticulo: "una unidad",
    descripcion: "Tractocamiones con su rendimiento esperado.",
    columnaActivo: "activa",
    campos: [
      { columna: "numero_economico", etiqueta: "Número económico", tipo: "texto", requerido: true, max: 20, mayusculas: true },
      { columna: "placas", etiqueta: "Placas", tipo: "texto", max: 15, mayusculas: true },
      { columna: "marca", etiqueta: "Marca", tipo: "texto", max: 40 },
      { columna: "modelo", etiqueta: "Modelo", tipo: "texto", max: 40 },
      { columna: "anio", etiqueta: "Año", tipo: "numero", min: 1950, max: 2100, decimales: 0 },
      {
        columna: "configuracion",
        etiqueta: "Configuración",
        tipo: "opcion",
        requerido: true,
        opciones: OPCIONES_CONFIGURACION,
        porDefecto: "full",
      },
      {
        columna: "tipo_equipo",
        etiqueta: "Tipo de equipo",
        tipo: "texto",
        max: 60,
        sugerencias: ["Góndola granelera", "Jaula ganadera", "Caja seca", "Tolva", "Plataforma", "Pipa"],
      },
      rendimiento("rend_cargado_kml", "Rendimiento cargado", "Kilómetros por litro esperados con carga"),
      rendimiento("rend_vacio_kml", "Rendimiento vacío", "Kilómetros por litro esperados sin carga"),
    ],
    llaveUnica: ["numero_economico"],
    mensajeDuplicado: "Ya existe una unidad con ese número económico",
    columnasLista: ["numero_economico", "placas", "marca", "configuracion", "tipo_equipo", "rend_cargado_kml", "rend_vacio_kml"],
    orden: "numero_economico",
  },
  operadores: {
    clave: "operadores",
    tabla: "operadores",
    titulo: "Operadores",
    singular: "operador",
    conArticulo: "un operador",
    descripcion: "Choferes. Solo son un registro para saber quién manejó cada viaje; no entran al sistema.",
    columnaActivo: "activo",
    campos: [
      { columna: "nombre", etiqueta: "Nombre completo", tipo: "texto", requerido: true, min: 2, max: 120 },
      {
        columna: "telefono",
        etiqueta: "Teléfono",
        tipo: "texto",
        max: 20,
        patron: { regex: /^\+?[0-9 ()-]{7,20}$/, mensaje: "Escribe solo números (10 dígitos)" },
      },
    ],
    llaveUnica: ["nombre"],
    mensajeDuplicado: "Ya existe un operador con ese nombre",
    columnasLista: ["nombre", "telefono"],
    orden: "nombre",
  },
  clientes: {
    clave: "clientes",
    tabla: "clientes",
    titulo: "Clientes",
    singular: "cliente",
    conArticulo: "un cliente",
    descripcion: "A quién le das el servicio de flete.",
    columnaActivo: "activo",
    campos: [
      { columna: "nombre", etiqueta: "Nombre o razón social", tipo: "texto", requerido: true, min: 2, max: 120 },
      {
        columna: "rfc",
        etiqueta: "RFC",
        tipo: "texto",
        max: 13,
        mayusculas: true,
        patron: { regex: PATRON_RFC, mensaje: "RFC inválido (12 caracteres para persona moral, 13 para física)" },
      },
    ],
    llaveUnica: ["nombre"],
    mensajeDuplicado: "Ya existe un cliente con ese nombre",
    columnasLista: ["nombre", "rfc"],
    orden: "nombre",
  },
  rutas: {
    clave: "rutas",
    tabla: "rutas",
    titulo: "Rutas",
    singular: "ruta",
    conArticulo: "una ruta",
    descripcion: "Origen, destino y kilómetros. El rendimiento por ruta es opcional y manda sobre el de la unidad.",
    columnaActivo: "activa",
    campos: [
      { columna: "origen", etiqueta: "Origen", tipo: "texto", requerido: true, min: 2, max: 120 },
      { columna: "destino", etiqueta: "Destino", tipo: "texto", requerido: true, min: 2, max: 120 },
      {
        columna: "km",
        etiqueta: "Kilómetros",
        tipo: "numero",
        requerido: true,
        min: 0,
        minExclusivo: true,
        max: 10000,
        decimales: 1,
        unidad: "km",
        ayuda: "Distancia de un sentido",
      },
      rendimiento("rend_cargado_kml", "Rendimiento cargado (opcional)", "Déjalo vacío para usar el de la unidad"),
      rendimiento("rend_vacio_kml", "Rendimiento vacío (opcional)", "Déjalo vacío para usar el de la unidad"),
    ],
    llaveUnica: ["origen", "destino"],
    mensajeDuplicado: "Ya existe una ruta con ese origen y destino",
    columnasLista: ["origen", "destino", "km", "rend_cargado_kml", "rend_vacio_kml"],
    orden: "origen",
  },
  fuentes: {
    clave: "fuentes",
    tabla: "fuentes_diesel",
    titulo: "Fuentes de diésel",
    singular: "fuente de diésel",
    conArticulo: "una fuente de diésel",
    descripcion: "Dónde se carga: tanques propios, estaciones y tarjetas.",
    columnaActivo: "activa",
    campos: [
      { columna: "nombre", etiqueta: "Nombre", tipo: "texto", requerido: true, min: 2, max: 120, ayuda: "Ej. Tanque La Barca" },
      { columna: "tipo", etiqueta: "Tipo", tipo: "opcion", requerido: true, opciones: OPCIONES_TIPO_FUENTE },
      {
        columna: "capacidad_litros",
        etiqueta: "Capacidad",
        tipo: "numero",
        min: 0,
        minExclusivo: true,
        max: 1_000_000,
        decimales: 1,
        unidad: "litros",
        ayuda: "Solo para tanques propios",
      },
    ],
    llaveUnica: ["nombre"],
    mensajeDuplicado: "Ya existe una fuente de diésel con ese nombre",
    columnasLista: ["nombre", "tipo", "capacidad_litros"],
    orden: "nombre",
  },
};

export const CLAVES_CATALOGO = Object.keys(CATALOGOS) as ClaveCatalogo[];

export function esClaveCatalogo(clave: string): clave is ClaveCatalogo {
  return Object.hasOwn(CATALOGOS, clave);
}
