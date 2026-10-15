import Link from "next/link";
import { numero, pesos, porcentaje } from "@/lib/formato";
import { calcularKpis, mesesAnteriores, mesesEntre, tendencia, variacion, type Filtros, type FilaGrupo, type Kpis } from "@/lib/kpis";
import { cargarEntradaKpis } from "@/lib/kpis/datos";
import { hojasTablero } from "@/lib/kpis/exportacion";
import { COLUMNAS_RANKING, GRUPOS_INDICADORES, PRINCIPALES, TODOS_LOS_INDICADORES, type Formato, type Indicador } from "@/lib/kpis/indicadores";
import { hoy } from "@/lib/viajes/fechas";
import { ExportarTablero } from "./exportar";

const MES = /^\d{4}-(0[1-9]|1[0-2])$/;
const UUID = /^[0-9a-f-]{36}$/i;

export function fmt(v: number | null, f: Formato) {
  if (f === "pesos") return pesos(v, Math.abs(v ?? 0) >= 1000 ? 0 : 2);
  if (f === "pct") return porcentaje(v);
  if (f === "decimal") return numero(v, 2);
  return numero(v);
}

/** Tablero de KPIs para dueño y administración. */
export async function Indicadores({ empresaId, parametros }: { empresaId: string; parametros: Record<string, string | string[] | undefined> }) {
  const uno = (k: string) => (typeof parametros[k] === "string" ? (parametros[k] as string) : "");
  const actual = hoy().slice(0, 7);
  let desde = MES.test(uno("desde")) ? uno("desde") : actual;
  let hasta = MES.test(uno("hasta")) ? uno("hasta") : desde;
  if (hasta < desde) [desde, hasta] = [hasta, desde];
  const filtros: Filtros = {
    unidad: UUID.test(uno("unidad")) ? uno("unidad") : undefined,
    operador: UUID.test(uno("operador")) ? uno("operador") : undefined,
    cliente: UUID.test(uno("cliente")) ? uno("cliente") : undefined,
    ruta: uno("ruta") || undefined,
    incluirAbiertos: uno("abiertos") === "1",
  };

  const entrada = await cargarEntradaKpis(empresaId, desde, hasta);
  const meses = mesesEntre(desde, hasta);
  const anteriores = mesesAnteriores(desde, meses.length);
  const k = calcularKpis(entrada, meses, filtros);
  const ant = calcularKpis(entrada, anteriores, filtros);
  const tend = tendencia(entrada, [...mesesAnteriores(hasta, 11), hasta], filtros);
  const titulo = desde === hasta ? desde : `${desde} a ${hasta}`;
  const visible = (i: Indicador) => !(k.sinCostosFijos && i.usaCostosFijos);
  const rutas = [...new Set(entrada.viajes.map((v) => v.ruta).filter((r): r is string => !!r))].sort();

  const selector = (nombre: string, etiqueta: string, opciones: [string, string][], valor?: string) => (
    <label className="flex flex-col gap-1 text-sm">
      <span className="font-medium">{etiqueta}</span>
      <select name={nombre} defaultValue={valor ?? ""} className="rounded-md border border-zinc-300 bg-white px-2 py-2 dark:border-zinc-700 dark:bg-zinc-950">
        <option value="">Todos</option>
        {opciones.map(([v, t]) => (
          <option key={v} value={v}>
            {t}
          </option>
        ))}
      </select>
    </label>
  );

  return (
    <section className="flex flex-col gap-6">
      <form method="get" className="grid grid-cols-2 items-end gap-3 sm:grid-cols-4 lg:grid-cols-8">
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium">Desde</span>
          <input type="month" name="desde" defaultValue={desde} className="rounded-md border border-zinc-300 bg-white px-2 py-2 dark:border-zinc-700 dark:bg-zinc-950" />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium">Hasta</span>
          <input type="month" name="hasta" defaultValue={hasta} className="rounded-md border border-zinc-300 bg-white px-2 py-2 dark:border-zinc-700 dark:bg-zinc-950" />
        </label>
        {selector("unidad", "Unidad", entrada.unidades.map((u) => [u.id, u.nombre]), filtros.unidad)}
        {selector("operador", "Operador", Object.entries(entrada.nombres.operadores), filtros.operador)}
        {selector("cliente", "Cliente", Object.entries(entrada.nombres.clientes), filtros.cliente)}
        {selector("ruta", "Ruta", rutas.map((r) => [r, r]), filtros.ruta)}
        <label className="flex items-center gap-2 pb-2 text-sm">
          <input type="checkbox" name="abiertos" value="1" defaultChecked={filtros.incluirAbiertos} />
          Incluir abiertos
        </label>
        <button type="submit" className="rounded-md border border-zinc-300 px-4 py-2 font-medium hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800">
          Ver
        </button>
      </form>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-zinc-500">
          {titulo} · contra {anteriores[0] === anteriores.at(-1) ? anteriores[0] : `${anteriores[0]} a ${anteriores.at(-1)}`} ·{" "}
          {filtros.incluirAbiertos ? "viajes abiertos y cerrados" : "solo viajes cerrados"}
        </p>
        <ExportarTablero hojas={hojasTablero(k, ant, tend, `Tablero ${titulo}`)} nombreArchivo={`tablero-${titulo.replace(/ /g, "")}.xlsx`} />
      </div>

      {k.sinCostosFijos && (
        <p className="rounded-md bg-zinc-100 px-3 py-2 text-sm dark:bg-zinc-800">
          Con filtro de operador, cliente o ruta se ve la contribución (ingreso − costo variable): los costos fijos no son de un
          operador, cliente o ruta.
        </p>
      )}
      {k.financieros.costosExcluidos > 0 && (
        <p className="rounded-md bg-zinc-100 px-3 py-2 text-sm dark:bg-zinc-800">
          {pesos(k.financieros.costosExcluidos, 0)} de costos registrados no entran en la rentabilidad (
          {Object.entries(k.financieros.costosExcluidosPorCategoria)
            .map(([c, x]) => `${c}: ${pesos(x, 0)}`)
            .join(", ")}
          ).{" "}
          <Link href="/catalogos/categorias-costo" className="underline">
            Cambiar
          </Link>
        </p>
      )}
      {k.financieros.viajesSinTarifa > 0 && (
        <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:bg-amber-950/40 dark:text-amber-300">
          {k.financieros.viajesSinTarifa} viaje(s) sin tarifa: su ingreso cuenta como cero.
        </p>
      )}

      <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {PRINCIPALES.map((nombre) => TODOS_LOS_INDICADORES.find((i) => i.nombre === nombre)!)
          .filter(visible)
          .map((i) => (
            <Tarjeta key={i.nombre} i={i} k={k} ant={ant} />
          ))}
      </ul>

      {k.alertas.length > 0 && (
        <details open className="rounded-xl border border-amber-300 p-4 dark:border-amber-800">
          <summary className="cursor-pointer font-semibold">Alertas ({k.alertas.length})</summary>
          <ul className="mt-2 flex flex-col gap-1 text-sm">
            {k.alertas.map((a, n) => (
              <li key={n}>{a.viajeId ? <Link href={`/viajes/${a.viajeId}`} className="underline">{a.texto}</Link> : a.texto}</li>
            ))}
          </ul>
        </details>
      )}

      {GRUPOS_INDICADORES.map((g) => (
        <details key={g.titulo} className="rounded-xl border border-zinc-200 p-4 dark:border-zinc-800">
          <summary className="cursor-pointer font-semibold">{g.titulo}</summary>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-zinc-500">
                <tr>
                  <th className="py-1 pr-3 font-medium">Indicador</th>
                  <th className="py-1 pr-3 text-right font-medium">Periodo</th>
                  <th className="py-1 pr-3 text-right font-medium">Anterior</th>
                  <th className="py-1 pr-3 text-right font-medium">Variación</th>
                  <th className="hidden py-1 font-medium md:table-cell">Fórmula</th>
                </tr>
              </thead>
              <tbody>
                {g.indicadores.filter(visible).map((i) => (
                  <tr key={i.nombre} className="border-t border-zinc-100 dark:border-zinc-800">
                    <td className="py-1 pr-3">{i.nombre}</td>
                    <td className="py-1 pr-3 text-right font-medium">{fmt(i.valor(k), i.formato)}</td>
                    <td className="py-1 pr-3 text-right text-zinc-500">{fmt(i.valor(ant), i.formato)}</td>
                    <td className="py-1 pr-3 text-right">
                      <Variacion i={i} k={k} ant={ant} />
                    </td>
                    <td className="hidden py-1 text-zinc-500 md:table-cell">{i.formula}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {g.titulo === "Financieros" && (
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <Desglose titulo="Gastos de viaje por categoría" datos={k.financieros.gastosPorCategoria} />
              {!k.sinCostosFijos && <Desglose titulo="Costos fijos por categoría" datos={k.financieros.costosPorCategoria} />}
            </div>
          )}
        </details>
      ))}

      <Ranking titulo="Unidades: de más a menos rentable" grupos={k.porUnidad} />
      <Ranking titulo="Clientes: de más a menos rentable" grupos={k.porCliente} />
      <Ranking titulo="Rutas: de más a menos rentable" grupos={k.porRuta} />
      <Ranking titulo="Operadores: por km/l contra lo esperado" grupos={k.porOperador} />

      <Tabla
        titulo="Tarifa de equilibrio por ruta"
        nota="Tarifa mínima por tonelada para no perder = (km cargado + km vacío promedio de la ruta) × costo total/km ÷ toneladas promedio."
        encabezados={["Ruta", "Viajes", "Km cargado", "Km vacío", "Toneladas", "Equilibrio $/t", "Real $/t", "Casetas/km", "Urea/km"]}
        filas={k.rutas.map((r) => [
          r.ruta,
          numero(r.viajes),
          numero(r.kmCargadoPromedio),
          numero(r.kmVacioPromedio),
          numero(r.toneladasPromedio, 2),
          pesos(r.tarifaEquilibrio),
          <span key="real" className={r.tarifaReal !== null && r.tarifaEquilibrio !== null && r.tarifaReal < r.tarifaEquilibrio ? "text-red-600" : ""}>{pesos(r.tarifaReal)}</span>,
          pesos(r.casetasPorKm),
          pesos(r.ureaPorKm),
        ])}
      />
      <Tabla
        titulo="Clientes: tiempos y concentración del ingreso"
        nota={`Horas en carga y descarga; se señalan los viajes que pasan de ${entrada.parametros.horasLimiteEstadia} h (base para cobrar estadías).`}
        encabezados={["Cliente", "Viajes", "Horas en carga", "Horas en descarga", "Sobre el límite", "% del ingreso"]}
        filas={k.tiemposPorCliente.map((t) => [
          t.cliente,
          numero(t.viajes),
          numero(t.horasCargaPromedio, 1),
          numero(t.horasDescargaPromedio, 1),
          <span key="lim" className={t.viajesSobreLimite ? "font-medium text-amber-700 dark:text-amber-400" : ""}>{numero(t.viajesSobreLimite)}</span>,
          porcentaje(k.concentracion.find((c) => c.cliente === t.cliente)?.pct ?? null),
        ])}
      />
      <Tabla
        titulo="Viajes del periodo (de menor a mayor utilidad)"
        encabezados={["Folio", "Ingreso", "Utilidad", "Costo del km vacío", "Merma $"]}
        filas={k.porViaje.slice(0, 100).map((v) => [
          <Link key="f" href={`/viajes/${v.id}`} className="underline">{v.folio}</Link>,
          pesos(v.ingreso, 0),
          <span key="u" className={(v.utilidad ?? 0) < 0 ? "text-red-600" : ""}>{pesos(v.utilidad, 0)}</span>,
          pesos(v.costoKmVacio, 0),
          pesos(v.mermaPesos, 0),
        ])}
      />
      <Tabla
        titulo="Tendencia mes a mes"
        encabezados={["Mes", "Viajes", "Costo total/km", "Costo variable/km", "Utilidad", "Km/l"]}
        filas={tend.map((t) => [t.mes, numero(t.viajes), pesos(t.costoTotalPorKm), pesos(t.costoVariablePorKm), pesos(t.utilidad, 0), numero(t.kmPorLitro, 2)])}
      />
    </section>
  );
}

function Variacion({ i, k, ant }: { i: Indicador; k: Kpis; ant: Kpis }) {
  const v = variacion(i.valor(k), i.valor(ant));
  if (v === null) return <span className="text-zinc-400">—</span>;
  const mejor = i.menorEsMejor ? v < 0 : v > 0;
  return <span className={v === 0 ? "text-zinc-500" : mejor ? "text-green-700 dark:text-green-400" : "text-red-600"}>{`${v > 0 ? "+" : ""}${numero(v, 1)}%`}</span>;
}

function Tarjeta({ i, k, ant }: { i: Indicador; k: Kpis; ant: Kpis }) {
  return (
    <li className="flex flex-col gap-1 rounded-xl border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-900" title={i.formula}>
      <span className="text-xs text-zinc-500">{i.nombre}</span>
      <span className={`text-lg font-semibold ${i.nombre === "Utilidad" && (i.valor(k) ?? 0) < 0 ? "text-red-600" : ""}`}>{fmt(i.valor(k), i.formato)}</span>
      <span className="text-xs">
        <Variacion i={i} k={k} ant={ant} /> <span className="text-zinc-500">vs {fmt(i.valor(ant), i.formato)}</span>
      </span>
    </li>
  );
}

function Desglose({ titulo, datos }: { titulo: string; datos: Record<string, number> }) {
  const filas = Object.entries(datos).sort((a, b) => b[1] - a[1]);
  return (
    <div>
      <h3 className="mb-1 text-sm font-medium">{titulo}</h3>
      {filas.length === 0 ? (
        <p className="text-sm text-zinc-500">—</p>
      ) : (
        <ul className="text-sm">
          {filas.map(([c, x]) => (
            <li key={c} className="flex justify-between border-t border-zinc-100 py-0.5 dark:border-zinc-800">
              <span>{c}</span>
              <span>{pesos(x, 0)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Ranking({ titulo, grupos }: { titulo: string; grupos: FilaGrupo[] }) {
  return (
    <Tabla
      titulo={titulo}
      encabezados={["", ...COLUMNAS_RANKING.map((c) => c.nombre)]}
      filas={grupos.map((g) => [
        g.nombre,
        ...COLUMNAS_RANKING.map((c) => {
          const v = c.valor(g);
          const negativo = (c.nombre === "Utilidad" || c.nombre === "Km/l vs esperado") && (v ?? 0) < 0;
          return (
            <span key={c.nombre} className={negativo ? "text-red-600" : ""}>
              {fmt(v, c.formato)}
            </span>
          );
        }),
      ])}
    />
  );
}

function Tabla({ titulo, nota, encabezados, filas }: { titulo: string; nota?: string; encabezados: string[]; filas: React.ReactNode[][] }) {
  return (
    <details className="rounded-xl border border-zinc-200 p-4 dark:border-zinc-800">
      <summary className="cursor-pointer font-semibold">
        {titulo} <span className="font-normal text-zinc-500">({filas.length})</span>
      </summary>
      {nota && <p className="mt-2 text-sm text-zinc-500">{nota}</p>}
      {filas.length === 0 ? (
        <p className="mt-2 text-sm text-zinc-500">Sin datos en el periodo.</p>
      ) : (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-sm whitespace-nowrap">
            <thead className="text-left text-zinc-500">
              <tr>
                {encabezados.map((e, n) => (
                  <th key={n} className={`py-1 pr-4 font-medium ${n ? "text-right" : ""}`}>
                    {e}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filas.map((f, n) => (
                <tr key={n} className="border-t border-zinc-100 dark:border-zinc-800">
                  {f.map((c, m) => (
                    <td key={m} className={`py-1 pr-4 ${m ? "text-right" : ""}`}>
                      {c}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </details>
  );
}
