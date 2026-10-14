import type { Metadata } from "next";
import Link from "next/link";
import { FormularioRegistro } from "./formulario";

export const metadata: Metadata = { title: "Crear cuenta · Control Diésel" };

export default function PaginaRegistro() {
  return (
    <>
      <h1 className="mb-1 text-xl font-semibold">Crear cuenta</h1>
      <p className="mb-4 text-sm text-zinc-600 dark:text-zinc-400">
        Primero tu usuario; después das de alta tu empresa.
      </p>
      <FormularioRegistro />
      <p className="mt-6 text-center text-sm text-zinc-600 dark:text-zinc-400">
        ¿Ya tienes cuenta?{" "}
        <Link href="/login" className="font-medium text-zinc-900 underline dark:text-zinc-100">
          Entrar
        </Link>
      </p>
    </>
  );
}
