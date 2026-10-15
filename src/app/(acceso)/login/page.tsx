import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { FormularioLogin } from "./formulario";

export const metadata: Metadata = { title: "Entrar · Control Diésel" };

export default function PaginaLogin() {
  return (
    <>
      <h1 className="mb-4 text-xl font-semibold">Entrar</h1>
      {/* useSearchParams lee la URL en el navegador: va dentro de Suspense. */}
      <Suspense>
        <FormularioLogin />
      </Suspense>
      <p className="mt-6 text-center text-sm text-zinc-600 dark:text-zinc-400">
        ¿Tu empresa aún no usa Control Diésel?{" "}
        <Link href="/registro" className="font-medium text-zinc-900 underline dark:text-zinc-100">
          Crear cuenta
        </Link>
      </p>
      <p className="mt-2 text-center text-sm text-zinc-600 dark:text-zinc-400">
        ¿Te registraste y no has confirmado?{" "}
        <Link href="/verificar" className="font-medium text-zinc-900 underline dark:text-zinc-100">
          Tengo un código
        </Link>
      </p>
    </>
  );
}
