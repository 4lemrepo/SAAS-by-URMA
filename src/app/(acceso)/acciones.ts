"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { rutaSegura, validarCredenciales, validarEmpresa } from "@/lib/auth/validacion";
import { crearClienteServidor } from "@/lib/supabase/server";

export interface EstadoFormulario {
  mensaje?: string;
  errores?: Record<string, string | undefined>;
  /** Para no borrar lo que el usuario ya escribió si hay un error. */
  valores?: Record<string, string>;
  exito?: boolean;
}

const valor = (form: FormData, campo: string) => {
  const v = form.get(campo);
  return typeof v === "string" ? v : "";
};

export async function iniciarSesion(_: EstadoFormulario, form: FormData): Promise<EstadoFormulario> {
  const valores = { correo: valor(form, "correo") };
  const v = validarCredenciales(form);
  if (!v.ok) return { errores: v.errores, valores };

  const supabase = await crearClienteServidor();
  const { error } = await supabase.auth.signInWithPassword({
    email: v.datos.correo,
    password: v.datos.contrasena,
  });
  if (error) {
    // Mensaje genérico: no revelar si el correo existe.
    const sinConfirmar = error.code === "email_not_confirmed";
    return {
      mensaje: sinConfirmar
        ? "Confirma tu correo antes de entrar. Revisa tu bandeja de entrada."
        : "Correo o contraseña incorrectos",
      valores,
    };
  }
  redirect(rutaSegura(valor(form, "siguiente")));
}

export async function registrarse(_: EstadoFormulario, form: FormData): Promise<EstadoFormulario> {
  const valores = { correo: valor(form, "correo") };
  const v = validarCredenciales(form, { nueva: true });
  if (!v.ok) return { errores: v.errores, valores };

  const origen = (await headers()).get("origin");
  const supabase = await crearClienteServidor();
  const { data, error } = await supabase.auth.signUp({
    email: v.datos.correo,
    password: v.datos.contrasena,
    options: origen
      ? { emailRedirectTo: `${origen}/auth/confirmar?siguiente=/alta-empresa` }
      : undefined,
  });
  if (error) {
    if (error.code === "weak_password") {
      return { errores: { contrasena: "La contraseña es muy débil; usa una más larga" }, valores };
    }
    if (error.code === "over_email_send_rate_limit" || error.status === 429) {
      return { mensaje: "Demasiados intentos. Espera unos minutos.", valores };
    }
    return { mensaje: "No se pudo crear la cuenta. Intenta de nuevo.", valores };
  }

  // Si el proyecto no pide confirmar correo, ya hay sesión: directo al alta de empresa.
  if (data.session) redirect("/alta-empresa");

  // Mismo mensaje exista o no el correo, para no revelar cuentas registradas.
  return {
    exito: true,
    mensaje: "Te enviamos un correo para confirmar tu cuenta. Ábrelo desde este dispositivo.",
  };
}

export async function crearEmpresa(_: EstadoFormulario, form: FormData): Promise<EstadoFormulario> {
  const valores = { nombre: valor(form, "nombre"), rfc: valor(form, "rfc") };
  const v = validarEmpresa(form);
  if (!v.ok) return { errores: v.errores, valores };

  const supabase = await crearClienteServidor();
  const { data } = await supabase.auth.getClaims();
  if (!data?.claims?.sub) redirect("/login?siguiente=/alta-empresa");

  const { error } = await supabase.rpc("crear_empresa", {
    p_nombre: v.datos.nombre,
    p_rfc: v.datos.rfc,
  });
  if (error) {
    // crear_empresa lanza mensajes pensados para el usuario (validaciones y límite).
    const conocido = /RFC|nombre|Límite/.test(error.message);
    return { mensaje: conocido ? error.message : "No se pudo dar de alta la empresa", valores };
  }
  redirect("/tablero");
}

export async function cerrarSesion() {
  const supabase = await crearClienteServidor();
  await supabase.auth.signOut();
  redirect("/login");
}
