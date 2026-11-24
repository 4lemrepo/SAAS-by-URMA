import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Suspense } from "react";
import { usuarioConPermiso } from "@/lib/auth/sesion";
import { leerReferencias } from "@/lib/catalogos/datos";
import { CATALOGOS, CLAVES_CATALOGO, esClaveCatalogo, puedeVerCatalogo } from "@/lib/catalogos/definiciones";
import { FormularioCatalogo } from "../../formulario";

export function generateStaticParams() {
  return CLAVES_CATALOGO.map((catalogo) => ({ catalogo }));
}

export const metadata: Metadata = { title: "Agregar · Control Diésel" };

export default async function PaginaNuevo({ params }: PageProps<"/catalogos/[catalogo]/nuevo">) {
  const { catalogo } = await params;
  if (!esClaveCatalogo(catalogo)) notFound();
  const def = CATALOGOS[catalogo];
  return (
    <>
      <div>
        <Link href={`/catalogos/${catalogo}`} className="text-sm text-zinc-500 underline">
          ← {def.titulo}
        </Link>
        <h1 className="mt-1 text-2xl font-semibold">Agregar {def.singular}</h1>
      </div>
      <Suspense fallback={<p className="text-zinc-500">Cargando…</p>}>
        <Formulario clave={catalogo} />
      </Suspense>
    </>
  );
}

async function Formulario({ clave }: { clave: keyof typeof CATALOGOS }) {
  const { empresa } = await usuarioConPermiso("editarCatalogos");
  if (!puedeVerCatalogo(empresa, clave)) redirect("/tablero");
  const referencias = await leerReferencias(CATALOGOS[clave], empresa.empresaId);
  return <FormularioCatalogo clave={clave} id={null} iniciales={{}} referencias={referencias} />;
}
