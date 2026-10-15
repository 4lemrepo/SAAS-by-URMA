import { valorDeFormulario } from "@/lib/catalogos/formato";
import { crearClienteServidor } from "@/lib/supabase/server";
import { FormularioPago } from "./formulario";

/** Pago propio de un operador (o usa el de la empresa). Solo para quien ve tarifas. */
export async function SeccionPagoOperador({ operadorId, empresaId }: { operadorId: string; empresaId: string }) {
  const db = await crearClienteServidor();
  const { data } = await db
    .from("pago_operador_config")
    .select("*")
    .eq("empresa_id", empresaId)
    .eq("operador_id", operadorId)
    .maybeSingle();
  const fila = data as Record<string, string | number | boolean | null> | null;
  return (
    <section className="flex flex-col gap-3 border-t border-zinc-200 pt-6 dark:border-zinc-800">
      <h2 className="text-lg font-semibold">Pago al operador</h2>
      <FormularioPago
        operadorId={operadorId}
        usaElDeLaEmpresa={!fila || fila.activo === false}
        iniciales={Object.fromEntries(
          ["esquema", "pct", "tarifa_km_cargado", "tarifa_km_vacio", "tarifa_tonelada", "monto_fijo", "sueldo_base_mensual"].map((k) => [
            k,
            valorDeFormulario((fila?.[k] as string | number | null) ?? null),
          ]),
        )}
      />
    </section>
  );
}
