/**
 * Qué puede hacer cada rol. La base de datos (RLS, migración 20261015000200)
 * es la que de verdad impide; esto decide qué se muestra en pantalla.
 * El operador (chofer) no es usuario: es un registro del catálogo.
 */

export type Rol = "dueno" | "administracion" | "captura";

export const NOMBRE_ROL: Record<Rol, string> = {
  dueno: "Dueño",
  administracion: "Administración",
  captura: "Captura",
};

export type Permiso =
  | "administrarUsuarios"
  | "editarParametros"
  | "verCatalogos"
  | "editarCatalogos"
  | "capturar"
  | "validarCargas"
  | "cerrarViajes"
  | "verConciliacion"
  /** Importar viajes y costos históricos desde Excel (trae tarifas, pago y costos). */
  | "importarHistorico";

const PERMISOS: Record<Rol, readonly Permiso[]> = {
  dueno: [
    "administrarUsuarios",
    "editarParametros",
    "verCatalogos",
    "editarCatalogos",
    "capturar",
    "validarCargas",
    "cerrarViajes",
    "verConciliacion",
    "importarHistorico",
  ],
  administracion: ["verCatalogos", "editarCatalogos", "capturar", "validarCargas", "cerrarViajes", "verConciliacion"],
  captura: ["verCatalogos", "capturar"],
};

export function puede(rol: Rol, permiso: Permiso): boolean {
  return PERMISOS[rol]?.includes(permiso) ?? false;
}

/**
 * Validar o rechazar una carga: rol con permiso y carga pendiente. Nadie revisa
 * lo que capturó, salvo el dueño (la carga queda marcada como autovalidada).
 */
export function puedeRevisarCarga(
  rol: Rol,
  usuarioId: string,
  carga: { capturadoPor: string | null; estado: "pendiente" | "validada" | "rechazada" },
): boolean {
  if (!puede(rol, "validarCargas") || carga.estado !== "pendiente") return false;
  return carga.capturadoPor !== usuarioId || rol === "dueno";
}

export interface PermisosFinancieros {
  /** Tarifa, flete, cargos adicionales e ingreso. */
  veTarifas: boolean;
  /** Pago al operador, utilidad, margen, costo/km y el tablero financiero (requiere veTarifas). */
  veUtilidades: boolean;
  /** Costos de unidad y generales (captura y consulta). */
  veCostos: boolean;
}

/**
 * Interruptores que el dueño da a cada usuario. El dueño los tiene siempre;
 * administración solo si se los dieron; captura puede ver tarifas, nada más.
 * Misma regla que ve_tarifas(), ve_utilidades() y ve_costos() en la base
 * (migración 20261123000300), que es la que de verdad impide.
 */
export function permisosFinancieros(
  rol: Rol,
  m: { ve_tarifas?: boolean | null; ve_utilidades?: boolean | null; ve_costos?: boolean | null },
): PermisosFinancieros {
  if (rol === "dueno") return { veTarifas: true, veUtilidades: true, veCostos: true };
  const veTarifas = m.ve_tarifas === true;
  const admin = rol === "administracion";
  return { veTarifas, veUtilidades: admin && veTarifas && m.ve_utilidades === true, veCostos: admin && m.ve_costos === true };
}
