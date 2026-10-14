/**
 * Validación de formularios de acceso y alta de empresa.
 * Funciones puras: corren igual en el servidor (Server Actions) y en pruebas.
 * La base de datos vuelve a validar (crear_empresa), esto es para dar buenos mensajes.
 */

export type Resultado<T> =
  | { ok: true; datos: T }
  | { ok: false; errores: Partial<Record<keyof T, string>> };

const texto = (v: FormDataEntryValue | null) => (typeof v === "string" ? v.trim() : "");

export const LARGO_MINIMO_CONTRASENA = 8;

export interface Credenciales {
  correo: string;
  contrasena: string;
}

export function validarCredenciales(form: FormData, { nueva = false } = {}): Resultado<Credenciales> {
  const correo = texto(form.get("correo")).toLowerCase();
  // La contraseña no se recorta: los espacios son válidos.
  const contrasenaCruda = form.get("contrasena");
  const contrasena = typeof contrasenaCruda === "string" ? contrasenaCruda : "";
  const errores: Partial<Record<keyof Credenciales, string>> = {};

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(correo) || correo.length > 254) {
    errores.correo = "Escribe un correo válido";
  }
  if (!contrasena) {
    errores.contrasena = "Escribe tu contraseña";
  } else if (nueva && contrasena.length < LARGO_MINIMO_CONTRASENA) {
    errores.contrasena = `La contraseña debe tener al menos ${LARGO_MINIMO_CONTRASENA} caracteres`;
  } else if (contrasena.length > 72) {
    // Límite de bcrypt, que usa Supabase Auth.
    errores.contrasena = "La contraseña no puede tener más de 72 caracteres";
  }

  return Object.keys(errores).length ? { ok: false, errores } : { ok: true, datos: { correo, contrasena } };
}

export interface DatosEmpresa {
  nombre: string;
  rfc: string | null;
}

/** RFC de persona moral (12) o física (13). Misma regla que crear_empresa() en SQL. */
export const PATRON_RFC = /^[A-ZÑ&]{3,4}[0-9]{6}[A-Z0-9]{3}$/;

export function validarEmpresa(form: FormData): Resultado<DatosEmpresa> {
  const nombre = texto(form.get("nombre")).replace(/\s+/g, " ");
  const rfc = texto(form.get("rfc")).toUpperCase() || null;
  const errores: Partial<Record<keyof DatosEmpresa, string>> = {};

  if (nombre.length < 2 || nombre.length > 120) {
    errores.nombre = "El nombre debe tener entre 2 y 120 caracteres";
  }
  if (rfc && !PATRON_RFC.test(rfc)) {
    errores.rfc = "RFC inválido (12 caracteres para persona moral, 13 para física)";
  }

  return Object.keys(errores).length ? { ok: false, errores } : { ok: true, datos: { nombre, rfc } };
}

/**
 * Ruta interna a la que se puede regresar después de iniciar sesión.
 * Evita redirecciones abiertas: solo rutas relativas del mismo sitio.
 */
export function rutaSegura(destino: string | null | undefined, porDefecto = "/tablero"): string {
  if (!destino || !destino.startsWith("/") || destino.startsWith("//") || destino.includes("\\")) {
    return porDefecto;
  }
  try {
    // Si al resolverla contra un origen ficticio cambia el origen, no es interna.
    const url = new URL(destino, "http://interno.invalid");
    if (url.origin !== "http://interno.invalid") return porDefecto;
    return url.pathname + url.search + url.hash;
  } catch {
    return porDefecto;
  }
}
