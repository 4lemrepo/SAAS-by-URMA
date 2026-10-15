import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { usuarioConPermiso } from "@/lib/auth/sesion";
import { CATALOGOS, CLAVES_CATALOGO, esClaveCatalogo } from "@/lib/catalogos/definiciones";
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
        <SoloEditores>
          <FormularioCatalogo clave={catalogo} id={null} iniciales={{}} />
        </SoloEditores>
      </Suspense>
    </>
  );
}

async function SoloEditores({ children }: { children: React.ReactNode }) {
  await usuarioConPermiso("editarCatalogos");
  return children;
}
