/**
 * Reglas de acceso por estado del correo. Funciones puras con pruebas; las usan
 * la capa de sesión y las Server Actions. La base de datos repite la regla en
 * crear_empresa() para quien llame a la API directo.
 */

export interface UsuarioAuth {
  email_confirmed_at?: string | null;
}

export type MotivoBloqueo = "sin_confirmar" | "confirmacion_apagada";

/** El correo cuenta como confirmado solo si Supabase registró una fecha válida. */
export function correoConfirmado(usuario: UsuarioAuth | null | undefined): boolean {
  const fecha = usuario?.email_confirmed_at;
  return typeof fecha === "string" && fecha.length > 0 && !Number.isNaN(Date.parse(fecha));
}

/**
 * Decide si un usuario puede entrar. Con la confirmación apagada en Supabase,
 * Auth marca cada correo como confirmado al registrarse sin mandar nada, así que
 * email_confirmed_at deja de probar que el correo es de quien se registró:
 * en ese caso no entra nadie hasta que se vuelva a encender.
 */
export function motivoBloqueo(
  usuario: UsuarioAuth | null | undefined,
  { confirmacionApagada }: { confirmacionApagada: boolean },
): MotivoBloqueo | null {
  if (confirmacionApagada) return "confirmacion_apagada";
  if (!correoConfirmado(usuario)) return "sin_confirmar";
  return null;
}

export const MENSAJE_BLOQUEO: Record<MotivoBloqueo, string> = {
  sin_confirmar: "Confirma tu correo antes de entrar. Revisa tu bandeja de entrada o pide otro correo.",
  confirmacion_apagada:
    "El acceso está deshabilitado: la confirmación de correo está apagada en Supabase " +
    "(Authentication → Sign In / Providers → Email → Confirm email). Pide al administrador que la encienda.",
};

/** Errores de Supabase Auth por exceso de envíos o de intentos. */
export function esLimiteDeEnvios(error: { code?: string; status?: number } | null | undefined) {
  return (
    error?.status === 429 ||
    error?.code === "over_email_send_rate_limit" ||
    error?.code === "over_request_rate_limit"
  );
}
