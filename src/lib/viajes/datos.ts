import "server-only";
import { crearClienteServidor } from "@/lib/supabase/server";
import { leerEquipo } from "@/lib/catalogos/datos";
import { ZONA } from "./fechas";
import { tasaIva, type TasaIva } from "@/lib/costos/iva";
import { resumirViaje, type BaseFlete, type EsquemaPago, type ResumenViaje, type TipoTramo } from "./calculos";

type ClienteSupabase = Awaited<ReturnType<typeof crearClienteServidor>>;


export interface Tramo {
  id: string;
  tipo: TipoTramo;
  origen: string;
  destino: string;
  odometro_inicial: number;
  odometro_final: number;
  km: number;
  ruta_id: string | null;
  km_ruta: number | null;
  motivo_desvio: string | null;
  nota_desvio: string | null;
}
export interface Carga {
  id: string;
  fecha: string;
  litros: number;
  precio_litro: number | null;
  /** Total del ticket (con IVA si lo trae). */
  importe: number | null;
  tiene_factura: boolean;
  tasa_iva: TasaIva;
  iva: number;
  /** importe − IVA; null sin importe. */
  costo: number | null;
  estado: "pendiente" | "validada" | "rechazada";
  fuente_id: string;
  fuente: string;
  folio_ticket: string | null;
  odometro: number | null;
  foto_ticket_path: string | null;
  capturado_por: string | null;
  autovalidada: boolean;
}
export interface Gasto {
  id: string;
  folio: string;
  fecha: string;
  categoria_id: string;
  categoria: string;
  /** Total pagado (con IVA si lo trae). */
  monto: number;
  tiene_factura: boolean;
  tasa_iva: TasaIva;
  iva: number;
  /** Costo para rentabilidad: monto − IVA acreditable. */
  costo: number;
  forma_pago: string;
  proveedor: string | null;
  numero_comprobante: string | null;
  comprobante_path: string | null;
  /** Antes se marcaba "se factura al cliente" (ya no se usa; para revisión). */
  facturable_anterior: boolean;
  cancelado: boolean;
  notas: string | null;
}
export interface CargoAdicional {
  id: string;
  concepto: string;
  /** Subtotal sin IVA. */
  monto: number;
  cancelado: boolean;
}
/** Tarifa del viaje (solo quien ve tarifas). */
export interface Finanzas {
  tipo_tarifa: "por_tonelada" | "fija";
  tarifa: number;
  factura_por: "cargado" | "descargado";
}
/** Pago al operador del viaje: esquema y valores que se usaron (solo quien ve utilidades). */
export interface PagoViaje {
  esquema: EsquemaPago;
  base_flete: BaseFlete;
  pct: number | null;
  tarifa_km_cargado: number | null;
  tarifa_km_vacio: number | null;
  tarifa_tonelada: number | null;
  monto_fijo: number | null;
  pago_operador_manual: number | null;
}
export type EstadoViaje = "abierto" | "cerrado" | "cancelado";

export interface Viaje {
  id: string;
  folio: string;
  estado: EstadoViaje;
  unidad_id: string;
  operador_id: string;
  cliente_id: string | null;
  armado_id: string | null;
  producto: string | null;
  toneladas_cargadas: number | null;
  toneladas_descargadas: number | null;
  fecha_salida: string;
  llegada_carga: string | null;
  salida_carga: string | null;
  llegada_descarga: string | null;
  salida_descarga: string | null;
  fecha_llegada: string | null;
  odometro_anterior: number | null;
  km_sin_viaje: number;
  explicacion_km_sin_viaje: string | null;
  notas: string | null;
  cerrado_en: string | null;
  cancelado_en: string | null;
  motivo_cancelacion: string | null;
  creado_en: string;
}
export interface ViajeCompleto extends Viaje {
  unidad: string;
  operador: string;
  cliente: string | null;
  /** Peso con el que factura el cliente (para la tarifa de un viaje nuevo). */
  facturaPorCliente: "cargado" | "descargado" | null;
  armado: string;
  tramos: Tramo[];
  cargas: Carga[];
  gastos: Gasto[];
  /** Vacío si quien consulta no ve tarifas. */
  cargosAdicionales: CargoAdicional[];
  /** null si quien consulta no ve tarifas, o si el viaje aún no tiene tarifa. */
  finanzas: Finanzas | null;
  /** null si quien consulta no ve utilidades, o si el viaje aún no tiene pago. */
  pago: PagoViaje | null;
  /**
   * Cálculos del viaje. Sin "ve utilidades" no hay pago al operador: la
   * utilidad y el costo variable de aquí no se muestran.
   */
  resumen: ResumenViaje;
}

