import type { Metadata } from "next";
import Link from "next/link";
import { ConfirmarConCodigo } from "../codigo";

export const metadata: Metadata = { title: "Confirmar cuenta · Control Diésel" };

export default function PaginaVerificar() {
  return (
    <>
      <h1 className="mb-1 text-xl font-semibold">Confirma tu cuenta</h1>
      <p className="mb-4 text-sm text-zinc-600 dark:text-zinc-400">
        Escribe el código de 6 dígitos que te enviamos por correo.
      </p>
      <ConfirmarConCodigo />
      <p className="mt-6 text-center text-sm text-zinc-600 dark:text-zinc-400">
        <Link href="/login" className="font-medium text-zinc-900 underline dark:text-zinc-100">
          Volver a entrar
        </Link>
      </p>
    </>
  );
}
