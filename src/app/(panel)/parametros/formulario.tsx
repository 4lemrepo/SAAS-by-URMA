"use client";

import { useActionState } from "react";
import { Aviso, BotonEnviar, Campo } from "@/components/campos";
import { CAMPOS_PARAMETROS } from "@/lib/empresa/parametros";
import { guardarParametros } from "./acciones";

export function FormularioParametros({ iniciales }: { iniciales: Record<string, string> }) {
  const [estado, accion] = useActionState(guardarParametros, {});
  const valores = estado.valores ?? iniciales;

  return (
    <form action={accion} key={JSON.stringify(valores)} className="flex max-w-md flex-col gap-4">
      <Aviso texto={estado.mensaje} tipo={estado.exito ? "exito" : "error"} />
      {CAMPOS_PARAMETROS.map((c) => (
        <Campo
          key={c.columna}
          etiqueta={`${c.etiqueta} (${c.unidad})`}
          name={c.columna}
          ayuda={c.ayuda}
          required={c.requerido}
          inputMode="decimal"
          autoComplete="off"
          defaultValue={valores[c.columna] ?? ""}
          error={estado.errores?.[c.columna]}
        />
      ))}
      <BotonEnviar pendiente="Guardando…">Guardar parámetros</BotonEnviar>
    </form>
  );
}