export interface FiltrosViajes {
  desde?: string;
  hasta?: string;
  unidad?: string;
  operador?: string;
  cliente?: string;
  /** Sin estado: abiertos y cerrados (los cancelados solo si se piden, o por id). */
  estado?: EstadoViaje | "todos";
  ids?: string[];
}

const COLUMNAS_VIAJE =
  "id, folio, estado, unidad_id, operador_id, cliente_id, armado_id, producto, toneladas_cargadas, toneladas_descargadas, fecha_salida, llegada_carga, salida_carga, llegada_descarga, salida_descarga, fecha_llegada, odometro_anterior, km_sin_viaje, explicacion_km_sin_viaje, notas, cerrado_en, cancelado_en, motivo_cancelacion, creado_en";

/**
 * Consulta por lotes de ids: una URL con cientos de ids no cabe en una
 * petición. Cada lote se pagina (Supabase devuelve máximo 1,000 filas).
 */
async function porLotes<T>(
  ids: string[],
  consulta: (lote: string[]) => { range: (desde: number, hasta: number) => PromiseLike<{ data: T[] | null; error: unknown }> },
) {
  const resultado: T[] = [];
  for (let i = 0; i < ids.length; i += 50) {
    const lote = ids.slice(i, i + 50);
    resultado.push(...(await paginar<T>((desde, hasta) => consulta(lote).range(desde, hasta))));
  }
  return resultado;
}

/** Lee todas las filas de una consulta, de 1,000 en 1,000 (el máximo de Supabase por petición). */
export async function paginar<T>(
  consulta: (desde: number, hasta: number) => PromiseLike<{ data: T[] | null; error: unknown }>,
  tope = 50_000,
): Promise<T[]> {
  const resultado: T[] = [];
  for (let i = 0; i < tope; i += 1000) {
    const { data, error } = await consulta(i, i + 999);
    if (error) throw new Error("No se pudieron leer los datos");
    resultado.push(...(data ?? []));
    if (!data || data.length < 1000) break;
  }
  return resultado;
}

/**
 * Viajes de la empresa con todo lo que les pasó. La tarifa y los cargos solo
 * vienen si el usuario ve tarifas, y el pago al operador si ve utilidades (la
 * RLS de cada tabla también lo impone).
 */
