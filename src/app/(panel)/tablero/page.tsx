import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { puede } from "@/lib/auth/permisos";
import { usuarioConEmpresa } from "@/lib/auth/sesion";
import { CATALOGOS, CLAVES_CATALOGO } from "@/lib/catalogos/definiciones";
import { Indicadores } from "./indicadores";

export const metadata: Metadata = { title: "Tablero · Control Diésel" };

export default function PaginaTablero({ searchParams }: PageProps<"/tablero">) {
  return (
    <Suspense fallback={<p className="text-zinc-500">Cargando…</p>}>
      <Tablero searchParams={searchParams} />
    </Suspense>
  );
}

async function Tablero({ searchParams }: { searchParams: PageProps<"/tablero">["searchParams"] }) {
  const { empresa } = await usuarioConEmpresa();
  const verKpis = puede(empresa.rol, "verConciliacion");
  const editaCatalogos = puede(empresa.rol, "editarCatalogos");

  return (
    <>
      <h1 className="text-2xl font-semibold">{empresa.empresaNombre}</h1>

      {/* Captura no ve el tablero de pesos. */}
      {verKpis && (
        <Suspense fallback={<p className="text-zinc-500">Calculando indicadores…</p>}>
          <Indicadores empresaId={empresa.empresaId} parametros={await searchParams} />
        </Suspense>
      )}

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-medium tracking-wide text-zinc-500 uppercase">Operación</h2>
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <Tarjeta href="/viajes" titulo="Viajes" texto="Tramos, cargas de diésel, gastos, cierre y exportación." />
          <Tarjeta href="/viajes/nuevo" titulo="Nuevo viaje" texto="Empieza donde terminó el viaje anterior de la unidad." />
          {editaCatalogos && (
            <Tarjeta href="/costos" titulo="Costos" texto="Mantenimiento, llantas, seguro, oficina… por equipo y por mes." />
          )}
        </ul>
      </section>

      {puede(empresa.rol, "verCatalogos") && (
        <section className="flex flex-col gap-3">
          <h2 className="text-sm font-medium tracking-wide text-zinc-500 uppercase">
            Catálogos{editaCatalogos ? "" : " (solo consulta)"}
          </h2>
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {editaCatalogos && (
              <Tarjeta
                href="/catalogos/importar"
                titulo="Importar desde Excel"
                texto="Plantilla por catálogo o tu control de viajes."
              />
            )}
            {CLAVES_CATALOGO.filter((clave) => editaCatalogos || !CATALOGOS[clave].soloAdmin).map((clave) => (
              <Tarjeta
                key={clave}
                href={`/catalogos/${clave}`}
                titulo={CATALOGOS[clave].titulo}
                texto={CATALOGOS[clave].descripcion}
              />
            ))}
          </ul>
        </section>
      )}

      {puede(empresa.rol, "editarParametros") && (
        <section className="flex flex-col gap-3">
          <h2 className="text-sm font-medium tracking-wide text-zinc-500 uppercase">Empresa</h2>
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {puede(empresa.rol, "administrarUsuarios") && (
              <Tarjeta href="/usuarios" titulo="Usuarios" texto="Quién puede reabrir viajes y quién ve tarifas e ingresos." />
            )}
            <Tarjeta
              href="/parametros"
              titulo="Parámetros"
              texto="Tolerancias, precio del diésel, folios, alertas y pago al operador."
            />
          </ul>
        </section>
      )}
    </>
  );
}

function Tarjeta({ href, titulo, texto }: { href: string; titulo: string; texto: string }) {
  return (
    <li>
      <Link
        href={href}
        className="flex h-full flex-col gap-1 rounded-xl border border-zinc-200 bg-white p-4 hover:border-zinc-400 dark:border-zinc-800 dark:bg-zinc-900 dark:hover:border-zinc-600"
      >
        <span className="font-medium">{titulo}</span>
        <span className="text-sm text-zinc-500">{texto}</span>
      </Link>
    </li>
  );
}
