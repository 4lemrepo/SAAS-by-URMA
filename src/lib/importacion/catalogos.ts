/** Catálogos que llenan las dos formas de importar. */
export const CATALOGOS_CONTROL = ["unidades", "operadores", "clientes", "rutas", "fuentes"] as const;
export type CatalogoControl = (typeof CATALOGOS_CONTROL)[number];