export async function leerViajes(
  empresaId: string,
  filtros: FiltrosViajes,
  { veTarifas, veUtilidades, esAdmin }: { veTarifas: boolean; veUtilidades: boolean; esAdmin: boolean },
  supabase?: ClienteSupabase,
): Promise<ViajeCompleto[]> {
  const db = supabase ?? (await crearClienteServidor());
  // El constructor de Supabase se modifica en cada llamada: uno nuevo por página.
  const consulta = () => {
    let q = db.from("viajes").select(COLUMNAS_VIAJE).eq("empresa_id", empresaId);
    if (filtros.desde) q = q.gte("fecha_salida", `${filtros.desde}T00:00:00${ZONA}`);
    if (filtros.hasta) q = q.lte("fecha_salida", `${filtros.hasta}T23:59:59.999${ZONA}`);
    if (filtros.unidad) q = q.eq("unidad_id", filtros.unidad);
    if (filtros.operador) q = q.eq("operador_id", filtros.operador);
    if (filtros.cliente) q = q.eq("cliente_id", filtros.cliente);
    if (filtros.estado && filtros.estado !== "todos") q = q.eq("estado", filtros.estado);
    // Un viaje cancelado sale de listas y KPIs; se ve con su filtro o abriéndolo.
    else if (!filtros.estado && !filtros.ids) q = q.neq("estado", "cancelado");
    if (filtros.ids) q = q.in("id", filtros.ids);
    return q.order("fecha_salida", { ascending: false }).order("id");
  };
  const viajes = (await paginar((desde, hasta) => consulta().range(desde, hasta))) as unknown as Viaje[];
  if (!viajes.length) return [];
  const ids = viajes.map((v) => v.id);

  const [tramos, cargas, gastos, finanzas, pagos, cargos, categorias, fuentes, catalogos, parametros, equipo, armados] = await Promise.all([
    porLotes<Tramo & { viaje_id: string }>(ids, (l) =>
      db.from("tramos_viaje").select("id, viaje_id, tipo, origen, destino, odometro_inicial, odometro_final, km, ruta_id, km_ruta, motivo_desvio, nota_desvio").in("viaje_id", l),
    ),
    porLotes<Omit<Carga, "fuente"> & { viaje_id: string }>(ids, (l) =>
      db.from("cargas_diesel").select("id, viaje_id, fecha, litros, precio_litro, importe, tiene_factura, tasa_iva, iva, costo, estado, fuente_id, folio_ticket, odometro, foto_ticket_path, capturado_por, autovalidada").in("viaje_id", l).order("fecha"),
    ),
    porLotes<Omit<Gasto, "categoria"> & { viaje_id: string }>(ids, (l) =>
      db.from("gastos_viaje").select("id, viaje_id, folio, fecha, categoria_id, monto, tiene_factura, tasa_iva, iva, costo, forma_pago, proveedor, numero_comprobante, comprobante_path, facturable_anterior, cancelado, notas").in("viaje_id", l).order("fecha"),
    ),
    veTarifas
      ? porLotes<Finanzas & { viaje_id: string }>(ids, (l) => db.from("viajes_finanzas").select("viaje_id, tipo_tarifa, tarifa, factura_por").in("viaje_id", l))
      : Promise.resolve([]),
    veUtilidades
      ? porLotes<PagoViaje & { viaje_id: string }>(ids, (l) => db.from("viajes_pago").select("*").in("viaje_id", l))
      : Promise.resolve([]),
    veTarifas
      ? porLotes<CargoAdicional & { viaje_id: string }>(ids, (l) =>
          db.from("cargos_adicionales").select("id, viaje_id, concepto, monto, cancelado").in("viaje_id", l).order("creado_en"),
        )
      : Promise.resolve([]),
    db.from("categorias_gasto").select("id, nombre").eq("empresa_id", empresaId),
    db.from("fuentes_diesel").select("id, nombre").eq("empresa_id", empresaId),
    leerNombres(db, empresaId),
    // Precio del diésel para cargas sin importe ni precio (solo lo leen dueño y administración).
    esAdmin
      ? db.from("parametros_empresa").select("precio_diesel_litro").eq("empresa_id", empresaId).maybeSingle()
      : Promise.resolve({ data: null }),
    leerEquipo(db, empresaId),
    porLotes<{ id: string; remolque1_id: string; dolly_id: string | null; remolque2_id: string | null }>(
      [...new Set(viajes.map((v) => v.armado_id).filter((x): x is string => !!x))],
      (l) => db.from("armados").select("id, remolque1_id, dolly_id, remolque2_id").in("id", l),
    ),
  ]);
  const nombreCategoria = new Map((categorias.data ?? []).map((c) => [c.id as string, c.nombre as string]));
  const nombreFuente = new Map((fuentes.data ?? []).map((f) => [f.id as string, f.nombre as string]));
  const armadoPorId = new Map(armados.map((a) => [a.id, a]));
  const precio = (parametros.data as { precio_diesel_litro: number | null } | null)?.precio_diesel_litro ?? null;
  const agrupar = <T extends { viaje_id: string }>(xs: T[]) => {
    const m = new Map<string, T[]>();
    for (const x of xs) m.set(x.viaje_id, [...(m.get(x.viaje_id) ?? []), x]);
    return m;
  };
  const tramosDe = agrupar(tramos);
  const cargasDe = agrupar(cargas);
  const gastosDe = agrupar(gastos);
  const cargosDe = agrupar(cargos);
  const finanzasDe = new Map(finanzas.map((f) => [f.viaje_id, f]));
  const pagoDe = new Map(pagos.map((p) => [p.viaje_id, p]));

  return viajes.map((v) => {
    const t = (tramosDe.get(v.id) ?? []).sort((a, b) => (a.tipo === "vacio" ? -1 : 1) - (b.tipo === "vacio" ? -1 : 1));
    const c = (cargasDe.get(v.id) ?? []).map((x) => ({
      ...x,
      tasa_iva: tasaIva(x.tasa_iva),
      iva: Number(x.iva),
      costo: num(x.costo),
      fuente: nombreFuente.get(x.fuente_id) ?? "",
    }));
    const g = (gastosDe.get(v.id) ?? []).map((x) => ({
      ...x,
      monto: Number(x.monto),
      tasa_iva: tasaIva(x.tasa_iva),
      iva: Number(x.iva),
      costo: Number(x.costo),
      categoria: nombreCategoria.get(x.categoria_id) ?? "",
    }));
    const ca = (cargosDe.get(v.id) ?? []).map((x) => ({ ...x, monto: Number(x.monto) }));
    const f = finanzasDe.get(v.id) ?? null;
    const p = pagoDe.get(v.id) ?? null;
    const a = v.armado_id ? armadoPorId.get(v.armado_id) : undefined;
    return {
      ...v,
      unidad: catalogos.unidades.get(v.unidad_id) ?? "",
      operador: catalogos.operadores.get(v.operador_id) ?? "",
      cliente: v.cliente_id ? (catalogos.clientes.get(v.cliente_id) ?? null) : null,
      facturaPorCliente: catalogos.listas.clientes.find((c) => c.id === v.cliente_id)?.factura_por ?? null,
      armado: a
        ? equipo.describir({ ...a, id: a.id, unidad_id: v.unidad_id, configuracion: a.remolque2_id ? "full" : "sencillo", desde: "", hasta: null })
        : "Sin armado registrado",
      tramos: t,
      cargas: c,
      gastos: g,
      cargosAdicionales: ca,
      finanzas: f,
      pago: p,
      resumen: resumirViaje({
        tramos: t.map((x) => ({ tipo: x.tipo, odometroInicial: Number(x.odometro_inicial), odometroFinal: Number(x.odometro_final) })),
        toneladasCargadas: num(v.toneladas_cargadas),
        toneladasDescargadas: num(v.toneladas_descargadas),
        tarifa: f ? { tipo: f.tipo_tarifa, tarifa: Number(f.tarifa), facturaPor: f.factura_por } : null,
        cargosAdicionales: ca.map((x) => ({ concepto: x.concepto, monto: x.monto, cancelado: x.cancelado })),
        pago: p
          ? {
              esquema: p.esquema,
              baseFlete: p.base_flete,
              pct: num(p.pct),
              tarifaKmCargado: num(p.tarifa_km_cargado),
              tarifaKmVacio: num(p.tarifa_km_vacio),
              tarifaTonelada: num(p.tarifa_tonelada),
              montoFijo: num(p.monto_fijo),
            }
          : null,
        pagoManual: p ? num(p.pago_operador_manual) : null,
        gastos: g.map((x) => ({ categoria: x.categoria, folio: x.folio, monto: x.monto, iva: x.iva, cancelado: x.cancelado })),
        cargas: c.map((x) => ({
          litros: Number(x.litros),
          importe: num(x.importe),
          precioLitro: num(x.precio_litro),
          estado: x.estado,
          tieneFactura: x.tiene_factura,
          tasaIva: x.tasa_iva,
        })),
        precioDieselParametro: num(precio),
      }),
    };
  });
}

