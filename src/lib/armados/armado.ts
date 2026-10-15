/**
 * Armado de una unidad: qué remolques y dolly trae enganchados.
 *   sencillo = remolque 1
 *   full     = remolque 1 + dolly + remolque 2
 * La base de datos impone lo mismo (cambiar_armado y checks de la tabla armados);
 * esto da buenos mensajes y describe el armado en pantalla.
 */

export type Configuracion = "sencillo" | "full";

export interface ArmadoElegido {
  remolque1: string | null;
  dolly: string | null;
  remolque2: string | null;
}

export type ResultadoArmado =
  | { ok: true; datos: ArmadoElegido; configuracion: Configuracion | null }
  | { ok: false; errores: Partial<Record<keyof ArmadoElegido, string>> };

const id = (v: FormDataEntryValue | null | undefined) => (typeof v === "string" && v.trim() ? v.trim() : null);

/** Valida lo elegido en el formulario. Todo vacío = desenganchar. */
export function validarArmado(form: { get(nombre: string): FormDataEntryValue | null }): ResultadoArmado {
  const datos = { remolque1: id(form.get("remolque1")), dolly: id(form.get("dolly")), remolque2: id(form.get("remolque2")) };
  const errores: Partial<Record<keyof ArmadoElegido, string>> = {};

  if (!datos.remolque1 && (datos.dolly || datos.remolque2)) {
    errores.remolque1 = "Elige el remolque 1";
  }
  if (datos.dolly && !datos.remolque2) errores.remolque2 = "Un full lleva segundo remolque";
  if (datos.remolque2 && !datos.dolly) errores.dolly = "Un full lleva dolly";
  if (datos.remolque2 && datos.remolque2 === datos.remolque1) errores.remolque2 = "Debe ser distinto al remolque 1";

  if (Object.keys(errores).length) return { ok: false, errores };
  return { ok: true, datos, configuracion: configuracionDe(datos) };
}

export function configuracionDe(a: ArmadoElegido): Configuracion | null {
  if (!a.remolque1) return null;
  return a.remolque2 ? "full" : "sencillo";
}

export const NOMBRE_CONFIGURACION: Record<Configuracion, string> = { sencillo: "Sencillo", full: "Full" };

/** Cómo se nombra un remolque: su número económico, o sus placas si no tiene. */
export function etiquetaRemolque(r: { numero_economico: string | null; placas: string }): string {
  return r.numero_economico ? `${r.numero_economico} (${r.placas})` : r.placas;
}

/** Cómo se nombra un dolly: su número económico, o su número de serie. */
export function etiquetaDolly(d: { numero_economico: string | null; numero_serie: string }): string {
  return d.numero_economico ?? `Serie ${d.numero_serie}`;
}

/** "Full: R-02 (10AB1A) + D-1 + 10AB3A" o "Sin remolques". */
export function describirArmado(
  armado: { remolque1: string | null; dolly: string | null; remolque2: string | null } | null,
): string {
  if (!armado?.remolque1) return "Sin remolques";
  if (!armado.remolque2) return `Sencillo: ${armado.remolque1}`;
  return `Full: ${armado.remolque1} + ${armado.dolly ?? "?"} + ${armado.remolque2}`;
}

/** Fecha ISO que manda el navegador (ya con su zona horaria). null si no es válida. */
export function fechaDelCambio(valor: FormDataEntryValue | null, ahora = new Date()): Date | null {
  if (typeof valor !== "string" || !valor) return ahora;
  const fecha = new Date(valor);
  if (Number.isNaN(fecha.getTime())) return null;
  // Margen de un día por relojes desfasados; la base aplica la misma regla.
  if (fecha.getTime() > ahora.getTime() + 24 * 3600 * 1000) return null;
  return fecha;
}
