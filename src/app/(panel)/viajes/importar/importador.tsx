"use client";

import Link from "next/link";
import { useMemo, useState, useTransition } from "react";
import { Aviso } from "@/components/campos";
import { numero, pesos } from "@/lib/formato";
import type { ContextoImportacion } from "@/lib/importacion/datos";
import { leerFormulas } from "@/lib/importacion/formulas";
import {
  anioMasComun,
  armarCostos,
  armarViajes,
  leerHojaCostos,
  leerHojaViajes,
  PLANTILLA_COSTOS,
  PLANTILLA_VIAJES,
  type EstadoImportacion,
  type FilaCostoHistorico,
  type FilaHistorica,
  type PreviaViaje,
} from "@/lib/importacion/historico";
import { formatearFecha } from "@/lib/viajes/fechas";
import { leerArchivo, TIPOS_ACEPTADOS } from "../../catalogos/importar/archivo";
import { importarHistorico, type ResultadoImportacionHistorica } from "./acciones";

const claseBoton =
  "rounded-md bg-zinc-900 px-4 py-2 font-medium text-white hover:bg-zinc-700 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900";
const claseBotonSecundario =
  "rounded-md border border-zinc-300 px-4 py-2 font-medium hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800";

const ETIQUETA_ESTADO: Record<EstadoImportacion, { texto: string; clase: string }> = {
  nuevo: { texto: "Nuevo", clase: "bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-300" },
  existe: { texto: "Ya existe: se omite", clase: "bg-zinc-200 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300" },
  error: { texto: "Error", clase: "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300" },
};

interface Leido {
  archivo: string;
  hojaViajes: string | null;
  hojaCostos: string | null;
  viajes: FilaHistorica[];
  costos: FilaCostoHistorico[];
}

type Filtro = "todos" | "avisos" | "errores" | "omitidos";

