"use server";

import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { puede } from "@/lib/auth/permisos";
import { sesionDeAccion } from "@/lib/auth/sesion";
import { CAMPOS_PARAMETROS, validarParametros } from "@/lib/empresa/parametros";
import { validarConfigPago } from "@/lib/viajes/pago";

export interface EstadoParametros {
  mensaje?: string;
  exito?: boolean;
  errores?: Record<string, string | undefined>;
  valores?: Record<string, string>;
}

export async function guardarParametros(_: EstadoParametros, form: FormData): Promise<EstadoParametros> {
  const valores = Object.fromEntries(CAMPOS_PARAMETROS.map((c) => [c.columna, String(form.get(c.columna) ?? "")]));
  const sesion = await sesionDeAccion();
  if (!sesion) redirect("/login");
  if (!puede(sesion.empresa.rol, "editarParametros")) return { mensaje: "Solo el dueño cambia los parámetros", valores };

  const v = validarParametros(valores);
  if (!v.ok) return { errores: v.errores, valores };

  // La llave de parametros_empresa es empresa_id (no hay columna id).
  const { data, error } = await sesion.supabase
    .from("parametros_empresa")
    .update(v.datos)
    .eq("empresa_id", sesion.empresa.empresaId)
    .select("empresa_id");
  if (error || !data?.length) return { mensaje: "No se pudieron guardar los parámetros. Intenta de nuevo.", valores };
  return { exito: true, mensaje: "Parámetros guardados.", valores };
}

/** Pago al operador de la empresa (operadorId null) o de un operador. */
export async function guardarPagoOperador(operadorId: string | null, _: EstadoParametros, form: FormData): Promise<EstadoParametros> {
  const valores: Record<string, string> = {};
  for (const [k, x] of form.entries()) if (typeof x === "string") valores[k] = x;
  const sesion = await sesionDeAccion();
  if (!sesion) redirect("/login");
  // El dueño la cambia en Parámetros; administración (que ve tarifas) en cada operador.
  const permitido = operadorId ? puede(sesion.empresa.rol, "editarCatalogos") : puede(sesion.empresa.rol, "editarParametros");
  if (!permitido) return { mensaje: "No tienes permiso para cambiar el pago", valores };

  const db = sesion.supabase;
  const empresa = sesion.empresa.empresaId;
  const filtro = (q: ReturnType<ReturnType<typeof db.from>["update"]>) =>
    operadorId ? q.eq("empresa_id", empresa).eq("operador_id", operadorId) : q.eq("empresa_id", empresa).is("operador_id", null);

  // Operador sin pago propio: se desactiva su configuración y usa la de la empresa.
  if (operadorId && valores.propio !== "on") {
    const { error } = await filtro(db.from("pago_operador_config").update({ activo: false }));
    if (error) return { mensaje: "No se pudo guardar", valores };
    refresh();
    return { exito: true, mensaje: "Usa el pago de la empresa.", valores };
  }

  const v = validarConfigPago(valores);
  if (!v.ok) return { errores: v.errores, valores };
  const { data, error } = await filtro(db.from("pago_operador_config").update({ ...v.datos, activo: true })).select("id");
  if (error) return { mensaje: "No se pudo guardar el pago", valores };
  if (!data?.length) {
    const { error: e2 } = await db.from("pago_operador_config").insert({ ...v.datos, empresa_id: empresa, operador_id: operadorId });
    if (e2) return { mensaje: "No se pudo guardar el pago", valores };
  }
  refresh();
  return { exito: true, mensaje: "Pago al operador guardado.", valores };
}
