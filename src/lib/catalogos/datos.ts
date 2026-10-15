import "server-only";
import { describirArmado, etiquetaDolly, etiquetaRemolque } from "@/lib/armados/armado";
import { crearClienteServidor } from "@/lib/supabase/server";
import { CATALOGOS, type ClaveCatalogo, type DefinicionCatalogo } from "./definiciones";
import type { Referencias, Registro } from "./validacion";

type ClienteSupabase = Awaited<ReturnType<typeof crearClienteServidor>>;

export interface FilaCatalogo {
  id: string;
  activo: boolean;
  valores: Registro;
}

function columnas(clave: ClaveCatalogo) {
  const def = CATALOGOS[clave];
  return ["id", def.columnaActivo, ...def.campos.map((c) => c.columna)].join(",");
}

function aFila(clave: ClaveCatalogo, fila: Record<string, unknown>): FilaCatalogo {
  const def = CATALOGOS[clave];
  const valores: Registro = {};
  for (const c of def.campos) valores[c.columna] = (fila[c.columna] as string | number | boolean | null) ?? null;
  return { id: String(fila.id), activo: fila[def.columnaActivo] === true, valores };
}

/** Todos los registros del catálogo de la empresa (RLS ya limita a la empresa del usuario). */
export async function leerCatalogo(clave: ClaveCatalogo, empresaId: string): Promise<FilaCatalogo[]> {
  const def = CATALOGOS[clave];
  const supabase = await crearClienteServidor();
  const { data, error } = await supabase
    .from(def.tabla)
    .select(columnas(clave))
    .eq("empresa_id", empresaId)
    .order(def.orden);
  if (error) throw new Error(`No se pudo leer el catálogo de ${def.titulo.toLowerCase()}`);
  const filas = (data as unknown as Record<string, unknown>[]).map((f) => aFila(clave, f));

  if (def.calculadas?.length) {
    const equipo = await leerEquipo(supabase, empresaId);
    for (const f of filas) {
      if (clave === "unidades") f.valores.armado = equipo.describirVigente(f.id);
      if (clave === "remolques") f.valores.enganchado = equipo.unidadDeRemolque(f.id);
      if (clave === "dollies") f.valores.enganchado = equipo.unidadDeDolly(f.id);
    }
  }
  return filas;
}

export async function leerRegistro(clave: ClaveCatalogo, empresaId: string, id: string): Promise<FilaCatalogo | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const supabase = await crearClienteServidor();
  const { data } = await supabase
    .from(CATALOGOS[clave].tabla)
    .select(columnas(clave))
    .eq("empresa_id", empresaId)
    .eq("id", id)
    .maybeSingle();
  return data ? aFila(clave, data as unknown as Record<string, unknown>) : null;
}

/** Opciones de cada campo de referencia del catálogo (p. ej. tipos de remolque). */
export async function leerReferencias(
  def: DefinicionCatalogo,
  empresaId: string,
  supabase?: ClienteSupabase,
): Promise<Referencias> {
  const cliente = supabase ?? (await crearClienteServidor());
  const referencias: Referencias = {};
  for (const campo of def.campos) {
    if (campo.tipo !== "referencia") continue;
    const ref = CATALOGOS[campo.catalogo];
    const { data, error } = await cliente
      .from(ref.tabla)
      .select(`id, ${ref.columnaEtiqueta}, ${ref.columnaActivo}`)
      .eq("empresa_id", empresaId)
      .order(ref.columnaEtiqueta);
    if (error) throw new Error(`No se pudo leer ${ref.titulo.toLowerCase()}`);
    referencias[campo.columna] = (data as unknown as Record<string, unknown>[]).map((f) => ({
      valor: String(f.id),
      etiqueta: `${f[ref.columnaEtiqueta]}${f[ref.columnaActivo] ? "" : " (inactivo)"}`,
    }));
  }
  return referencias;
}

