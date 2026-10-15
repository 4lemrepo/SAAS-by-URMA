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
  | "verConciliacion";

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
