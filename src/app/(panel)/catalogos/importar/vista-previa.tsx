"use client";

import type { DefinicionCatalogo } from "@/lib/catalogos/definiciones";
import type { FilaPrevia } from "@/lib/importacion/plantilla";

const ESTADO = {
  nueva: { texto: "Nueva", clase: "bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-300" },
  existe: { texto: "Ya existe", clase: "bg-zinc-200 text-zinc-700 dark:bg-zinc-700 dark:text-zinc-200" },
  error: { texto: "Error", clase: "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300" },
} as const;

export function Estado({ estado }: { estado: FilaPrevia["estado"] }) {
  return <span className={`rounded px-1.5 py-0.5 text-xs font-medium ${ESTADO[estado].clase}`}>{ESTADO[estado].texto}</span>;
}

/** Tabla de vista previa: una fila por registro, con los errores marcados en su celda. */
export function VistaPrevia({
  def,
  filas,
  etiquetaFila = "Fila",
  columnas,
  extra,
}: {
  def: DefinicionCatalogo;
  filas: FilaPrevia[];
  etiquetaFila?: string;
  /** Columnas a mostrar; por defecto, todos los campos. */
  columnas?: string[];
  /** Columna adicional (p. ej. rendimiento sugerido). */
  extra?: { titulo: string; valor: (f: FilaPrevia) => React.ReactNode };
}) {
  const campos = def.campos.filter((c) => !columnas || columnas.includes(c.columna));
  return (
    <div className="overflow-x-auto rounded-xl border border-zinc-200 dark:border-zinc-800">
      <table className="w-full text-sm">
        <thead className="bg-zinc-50 text-left text-zinc-500 dark:bg-zinc-900">
          <tr>
            <th className="px-3 py-2 font-medium">{etiquetaFila}</th>
            <th className="px-3 py-2 font-medium">Estado</th>
            {campos.map((c) => (
              <th key={c.columna} className="px-3 py-2 font-medium whitespace-nowrap">
                {c.etiqueta.replace(/ \(opcional\)$/, "")}
              </th>
            ))}
            {extra && <th className="px-3 py-2 font-medium">{extra.titulo}</th>}
          </tr>
        </thead>
        <tbody>
          {filas.map((f) => (
            <tr key={f.numero} className="border-t border-zinc-200 align-top dark:border-zinc-800">
              <td className="px-3 py-2 text-zinc-500">{f.numero}</td>
              <td className="px-3 py-2">
                <Estado estado={f.estado} />
                {f.aviso && <p className="mt-1 max-w-48 text-xs text-zinc-500">{f.aviso}</p>}
              </td>
              {campos.map((c) => {
                const error = f.errores[c.columna];
                return (
                  <td key={c.columna} className={`px-3 py-2 ${error ? "bg-red-50 dark:bg-red-950/40" : ""}`}>
                    {f.original[c.columna] || <span className="text-zinc-400">—</span>}
                    {error && <p className="text-xs text-red-600">{error}</p>}
                  </td>
                );
              })}
              {extra && <td className="px-3 py-2">{extra.valor(f)}</td>}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
