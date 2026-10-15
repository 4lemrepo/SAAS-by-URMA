import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { usuarioConPermiso } from "@/lib/auth/sesion";
import { leerCatalogo } from "@/lib/catalogos/datos";
import { CATALOGOS } from "@/lib/catalogos/definiciones";
import type { Registro } from "@/lib/catalogos/validacion";
import { CATALOGOS_CONTROL, type CatalogoControl } from "@/lib/importacion/catalogos";
import { Importador } from "./importador";

export const metadata: Metadata = { title: "Importar catálogos · Control Diésel" };

export default function PaginaImportar() {
  return (
    <>
      <div>
        <Link href="/tablero" className="text-sm text-zinc-500 underline">
          ← Tablero
        </Link>
        <h1 className="mt-1 text-2xl font-semibold">Importar catálogos</h1>
        <p className="text-sm text-zinc-500">
          Sube el archivo, revisa la vista previa y confirma. Se guarda todo o nada; lo que ya existe se omite.
        </p>
      </div>
      <Suspense fallback={<p className="text-zinc-500">Cargando…</p>}>
        <Contenido />
      </Suspense>
    </>
  );
}

async function Contenido() {
  const { empresa } = await usuarioConPermiso("editarCatalogos");
  // Solo las columnas que identifican duplicados: la vista previa marca lo que ya existe.
  const listas = await Promise.all(CATALOGOS_CONTROL.map((c) => leerCatalogo(c, empresa.empresaId)));
  const existentes = Object.fromEntries(
    CATALOGOS_CONTROL.map((c, i) => [
      c,
      listas[i].map((f) => Object.fromEntries(CATALOGOS[c].llaveUnica.map((col) => [col, f.valores[col]]))),
    ]),
  ) as Record<CatalogoControl, Registro[]>;
  return <Importador existentes={existentes} />;
}
