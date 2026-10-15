import Link from "next/link";
import { Suspense } from "react";
import { cerrarSesion } from "@/app/(acceso)/acciones";
import { NOMBRE_ROL } from "@/lib/auth/permisos";
import { usuarioConEmpresa } from "@/lib/auth/sesion";

export default function LayoutPanel({ children }: LayoutProps<"/">) {
  return (
    <>
      <header className="border-b border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
        <div className="mx-auto flex w-full max-w-5xl items-center justify-between gap-3 px-4 py-3">
          <nav className="flex items-center gap-4">
            <Link href="/tablero" className="font-semibold">
              Control Diésel
            </Link>
            <Link href="/viajes" className="text-sm text-zinc-600 hover:underline dark:text-zinc-400">
              Viajes
            </Link>
          </nav>
          {/* Con Cache Components, lo que lee la sesión va dentro de Suspense. */}
          <Suspense fallback={null}>
            <Usuario />
          </Suspense>
        </div>
      </header>
      <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-6 px-4 py-6">{children}</main>
    </>
  );
}

async function Usuario() {
  const { correo, empresa } = await usuarioConEmpresa();
  return (
    <div className="flex min-w-0 items-center gap-3">
      <p className="min-w-0 truncate text-right text-sm text-zinc-500">
        <span className="hidden sm:inline">{correo} · </span>
        {NOMBRE_ROL[empresa.rol]}
      </p>
      <form action={cerrarSesion}>
        <button
          type="submit"
          className="shrink-0 rounded-md border border-zinc-300 px-3 py-1.5 text-sm hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
        >
          Salir
        </button>
      </form>
    </div>
  );
}
