"use server";

import { redirect } from "next/navigation";
import { puede } from "@/lib/auth/permisos";
import { sesionDeAccion } from "@/lib/auth/sesion";
import { CATALOGOS } from "@/lib/catalogos/definiciones";
import type { Registro } from "@/lib/catalogos/validacion";
import { validarRegistros, type Entrada } from "@/lib/importacion/plantilla";
import { CATALOGOS_CONTROL, type CatalogoControl } from "@/lib/importacion/catalogos";

export type ResultadoImportacion =
  | { ok: true; guardados: Partial<Record<CatalogoControl, number>> }
  | { ok: false; mensaje: string };

/** Máximo de registros por importación (protege al servidor de archivos enormes). */
const MAXIMO = 5000;

/**
 * Guarda una importación completa o nada. El navegador ya mostró la vista
 * previa, pero aquí se valida todo otra vez contra lo que hay en la base:
 * una acción del servidor se puede llamar sin pasar por la pantalla.
 */
export async function importarCatalogos(
  porCatalogo: Partial<Record<CatalogoControl, Entrada[]>>,
): Promise<ResultadoImportacion> {
  const sesion = await sesionDeAccion();
  if (!sesion) redirect("/login");
  if (!puede(sesion.empresa.rol, "editarCatalogos")) {
    return { ok: false, mensaje: "Solo dueño y administración importan catálogos" };
  }

  const claves = CATALOGOS_CONTROL.filter((c) => porCatalogo[c]?.length);
  const total = claves.reduce((n, c) => n + (porCatalogo[c]?.length ?? 0), 0);
  if (total === 0) return { ok: false, mensaje: "No hay nada que importar" };
  if (total > MAXIMO) return { ok: false, mensaje: `Son demasiados registros (máximo ${MAXIMO} por importación)` };

  const datos: Partial<Record<CatalogoControl, Registro[]>> = {};
  for (const clave of claves) {
    const def = CATALOGOS[clave];
    const columnasLlave = def.llaveUnica.join(",");
    const { data: existentes, error } = await sesion.supabase
      .from(def.tabla)
      .select(columnasLlave)
      .eq("empresa_id", sesion.empresa.empresaId);
    if (error) return { ok: false, mensaje: "No se pudo revisar el catálogo actual. Intenta de nuevo." };

    const previa = validarRegistros(def, porCatalogo[clave] ?? [], (existentes ?? []) as unknown as Registro[]);
    const conError = previa.find((f) => f.estado === "error");
    if (conError) {
      return { ok: false, mensaje: `${def.titulo}, fila ${conError.numero}: hay errores. No se guardó nada.` };
    }
    datos[clave] = previa.filter((f) => f.estado === "nueva").map((f) => f.datos!);
  }

  const { data, error } = await sesion.supabase.rpc("importar_catalogos", {
    p_empresa: sesion.empresa.empresaId,
    p_datos: datos,
  });
  if (error) {
    if (error.code === "23505") {
      return { ok: false, mensaje: "Alguien agregó uno de estos registros mientras importabas. No se guardó nada; vuelve a subir el archivo." };
    }
    return { ok: false, mensaje: "No se pudo importar. No se guardó nada." };
  }
  return { ok: true, guardados: data as Partial<Record<CatalogoControl, number>> };
}