/** Números de la base pueden llegar como texto (numeric grandes); null se queda null. */
const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));

/** Número económico de unidades y nombres de operadores y clientes. */
export async function leerNombres(db: ClienteSupabase, empresaId: string) {
  const [u, o, c] = await Promise.all([
    db.from("unidades").select("id, numero_economico, activa").eq("empresa_id", empresaId).order("numero_economico"),
    db.from("operadores").select("id, nombre, activo").eq("empresa_id", empresaId).order("nombre"),
    db.from("clientes").select("id, nombre, activo, factura_por").eq("empresa_id", empresaId).order("nombre"),
  ]);
  if (u.error || o.error || c.error) throw new Error("No se pudieron leer los catálogos");
  return {
    unidades: new Map((u.data ?? []).map((x) => [x.id as string, x.numero_economico as string])),
    operadores: new Map((o.data ?? []).map((x) => [x.id as string, x.nombre as string])),
    clientes: new Map((c.data ?? []).map((x) => [x.id as string, x.nombre as string])),
    listas: {
      unidades: (u.data ?? []) as { id: string; numero_economico: string; activa: boolean }[],
      operadores: (o.data ?? []) as { id: string; nombre: string; activo: boolean }[],
      clientes: (c.data ?? []) as { id: string; nombre: string; activo: boolean; factura_por: "cargado" | "descargado" }[],
    },
  };
}

/**
 * Último punto conocido de cada unidad: destino y odómetro final del tramo
 * cargado de su viaje más reciente (antes de `antesDe`, si se da). Es de donde
 * arranca el siguiente viaje.
 */
export async function ultimoPuntoDeUnidad(
  db: ClienteSupabase,
  unidadId: string,
  opciones: { antesDe?: string; excluir?: string } = {},
): Promise<{ lugar: string | null; odometro: number | null; operadorId: string | null }> {
  // Un viaje cancelado no mueve el último punto de la unidad.
  let q = db.from("viajes").select("id, operador_id").eq("unidad_id", unidadId).neq("estado", "cancelado");
  if (opciones.antesDe) q = q.lt("fecha_salida", opciones.antesDe);
  if (opciones.excluir) q = q.neq("id", opciones.excluir);
  const { data } = await q.order("fecha_salida", { ascending: false }).limit(1).maybeSingle();
  if (!data) return { lugar: null, odometro: null, operadorId: null };
  const { data: tramos } = await db
    .from("tramos_viaje")
    .select("tipo, destino, odometro_final")
    .eq("viaje_id", data.id);
  const ultimo = (tramos ?? []).find((t) => t.tipo === "cargado") ?? (tramos ?? []).find((t) => t.tipo === "vacio");
  return {
    lugar: (ultimo?.destino as string) ?? null,
    odometro: ultimo ? Number(ultimo.odometro_final) : null,
    operadorId: data.operador_id as string,
  };
}