export interface Remolque {
  id: string;
  placas: string;
  numero_economico: string | null;
  tipo: string;
  activo: boolean;
}
export interface Dolly {
  id: string;
  numero_serie: string;
  numero_economico: string | null;
  activo: boolean;
}
export interface Armado {
  id: string;
  unidad_id: string;
  remolque1_id: string;
  dolly_id: string | null;
  remolque2_id: string | null;
  configuracion: "sencillo" | "full";
  desde: string;
  hasta: string | null;
}

/** Remolques, dollies y armados vigentes de la empresa, con ayudas para nombrarlos. */
export async function leerEquipo(supabase: ClienteSupabase, empresaId: string) {
  const [remolques, tipos, dollies, vigentes, unidades] = await Promise.all([
    supabase.from("remolques").select("id, placas, numero_economico, tipo_id, activo").eq("empresa_id", empresaId).order("placas"),
    supabase.from("tipos_remolque").select("id, nombre").eq("empresa_id", empresaId),
    supabase.from("dollies").select("id, numero_serie, numero_economico, activo").eq("empresa_id", empresaId).order("numero_serie"),
    supabase
      .from("armados")
      .select("id, unidad_id, remolque1_id, dolly_id, remolque2_id, configuracion, desde, hasta")
      .eq("empresa_id", empresaId)
      .is("hasta", null),
    supabase.from("unidades").select("id, numero_economico").eq("empresa_id", empresaId),
  ]);
  for (const r of [remolques, tipos, dollies, vigentes, unidades]) {
    if (r.error) throw new Error("No se pudo leer el equipo de la empresa");
  }
  const nombreTipo = new Map((tipos.data ?? []).map((t) => [t.id as string, t.nombre as string]));
  const listaRemolques: Remolque[] = (remolques.data ?? []).map((r) => ({
    id: r.id,
    placas: r.placas,
    numero_economico: r.numero_economico,
    tipo: nombreTipo.get(r.tipo_id) ?? "",
    activo: r.activo,
  }));
  const listaDollies = (dollies.data ?? []) as Dolly[];
  const armados = (vigentes.data ?? []) as Armado[];
  const remolquePorId = new Map(listaRemolques.map((r) => [r.id, r]));
  const dollyPorId = new Map(listaDollies.map((d) => [d.id, d]));
  const unidadPorId = new Map((unidades.data ?? []).map((u) => [u.id as string, u.numero_economico as string]));

  const nombreRemolque = (id: string | null) => {
    const r = id ? remolquePorId.get(id) : undefined;
    return r ? etiquetaRemolque(r) : null;
  };
  const nombreDolly = (id: string | null) => {
    const d = id ? dollyPorId.get(id) : undefined;
    return d ? etiquetaDolly(d) : null;
  };
  const describir = (a: Armado | undefined) =>
    describirArmado(
      a ? { remolque1: nombreRemolque(a.remolque1_id), dolly: nombreDolly(a.dolly_id), remolque2: nombreRemolque(a.remolque2_id) } : null,
    );

  return {
    remolques: listaRemolques,
    dollies: listaDollies,
    vigentes: armados,
    nombreRemolque,
    nombreDolly,
    describir,
    describirVigente: (unidadId: string) => describir(armados.find((a) => a.unidad_id === unidadId)),
    unidadDeRemolque: (id: string) => {
      const a = armados.find((x) => x.remolque1_id === id || x.remolque2_id === id);
      return a ? (unidadPorId.get(a.unidad_id) ?? null) : null;
    },
    unidadDeDolly: (id: string) => {
      const a = armados.find((x) => x.dolly_id === id);
      return a ? (unidadPorId.get(a.unidad_id) ?? null) : null;
    },
    nombreUnidad: (id: string) => unidadPorId.get(id) ?? null,
  };
}

/** Historial de armados de una unidad, del más reciente al más antiguo. */
export async function leerHistorialArmados(supabase: ClienteSupabase, unidadId: string): Promise<Armado[]> {
  const { data, error } = await supabase
    .from("armados")
    .select("id, unidad_id, remolque1_id, dolly_id, remolque2_id, configuracion, desde, hasta")
    .eq("unidad_id", unidadId)
    .order("desde", { ascending: false })
    .limit(50);
  if (error) throw new Error("No se pudo leer el historial de armados");
  return (data ?? []) as Armado[];
}
