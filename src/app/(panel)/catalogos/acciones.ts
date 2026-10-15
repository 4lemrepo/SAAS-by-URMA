"use server";

import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { puede } from "@/lib/auth/permisos";
import { sesionDeAccion } from "@/lib/auth/sesion";
import { CATALOGOS, esClaveCatalogo } from "@/lib/catalogos/definiciones";
import { validarRegistro, valoresDeFormulario } from "@/lib/catalogos/validacion";

export interface EstadoCatalogo {
  mensaje?: string;
  errores?: Record<string, string | undefined>;
  /** Para no borrar lo que el usuario ya escribió si hay un error. */
  valores?: Record<string, string>;
}

const PATRON_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Sesión con permiso de editar catálogos, o el motivo por el que no. */
async function sesionEditora() {
  const sesion = await sesionDeAccion();
  if (!sesion) redirect("/login");
  if (!puede(sesion.empresa.rol, "editarCatalogos")) return null;
  return sesion;
}

/** Alta (id null) o edición de un registro de catálogo. */
export async function guardarRegistro(
  clave: string,
  id: string | null,
  _: EstadoCatalogo,
  form: FormData,
): Promise<EstadoCatalogo> {
  if (!esClaveCatalogo(clave) || (id !== null && !PATRON_UUID.test(id))) {
    return { mensaje: "Registro no válido" };
  }
  const def = CATALOGOS[clave];
  const valores = valoresDeFormulario(def, form);

  const sesion = await sesionEditora();
  if (!sesion) return { mensaje: "Tu rol solo puede consultar catálogos", valores };

  const v = validarRegistro(def, valores);
  if (!v.ok) return { errores: v.errores, valores };

  const tabla = sesion.supabase.from(def.tabla);
  const { data, error } = id
    ? await tabla.update(v.datos).eq("id", id).eq("empresa_id", sesion.empresa.empresaId).select("id")
    : await tabla.insert({ ...v.datos, empresa_id: sesion.empresa.empresaId }).select("id");

  if (error) {
    if (error.code === "23505") return { mensaje: def.mensajeDuplicado, valores };
    if (error.code === "23514") return { mensaje: "Algún dato está fuera de rango. Revisa el formulario.", valores };
    return { mensaje: "No se pudo guardar. Intenta de nuevo.", valores };
  }
  // RLS no da error al editar algo ajeno: simplemente no afecta filas.
  if (!data?.length) return { mensaje: "No se encontró el registro.", valores };

  redirect(`/catalogos/${clave}`);
}

/** Desactiva o reactiva un registro. Nada con historial se borra. */
export async function cambiarActivo(clave: string, id: string, activo: boolean): Promise<void> {
  if (!esClaveCatalogo(clave) || !PATRON_UUID.test(id)) return;
  const sesion = await sesionEditora();
  if (!sesion) return;
  const def = CATALOGOS[clave];
  await sesion.supabase
    .from(def.tabla)
    .update({ [def.columnaActivo]: activo })
    .eq("id", id)
    .eq("empresa_id", sesion.empresa.empresaId);
  refresh();
}
