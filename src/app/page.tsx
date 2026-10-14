import Link from "next/link";

export default function Inicio() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
      <h1 className="text-3xl font-semibold">Control Diésel</h1>
      <p className="max-w-md text-zinc-600 dark:text-zinc-400">
        Cuántos litros y cuántos pesos de diésel se pierden por unidad, operador y ruta.
      </p>
      <div className="mt-4 flex gap-3">
        <Link
          href="/login"
          className="rounded-md bg-zinc-900 px-4 py-2 font-medium text-white hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900"
        >
          Entrar
        </Link>
        <Link
          href="/registro"
          className="rounded-md border border-zinc-300 px-4 py-2 font-medium hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
        >
          Crear cuenta
        </Link>
      </div>
    </main>
  );
}
