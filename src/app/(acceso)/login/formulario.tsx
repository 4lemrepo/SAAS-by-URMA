"use client";

import { useActionState } from "react";
import { useSearchParams } from "next/navigation";
import { iniciarSesion } from "../acciones";
import { Aviso, BotonEnviar, Campo } from "../campos";

const MENSAJES_ERROR: Record<string, string> = {
  confirmacion: "El enlace de confirmación no es válido o ya expiró. Inicia sesión o regístrate de nuevo.",
};

export function FormularioLogin() {
  const params = useSearchParams();
  const [estado, accion] = useActionState(iniciarSesion, {});
  const errorUrl = MENSAJES_ERROR[params.get("error") ?? ""];

  return (
    <form action={accion} className="flex flex-col gap-4">
      <input type="hidden" name="siguiente" value={params.get("siguiente") ?? ""} />
      <Aviso texto={estado.mensaje ?? errorUrl} />
      <Campo
        etiqueta="Correo"
        name="correo"
        type="email"
        autoComplete="email"
        required
        defaultValue={estado.valores?.correo}
        error={estado.errores?.correo}
      />
      <Campo
        etiqueta="Contraseña"
        name="contrasena"
        type="password"
        autoComplete="current-password"
        required
        error={estado.errores?.contrasena}
      />
      <BotonEnviar pendiente="Entrando…">Entrar</BotonEnviar>
    </form>
  );
}
