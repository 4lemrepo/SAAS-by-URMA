"use client";

import { useActionState, useEffect, useState } from "react";
import { reenviarCodigo, verificarCodigo } from "./acciones";
import { Aviso, BotonEnviar, Campo } from "./campos";

/** Supabase no deja pedir otro código del mismo correo antes de ~60 s. */
const ESPERA_REENVIO_S = 60;

/**
 * Confirmación de cuenta con el código de 6 dígitos que llega por correo.
 * Si ya se conoce el correo (recién registrado o intento de login) no se vuelve a pedir.
 */
export function ConfirmarConCodigo({ correo: correoConocido }: { correo?: string }) {
  const [estado, verificar] = useActionState(verificarCodigo, {});
  const [correo, setCorreo] = useState(correoConocido ?? "");

  return (
    <div className="flex flex-col gap-4">
      <form action={verificar} className="flex flex-col gap-4">
        <Aviso texto={estado.mensaje} />
        {correoConocido ? (
          <input type="hidden" name="correo" value={correoConocido} />
        ) : (
          <Campo
            etiqueta="Correo de tu cuenta"
            name="correo"
            type="email"
            autoComplete="email"
            required
            value={correo}
            onChange={(e) => setCorreo(e.target.value)}
            error={estado.errores?.correo}
          />
        )}
        <Campo
          etiqueta="Código de confirmación"
          name="codigo"
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="[0-9 \-]{6,12}"
          maxLength={12}
          required
          placeholder="123456"
          className="rounded-md border border-zinc-300 bg-white px-3 py-2 text-center font-mono text-2xl tracking-[0.4em] outline-none focus:border-zinc-900 focus:ring-2 focus:ring-zinc-900/10 aria-[invalid=true]:border-red-500 dark:border-zinc-700 dark:bg-zinc-950 dark:focus:border-zinc-200"
          error={estado.errores?.codigo}
        />
        <BotonEnviar pendiente="Confirmando…">Confirmar cuenta</BotonEnviar>
      </form>
      <ReenviarCodigo correo={correo} />
    </div>
  );
}

function ReenviarCodigo({ correo }: { correo: string }) {
  const [estado, reenviar, enviando] = useActionState(reenviarCodigo, {});

  return (
    <form action={reenviar} className="flex flex-col gap-2 border-t border-zinc-200 pt-4 dark:border-zinc-800">
      <input type="hidden" name="correo" value={correo} />
      <Aviso texto={estado.mensaje ?? estado.errores?.correo} tipo={estado.exito ? "exito" : "error"} />
      {/* key: cada envío exitoso reinicia la cuenta regresiva. */}
      <BotonReenviar key={estado.enviadoEn ?? 0} enviando={enviando} espera={estado.exito ? ESPERA_REENVIO_S : 0} />
    </form>
  );
}

function BotonReenviar({ enviando, espera: inicial }: { enviando: boolean; espera: number }) {
  const [espera, setEspera] = useState(inicial);

  useEffect(() => {
    if (espera <= 0) return;
    const t = setTimeout(() => setEspera(espera - 1), 1000);
    return () => clearTimeout(t);
  }, [espera]);

  return (
    <button
      type="submit"
      disabled={espera > 0 || enviando}
      className="text-sm font-medium text-zinc-900 underline disabled:text-zinc-400 disabled:no-underline dark:text-zinc-100"
    >
      {enviando
        ? "Enviando…"
        : espera > 0
          ? `Podrás pedir otro código en ${espera} s`
          : "¿No te llegó? Reenviar código"}
    </button>
  );
}
