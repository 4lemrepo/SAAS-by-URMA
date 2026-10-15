"use server";

import { updateTag } from "next/cache";
import { redirect } from "next/navigation";
import { esLimiteDeEnvios, MENSAJE_BLOQUEO } from "@/lib/auth/acceso";
import { bloqueoDe, confirmacionApagada, TAG_SESION } from "@/lib/auth/sesion";
import { rutaSegura, validarCodigo, validarCredenciales, validarEmpresa } from "@/lib/auth/validacion";
import { crearClienteServidor } from "@/lib/supabase/server";

export interface EstadoFormulario {
  mensaje?: string;
  errores?: Record<string, string | undefined>;
  /** Para no borrar lo que el usuario ya escribió si hay un error. */
  valores?: Record<string, string>;
  exito?: boolean;
  /** La cuenta existe pero falta confirmar el correo: pedir el código. */
  sinConfirmar?: boolean;
  /** Momento del último reenvío exitoso: reinicia la cuenta regresiva del botón. */
  enviadoEn?: number;
}

const valor = (form: FormData, campo: string) => {
  const v = form.get(campo);
  return typeof v === "string" ? v : "";
};

const MENSAJE_LIMITE =
  "Se alcanzó el límite de correos que podemos enviar por ahora. Espera unos minutos e intenta de nuevo.";

export async function iniciarSesion(_: EstadoFormulario, form: FormData): Promise<EstadoFormulario> {
  const valores = { correo: valor(form, "correo") };
  const v = validarCredenciales(form);
  if (!v.ok) return { errores: v.errores, valores };

  const supabase = await crearClienteServidor();
  const { data, error } = await supabase.auth.signInWithPassword({
    email: v.datos.correo,
    password: v.datos.contrasena,
  });
  if (error) {
    if (error.code === "email_not_confirmed") {
      return { mensaje: MENSAJE_BLOQUEO.sin_confirmar, sinConfirmar: true, valores };
    }
    if (esLimiteDeEnvios(error)) return { mensaje: "Demasiados intentos. Espera unos minutos.", valores };
    // Mensaje genérico: no revelar si el correo existe.
    return { mensaje: "Correo o contraseña incorrectos", valores };
  }

  // Supabase pudo dar sesión sin correo confirmado (p. ej. con la confirmación apagada).
  const bloqueo = await bloqueoDe(data.user);
  if (bloqueo) {
    await supabase.auth.signOut();
    return { mensaje: MENSAJE_BLOQUEO[bloqueo], sinConfirmar: bloqueo === "sin_confirmar", valores };
  }

  updateTag(TAG_SESION);
  redirect(rutaSegura(valor(form, "siguiente")));
}

export async function registrarse(_: EstadoFormulario, form: FormData): Promise<EstadoFormulario> {
  const valores = { correo: valor(form, "correo") };
  const v = validarCredenciales(form, { nueva: true });
  if (!v.ok) return { errores: v.errores, valores };

  // Con la confirmación apagada, Supabase daría la cuenta por confirmada sin mandar correo.
  if (await confirmacionApagada()) return { mensaje: MENSAJE_BLOQUEO.confirmacion_apagada, valores };

  const supabase = await crearClienteServidor();
  // Sin enlace: la plantilla "Confirm signup" de Supabase manda un código ({{ .Token }}).
  // Los filtros de seguridad del correo corporativo abren los enlaces y los gastan.
  const { data, error } = await supabase.auth.signUp({
    email: v.datos.correo,
    password: v.datos.contrasena,
  });
  if (error) {
    if (error.code === "weak_password") {
      return { errores: { contrasena: "La contraseña es muy débil; usa una más larga" }, valores };
    }
    if (esLimiteDeEnvios(error)) return { mensaje: MENSAJE_LIMITE, valores };
    return { mensaje: "No se pudo crear la cuenta. Intenta de nuevo.", valores };
  }

  // Nunca entrar directo: si Supabase devolvió sesión, se cierra hasta que confirme.
  if (data.session) await supabase.auth.signOut();

  // Mismo mensaje exista o no el correo, para no revelar cuentas registradas.
  return {
    exito: true,
    valores,
    mensaje: `Te enviamos un código de 6 dígitos a ${v.datos.correo}. Escríbelo aquí para confirmar tu cuenta.`,
  };
}

