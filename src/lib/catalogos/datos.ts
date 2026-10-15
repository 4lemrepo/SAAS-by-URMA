import "server-only";
import { crearClienteServidor } from "@/lib/supabase/server";
import { CATALOGOS, type ClaveCatalogo } from "./definiciones";
import type { Registro } from "./validacion";

export interface FilaCatalogo {
  id: string;
  activo: boolean;
  valores: Registro;
}

function columnas(clave: ClaveCatalogo) {
  const def = CATALOGOS[clave];
  return ["id", def.columnaActivo, ...def.campos.map((c) => c.columna)].join(",");
}

function aFila(clave: ClaveCatalogo, fila: Record<string, unknown>): FilaCatalogo {
  const def = CATALOGOS[clave];
  const valores: Registro = {};
  for (const c of def.campos) valores[c.columna] = (fila[c.columna] as string | number | null) ?? null;
  return { id: String(fila.id), activo: fila[def.columnaActivo] === true, valores };
}

/** Todos los registros del catálogo de la empresa (RLS ya limita a la empresa del usuario). */
export async function leerCatalogo(clave: ClaveCatalogo, empresaId: string): Promise<FilaCatalogo[]> {
  const def = CATALOGOS[clave];
  const supabase = await crearClienteServidor();
  const { data, error } = await supabase
    .from(def.tabla)
    .select(columnas(clave))
    .eq("empresa_id", empresaId)
    .order(def.orden);
  if (error) throw new Error(`No se pudo leer el catálogo de ${def.titulo.toLowerCase()}`);
  return (data as unknown as Record<string, unknown>[]).map((f) => aFila(clave, f));
}

export async function leerRegistro(clave: ClaveCatalogo, empresaId: string, id: string): Promise<FilaCatalogo | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const supabase = await crearClienteServidor();
  const { data } = await supabase
    .from(CATALOGOS[clave].tabla)
    .select(columnas(clave))
    .eq("empresa_id", empresaId)
    .eq("id", id)
    .maybeSingle();
  return data ? aFila(clave, data as unknown as Record<string, unknown>) : null;
}