/** Lugares y productos ya usados, para autocompletar. */
export async function leerSugerencias(db: ClienteSupabase, empresaId: string) {
  const [tramos, rutas, productos] = await Promise.all([
    db.from("tramos_viaje").select("origen, destino").eq("empresa_id", empresaId).limit(5000),
    db.from("rutas").select("origen, destino, km, id, activa").eq("empresa_id", empresaId),
    db.from("viajes").select("producto").eq("empresa_id", empresaId).not("producto", "is", null).limit(5000),
  ]);
  const lugares = new Set<string>();
  for (const t of [...(tramos.data ?? []), ...(rutas.data ?? [])]) {
    lugares.add(String(t.origen).toUpperCase());
    lugares.add(String(t.destino).toUpperCase());
  }
  return {
    lugares: [...lugares].sort((a, b) => a.localeCompare(b, "es")),
    productos: [...new Set((productos.data ?? []).map((p) => String(p.producto)))].sort((a, b) => a.localeCompare(b, "es")),
    rutas: (rutas.data ?? []) as { id: string; origen: string; destino: string; km: number; activa: boolean }[],
  };
}

/** Último punto de todas las unidades en dos consultas (para prellenar un viaje nuevo). */
export async function ultimosPuntos(db: ClienteSupabase, empresaId: string) {
  const { data: recientes } = await db
    .from("viajes")
    .select("id, unidad_id, operador_id")
    .eq("empresa_id", empresaId)
    .neq("estado", "cancelado")
    .order("fecha_salida", { ascending: false })
    .limit(1000);
  const ultimoPorUnidad = new Map<string, { id: string; operador_id: string }>();
  for (const v of recientes ?? []) if (!ultimoPorUnidad.has(v.unidad_id)) ultimoPorUnidad.set(v.unidad_id, v);
  const ids = [...ultimoPorUnidad.values()].map((v) => v.id);
  const tramos = await porLotes<{ viaje_id: string; tipo: string; destino: string; odometro_final: number }>(ids, (l) =>
    db.from("tramos_viaje").select("viaje_id, tipo, destino, odometro_final").in("viaje_id", l),
  );
  const resultado: Record<string, { lugar: string | null; odometro: number | null; operadorId: string | null }> = {};
  for (const [unidad, v] of ultimoPorUnidad) {
    const propios = tramos.filter((t) => t.viaje_id === v.id);
    const ultimo = propios.find((t) => t.tipo === "cargado") ?? propios.find((t) => t.tipo === "vacio");
    resultado[unidad] = {
      lugar: ultimo?.destino ?? null,
      odometro: ultimo ? Number(ultimo.odometro_final) : null,
      operadorId: v.operador_id,
    };
  }
  return resultado;
}

/** Todo lo que necesita el formulario de viaje. */
export async function datosParaFormulario(db: ClienteSupabase, empresaId: string, esAdmin: boolean) {
  const [nombres, sugerencias, ultimos, { data: tolerancia }] = await Promise.all([
    leerNombres(db, empresaId),
    leerSugerencias(db, empresaId),
    ultimosPuntos(db, empresaId),
    db.rpc("tolerancia_km", { p_empresa: empresaId }),
  ]);
  return {
    unidades: nombres.listas.unidades.filter((u) => u.activa).map((u) => ({ id: u.id, nombre: u.numero_economico })),
    operadores: nombres.listas.operadores.filter((o) => o.activo).map((o) => ({ id: o.id, nombre: o.nombre })),
    clientes: nombres.listas.clientes.filter((c) => c.activo).map((c) => ({ id: c.id, nombre: c.nombre })),
    ultimos,
    rutas: sugerencias.rutas.filter((r) => r.activa).map((r) => ({ origen: r.origen, destino: r.destino, km: Number(r.km) })),
    toleranciaKmPct: Number(tolerancia ?? 10),
    lugares: sugerencias.lugares,
    productos: sugerencias.productos,
    esAdmin,
  };
}
