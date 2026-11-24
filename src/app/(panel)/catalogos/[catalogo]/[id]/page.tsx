import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { usuarioConPermiso } from "@/lib/auth/sesion";
import { leerReferencias, leerRegistro } from "@/lib/catalogos/datos";
import { SeccionArmado } from "../../../armados/seccion";
import { SeccionPagoOperador } from "../../../parametros/pago-operador";
import { CATALOGOS, esClaveCatalogo, type ClaveCatalogo, puedeVerCatalogo } from "@/lib/catalogos/definiciones";
import { valorDeFormulario } from "@/lib/catalogos/formato";
import { FormularioCatalogo } from "../../formulario";

export const metadata: Metadata = { title: "Editar · Control Diésel" };

export default function PaginaEditar({ params }: PageProps<"/catalogos/[catalogo]/[id]">) {
  // El id no se conoce al compilar: todo lo que lo lee va dentro de Suspense.
  return (
    <Suspense fallback={<p className="text-zinc-500">Cargando…</p>}>
      <Editar params={params} />
    </Suspense>
  );
}

async function Editar({ params }: { params: PageProps<"/catalogos/[catalogo]/[id]">["params"] }) {
  const { catalogo, id } = await params;
  if (!esClaveCatalogo(catalogo)) notFound();
  const clave: ClaveCatalogo = catalogo;
  const def = CATALOGOS[clave];
  const { empresa } = await usuarioConPermiso("editarCatalogos");
  if (!puedeVerCatalogo(empresa, clave)) notFound();
  const [registro, referencias] = await Promise.all([
    leerRegistro(clave, empresa.empresaId, id),
    leerReferencias(def, empresa.empresaId),
  ]);
  if (!registro) notFound();

  const iniciales: Record<string, string> = {};
  for (const c of def.campos) iniciales[c.columna] = valorDeFormulario(registro.valores[c.columna]);

  return (
    <>
      <div>
        <Link href={`/catalogos/${clave}`} className="text-sm text-zinc-500 underline">
          ← {def.titulo}
        </Link>
        <h1 className="mt-1 text-2xl font-semibold">
          Editar {def.singular}
          {!registro.activo && <span className="ml-2 text-base font-normal text-zinc-500">(inactivo)</span>}
        </h1>
      </div>
      <FormularioCatalogo clave={clave} id={registro.id} iniciales={iniciales} referencias={referencias} />
      {clave === "unidades" && <SeccionArmado unidadId={registro.id} empresaId={empresa.empresaId} />}
      {clave === "operadores" && empresa.veUtilidades && <SeccionPagoOperador operadorId={registro.id} empresaId={empresa.empresaId} />}
    </>
  );
}
