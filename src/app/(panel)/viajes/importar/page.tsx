import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { usuarioConPermiso } from "@/lib/auth/sesion";
import { leerContextoImportacion, leerLotes } from "@/lib/importacion/datos";
import { crearClienteServidor } from "@/lib/supabase/server";
import { ImportadorHistorico } from "./importador";
import { Lotes } from "./lotes";

export const metadata: Metadata = { title: "Importar viajes históricos · Control Diésel" };

export default function PaginaImportarViajes() {
  return (
    <>
      <div>
        <Link href="/viajes" className="text-sm text-zinc-500 underline">
          ← Viajes
        </Link>
        <h1 className="mt-1 text-2xl font-semibold">Importar viajes históricos</h1>
        <p className="text-sm text-zinc-500">
          Sube tu control de viajes en Excel (una fila por viaje) y, si lo trae, la hoja de mantenimiento por unidad y mes.
          Revisa la vista previa y confirma: se guarda todo o nada, y cada importación se puede anular completa.
        </p>
      </div>
      <Suspense fallback={<p className="text-zinc-500">Cargando…</p>}>
        <Contenido />
      </Suspense>
    </>
  );
}

async function Contenido() {
  const { empresa } = await usuarioConPermiso("importarHistorico");
  const db = await crearClienteServidor();
  const [contexto, lotes] = await Promise.all([leerContextoImportacion(db, empresa.empresaId), leerLotes(db, empresa.empresaId)]);
  return (
    <>
      <ImportadorHistorico contexto={contexto} />
      <Lotes lotes={lotes} />
    </>
  );
}
