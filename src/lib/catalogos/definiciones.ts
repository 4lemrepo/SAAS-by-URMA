/**
 * Definición de cada catálogo: tabla, campos y cómo se muestran. Las pantallas
 * y el importador leen de aquí, así un campo se valida igual en ambos lados.
 */

export type ClaveCatalogo =
  | "unidades"
  | "remolques"
  | "dollies"
  | "tipos-remolque"
  | "categorias-gasto"
  | "categorias-costo"
  | "operadores"
  | "clientes"
  | "rutas"
  | "fuentes";

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

/** Elige un registro de otro catálogo (p. ej. el tipo de un remolque). */
export interface CampoReferencia extends CampoBase {
  tipo: "referencia";
  catalogo: ClaveCatalogo;
}

/** Sí o no (casilla). */
export interface CampoBooleano extends CampoBase {
  tipo: "booleano";
  porDefecto: boolean;
}

export type Campo = CampoTexto | CampoNumero | CampoOpcion | CampoReferencia | CampoBooleano;

/** Opción de un campo de referencia: id y cómo se muestra. */
export interface OpcionReferencia {
  valor: string;
  etiqueta: string;
}

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
  /** Columnas que se ven en la lista, en orden (campos o columnas calculadas). */
  columnasLista: readonly string[];
  /** Columnas calculadas que solo se muestran (p. ej. el armado actual de la unidad). */
  calculadas?: readonly { columna: string; etiqueta: string }[];
  /** Columna con la que otro catálogo muestra este registro en una lista de opciones. */
  columnaEtiqueta: string;
  /** Solo dueño y administración lo ven. */
  soloAdmin?: boolean;
  /** Además, solo quien tiene "ve costos" (categorías de costo, que son pesos). */
  requiereVeCostos?: boolean;
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

export const OPCIONES_TIPO_FUENTE = [
  { valor: "tanque_propio", etiqueta: "Tanque propio" },
  { valor: "estacion", etiqueta: "Estación" },
  { valor: "tarjeta", etiqueta: "Tarjeta" },
  { valor: "credito_estacion", etiqueta: "Crédito en estación" },
] as const;

