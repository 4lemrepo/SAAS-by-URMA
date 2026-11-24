"use client";

import { useState, useTransition } from "react";
import { desglosarIva, TASAS_IVA, tasaIva, type TasaIva } from "@/lib/costos/iva";
import { pesos } from "@/lib/formato";

/** Estado de "¿Tiene factura?" y su tasa, con el valor por defecto que se le dé (categoría o fuente). */
export function useFactura(inicial: { tieneFactura: boolean; tasa?: TasaIva }) {
  const [tieneFactura, setTieneFactura] = useState(inicial.tieneFactura);
  const [tasa, setTasa] = useState<TasaIva>(inicial.tasa ?? 16);
  return { tieneFactura, setTieneFactura, tasa, setTasa };
}

/**
 * Casilla "¿Tiene factura?", tasa de IVA y el costo para rentabilidad que
 * resulta del total capturado. Manda tiene_factura y tasa_iva con el formulario.
 */
export function CamposFactura({
  total,
  factura,
}: {
  total: number | null;
  factura: ReturnType<typeof useFactura>;
}) {
  const d = total !== null && total > 0 ? desglosarIva(total, factura.tieneFactura, factura.tasa) : null;
  return (
    <div className="flex flex-col gap-2 rounded-md bg-zinc-50 p-3 text-sm sm:col-span-2 lg:col-span-3 dark:bg-zinc-900">
      <div className="flex flex-wrap items-center gap-4">
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            name="tiene_factura"
            checked={factura.tieneFactura}
            onChange={(e) => factura.setTieneFactura(e.target.checked)}
          />
          ¿Tiene factura?
        </label>
        <label className="flex items-center gap-2">
          <span>Tasa de IVA</span>
          <select
            name="tasa_iva"
            value={String(factura.tasa)}
            onChange={(e) => factura.setTasa(tasaIva(e.target.value))}
            disabled={!factura.tieneFactura}
            className="rounded-md border border-zinc-300 bg-white px-2 py-1 disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-950"
          >
            {TASAS_IVA.map((t) => (
              <option key={t.valor} value={t.valor}>
                {t.etiqueta}
              </option>
            ))}
          </select>
          {/* Un select deshabilitado no se envía: la tasa se manda igual. */}
          {!factura.tieneFactura && <input type="hidden" name="tasa_iva" value={String(factura.tasa)} />}
        </label>
      </div>
      <p>
        Costo para rentabilidad: <strong>{pesos(d?.costo ?? null)}</strong>
        {d && d.iva > 0 && <span className="text-zinc-500"> · IVA acreditable {pesos(d.iva)}</span>}
      </p>
    </div>
  );
}

/** Desglose de un renglón ya capturado: total, IVA y costo para rentabilidad. */
export function TextoFactura({ total, iva, costo, tieneFactura, tasa }: { total: number | null; iva: number; costo: number | null; tieneFactura: boolean; tasa: number }) {
  return (
    <span>
      Total {pesos(total)} · {tieneFactura ? `con factura (IVA ${tasa} %: ${pesos(iva)})` : "sin factura"} ·{" "}
      <strong>Costo para rentabilidad: {pesos(costo)}</strong>
    </span>
  );
}

/** Cambiar "¿Tiene factura?" y la tasa de algo ya capturado (gasto, carga o costo). */
export function EditarFactura({
  tieneFactura,
  tasa,
  guardar,
}: {
  tieneFactura: boolean;
  tasa: TasaIva;
  guardar: (tieneFactura: boolean, tasa: TasaIva) => Promise<string | null>;
}) {
  const [abierto, setAbierto] = useState(false);
  const [tiene, setTiene] = useState(tieneFactura);
  const [t, setT] = useState<TasaIva>(tasa);
  const [error, setError] = useState<string | null>(null);
  const [pendiente, iniciar] = useTransition();
  if (!abierto) {
    return (
      <button type="button" onClick={() => setAbierto(true)} className="text-sm text-zinc-600 underline dark:text-zinc-400">
        Cambiar factura
      </button>
    );
  }
  return (
    <span className="flex flex-wrap items-center gap-2 text-sm">
      <label className="flex items-center gap-1">
        <input type="checkbox" checked={tiene} onChange={(e) => setTiene(e.target.checked)} />
        Con factura
      </label>
      <select
        value={String(t)}
        onChange={(e) => setT(tasaIva(e.target.value))}
        disabled={!tiene}
        className="rounded-md border border-zinc-300 bg-white px-1 py-0.5 disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-950"
      >
        {TASAS_IVA.map((x) => (
          <option key={x.valor} value={x.valor}>
            {x.etiqueta}
          </option>
        ))}
      </select>
      <button
        type="button"
        disabled={pendiente}
        onClick={() =>
          iniciar(async () => {
            const e = await guardar(tiene, t);
            setError(e);
            if (!e) setAbierto(false);
          })
        }
        className="rounded-md border border-zinc-300 px-2 py-0.5 font-medium disabled:opacity-50 dark:border-zinc-700"
      >
        {pendiente ? "Guardando…" : "Guardar"}
      </button>
      <button type="button" onClick={() => setAbierto(false)} className="underline">
        Cerrar
      </button>
      {error && <span className="text-xs text-red-600">{error}</span>}
    </span>
  );
}
