import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { etiquetaDolly, etiquetaRemolque } from "@/lib/armados/armado";
import { usuarioConPermiso } from "@/lib/auth/sesion";
import { mesesDelCosto, sumarMeses } from "@/lib/costos/asignacion";
import { pesos } from "@/lib/formato";
import { crearClienteServidor } from "@/lib/supabase/server";
import { formatearFecha, hoy } from "@/lib/viajes/fechas";
import { BotonCancelarCosto, FormularioCosto } from "./formulario";

export const metadata: Metadata = { title: "Costos · Control Diésel" };

export default function PaginaCostos({ searchParams }: PageProps<"/costos">) {
  return (
    <>
      <div>
        <Link href="/tablero" className="text-sm text-zinc-500 underline">
          ← Tablero
        </Link>
        <h1 className="mt-1 text-2xl font-semibold">Costos de equipo y generales</h1>
        <p className="text-sm text-zinc-500">
          Lo que no es de un viaje. Un costo de remolque o dolly cuenta para la unidad que lo traía ese día; los generales se
          prorratean entre las unidades.
        </p>
      </div>
      <Suspense fallback={<p className="text-zinc-500">Cargando…</p>}>
        <Contenido searchParams={searchParams} />
      </Suspense>
    </>
  );
}

async function Contenido({ searchParams }: { searchParams: PageProps<"/costos">["searchParams"] }) {
  const { empresa } = await usuarioConPermiso("editarCatalogos");
  const p = await searchParams;
  const mes = typeof p.mes === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(p.mes) ? p.mes : hoy().slice(0, 7);
  const db = await crearClienteServidor();
  const e = empresa.empresaId;
  const [costos, categorias, unidades, remolques, dollies] = await Promise.all([
    // Un costo de hasta 60 meses atrás puede seguir aplicando este mes.
    db.from("costos").select("*").eq("empresa_id", e).lte("mes", `${mes}-01`).gte("mes", `${sumarMeses(`${mes}-01`, -59)}-01`).order("fecha", { ascending: false }),
    db.from("categorias_costo").select("id, nombre, incluir_en_rentabilidad, activo").eq("empresa_id", e).order("nombre"),
    db.from("unidades").select("id, numero_economico, activa").eq("empresa_id", e).order("numero_economico"),
    db.from("remolques").select("id, placas, numero_economico, activo").eq("empresa_id", e).order("placas"),
    db.from("dollies").select("id, numero_serie, numero_economico, activo").eq("empresa_id", e).order("numero_serie"),
  ]);
  if (costos.error || categorias.error) throw new Error("No se pudieron leer los costos");

  const categoria = new Map((categorias.data ?? []).map((c) => [c.id, c]));
  const equipo = (c: { unidad_id: string | null; remolque_id: string | null; dolly_id: string | null }) => {
    if (c.unidad_id) return `Tracto ${(unidades.data ?? []).find((u) => u.id === c.unidad_id)?.numero_economico ?? ""}`;
    if (c.remolque_id) {
      const r = (remolques.data ?? []).find((x) => x.id === c.remolque_id);
      return r ? `Remolque ${etiquetaRemolque(r)}` : "Remolque";
    }
    if (c.dolly_id) {
      const d = (dollies.data ?? []).find((x) => x.id === c.dolly_id);
      return d ? `Dolly ${etiquetaDolly(d)}` : "Dolly";
    }
    return "General de la empresa";
  };
  const delMes = (costos.data ?? [])
    .map((c) => ({ ...c, esteMes: mesesDelCosto({ mes: c.mes, meses: c.meses, monto: Number(c.monto) }).find((m) => m.mes === mes)?.monto ?? 0 }))
    .filter((c) => c.esteMes > 0);
  const vigentes = delMes.filter((c) => !c.cancelado);
  const incluidos = vigentes.filter((c) => categoria.get(c.categoria_id)?.incluir_en_rentabilidad !== false);
  const excluidos = vigentes.filter((c) => categoria.get(c.categoria_id)?.incluir_en_rentabilidad === false);
  const suma = (xs: { esteMes: number }[]) => xs.reduce((s, x) => s + x.esteMes, 0);

  return (
    <>
      <form method="get" className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium">Mes</span>
          <input type="month" name="mes" defaultValue={mes} className="rounded-md border border-zinc-300 bg-white px-2 py-2 dark:border-zinc-700 dark:bg-zinc-950" />
        </label>
        <button type="submit" className="rounded-md border border-zinc-300 px-4 py-2 font-medium hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800">
          Ver
        </button>
        <Link href="/catalogos/categorias-costo" className="text-sm underline">
          Categorías de costo
        </Link>
      </form>

      <FormularioCosto
        empresaId={e}
        categorias={(categorias.data ?? []).filter((c) => c.activo).map((c) => ({ valor: c.id, etiqueta: c.nombre }))}
        equipos={[
          { titulo: "Tractos", opciones: (unidades.data ?? []).filter((u) => u.activa).map((u) => ({ valor: `u:${u.id}`, etiqueta: u.numero_economico })) },
          { titulo: "Remolques", opciones: (remolques.data ?? []).filter((r) => r.activo).map((r) => ({ valor: `r:${r.id}`, etiqueta: etiquetaRemolque(r) })) },
          { titulo: "Dollies", opciones: (dollies.data ?? []).filter((d) => d.activo).map((d) => ({ valor: `d:${d.id}`, etiqueta: etiquetaDolly(d) })) },
        ]}
      />

      <div className="rounded-xl border border-zinc-200 p-3 text-sm dark:border-zinc-800">
        <p>
          <strong>{pesos(suma(incluidos))}</strong> en rentabilidad este mes ({incluidos.length} costos)
        </p>
        {excluidos.length > 0 && (
          <p className="text-zinc-500">
            {pesos(suma(excluidos))} registrados en categorías que no entran en la rentabilidad (
            {[...new Set(excluidos.map((c) => categoria.get(c.categoria_id)?.nombre))].join(", ")}).
          </p>
        )}
      </div>

      {delMes.length === 0 ? (
        <p className="rounded-xl border border-dashed border-zinc-300 p-8 text-center text-zinc-500 dark:border-zinc-700">
          Sin costos en {mes}.
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {delMes.map((c) => {
            const cat = categoria.get(c.categoria_id);
            return (
              <li
                key={c.id}
                className={`flex flex-wrap items-start justify-between gap-2 rounded-xl border border-zinc-200 p-3 text-sm dark:border-zinc-800 ${c.cancelado ? "opacity-50" : ""}`}
              >
                <div>
                  <p className="font-medium">
                    {cat?.nombre} · {pesos(c.esteMes)}
                    {c.meses > 1 && <span className="font-normal text-zinc-500"> (de {pesos(Number(c.monto))} en {c.meses} meses)</span>}
                    {cat?.incluir_en_rentabilidad === false && (
                      <span className="ml-2 rounded bg-zinc-200 px-1.5 py-0.5 text-xs font-normal dark:bg-zinc-700">no entra en rentabilidad</span>
                    )}
                    {c.cancelado && <span className="ml-2 text-xs">(cancelado)</span>}
                  </p>
                  <p className="text-zinc-500">
                    {c.folio} · {formatearFecha(c.fecha)} · {equipo(c)}
                    {c.proveedor && ` · ${c.proveedor}`}
                    {c.numero_comprobante && ` · ${c.numero_comprobante}`}
                  </p>
                </div>
                <BotonCancelarCosto id={c.id} cancelado={c.cancelado} />
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
