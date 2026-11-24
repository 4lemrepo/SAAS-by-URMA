import "server-only";
import { paginar } from "@/lib/viajes/datos";
import type { crearClienteServidor } from "@/lib/supabase/server";
import { llaveCosto } from "./historico";

type ClienteSupabase = Awaited<ReturnType<typeof crearClienteServidor>>;

/** Lo que necesita la importación de históricos para revisar contra la base (vista previa y servidor). */
export interface ContextoImportacion {
  unidades: { id: string; numero_economico: string }[];
  operadores: string[];
  clientes: string[];
  fuentes: { nombre: string; tiene_factura: boolean }[];
  /** Folios ocupados (en mayúsculas): un viaje importado y cancelado ya no ocupa el suyo. */
  foliosExistentes: string[];
  /** Costos de importaciones anteriores vigentes (llaveCosto). */
  costosExistentes: string[];
}

export async function leerContextoImportacion(db: ClienteSupabase, empresaId: string): Promise<ContextoImportacion> {
  const [unidades, operadores, clientes, fuentes, categorias, viajes, costos] = await Promise.all([
    db.from("unidades").select("id, numero_economico").eq("empresa_id", empresaId),
    db.from("operadores").select("nombre").eq("empresa_id", empresaId),
    db.from("clientes").select("nombre").eq("empresa_id", empresaId),
    db.from("fuentes_diesel").select("nombre, tiene_factura").eq("empresa_id", empresaId),
    db.from("categorias_costo").select("id, nombre").eq("empresa_id", empresaId),
    paginar<{ folio: string; estado: string; lote_id: string | null }>((d, h) =>
      db.from("viajes").select("folio, estado, lote_id").eq("empresa_id", empresaId).order("id").range(d, h),
    ),
    paginar<{ unidad_id: string; mes: string; categoria_id: string }>((d, h) =>
      db.from("costos").select("unidad_id, mes, categoria_id").eq("empresa_id", empresaId).not("lote_id", "is", null).eq("cancelado", false).order("id").range(d, h),
    ),
  ]);
  for (const r of [unidades, operadores, clientes, fuentes, categorias]) {
    if (r.error) throw new Error("No se pudieron leer los catálogos");
  }
  const nombreCategoria = new Map((categorias.data ?? []).map((c) => [c.id as string, c.nombre as string]));
  return {
    unidades: (unidades.data ?? []) as { id: string; numero_economico: string }[],
    operadores: (operadores.data ?? []).map((o) => o.nombre as string),
    clientes: (clientes.data ?? []).map((c) => c.nombre as string),
    fuentes: (fuentes.data ?? []) as { nombre: string; tiene_factura: boolean }[],
    foliosExistentes: viajes.filter((v) => v.estado !== "cancelado" || v.lote_id === null).map((v) => v.folio.toUpperCase()),
    costosExistentes: costos
      .filter((c) => c.unidad_id && nombreCategoria.has(c.categoria_id))
      .map((c) => llaveCosto(c.unidad_id, c.mes, nombreCategoria.get(c.categoria_id)!)),
  };
}

export interface LoteImportacion {
  id: string;
  archivo: string;
  creado_en: string;
  anulado_en: string | null;
  motivo_anulacion: string | null;
  viajes: number;
  costos: number;
  /** Rango de fechas de sus viajes ("aaaa-mm-dd"), para enlazar a la lista. */
  desde: string | null;
  hasta: string | null;
}

export async function leerLotes(db: ClienteSupabase, empresaId: string): Promise<LoteImportacion[]> {
  const [lotes, viajes, costos] = await Promise.all([
    db.from("lotes_importacion").select("id, archivo, creado_en, anulado_en, motivo_anulacion").eq("empresa_id", empresaId).order("creado_en", { ascending: false }),
    paginar<{ lote_id: string; fecha_salida: string }>((d, h) =>
      db.from("viajes").select("lote_id, fecha_salida").eq("empresa_id", empresaId).not("lote_id", "is", null).order("id").range(d, h),
    ),
    paginar<{ lote_id: string }>((d, h) =>
      db.from("costos").select("lote_id").eq("empresa_id", empresaId).not("lote_id", "is", null).order("id").range(d, h),
    ),
  ]);
  if (lotes.error) throw new Error("No se pudieron leer las importaciones");
  return (lotes.data ?? []).map((l) => {
    const propios = viajes.filter((v) => v.lote_id === l.id).map((v) => v.fecha_salida.slice(0, 10)).sort();
    return {
      ...(l as Omit<LoteImportacion, "viajes" | "costos" | "desde" | "hasta">),
      viajes: propios.length,
      costos: costos.filter((c) => c.lote_id === l.id).length,
      desde: propios[0] ?? null,
      hasta: propios.at(-1) ?? null,
    };
  });
}
