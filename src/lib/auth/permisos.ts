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
  | "verConciliacion";

const PERMISOS: Record<Rol, readonly Permiso[]> = {
  dueno: [
    "administrarUsuarios",
    "editarParametros",
    "verCatalogos",
    "editarCatalogos",
    "capturar",
    "validarCargas",
    "verConciliacion",
  ],
  administracion: ["verCatalogos", "editarCatalogos", "capturar", "validarCargas", "verConciliacion"],
  captura: ["verCatalogos", "capturar"],
};

export function puede(rol: Rol, permiso: Permiso): boolean {
  return PERMISOS[rol]?.includes(permiso) ?? false;
}

/** Validar o rechazar una carga: rol con permiso, carga pendiente y que no la haya capturado él. */
export function puedeRevisarCarga(
  rol: Rol,
  usuarioId: string,
  carga: { capturadoPor: string | null; estado: "pendiente" | "validada" | "rechazada" },
): boolean {
  return puede(rol, "validarCargas") && carga.estado === "pendiente" && carga.capturadoPor !== usuarioId;
}
