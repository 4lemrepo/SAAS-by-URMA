"use client";

import { useActionState } from "react";
import { Aviso, BotonEnviar, Campo, Selector } from "@/components/campos";
import { GRUPOS_PARAMETROS } from "@/lib/empresa/parametros";
import { CAMPOS_ESQUEMA, ESQUEMAS_PAGO, ETIQUETA_COLUMNA_PAGO } from "@/lib/viajes/pago";
import type { EsquemaPago } from "@/lib/viajes/calculos";
import { useState } from "react";
import { guardarParametros, guardarPagoOperador } from "./acciones";

export function FormularioParametros({ iniciales }: { iniciales: Record<string, string> }) {
  const [estado, accion] = useActionState(guardarParametros, {});
  const valores = estado.valores ?? iniciales;

  return (
    <form action={accion} key={JSON.stringify(valores)} className="flex max-w-2xl flex-col gap-6">
      <Aviso texto={estado.mensaje} tipo={estado.exito ? "exito" : "error"} />
      {GRUPOS_PARAMETROS.map((g) => (
        <fieldset key={g.titulo} className="flex flex-col gap-3">
          <legend className="mb-2 font-semibold">{g.titulo}</legend>
          <div className="grid gap-4 sm:grid-cols-2">
            {g.campos.map((c) => (
              <Campo
                key={c.columna}
                etiqueta={c.tipo === "numero" && c.unidad ? `${c.etiqueta} (${c.unidad})` : c.etiqueta}
                name={c.columna}
                ayuda={c.ayuda}
                required={c.requerido}
                inputMode={c.tipo === "numero" ? "decimal" : undefined}
                autoComplete="off"
                defaultValue={valores[c.columna] ?? ""}
                error={estado.errores?.[c.columna]}
              />
            ))}
          </div>
        </fieldset>
      ))}
      <BotonEnviar pendiente="Guardando…">Guardar parámetros</BotonEnviar>
    </form>
  );
}

/** Pago al operador: el de la empresa o el de un operador (operadorId). */
export function FormularioPago({
  operadorId,
  iniciales,
  usaElDeLaEmpresa,
}: {
  operadorId: string | null;
  iniciales: Record<string, string>;
  /** Solo para un operador: hoy usa el de la empresa. */
  usaElDeLaEmpresa?: boolean;
}) {
  const [estado, accion] = useActionState(guardarPagoOperador.bind(null, operadorId), {});
  const v = estado.valores ?? iniciales;
  const [esquema, setEsquema] = useState<EsquemaPago>((v.esquema as EsquemaPago) || "pct_subtotal");
  const [propio, setPropio] = useState(!usaElDeLaEmpresa);

  return (
    <form action={accion} className="flex max-w-2xl flex-col gap-4">
      <Aviso texto={estado.mensaje} tipo={estado.exito ? "exito" : "error"} />
      {operadorId && (
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="propio" checked={propio} onChange={(e) => setPropio(e.target.checked)} />
          Este operador tiene un pago distinto al de la empresa
        </label>
      )}
      {(propio || !operadorId) && (
        <div className="grid gap-4 sm:grid-cols-3">
          <Selector etiqueta="Esquema" name="esquema" value={esquema} onChange={(e) => setEsquema(e.target.value as EsquemaPago)} opciones={ESQUEMAS_PAGO} />
          {CAMPOS_ESQUEMA[esquema].map((c) => (
            <Campo
              key={c}
              etiqueta={ETIQUETA_COLUMNA_PAGO[c]}
              name={c}
              inputMode="decimal"
              defaultValue={v[c] ?? ""}
              ayuda={c === "sueldo_base_mensual" ? "Informativo: el sueldo se registra en Costos" : undefined}
              error={estado.errores?.[c]}
            />
          ))}
        </div>
      )}
      <p className="text-sm text-zinc-500">Cada viaje guarda el esquema que se usó; cambiarlo aquí no cambia viajes ya capturados.</p>
      <BotonEnviar pendiente="Guardando…">Guardar pago al operador</BotonEnviar>
    </form>
  );
}
