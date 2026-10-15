"use client";

import type { Hoja } from "@/lib/kpis/exportacion";

export function ExportarTablero({ hojas, nombreArchivo }: { hojas: Hoja[]; nombreArchivo: string }) {
  async function exportar() {
    const { default: escribirXlsx } = await import("write-excel-file/browser");
    await escribirXlsx(
      hojas.map((h) => ({
        sheet: h.nombre,
        data: h.filas.map((fila, i) =>
          fila.map((value) => (value === null || value === undefined ? null : i === 0 || (h.nombre === "Resumen" && i === 1) ? { value, fontWeight: "bold" as const } : { value })),
        ),
        stickyRowsCount: 1,
        columns: (h.filas[1] ?? h.filas[0] ?? []).map((_, j) => ({ width: j === 0 ? 34 : 16 })),
      })),
    ).toFile(nombreArchivo);
  }
  return (
    <button
      type="button"
      onClick={exportar}
      className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm font-medium hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
    >
      Exportar tablero a Excel
    </button>
  );
}
