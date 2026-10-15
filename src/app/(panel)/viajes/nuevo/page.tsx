import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { puede } from "@/lib/auth/permisos";
import { usuarioConPermiso } from "@/lib/auth/sesion";
import { crearClienteServidor } from "@/lib/supabase/server";
import { datosParaFormulario } from "@/lib/viajes/datos";
import { ahoraLocal } from "@/lib/viajes/fechas";
import { FormularioViaje } from "../formulario-viaje";

export const metadata: Metadata = { title: "Nuevo viaje · Control Diésel" };

export default function PaginaNuevoViaje() {
  return (
    <>
      <div>
        <Link href="/viajes" className="text-sm text-zinc-500 underline">
          ← Viajes
        </Link>
        <h1 className="mt-1 text-2xl font-semibold">Nuevo viaje</h1>
      </div>
      <Suspense fallback={<p className="text-zinc-500">Cargando…</p>}>
        <Formulario />
      </Suspense>
    </>
  );
}

async function Formulario() {
  const { empresa } = await usuarioConPermiso("capturar");
  const datos = await datosParaFormulario(await crearClienteServidor(), empresa.empresaId, puede(empresa.rol, "editarCatalogos"));
  return <FormularioViaje id={null} iniciales={{ fecha_salida: ahoraLocal() }} datos={datos} />;
}