export function ImportadorHistorico({ contexto }: { contexto: ContextoImportacion }) {
  const [leido, setLeido] = useState<Leido | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [leyendo, setLeyendo] = useState(false);
  const [anio, setAnio] = useState(() => new Date().getFullYear());
  const [filtro, setFiltro] = useState<Filtro>("todos");
  const [resultado, setResultado] = useState<ResultadoImportacionHistorica | null>(null);
  const [pendiente, iniciar] = useTransition();

  async function descargarPlantilla() {
    const { default: escribirXlsx } = await import("write-excel-file/browser");
    const encabezados = (xs: string[]) => [xs.map((value) => ({ value, fontWeight: "bold" as const }))];
    await escribirXlsx([
      { data: encabezados(PLANTILLA_VIAJES), sheet: "Viajes", stickyRowsCount: 1, columns: PLANTILLA_VIAJES.map((e) => ({ width: Math.max(12, e.length + 2) })) },
      { data: encabezados(PLANTILLA_COSTOS), sheet: "Mantenimiento por mes", stickyRowsCount: 1, columns: PLANTILLA_COSTOS.map((e) => ({ width: Math.max(10, e.length + 2) })) },
    ]).toFile("plantilla-viajes-historicos.xlsx");
  }

  async function procesar(archivo: File) {
    setError(null);
    setLeido(null);
    setResultado(null);
    setLeyendo(true);
    try {
      const hojas = await leerArchivo(archivo);
      // Las fórmulas (=1178+464.5) solo existen en .xlsx; dan las partes de cada gasto.
      const formulas = archivo.name.toLowerCase().endsWith(".xlsx")
        ? leerFormulas(new Uint8Array(await archivo.arrayBuffer()), hojas.map((h) => h.nombre))
        : {};
      // Primero la hoja "Viajes"; si no, la primera que parezca un control de viajes.
      const ordenadas = [...hojas].sort((a, b) => Number(b.nombre.toLowerCase() === "viajes") - Number(a.nombre.toLowerCase() === "viajes"));
      let viajes: { hoja: string; filas: FilaHistorica[] } | null = null;
      for (const h of ordenadas) {
        const r = leerHojaViajes(h.filas, formulas[h.nombre]);
        if (!("error" in r) && r.filas.length) {
          viajes = { hoja: h.nombre, filas: r.filas };
          break;
        }
      }
      let costos: { hoja: string; filas: FilaCostoHistorico[] } | null = null;
      for (const h of hojas) {
        if (h.nombre === viajes?.hoja) continue;
        const r = leerHojaCostos(h.filas, formulas[h.nombre]);
        if (!("error" in r) && r.filas.length) {
          costos = { hoja: h.nombre, filas: r.filas };
          break;
        }
      }
      if (!viajes && !costos) {
        throw new Error("No encontré una hoja de viajes (Fecha, No. Viaje, Unidad, Operador, Origen, Destino) ni una de mantenimiento por unidad y mes.");
      }
      setAnio(anioMasComun(viajes?.filas ?? [], new Date().getFullYear()));
      setLeido({
        archivo: archivo.name,
        hojaViajes: viajes?.hoja ?? null,
        hojaCostos: costos?.hoja ?? null,
        viajes: viajes?.filas ?? [],
        costos: costos?.filas ?? [],
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo leer el archivo");
    } finally {
      setLeyendo(false);
    }
  }

  const rv = useMemo(() => (leido ? armarViajes(leido.viajes, { archivo: leido.archivo, ...contexto }) : null), [leido, contexto]);
  const rc = useMemo(
    () =>
      leido
        ? armarCostos(leido.costos, { archivo: leido.archivo, anio, unidades: contexto.unidades, existentes: contexto.costosExistentes })
        : null,
    [leido, anio, contexto],
  );

  if (resultado?.ok) {
    return (
      <div className="flex flex-col gap-2">
        <Aviso
          tipo="exito"
          texto={`Listo: ${resultado.viajes} viajes y ${resultado.costos} costos importados${resultado.omitidos || resultado.costosOmitidos ? ` (${resultado.omitidos + resultado.costosOmitidos} ya existían y se omitieron)` : ""}.`}
        />
        <div className="flex flex-wrap gap-4 text-sm">
          <Link href="/viajes?origen=importados&desde=2000-01-01" className="underline">
            Ver viajes importados
          </Link>
          <Link href="/tablero" className="underline">
            Ir al tablero
          </Link>
          <button type="button" onClick={() => setResultado(null)} className="underline">
            Importar otro archivo
          </button>
        </div>
      </div>
    );
  }

  const cuenta = (xs: { estado: EstadoImportacion }[], e: EstadoImportacion) => xs.filter((x) => x.estado === e).length;
  const nuevos = rv?.previas.filter((p) => p.viaje) ?? [];
  const costosNuevos = rc?.filter((c) => c.costo) ?? [];
  const errores = (rv ? cuenta(rv.previas, "error") : 0) + (rc ? cuenta(rc, "error") : 0);
  const suma = (f: (p: PreviaViaje) => number | null) => nuevos.reduce((s, p) => s + (f(p) ?? 0), 0);
  const visibles =
    rv?.previas.filter((p) =>
      filtro === "avisos" ? p.avisos.length > 0 && p.estado !== "existe" : filtro === "errores" ? p.estado === "error" : filtro === "omitidos" ? p.estado === "existe" : true,
    ) ?? [];

  return (
    <div className="flex flex-col gap-6">
      <section className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium">Excel de control de viajes</span>
            <input
              type="file"
              accept={TIPOS_ACEPTADOS}
              disabled={leyendo}
              onChange={(e) => {
                const archivo = e.target.files?.[0];
                if (archivo) procesar(archivo);
                e.target.value = "";
              }}
              className="text-sm file:mr-3 file:rounded-md file:border file:border-zinc-300 file:bg-white file:px-3 file:py-2 file:text-sm file:font-medium dark:file:border-zinc-700 dark:file:bg-zinc-900"
            />
          </label>
          <button type="button" onClick={descargarPlantilla} className={claseBotonSecundario}>
            Descargar plantilla (.xlsx)
          </button>
        </div>
        <p className="text-sm text-zinc-500">
          Reconoce las columnas por su nombre (Fecha, No. Viaje, Unidad, Operador, Origen, Destino, Cliente, Km vacío y
          cargado, Litros, Dispersión, Precio por litro, Costo diésel, Casetas, Otros, Urea, Gastos operativos, Costo
          mantenimiento, Tarifa, Toneladas, Pago operador). Las unidades deben existir en el catálogo; operadores, clientes
          y fuentes nuevos se dan de alta. Nada se guarda hasta que confirmes.
        </p>
        {leyendo && <p className="text-sm text-zinc-500">Leyendo el archivo…</p>}
        <Aviso texto={error ?? undefined} />
      </section>

      {leido && rv && rc && (
        <>
          <section className="flex flex-col gap-3 rounded-xl border border-zinc-200 p-4 dark:border-zinc-800">
            <p className="text-sm">
              <strong>{leido.archivo}</strong>
              {leido.hojaViajes && <> · hoja «{leido.hojaViajes}»: {leido.viajes.length} viajes</>}
              {leido.hojaCostos && <> · hoja «{leido.hojaCostos}»: {leido.costos.length} renglones de mantenimiento</>}
            </p>
            <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-4">
              <Dato titulo="Viajes nuevos" valor={numero(nuevos.length)} />
              <Dato titulo="Ya existen (se omiten)" valor={numero(cuenta(rv.previas, "existe"))} />
              <Dato titulo="Con error" valor={numero(cuenta(rv.previas, "error"))} alerta={cuenta(rv.previas, "error") > 0} />
              <Dato titulo="Con avisos" valor={numero(rv.previas.filter((p) => p.avisos.length && p.estado !== "existe").length)} />
              <Dato titulo="Km" valor={numero(suma((p) => p.km))} />
              <Dato titulo="Litros" valor={numero(suma((p) => p.litros))} />
              <Dato titulo="Diésel pagado" valor={pesos(suma((p) => p.diesel), 0)} />
              <Dato titulo="Gastos pagados" valor={pesos(suma((p) => p.gastos), 0)} />
              <Dato titulo="Ingreso (sin IVA)" valor={pesos(suma((p) => p.ingreso), 0)} />
              <Dato titulo="Pago al operador" valor={pesos(suma((p) => p.pago), 0)} />
              <Dato titulo="Costos de mantenimiento nuevos" valor={numero(costosNuevos.length)} />
              <Dato titulo="Mantenimiento (subtotal sin IVA)" valor={pesos(costosNuevos.reduce((s, c) => s + (c.subtotal ?? 0), 0), 0)} />
            </dl>
            {(rv.nuevos.operadores.length > 0 || rv.nuevos.clientes.length > 0 || rv.nuevos.fuentes.length > 0) && (
              <div className="text-sm">
                <p className="font-medium">Se darán de alta en los catálogos:</p>
                <ul className="list-disc pl-5 text-zinc-600 dark:text-zinc-400">
                  {rv.nuevos.operadores.length > 0 && <li>Operadores: {rv.nuevos.operadores.join(", ")}</li>}
                  {rv.nuevos.clientes.length > 0 && <li>Clientes (facturan por peso cargado): {rv.nuevos.clientes.join(", ")}</li>}
                  {rv.nuevos.fuentes.length > 0 && <li>Fuentes de diésel (tarjeta): {rv.nuevos.fuentes.join(", ")}</li>}
                </ul>
              </div>
            )}
            <p className="text-sm text-zinc-500">
              Cada viaje entra cerrado, con salida y llegada ese día a mediodía (el Excel no trae horas), tramos sin odómetros
              y su diésel validado. No cuentan en días en ruta, utilización, ingreso por unidad por día ni tiempos de carga y
              descarga.
            </p>
          </section>

          {leido.viajes.length > 0 && (
            <section className="flex flex-col gap-3">
              <div className="flex flex-wrap items-center gap-3">
                <h2 className="text-lg font-semibold">Viajes</h2>
                <div role="tablist" className="flex flex-wrap gap-1 text-sm">
                  {(
                    [
                      ["todos", "Todos"],
                      ["avisos", "Con avisos"],
                      ["errores", "Con error"],
                      ["omitidos", "Se omiten"],
                    ] as const
                  ).map(([valor, texto]) => (
                    <button
                      key={valor}
                      role="tab"
                      aria-selected={filtro === valor}
                      onClick={() => setFiltro(valor)}
                      className={`rounded-md px-2 py-1 ${filtro === valor ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900" : "border border-zinc-300 dark:border-zinc-700"}`}
                    >
                      {texto}
                    </button>
                  ))}
                </div>
              </div>
              <TablaViajes previas={visibles} />
            </section>
          )}

          {leido.costos.length > 0 && (
            <section className="flex flex-col gap-3">
              <div className="flex flex-wrap items-end gap-3">
                <h2 className="text-lg font-semibold">Mantenimiento por unidad y mes</h2>
                <label className="flex items-center gap-2 text-sm">
                  Año de los meses sin año
                  <input
                    type="number"
                    min={2000}
                    max={2100}
                    value={anio}
                    onChange={(e) => setAnio(Number(e.target.value) || anio)}
                    className="w-24 rounded-md border border-zinc-300 bg-white px-2 py-1 dark:border-zinc-700 dark:bg-zinc-950"
                  />
                </label>
              </div>
              <p className="text-sm text-zinc-500">
                Los montos son subtotales sin IVA: se guardan con factura, costo = monto del Excel, IVA 16 % aparte y total =
                monto × 1.16. Van a la unidad en ese mes.
              </p>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[40rem] text-sm">
                  <thead className="text-left text-zinc-500">
                    <tr>
                      <th className="py-1 pr-3 font-medium">Fila</th>
                      <th className="py-1 pr-3 font-medium">Unidad</th>
                      <th className="py-1 pr-3 font-medium">Mes</th>
                      <th className="py-1 pr-3 font-medium">Categoría</th>
                      <th className="py-1 pr-3 text-right font-medium">Subtotal</th>
                      <th className="py-1 pr-3 text-right font-medium">Total con IVA</th>
                      <th className="py-1 font-medium">Estado</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rc.map((c, i) => (
                      <tr key={`${c.fila}-${c.categoria}-${i}`} className="border-t border-zinc-100 align-top dark:border-zinc-800">
                        <td className="py-1 pr-3 text-zinc-500">{c.fila}</td>
                        <td className="py-1 pr-3">{c.unidad}</td>
                        <td className="py-1 pr-3">{c.mes?.slice(0, 7) ?? "—"}</td>
                        <td className="py-1 pr-3">{c.categoria}</td>
                        <td className="py-1 pr-3 text-right">{pesos(c.subtotal)}</td>
                        <td className="py-1 pr-3 text-right">{c.costo ? pesos(c.costo.monto) : "—"}</td>
                        <td className="py-1">
                          <Estado estado={c.estado} />
                          <Mensajes errores={c.errores} avisos={c.avisos} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          <section className="flex flex-col gap-2 border-t border-zinc-200 pt-4 dark:border-zinc-800">
            {errores > 0 && <Aviso texto={`Hay ${errores} renglón(es) con error. Corrígelos en tu Excel y vuelve a subirlo: se guarda todo o nada.`} />}
            {resultado && !resultado.ok && <Aviso texto={resultado.mensaje} />}
            <button
              type="button"
              disabled={pendiente || errores > 0 || (!nuevos.length && !costosNuevos.length)}
              onClick={() =>
                iniciar(async () =>
                  setResultado(await importarHistorico({ archivo: leido.archivo, anio, viajes: leido.viajes, costos: leido.costos })),
                )
              }
              className={`self-start ${claseBoton}`}
            >
              {pendiente ? "Importando…" : `Importar ${nuevos.length} viajes y ${costosNuevos.length} costos`}
            </button>
          </section>
        </>
      )}
    </div>
  );
}

function Dato({ titulo, valor, alerta }: { titulo: string; valor: string; alerta?: boolean }) {
  return (
    <div className="flex flex-col">
      <dt className="text-zinc-500">{titulo}</dt>
      <dd className={`font-medium ${alerta ? "text-red-600" : ""}`}>{valor}</dd>
    </div>
  );
}

function Estado({ estado }: { estado: EstadoImportacion }) {
  const e = ETIQUETA_ESTADO[estado];
  return <span className={`whitespace-nowrap rounded px-1.5 py-0.5 text-xs ${e.clase}`}>{e.texto}</span>;
}

function Mensajes({ errores, avisos }: { errores: string[]; avisos: string[] }) {
  if (!errores.length && !avisos.length) return null;
  return (
    <ul className="mt-1 flex flex-col gap-0.5 text-xs">
      {errores.map((m) => (
        <li key={m} className="text-red-600">
          {m}
        </li>
      ))}
      {avisos.map((m) => (
        <li key={m} className="text-amber-700 dark:text-amber-400">
          {m}
        </li>
      ))}
    </ul>
  );
}

function TablaViajes({ previas }: { previas: PreviaViaje[] }) {
  if (!previas.length) return <p className="text-sm text-zinc-500">Nada con este filtro.</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[64rem] text-sm">
        <thead className="text-left text-zinc-500">
          <tr>
            <th className="py-1 pr-3 font-medium">Fila</th>
            <th className="py-1 pr-3 font-medium">Folio</th>
            <th className="py-1 pr-3 font-medium">Fecha</th>
            <th className="py-1 pr-3 font-medium">Unidad · operador</th>
            <th className="py-1 pr-3 font-medium">Ruta</th>
            <th className="py-1 pr-3 text-right font-medium">Km</th>
            <th className="py-1 pr-3 text-right font-medium">Litros</th>
            <th className="py-1 pr-3 text-right font-medium">Diésel</th>
            <th className="py-1 pr-3 text-right font-medium">Gastos</th>
            <th className="py-1 pr-3 text-right font-medium">Ingreso</th>
            <th className="py-1 pr-3 text-right font-medium">Pago</th>
            <th className="py-1 font-medium">Estado</th>
          </tr>
        </thead>
        <tbody>
          {previas.map((p) => (
            <tr key={p.fila} className="border-t border-zinc-100 align-top dark:border-zinc-800">
              <td className="py-1 pr-3 text-zinc-500">{p.fila}</td>
              <td className="py-1 pr-3">
                <span className="font-medium">{p.folio}</span>
                {p.remisiones.length > 0 && <span className="block text-xs text-zinc-500">Rem. {p.remisiones.join(", ")}</span>}
              </td>
              <td className="py-1 pr-3 whitespace-nowrap">{p.fecha ? formatearFecha(p.fecha) : "—"}</td>
              <td className="py-1 pr-3">
                {p.unidad} · {p.operador}
              </td>
              <td className="py-1 pr-3">{p.ruta}</td>
              <td className="py-1 pr-3 text-right">{numero(p.km)}</td>
              <td className="py-1 pr-3 text-right">{numero(p.litros, 2)}</td>
              <td className="py-1 pr-3 text-right">{pesos(p.diesel)}</td>
              <td className="py-1 pr-3 text-right">{pesos(p.gastos)}</td>
              <td className="py-1 pr-3 text-right">{pesos(p.ingreso)}</td>
              <td className="py-1 pr-3 text-right">{pesos(p.pago)}</td>
              <td className="min-w-[16rem] py-1">
                <Estado estado={p.estado} />
                <Mensajes errores={p.errores} avisos={p.avisos} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
