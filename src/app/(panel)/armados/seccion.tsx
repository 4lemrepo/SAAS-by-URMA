import { NOMBRE_CONFIGURACION } from "@/lib/armados/armado";
import { leerEquipo, leerHistorialArmados } from "@/lib/catalogos/datos";
import { crearClienteServidor } from "@/lib/supabase/server";
import { FormularioArmado, type OpcionEquipo } from "./formulario";

const fecha = (iso: string) =>
  new Date(iso).toLocaleString("es-MX", { dateStyle: "short", timeStyle: "short", timeZone: "America/Mexico_City" });

/** Armado actual, cambio de armado e historial de una unidad. */
export async function SeccionArmado({ unidadId, empresaId }: { unidadId: string; empresaId: string }) {
  const supabase = await crearClienteServidor();
  const [equipo, historial] = await Promise.all([leerEquipo(supabase, empresaId), leerHistorialArmados(supabase, unidadId)]);
  const vigente = historial.find((a) => a.hasta === null);

  const dondeEsta = (id: string, tipo: "remolque" | "dolly") => {
    const unidad = tipo === "remolque" ? equipo.unidadDeRemolque(id) : equipo.unidadDeDolly(id);
    const estaAqui =
      vigente && (tipo === "remolque" ? [vigente.remolque1_id, vigente.remolque2_id].includes(id) : vigente.dolly_id === id);
    return estaAqui ? null : unidad;
  };
  // Solo equipo activo (la base no deja desactivar equipo enganchado).
  const remolques: OpcionEquipo[] = equipo.remolques
    .filter((r) => r.activo)
    .map((r) => ({ valor: r.id, etiqueta: `${equipo.nombreRemolque(r.id)} · ${r.tipo}`, enOtraUnidad: dondeEsta(r.id, "remolque") }));
  const dollies: OpcionEquipo[] = equipo.dollies
    .filter((d) => d.activo)
    .map((d) => ({ valor: d.id, etiqueta: equipo.nombreDolly(d.id) ?? "", enOtraUnidad: dondeEsta(d.id, "dolly") }));

  return (
    <section className="flex flex-col gap-4 border-t border-zinc-200 pt-6 dark:border-zinc-800">
      <div>
        <h2 className="text-lg font-semibold">Armado</h2>
        <p className="text-sm">
          {vigente ? (
            <>
              <strong>{equipo.describir(vigente)}</strong>
              <span className="text-zinc-500"> · desde {fecha(vigente.desde)}</span>
            </>
          ) : (
            <span className="text-zinc-500">Sin remolques enganchados.</span>
          )}
        </p>
      </div>
      {equipo.remolques.length === 0 ? (
        <p className="text-sm text-zinc-500">Da de alta remolques (y dollies para un full) para armar esta unidad.</p>
      ) : (
        <FormularioArmado
          key={vigente?.id ?? "sin-armado"}
          unidadId={unidadId}
          remolques={remolques}
          dollies={dollies}
          actual={{
            remolque1: vigente?.remolque1_id ?? "",
            dolly: vigente?.dolly_id ?? "",
            remolque2: vigente?.remolque2_id ?? "",
          }}
        />
      )}
      {historial.length > 0 && (
        <details>
          <summary className="cursor-pointer text-sm font-medium">Historial ({historial.length})</summary>
          <ul className="mt-2 flex flex-col gap-2 text-sm">
            {historial.map((a) => (
              <li key={a.id} className="rounded-md border border-zinc-200 p-2 dark:border-zinc-800">
                <p>
                  {fecha(a.desde)} → {a.hasta ? fecha(a.hasta) : "hoy"}
                  <span className="ml-2 text-zinc-500">{NOMBRE_CONFIGURACION[a.configuracion]}</span>
                </p>
                <p className="text-zinc-600 dark:text-zinc-400">{equipo.describir(a)}</p>
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}
