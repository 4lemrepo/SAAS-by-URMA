"use client";

import { useActionState, useState, useTransition } from "react";
import { Aviso, BotonEnviar, Campo, Selector } from "@/components/campos";
import { hoy } from "@/lib/viajes/fechas";
import { SubirArchivo } from "../viajes/piezas";
import { cancelarCosto, guardarCosto } from "./acciones";

export interface GrupoEquipo {
  titulo: string;
  opciones: { valor: string; etiqueta: string }[];
}

export function FormularioCosto({
  empresaId,
  categorias,
  equipos,
}: {
  empresaId: string;
  categorias: { valor: string; etiqueta: string }[];
  equipos: GrupoEquipo[];
}) {
  const [estado, accion] = useActionState(guardarCosto, {});
  const [abierto, setAbierto] = useState(false);
  const v = estado.valores ?? {};
  const e = estado.errores ?? {};
  if (!abierto) {
    return (
      <div className="flex flex-col gap-2">
        {estado.exito && <Aviso tipo="exito" texto={estado.mensaje} />}
        <button
          type="button"
          onClick={() => setAbierto(true)}
          className="self-start rounded-md bg-zinc-900 px-4 py-2 font-medium text-white dark:bg-zinc-100 dark:text-zinc-900"
        >
          Registrar costo
        </button>
      </div>
    );
  }
  return (
    <form action={accion} key={estado.enviadoEn ?? 0} className="flex flex-col gap-3 rounded-xl border border-zinc-200 p-4 dark:border-zinc-800">
      <Aviso texto={estado.mensaje} tipo={estado.exito ? "exito" : "error"} />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <Campo etiqueta="Fecha" name="fecha" type="date" defaultValue={v.fecha ?? hoy()} required error={e.fecha} />
        <Selector etiqueta="Categoría" name="categoria_id" opciones={categorias} vacio="Elige…" defaultValue={v.categoria_id ?? ""} required error={e.categoria_id} />
        <Campo etiqueta="Monto" name="monto" inputMode="decimal" defaultValue={v.monto ?? ""} required error={e.monto} />
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium">¿De qué equipo?</span>
          <select
            name="equipo"
            defaultValue={v.equipo ?? ""}
            className="rounded-md border border-zinc-300 bg-white px-3 py-2 text-base dark:border-zinc-700 dark:bg-zinc-950"
          >
            <option value="">General de la empresa (se prorratea)</option>
            {equipos.map((g) => (
              <optgroup key={g.titulo} label={g.titulo}>
                {g.opciones.map((o) => (
                  <option key={o.valor} value={o.valor}>
                    {o.etiqueta}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
          {e.equipo && <span className="text-red-600">{e.equipo}</span>}
        </label>
        <Campo etiqueta="Mes al que aplica" name="mes" type="month" defaultValue={v.mes ?? hoy().slice(0, 7)} error={e.mes} />
        <Campo etiqueta="Repartir en meses" name="meses" inputMode="numeric" defaultValue={v.meses ?? "1"} ayuda="Ej. seguro anual: 12" error={e.meses} />
        <Campo etiqueta="Proveedor" name="proveedor" defaultValue={v.proveedor ?? ""} error={e.proveedor} />
        <Campo etiqueta="No. de comprobante o factura" name="numero_comprobante" defaultValue={v.numero_comprobante ?? ""} error={e.numero_comprobante} />
        <Campo etiqueta="Folio" name="folio" placeholder="Automático" defaultValue={v.folio ?? ""} error={e.folio} />
        <SubirArchivo bucket="comprobantes" empresaId={empresaId} nombre="comprobante_path" etiqueta="Comprobante (foto o PDF)" acepta="image/*,application/pdf" error={e.comprobante_path} />
      </div>
      <Campo etiqueta="Notas" name="notas" defaultValue={v.notas ?? ""} error={e.notas} />
      <div className="flex items-center gap-4">
        <BotonEnviar pendiente="Guardando…">Guardar costo</BotonEnviar>
        <button type="button" onClick={() => setAbierto(false)} className="mt-2 text-sm underline">
          Cerrar
        </button>
      </div>
    </form>
  );
}

export function BotonCancelarCosto({ id, cancelado }: { id: string; cancelado: boolean }) {
  const [pendiente, iniciar] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <span className="flex flex-col items-end">
      <button
        type="button"
        disabled={pendiente}
        onClick={() => iniciar(async () => setError(await cancelarCosto(id, !cancelado)))}
        className="text-sm text-zinc-600 underline disabled:opacity-50 dark:text-zinc-400"
      >
        {cancelado ? "Reactivar" : "Cancelar"}
      </button>
      {error && <span className="text-xs text-red-600">{error}</span>}
    </span>
  );
}
