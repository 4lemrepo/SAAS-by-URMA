"use client";

import Link from "next/link";
import { numero, pesos, porcentaje } from "@/lib/formato";
import type { ViajeCompleto } from "@/lib/viajes/datos";
import { filasExportacion } from "@/lib/viajes/exportacion";
import { formatearFechaHora } from "@/lib/viajes/fechas";

export function ListaViajes({
  viajes,
  ve,
  nombreArchivo,
}: {
  viajes: ViajeCompleto[];
  ve: { veTarifas: boolean; veUtilidades: boolean };
  nombreArchivo: string;
}) {
  const { veTarifas, veUtilidades } = ve;
  const suma = (f: (v: ViajeCompleto) => number | null) => viajes.reduce((s, v) => s + (f(v) ?? 0), 0);
  const totales = {
    km: suma((v) => v.resumen.kmTotales),
    toneladas: suma((v) => v.toneladas_cargadas),
    litros: suma((v) => v.resumen.litros),
    diesel: suma((v) => v.resumen.costoDiesel),
    gastos: suma((v) => v.resumen.gastosCosto),
    ingreso: suma((v) => v.resumen.ingreso),
    utilidad: suma((v) => v.resumen.utilidad),
  };

  async function exportar() {
    const { encabezados, filas } = filasExportacion(viajes, ve);
    const { default: escribirXlsx } = await import("write-excel-file/browser");
    await escribirXlsx(
      [encabezados.map((value) => ({ value, fontWeight: "bold" as const })), ...filas.map((f) => f.map((value) => (value === null ? null : { value })))],
      { sheet: "Viajes", stickyRowsCount: 1, columns: encabezados.map((e) => ({ width: Math.max(10, Math.min(30, e.length + 4)) })) },
    ).toFile(nombreArchivo);
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-zinc-200 p-3 text-sm dark:border-zinc-800">
        <p className="flex flex-wrap gap-x-4 gap-y-1">
          <span>
            <strong>{viajes.length}</strong> viajes
          </span>
          <span>{numero(totales.km)} km</span>
          <span>{numero(totales.toneladas, 1)} t</span>
          <span>{numero(totales.litros)} L · {pesos(totales.diesel, 0)}</span>
          <span>Gastos {pesos(totales.gastos, 0)}</span>
          {veTarifas && (
            <>
              <span>Ingreso {pesos(totales.ingreso, 0)}</span>
              {veUtilidades && <span className={totales.utilidad < 0 ? "text-red-600" : ""}>Utilidad {pesos(totales.utilidad, 0)}</span>}
            </>
          )}
        </p>
        <button
          type="button"
          onClick={exportar}
          disabled={!viajes.length}
          className="rounded-md border border-zinc-300 px-3 py-1.5 font-medium hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
        >
          Exportar a Excel
        </button>
      </div>
      {viajes.length === 0 ? (
        <p className="rounded-xl border border-dashed border-zinc-300 p-8 text-center text-zinc-500 dark:border-zinc-700">
          No hay viajes con esos filtros.
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {viajes.map((v) => {
            const cargado = v.tramos.find((t) => t.tipo === "cargado");
            const vacio = v.tramos.find((t) => t.tipo === "vacio");
            return (
              <li key={v.id}>
                <Link
                  href={`/viajes/${v.id}`}
                  className="flex flex-wrap items-start justify-between gap-2 rounded-xl border border-zinc-200 bg-white p-3 text-sm hover:border-zinc-400 dark:border-zinc-800 dark:bg-zinc-900"
                >
                  <div className="min-w-0">
                    <p className="font-medium">
                      {v.folio} · {v.unidad} · {v.operador}
                      {v.estado === "abierto" && (
                        <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-xs text-amber-800 dark:bg-amber-950 dark:text-amber-300">abierto</span>
                      )}
                      {v.estado === "cancelado" && (
                        <span className="ml-2 rounded bg-red-100 px-1.5 py-0.5 text-xs text-red-800 dark:bg-red-950 dark:text-red-300">cancelado</span>
                      )}
                    </p>
                    <p className="text-zinc-500">
                      {formatearFechaHora(v.fecha_salida)} · {vacio?.origen ?? "?"} → {cargado?.origen ?? vacio?.destino ?? "?"} → {cargado?.destino ?? "?"}
                      {v.cliente && ` · ${v.cliente}`}
                    </p>
                    {v.estado === "cancelado" && <p className="text-red-700 dark:text-red-400">Motivo: {v.motivo_cancelacion}</p>}
                  </div>
                  <div className="text-right">
                    <p>
                      {numero(v.resumen.kmTotales)} km · {numero(v.resumen.litros)} L
                    </p>
                    {veUtilidades ? (
                      <p className={(v.resumen.utilidad ?? 0) < 0 ? "text-red-600" : "text-zinc-500"}>
                        {v.resumen.ingreso === null ? "sin tarifa" : `${pesos(v.resumen.utilidad, 0)} (${porcentaje(v.resumen.margenPct)})`}
                      </p>
                    ) : (
                      veTarifas && <p className="text-zinc-500">{v.resumen.ingreso === null ? "sin tarifa" : `Ingreso ${pesos(v.resumen.ingreso, 0)}`}</p>
                    )}
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
