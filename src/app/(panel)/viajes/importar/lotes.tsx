"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { Aviso, BotonEnviar, Campo } from "@/components/campos";
import type { LoteImportacion } from "@/lib/importacion/datos";
import { numero } from "@/lib/formato";
import { formatearFechaHora } from "@/lib/viajes/fechas";
import { anularLote } from "./acciones";

/** Importaciones hechas: cada una se anula completa (sus viajes y costos se cancelan; nada se borra). */
export function Lotes({ lotes }: { lotes: LoteImportacion[] }) {
  return (
    <section className="flex flex-col gap-3 border-t border-zinc-200 pt-6 dark:border-zinc-800">
      <h2 className="text-lg font-semibold">Importaciones hechas</h2>
      {lotes.length === 0 ? (
        <p className="text-sm text-zinc-500">Todavía no hay importaciones.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {lotes.map((l) => (
            <Lote key={l.id} lote={l} />
          ))}
        </ul>
      )}
    </section>
  );
}

function Lote({ lote }: { lote: LoteImportacion }) {
  const [estado, accion] = useActionState(anularLote.bind(null, lote.id), {});
  const [anulando, setAnulando] = useState(false);
  const anulado = !!lote.anulado_en;
  return (
    <li className={`flex flex-col gap-2 rounded-md border border-zinc-200 p-3 text-sm dark:border-zinc-800 ${anulado ? "opacity-70" : ""}`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="font-medium">
            {lote.archivo}{" "}
            {anulado && (
              <span className="ml-1 rounded bg-red-100 px-1.5 py-0.5 text-xs text-red-800 dark:bg-red-950 dark:text-red-300">anulada</span>
            )}
          </p>
          <p className="text-zinc-500">
            {formatearFechaHora(lote.creado_en)} · {numero(lote.viajes)} viajes · {numero(lote.costos)} costos
            {lote.desde && ` · viajes del ${lote.desde} al ${lote.hasta}`}
          </p>
          {anulado && (
            <p className="text-red-700 dark:text-red-400">
              Anulada el {formatearFechaHora(lote.anulado_en)}: «{lote.motivo_anulacion}»
            </p>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {lote.desde && (
            <Link
              href={`/viajes?origen=importados&estado=${anulado ? "cancelado" : "todos"}&desde=${lote.desde}&hasta=${lote.hasta}`}
              className="underline"
            >
              Ver viajes
            </Link>
          )}
          {!anulado && !anulando && (
            <button type="button" onClick={() => setAnulando(true)} className="text-red-700 underline dark:text-red-400">
              Anular importación…
            </button>
          )}
        </div>
      </div>
      {!anulado && anulando && (
        <form action={accion} className="flex max-w-xl flex-col gap-2 rounded-md border border-red-200 p-3 dark:border-red-900">
          <Aviso texto={estado.mensaje} tipo={estado.exito ? "exito" : "error"} />
          <p className="text-zinc-600 dark:text-zinc-400">
            Se cancelan sus {numero(lote.viajes)} viajes y {numero(lote.costos)} costos (no se borran: quedan en la bitácora con
            el motivo y salen del tablero). Sus folios quedan libres para volver a importarlos.
          </p>
          <Campo etiqueta="Motivo" name="motivo" required minLength={5} />
          <div className="flex items-center gap-4">
            <BotonEnviar pendiente="Anulando…">Anular importación</BotonEnviar>
            <button type="button" onClick={() => setAnulando(false)} className="mt-2 underline">
              No anular
            </button>
          </div>
        </form>
      )}
    </li>
  );
}
