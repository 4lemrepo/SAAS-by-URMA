import type { Metadata } from "next";
import { Suspense } from "react";
import { usuarioSinEmpresa } from "@/lib/auth/sesion";
import { FormularioEmpresa } from "./formulario";

export const metadata: Metadata = { title: "Alta de empresa · Control Diésel" };

export default function PaginaAltaEmpresa() {
  return (
    <>
      <h1 className="mb-1 text-xl font-semibold">Da de alta tu empresa</h1>
      <p className="mb-4 text-sm text-zinc-600 dark:text-zinc-400">
        Quedarás como dueño. Después podrás invitar a administración y operadores.
      </p>
      {/* Lee la sesión: va dentro de Suspense. */}
      <Suspense fallback={<p className="text-sm text-zinc-500">Revisando tu cuenta…</p>}>
        <SoloSinEmpresa />
      </Suspense>
    </>
  );
}

/** Si el usuario ya tiene empresa lo manda al tablero; el formulario solo se ve sin empresa. */
async function SoloSinEmpresa() {
  await usuarioSinEmpresa();
  return <FormularioEmpresa />;
}
