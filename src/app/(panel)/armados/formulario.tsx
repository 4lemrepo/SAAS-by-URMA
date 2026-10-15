"use client";

import { useActionState, useState } from "react";
import { Aviso, BotonEnviar, Campo, Selector } from "@/components/campos";
import { cambiarArmado } from "./acciones";

export interface OpcionEquipo {
  valor: string;
  etiqueta: string;
  /** Número económico de la unidad donde ya está enganchado, si es otra. */
  enOtraUnidad: string | null;
}

/** Fecha y hora local para <input type="datetime-local">. */
function ahoraLocal() {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
}

export function FormularioArmado({
  unidadId,
  remolques,
  dollies,
  actual,
}: {
  unidadId: string;
  remolques: OpcionEquipo[];
  dollies: OpcionEquipo[];
  actual: { remolque1: string; dolly: string; remolque2: string };
}) {
  const [estado, despachar] = useActionState(cambiarArmado.bind(null, unidadId), {});
  const [desde] = useState(ahoraLocal);

  // La fecha se manda en ISO con la zona del navegador: el servidor puede estar en UTC.
  const accion = (form: FormData) => {
    const local = form.get("desde");
    if (typeof local === "string" && local) form.set("desde_iso", new Date(local).toISOString());
    despachar(form);
  };

  const opciones = (lista: OpcionEquipo[]) =>
    lista.map((o) => ({ valor: o.valor, etiqueta: o.enOtraUnidad ? `${o.etiqueta} — en ${o.enOtraUnidad}` : o.etiqueta }));

  return (
    <form action={accion} className="flex max-w-xl flex-col gap-4">
      <Aviso texto={estado.mensaje} tipo={estado.exito ? "exito" : "error"} />
      <p className="text-sm text-zinc-500">
        Sencillo: solo remolque 1. Full: remolque 1 + dolly + remolque 2. Deja todo vacío para desenganchar.
        Un equipo que está en otra unidad hay que quitarlo de ahí primero.
      </p>
      <div className="grid gap-4 sm:grid-cols-3">
        <Selector etiqueta="Remolque 1" name="remolque1" opciones={opciones(remolques)} vacio="— ninguno —" defaultValue={actual.remolque1} error={estado.errores?.remolque1} />
        <Selector etiqueta="Dolly" name="dolly" opciones={opciones(dollies)} vacio="— ninguno —" defaultValue={actual.dolly} error={estado.errores?.dolly} />
        <Selector etiqueta="Remolque 2" name="remolque2" opciones={opciones(remolques)} vacio="— ninguno —" defaultValue={actual.remolque2} error={estado.errores?.remolque2} />
      </div>
      <Campo
        etiqueta="¿Desde cuándo?"
        name="desde"
        type="datetime-local"
        defaultValue={desde}
        ayuda="Si el cambio fue antes, pon la fecha y hora en que se hizo"
        error={estado.errores?.desde}
      />
      <BotonEnviar pendiente="Guardando…">Guardar armado</BotonEnviar>
    </form>
  );
}
