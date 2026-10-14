import type { Metadata } from "next";
import { FormularioEmpresa } from "./formulario";

export const metadata: Metadata = { title: "Alta de empresa · Control Diésel" };

// El proxy exige sesión para llegar aquí y crearEmpresa vuelve a revisarla.
export default function PaginaAltaEmpresa() {
  return (
    <>
      <h1 className="mb-1 text-xl font-semibold">Da de alta tu empresa</h1>
      <p className="mb-4 text-sm text-zinc-600 dark:text-zinc-400">
        Quedarás como dueño. Después podrás invitar a administración y operadores.
      </p>
      <FormularioEmpresa />
    </>
  );
}
