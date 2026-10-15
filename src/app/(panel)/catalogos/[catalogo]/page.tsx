import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { puede } from "@/lib/auth/permisos";
import { usuarioConPermiso } from "@/lib/auth/sesion";
import { leerCatalogo, leerReferencias } from "@/lib/catalogos/datos";
import { CATALOGOS, CLAVES_CATALOGO, esClaveCatalogo } from "@/lib/catalogos/definiciones";
import { CATALOGOS_IMPORTABLES } from "@/lib/importacion/plantilla";
import { ListaCatalogo } from "../lista";

export function generateStaticParams() {
  return CLAVES_CATALOGO.map((catalogo) => ({ catalogo }));
}

export async function generateMetadata({ params }: PageProps<"/catalogos/[catalogo]">): Promise<Metadata> {
  const { catalogo } = await params;
  return { title: `${esClaveCatalogo(catalogo) ? CATALOGOS[catalogo].titulo : "Catálogo"} · Control Diésel` };
}

export default async function PaginaCatalogo({ params }: PageProps<"/catalogos/[catalogo]">) {
  const { catalogo } = await params;
  if (!esClaveCatalogo(catalogo)) notFound();
  const def = CATALOGOS[catalogo];
  return (
    <>
      <div>
        <Link href="/tablero" className="text-sm text-zinc-500 underline">
          ← Tablero
        </Link>
        <h1 className="mt-1 text-2xl font-semibold">{def.titulo}</h1>
        <p className="text-sm text-zinc-500">{def.descripcion}</p>
      </div>
      <Suspense fallback={<p className="text-zinc-500">Cargando…</p>}>
        <Contenido clave={catalogo} />
      </Suspense>
    </>
  );
}

async function Contenido({ clave }: { clave: keyof typeof CATALOGOS }) {
  const { empresa } = await usuarioConPermiso(CATALOGOS[clave].soloAdmin ? "editarCatalogos" : "verCatalogos");
  const [filas, referencias] = await Promise.all([
    leerCatalogo(clave, empresa.empresaId),
    leerReferencias(CATALOGOS[clave], empresa.empresaId),
  ]);
  const puedeEditar = puede(empresa.rol, "editarCatalogos");
  return (
    <>
      {puedeEditar && (
        <div className="flex flex-wrap items-center gap-4">
          <Link
            href={`/catalogos/${clave}/nuevo`}
            className="rounded-md bg-zinc-900 px-4 py-2 font-medium text-white hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900"
          >
            Agregar {CATALOGOS[clave].singular}
          </Link>
          {(CATALOGOS_IMPORTABLES as readonly string[]).includes(clave) && (
            <Link href="/catalogos/importar" className="text-sm underline">
              Importar desde Excel
            </Link>
          )}
        </div>
      )}
      <ListaCatalogo clave={clave} filas={filas} referencias={referencias} puedeEditar={puedeEditar} />
    </>
  );
}