export async function verificarCodigo(_: EstadoFormulario, form: FormData): Promise<EstadoFormulario> {
  const valores = { correo: valor(form, "correo") };
  const v = validarCodigo(form);
  if (!v.ok) return { errores: v.errores, valores };

  const supabase = await crearClienteServidor();
  // type "email" cubre el código de confirmación de registro (y deja la sesión iniciada).
  const { data, error } = await supabase.auth.verifyOtp({
    email: v.datos.correo,
    token: v.datos.codigo,
    type: "email",
  });
  if (error) {
    if (esLimiteDeEnvios(error)) return { mensaje: "Demasiados intentos. Espera unos minutos.", valores };
    // Supabase no distingue entre código incorrecto y vencido.
    return { errores: { codigo: "El código es incorrecto o ya expiró. Revísalo o pide uno nuevo." }, valores };
  }

  const bloqueo = await bloqueoDe(data.user);
  if (bloqueo) {
    await supabase.auth.signOut();
    return { mensaje: MENSAJE_BLOQUEO[bloqueo], valores };
  }

  updateTag(TAG_SESION);
  // El tablero manda al alta de empresa si todavía no tiene una.
  redirect("/tablero");
}

export async function reenviarCodigo(_: EstadoFormulario, form: FormData): Promise<EstadoFormulario> {
  const correo = valor(form, "correo").trim().toLowerCase();
  const valores = { correo };
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(correo)) {
    return { errores: { correo: "Escribe tu correo para reenviar el código" }, valores };
  }

  const supabase = await crearClienteServidor();
  const { error } = await supabase.auth.resend({ type: "signup", email: correo });
  if (esLimiteDeEnvios(error)) return { mensaje: MENSAJE_LIMITE, valores };
  if (error) return { mensaje: "No se pudo reenviar el código. Intenta de nuevo en unos minutos.", valores };

  // Supabase responde igual exista o no la cuenta; el mensaje tampoco lo revela.
  return {
    exito: true,
    enviadoEn: Date.now(),
    valores,
    mensaje: `Si ${correo} tiene una cuenta pendiente de confirmar, te llegará un código nuevo. El anterior deja de servir. Revisa también spam.`,
  };
}

export async function crearEmpresa(_: EstadoFormulario, form: FormData): Promise<EstadoFormulario> {
  const valores = { nombre: valor(form, "nombre"), rfc: valor(form, "rfc") };
  const v = validarEmpresa(form);
  if (!v.ok) return { errores: v.errores, valores };

  const supabase = await crearClienteServidor();
  const { data } = await supabase.auth.getUser();
  if (!data.user) redirect("/login?siguiente=/alta-empresa");
  const bloqueo = await bloqueoDe(data.user);
  if (bloqueo) redirect(`/auth/salir?motivo=${bloqueo}`);

  const { error } = await supabase.rpc("crear_empresa", {
    p_nombre: v.datos.nombre,
    p_rfc: v.datos.rfc,
  });
  if (error) {
    // crear_empresa lanza mensajes pensados para el usuario (validaciones y límite).
    const conocido = /RFC|nombre|Límite|correo/.test(error.message);
    return { mensaje: conocido ? error.message : "No se pudo dar de alta la empresa", valores };
  }
  updateTag(TAG_SESION);
  redirect("/tablero");
}

export async function cerrarSesion() {
  const supabase = await crearClienteServidor();
  await supabase.auth.signOut();
  updateTag(TAG_SESION);
  redirect("/login");
}
