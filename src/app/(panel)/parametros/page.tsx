import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { usuarioConPermiso } from "@/lib/auth/sesion";
import { valorDeFormulario } from "@/lib/catalogos/formato";
import { CAMPOS_PARAMETROS } from "@/lib/empresa/parametros";
import { crearClienteServidor } from "@/lib/supabase/server";
import { FormularioPago, FormularioParametros } from "./formulario";

export const metadata: Metadata = { title: "Parámetros · Control Diésel" };

export default function PaginaParametros() {
  return (
    <>
      <div>
        <Link href="/tablero" className="text-sm text-zinc-500 underline">
          ← Tablero
        </Link>
        <h1 className="mt-1 text-2xl font-semibold">Parámetros de la empresa</h1>
        <p className="text-sm text-zinc-500">Los usan la conciliación, los viajes y el tablero. Solo el dueño los cambia.</p>
      </div>
      <Suspense fallback={<p className="text-zinc-500">Cargando…</p>}>
        <Contenido />
      </Suspense>
    </>
  );
}

async function Contenido() {
  const { empresa } = await usuarioConPermiso("editarParametros");
  const db = await crearClienteServidor();
  const [{ data, error }, { data: pago }] = await Promise.all([
    db.from("parametros_empresa").select(CAMPOS_PARAMETROS.map((c) => c.columna).join(", ")).eq("empresa_id", empresa.empresaId).single(),
    db.from("pago_operador_config").select("*").eq("empresa_id", empresa.empresaId).is("operador_id", null).maybeSingle(),
  ]);
  if (error) throw new Error("No se pudieron leer los parámetros");
  const fila = data as unknown as Record<string, unknown>;
  return (
    <>
      <FormularioParametros iniciales={Object.fromEntries(CAMPOS_PARAMETROS.map((c) => [c.columna, valorDeFormulario(fila[c.columna] as string | number | null)]))} />
      <section className="flex flex-col gap-3 border-t border-zinc-200 pt-6 dark:border-zinc-800">
        <h2 className="text-lg font-semibold">Pago al operador (por defecto)</h2>
        <p className="text-sm text-zinc-500">Se puede cambiar por operador (en su ficha) y en cada viaje.</p>
        <FormularioPago
          operadorId={null}
          iniciales={Object.fromEntries(
            ["esquema", "pct", "tarifa_km_cargado", "tarifa_km_vacio", "tarifa_tonelada", "monto_fijo", "sueldo_base_mensual"].map((k) => [
              k,
              valorDeFormulario((pago as Record<string, string | number | null> | null)?.[k] ?? null),
            ]),
          )}
        />
      </section>
    </>
  );
}
