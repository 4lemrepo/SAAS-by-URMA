"use client";

import Link from "next/link";
import { useState } from "react";
import { useFormStatus } from "react-dom";
import { CATALOGOS, type ClaveCatalogo } from "@/lib/catalogos/definiciones";
import { formatearValor } from "@/lib/catalogos/formato";
import { claveComparacion } from "@/lib/catalogos/validacion";
import type { FilaCatalogo } from "@/lib/catalogos/datos";
import { cambiarActivo } from "./acciones";

export function ListaCatalogo({
  clave,
  filas,
  puedeEditar,
}: {
  clave: ClaveCatalogo;
  filas: FilaCatalogo[];
  puedeEditar: boolean;
}) {
  const def = CATALOGOS[clave];
  const [busqueda, setBusqueda] = useState("");
  const [verInactivos, setVerInactivos] = useState(false);
  const campos = def.columnasLista.map((c) => def.campos.find((x) => x.columna === c)!);
  const [principal, ...resto] = campos;

  const texto = claveComparacion(busqueda);
  const visibles = filas.filter(
    (f) =>
      (verInactivos || f.activo) &&
      (!texto || campos.some((c) => claveComparacion(formatearValor(c, f.valores[c.columna])).includes(texto))),
  );
  const inactivos = filas.filter((f) => !f.activo).length;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-3">
        <input
          type="search"
          value={busqueda}
          onChange={(e) => setBusqueda(e.target.value)}
          placeholder="Buscar…"
          aria-label={`Buscar en ${def.titulo.toLowerCase()}`}
          className="min-w-0 flex-1 rounded-md border border-zinc-300 bg-white px-3 py-2 text-base outline-none focus:border-zinc-900 dark:border-zinc-700 dark:bg-zinc-950"
        />
        {inactivos > 0 && (
          <label className="flex items-center gap-2 text-sm text-zinc-600 dark:text-zinc-400">
            <input type="checkbox" checked={verInactivos} onChange={(e) => setVerInactivos(e.target.checked)} />
            Ver inactivos ({inactivos})
          </label>
        )}
      </div>

      {visibles.length === 0 ? (
        <p className="rounded-xl border border-dashed border-zinc-300 p-8 text-center text-zinc-500 dark:border-zinc-700">
          {filas.length === 0 ? `Todavía no hay ${def.titulo.toLowerCase()}.` : "Nada coincide con la búsqueda."}
        </p>
      ) : (
        <>
          {/* Celular: tarjetas */}
          <ul className="flex flex-col gap-2 md:hidden">
            {visibles.map((f) => (
              <li
                key={f.id}
                className={`rounded-xl border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-900 ${f.activo ? "" : "opacity-60"}`}
              >
                <div className="flex items-start justify-between gap-2">
                  <p className="font-medium">
                    {formatearValor(principal, f.valores[principal.columna])}
                    {!f.activo && <Inactivo />}
                  </p>
                  {puedeEditar && <Acciones clave={clave} fila={f} />}
                </div>
                <dl className="mt-1 grid grid-cols-[auto_1fr] gap-x-3 text-sm">
                  {resto.map((c) => (
                    <div key={c.columna} className="contents">
                      <dt className="text-zinc-500">{c.etiqueta}</dt>
                      <dd>{formatearValor(c, f.valores[c.columna])}</dd>
                    </div>
                  ))}
                </dl>
              </li>
            ))}
          </ul>

          {/* Escritorio: tabla */}
          <div className="hidden overflow-x-auto rounded-xl border border-zinc-200 md:block dark:border-zinc-800">
            <table className="w-full text-sm">
              <thead className="bg-zinc-50 text-left text-zinc-500 dark:bg-zinc-900">
                <tr>
                  {campos.map((c) => (
                    <th key={c.columna} className="px-3 py-2 font-medium">
                      {c.etiqueta}
                    </th>
                  ))}
                  {puedeEditar && <th className="px-3 py-2" />}
                </tr>
              </thead>
              <tbody>
                {visibles.map((f) => (
                  <tr key={f.id} className={`border-t border-zinc-200 dark:border-zinc-800 ${f.activo ? "" : "opacity-60"}`}>
                    {campos.map((c, i) => (
                      <td key={c.columna} className={`px-3 py-2 ${i === 0 ? "font-medium" : ""}`}>
                        {formatearValor(c, f.valores[c.columna])}
                        {i === 0 && !f.activo && <Inactivo />}
                      </td>
                    ))}
                    {puedeEditar && (
                      <td className="px-3 py-2 text-right">
                        <Acciones clave={clave} fila={f} />
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

function Inactivo() {
  return (
    <span className="ml-2 rounded bg-zinc-200 px-1.5 py-0.5 text-xs font-normal text-zinc-700 dark:bg-zinc-700 dark:text-zinc-200">
      Inactivo
    </span>
  );
}

function Acciones({ clave, fila }: { clave: ClaveCatalogo; fila: FilaCatalogo }) {
  return (
    <div className="flex shrink-0 items-center justify-end gap-3 text-sm">
      <Link href={`/catalogos/${clave}/${fila.id}`} className="font-medium underline">
        Editar
      </Link>
      <form action={cambiarActivo.bind(null, clave, fila.id, !fila.activo)}>
        <BotonActivo activo={fila.activo} />
      </form>
    </div>
  );
}

function BotonActivo({ activo }: { activo: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className="text-zinc-600 underline disabled:opacity-50 dark:text-zinc-400">
      {pending ? "…" : activo ? "Desactivar" : "Reactivar"}
    </button>
  );
}