export const CATALOGOS: Record<ClaveCatalogo, DefinicionCatalogo> = {
  unidades: {
    clave: "unidades",
    tabla: "unidades",
    titulo: "Unidades",
    singular: "unidad",
    conArticulo: "una unidad",
    descripcion: "Tractocamiones (número económico) con su rendimiento esperado y su armado actual.",
    columnaActivo: "activa",
    campos: [
      { columna: "numero_economico", etiqueta: "Número económico", tipo: "texto", requerido: true, max: 20, mayusculas: true },
      { columna: "placas", etiqueta: "Placas", tipo: "texto", max: 15, mayusculas: true },
      { columna: "numero_serie", etiqueta: "Número de serie / VIN", tipo: "texto", min: 3, max: 30, mayusculas: true },
      { columna: "marca", etiqueta: "Marca", tipo: "texto", max: 40 },
      { columna: "modelo", etiqueta: "Modelo", tipo: "texto", max: 40 },
      { columna: "anio", etiqueta: "Año", tipo: "numero", min: 1950, max: 2100, decimales: 0 },
      rendimiento("rend_cargado_kml", "Rendimiento cargado", "Kilómetros por litro esperados con carga"),
      rendimiento("rend_vacio_kml", "Rendimiento vacío", "Kilómetros por litro esperados sin carga"),
    ],
    llaveUnica: ["numero_economico"],
    mensajeDuplicado: "Ya existe una unidad con ese número económico (o ese número de serie)",
    columnasLista: ["numero_economico", "placas", "armado", "rend_cargado_kml", "rend_vacio_kml"],
    calculadas: [{ columna: "armado", etiqueta: "Armado actual" }],
    columnaEtiqueta: "numero_economico",
    orden: "numero_economico",
  },
  remolques: {
    clave: "remolques",
    tabla: "remolques",
    titulo: "Remolques",
    singular: "remolque",
    conArticulo: "un remolque",
    descripcion: "Góndolas, jaulas, cajas y demás equipo que se engancha a una unidad.",
    columnaActivo: "activo",
    campos: [
      { columna: "placas", etiqueta: "Placas", tipo: "texto", requerido: true, min: 5, max: 15, mayusculas: true },
      { columna: "numero_serie", etiqueta: "Número de serie", tipo: "texto", requerido: true, min: 3, max: 30, mayusculas: true },
      { columna: "tipo_id", etiqueta: "Tipo", tipo: "referencia", requerido: true, catalogo: "tipos-remolque" },
      {
        columna: "numero_economico",
        etiqueta: "Número económico (opcional)",
        tipo: "texto",
        max: 20,
        mayusculas: true,
      },
    ],
    llaveUnica: ["placas"],
    mensajeDuplicado: "Ya existe un remolque con esas placas, ese número de serie o ese número económico",
    columnasLista: ["placas", "numero_economico", "tipo_id", "numero_serie", "enganchado"],
    calculadas: [{ columna: "enganchado", etiqueta: "Enganchado a" }],
    columnaEtiqueta: "placas",
    orden: "placas",
  },
  dollies: {
    clave: "dollies",
    tabla: "dollies",
    titulo: "Dollies",
    singular: "dolly",
    conArticulo: "un dolly",
    descripcion: "Convertidores para armar un full. No llevan placa.",
    columnaActivo: "activo",
    campos: [
      { columna: "numero_serie", etiqueta: "Número de serie", tipo: "texto", requerido: true, min: 3, max: 30, mayusculas: true },
      {
        columna: "numero_economico",
        etiqueta: "Número económico (opcional)",
        tipo: "texto",
        max: 20,
        mayusculas: true,
      },
    ],
    llaveUnica: ["numero_serie"],
    mensajeDuplicado: "Ya existe un dolly con ese número de serie o ese número económico",
    columnasLista: ["numero_serie", "numero_economico", "enganchado"],
    calculadas: [{ columna: "enganchado", etiqueta: "Enganchado a" }],
    columnaEtiqueta: "numero_serie",
    orden: "numero_serie",
  },
  "tipos-remolque": {
    clave: "tipos-remolque",
    tabla: "tipos_remolque",
    titulo: "Tipos de remolque",
    singular: "tipo de remolque",
    conArticulo: "un tipo de remolque",
    descripcion: "Góndola granelera, jaula ganadera, caja seca… Agrega los que uses.",
    columnaActivo: "activo",
    campos: [{ columna: "nombre", etiqueta: "Nombre", tipo: "texto", requerido: true, min: 2, max: 60 }],
    llaveUnica: ["nombre"],
    mensajeDuplicado: "Ya existe ese tipo de remolque",
    columnasLista: ["nombre"],
    columnaEtiqueta: "nombre",
    orden: "nombre",
  },
  "categorias-gasto": {
    clave: "categorias-gasto",
    tabla: "categorias_gasto",
    titulo: "Categorías de gasto",
    singular: "categoría de gasto",
    conArticulo: "una categoría de gasto",
    descripcion: "Casetas, maniobras, estadías… para los gastos de cada viaje, y si traen factura.",
    columnaActivo: "activo",
    campos: [
      { columna: "nombre", etiqueta: "Nombre", tipo: "texto", requerido: true, min: 2, max: 60 },
      {
        columna: "tiene_factura",
        etiqueta: "Con factura por defecto",
        tipo: "booleano",
        porDefecto: false,
        ayuda: "Valor inicial de «¿Tiene factura?» al capturar un gasto de esta categoría. Se puede cambiar en cada uno.",
      },
    ],
    llaveUnica: ["nombre"],
    mensajeDuplicado: "Ya existe esa categoría",
    columnasLista: ["nombre", "tiene_factura"],
    columnaEtiqueta: "nombre",
    orden: "nombre",
  },
  "categorias-costo": {
    clave: "categorias-costo",
    tabla: "categorias_costo",
    titulo: "Categorías de costo",
    singular: "categoría de costo",
    conArticulo: "una categoría de costo",
    descripcion: "Mantenimiento, llantas, seguro, oficina… y si entran en la rentabilidad.",
    columnaActivo: "activo",
    campos: [
      { columna: "nombre", etiqueta: "Nombre", tipo: "texto", requerido: true, min: 2, max: 60 },
      {
        columna: "incluir_en_rentabilidad",
        etiqueta: "Incluir en rentabilidad",
        tipo: "booleano",
        porDefecto: true,
        ayuda: "Apagado: se registra pero no entra en los KPIs (p. ej. sueldo fijo e IMSS). Cambiarlo recalcula también meses pasados.",
      },
      {
        columna: "tiene_factura",
        etiqueta: "Con factura por defecto",
        tipo: "booleano",
        porDefecto: true,
        ayuda: "Valor inicial de «¿Tiene factura?» al capturar un costo de esta categoría. Se puede cambiar en cada uno.",
      },
    ],
    llaveUnica: ["nombre"],
    mensajeDuplicado: "Ya existe esa categoría",
    columnasLista: ["nombre", "incluir_en_rentabilidad", "tiene_factura"],
    columnaEtiqueta: "nombre",
    orden: "nombre",
    soloAdmin: true,
    requiereVeCostos: true,
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
    columnaEtiqueta: "nombre",
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
      {
        columna: "factura_por",
        etiqueta: "Se factura por peso",
        tipo: "opcion",
        requerido: true,
        opciones: [
          { valor: "cargado", etiqueta: "Cargado" },
          { valor: "descargado", etiqueta: "Descargado" },
        ],
        porDefecto: "cargado",
        ayuda: "Con cuál peso se calcula el flete por tonelada",
      },
    ],
    llaveUnica: ["nombre"],
    mensajeDuplicado: "Ya existe un cliente con ese nombre",
    columnasLista: ["nombre", "rfc", "factura_por"],
    columnaEtiqueta: "nombre",
    orden: "nombre",
  },
  rutas: {
    clave: "rutas",
    tabla: "rutas",
    titulo: "Rutas",
    singular: "ruta",
    conArticulo: "una ruta",
    descripcion:
      "Tramos de un sentido (origen → destino) con sus kilómetros; la ida y el regreso son dos rutas. El rendimiento por ruta es opcional y manda sobre el de la unidad.",
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
        ayuda: "Solo este sentido (no ida y vuelta)",
      },
      rendimiento("rend_cargado_kml", "Rendimiento cargado (opcional)", "Déjalo vacío para usar el de la unidad"),
      rendimiento("rend_vacio_kml", "Rendimiento vacío (opcional)", "Déjalo vacío para usar el de la unidad"),
    ],
    llaveUnica: ["origen", "destino"],
    mensajeDuplicado: "Ya existe una ruta con ese origen y destino",
    columnasLista: ["origen", "destino", "km", "rend_cargado_kml", "rend_vacio_kml"],
    columnaEtiqueta: "origen",
    orden: "origen",
  },
  fuentes: {
    clave: "fuentes",
    tabla: "fuentes_diesel",
    titulo: "Fuentes de diésel",
    singular: "fuente de diésel",
    conArticulo: "una fuente de diésel",
    descripcion: "Dónde se carga: tanques propios, estaciones, tarjetas y crédito en estaciones.",
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
      {
        columna: "tiene_factura",
        etiqueta: "Con factura por defecto",
        tipo: "booleano",
        porDefecto: false,
        ayuda: "Valor inicial de «¿Tiene factura?» al capturar una carga de esta fuente. Se puede cambiar en cada uno.",
      },
    ],
    llaveUnica: ["nombre"],
    mensajeDuplicado: "Ya existe una fuente de diésel con ese nombre",
    columnasLista: ["nombre", "tipo", "capacidad_litros", "tiene_factura"],
    columnaEtiqueta: "nombre",
    orden: "nombre",
  },
};

export const CLAVES_CATALOGO = Object.keys(CATALOGOS) as ClaveCatalogo[];

/** ¿Este usuario ve el catálogo? Captura consulta los de operación; los de pesos piden su permiso. */
export function puedeVerCatalogo(u: { rol: "dueno" | "administracion" | "captura"; veCostos: boolean }, clave: ClaveCatalogo): boolean {
  const def = CATALOGOS[clave];
  if (def.soloAdmin && u.rol === "captura") return false;
  return !def.requiereVeCostos || u.veCostos;
}

export function esClaveCatalogo(clave: string): clave is ClaveCatalogo {
  return Object.hasOwn(CATALOGOS, clave);
}
