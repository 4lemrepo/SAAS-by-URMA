import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { puede } from "@/lib/auth/permisos";
import { usuarioConPermiso } from "@/lib/auth/sesion";
import { crearClienteServidor } from "@/lib/supabase/server";
import { leerNombres, leerViajes, type FiltrosViajes } from "@/lib/viajes/datos";
import { hoy } from "@/lib/viajes/fechas";
import { ListaViajes } from "./lista";

export const metadata: Metadata = { title: "Viajes · Control Diésel" };

const FECHA = /^\d{4}-\d{2}-\d{2}$/;
const UUID = /^[0-9a-f-]{36}$/i;

export default function PaginaViajes({ searchParams }: PageProps<"/viajes">) {
  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <Link href="/tablero" className="text-sm text-zinc-500 underline">
            ← Tablero
          </Link>
          <h1 className="mt-1 text-2xl font-semibold">Viajes</h1>
        </div>
        <Link
          href="/viajes/nuevo"
          className="rounded-md bg-zinc-900 px-4 py-2 font-medium text-white hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900"
        >
          Nuevo viaje
        </Link>
      </div>
      <Suspense fallback={<p className="text-zinc-500">Cargando…</p>}>
        <Contenido searchParams={searchParams} />
      </Suspense>
    </>
  );
}

async function Contenido({ searchParams }: { searchParams: PageProps<"/viajes">["searchParams"] }) {
  const { empresa } = await usuarioConPermiso("capturar");
  const p = await searchParams;
  const uno = (k: string) => (typeof p[k] === "string" ? (p[k] as string) : "");
  const inicioMes = `${hoy().slice(0, 7)}-01`;
  const filtros: FiltrosViajes = {
    desde: FECHA.test(uno("desde")) ? uno("desde") : inicioMes,
    hasta: FECHA.test(uno("hasta")) ? uno("hasta") : hoy(),
    unidad: UUID.test(uno("unidad")) ? uno("unidad") : undefined,
    operador: UUID.test(uno("operador")) ? uno("operador") : undefined,
    cliente: UUID.test(uno("cliente")) ? uno("cliente") : undefined,
    estado: ["abierto", "cerrado", "cancelado", "todos"].includes(uno("estado")) ? (uno("estado") as FiltrosViajes["estado"]) : undefined,
  };
  const db = await crearClienteServidor();
  const [viajes, nombres] = await Promise.all([
    leerViajes(empresa.empresaId, filtros, { veTarifas: empresa.veTarifas, veUtilidades: empresa.veUtilidades, esAdmin: puede(empresa.rol, "editarCatalogos") }, db),
    leerNombres(db, empresa.empresaId),
  ]);
  const selector = (nombre: string, etiqueta: string, opciones: { id: string; texto: string }[], valor?: string, todos = "Todos") => (
    <label className="flex flex-col gap-1 text-sm">
      <span className="font-medium">{etiqueta}</span>
      <select name={nombre} defaultValue={valor ?? ""} className="rounded-md border border-zinc-300 bg-white px-2 py-2 dark:border-zinc-700 dark:bg-zinc-950">
        <option value="">{todos}</option>
        {opciones.map((o) => (
          <option key={o.id} value={o.id}>
            {o.texto}
          </option>
        ))}
      </select>
    </label>
  );
  return (
    <>
      <form method="get" className="grid grid-cols-2 items-end gap-3 sm:grid-cols-3 lg:grid-cols-7">
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium">Desde</span>
          <input type="date" name="desde" defaultValue={filtros.desde} className="rounded-md border border-zinc-300 bg-white px-2 py-2 dark:border-zinc-700 dark:bg-zinc-950" />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium">Hasta</span>
          <input type="date" name="hasta" defaultValue={filtros.hasta} className="rounded-md border border-zinc-300 bg-white px-2 py-2 dark:border-zinc-700 dark:bg-zinc-950" />
        </label>
        {selector("unidad", "Unidad", nombres.listas.unidades.map((u) => ({ id: u.id, texto: u.numero_economico })), filtros.unidad)}
        {selector("operador", "Operador", nombres.listas.operadores.map((o) => ({ id: o.id, texto: o.nombre })), filtros.operador)}
        {selector("cliente", "Cliente", nombres.listas.clientes.map((c) => ({ id: c.id, texto: c.nombre })), filtros.cliente)}
        {selector(
          "estado",
          "Estado",
          [
            { id: "abierto", texto: "Abiertos" },
            { id: "cerrado", texto: "Cerrados" },
            { id: "cancelado", texto: "Cancelados" },
            { id: "todos", texto: "Todos, con cancelados" },
          ],
          filtros.estado,
          "Abiertos y cerrados",
        )}
        <button type="submit" className="rounded-md border border-zinc-300 px-4 py-2 font-medium hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800">
          Filtrar
        </button>
      </form>
      <ListaViajes viajes={viajes} ve={{ veTarifas: empresa.veTarifas, veUtilidades: empresa.veUtilidades }} nombreArchivo={`viajes-${filtros.desde}-a-${filtros.hasta}.xlsx`} />
    </>
  );
}
