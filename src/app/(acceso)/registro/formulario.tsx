"use client";

import { useActionState } from "react";
import { LARGO_MINIMO_CONTRASENA } from "@/lib/auth/validacion";
import { registrarse } from "../acciones";
import { Aviso, BotonEnviar, Campo } from "../campos";

export function FormularioRegistro() {
  const [estado, accion] = useActionState(registrarse, {});

  if (estado.exito) return <Aviso tipo="exito" texto={estado.mensaje} />;

  return (
    <form action={accion} className="flex flex-col gap-4">
      <Aviso texto={estado.mensaje} />
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
        autoComplete="new-password"
        required
        minLength={LARGO_MINIMO_CONTRASENA}
        maxLength={72}
        ayuda={`Mínimo ${LARGO_MINIMO_CONTRASENA} caracteres`}
        error={estado.errores?.contrasena}
      />
      <BotonEnviar pendiente="Creando cuenta…">Crear cuenta</BotonEnviar>
    </form>
  );
}
