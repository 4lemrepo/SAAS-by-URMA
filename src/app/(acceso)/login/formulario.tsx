"use client";

import { useActionState } from "react";
import { useSearchParams } from "next/navigation";
import { MENSAJE_BLOQUEO } from "@/lib/auth/acceso";
import { iniciarSesion } from "../acciones";
import { Aviso, BotonEnviar, Campo } from "../campos";
import { ConfirmarConCodigo } from "../codigo";

const MENSAJES_ERROR: Record<string, string> = {
  confirmacion: "El enlace de confirmación no es válido o ya expiró. Confirma tu cuenta con un código.",
  sin_confirmar: MENSAJE_BLOQUEO.sin_confirmar,
  confirmacion_apagada: MENSAJE_BLOQUEO.confirmacion_apagada,
};

/** Errores de la URL que se resuelven confirmando con código. */
const PEDIR_CODIGO = new Set(["confirmacion", "sin_confirmar"]);

export function FormularioLogin() {
  const params = useSearchParams();
  const [estado, accion] = useActionState(iniciarSesion, {});
  const errorUrl = params.get("error") ?? "";
  // Un intento de login nuevo reemplaza el aviso que venía en la URL.
  const intento = Boolean(estado.mensaje || estado.errores);
  const pedirCodigo = estado.sinConfirmar || (!intento && PEDIR_CODIGO.has(errorUrl));

  return (
    <div className="flex flex-col gap-4">
      <form action={accion} className="flex flex-col gap-4">
        <input type="hidden" name="siguiente" value={params.get("siguiente") ?? ""} />
        <Aviso texto={estado.mensaje ?? (intento ? undefined : MENSAJES_ERROR[errorUrl])} />
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
      {pedirCodigo && (
        <section className="flex flex-col gap-3 border-t border-zinc-200 pt-4 dark:border-zinc-800">
          <h2 className="font-medium">Confirma tu cuenta</h2>
          {/* key: si cambia el correo, el formulario del código empieza de cero. */}
          <ConfirmarConCodigo
            key={estado.valores?.correo}
            correo={estado.sinConfirmar ? estado.valores?.correo : undefined}
          />
        </section>
      )}
    </div>
  );
}
