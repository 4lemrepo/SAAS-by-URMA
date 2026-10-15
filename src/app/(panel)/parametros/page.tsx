import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { usuarioConPermiso } from "@/lib/auth/sesion";
import { valorDeFormulario } from "@/lib/catalogos/formato";
import { crearClienteServidor } from "@/lib/supabase/server";
import { FormularioParametros } from "./formulario";

export const metadata: Metadata = { title: "Parámetros · Control Diésel" };

export default function PaginaParametros() {
  return (
    <>
      <div>
        <Link href="/tablero" className="text-sm text-zinc-500 underline">
          ← Tablero
        </Link>
        <h1 className="mt-1 text-2xl font-semibold">Parámetros de la empresa</h1>
        <p className="text-sm text-zinc-500">Los usa la conciliación. Solo el dueño los cambia.</p>
      </div>
      <Suspense fallback={<p className="text-zinc-500">Cargando…</p>}>
        <Contenido />
      </Suspense>
    </>
  );
}

async function Contenido() {
  const { empresa } = await usuarioConPermiso("editarParametros");
  const supabase = await crearClienteServidor();
  const { data, error } = await supabase
    .from("empresas")
    .select("tolerancia_pct, precio_diesel_litro")
    .eq("id", empresa.empresaId)
    .single();
  if (error) throw new Error("No se pudieron leer los parámetros");
  return (
    <FormularioParametros
      iniciales={{
        tolerancia_pct: valorDeFormulario(data.tolerancia_pct),
        precio_diesel_litro: valorDeFormulario(data.precio_diesel_litro),
      }}
    />
  );
}
