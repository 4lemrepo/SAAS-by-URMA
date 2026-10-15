import type { Metadata } from "next";
import { Suspense } from "react";
import { cerrarSesion } from "@/app/(acceso)/acciones";
import { NOMBRE_ROL } from "@/lib/auth/permisos";
import { usuarioConEmpresa } from "@/lib/auth/sesion";

export const metadata: Metadata = { title: "Tablero · Control Diésel" };

export default function PaginaTablero() {
  return (
    <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-6 px-4 py-8">
      {/* Con Cache Components, lo que lee la sesión va dentro de Suspense. */}
      <Suspense fallback={<p className="text-zinc-500">Cargando…</p>}>
        <Encabezado />
      </Suspense>
      <section className="rounded-xl border border-dashed border-zinc-300 p-8 text-center text-zinc-500 dark:border-zinc-700">
        Aquí irán los catálogos, viajes y la conciliación (siguientes pasos de la Fase 1).
      </section>
    </main>
  );
}

async function Encabezado() {
  const { correo, empresa } = await usuarioConEmpresa();
  return (
    <header className="flex flex-wrap items-center justify-between gap-4">
      <div>
        <h1 className="text-2xl font-semibold">{empresa.empresaNombre}</h1>
        <p className="text-sm text-zinc-500">
          {correo} · {NOMBRE_ROL[empresa.rol]}
        </p>
      </div>
      <form action={cerrarSesion}>
        <button
          type="submit"
          className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
        >
          Cerrar sesión
        </button>
      </form>
    </header>
  );
}
