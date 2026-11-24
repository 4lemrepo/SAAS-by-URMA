/**
 * KPIs del tablero. Funciones puras: reciben viajes ya resumidos (ver
 * src/lib/viajes/calculos.ts), costos y parámetros, y devuelven números.
 * Ninguna fórmula vive en SQL ni en componentes.
 *
 * Reglas:
 * - Un viaje cuenta en el mes de su salida (hora del centro). Por defecto solo
 *   los cerrados. Los cancelados nunca cuentan (ni en alertas).
 * - Utilidad del viaje (contribución) = ingreso − costo variable
 *   (diésel + gastos del viaje + pago al operador).
 * - Los costos son el costo real: sin el IVA acreditable de lo que tiene
 *   factura. `entradaConIva()` da la misma entrada con lo pagado con IVA, para
 *   comparar contra un control que trae diésel y casetas con IVA.
 * - Costos fijos: costos de equipo de cada unidad + su parte de los generales
 *   (+ "equipo sin asignar" en el total de la flotilla). Los de categorías
 *   excluidas no entran en ningún KPI; se informan aparte.
 * - Filtrar por operador, cliente o ruta deja fuera los costos fijos (no son
 *   de un operador, cliente o ruta): se ve la contribución.
 */
import { asignarCostos, type ArmadoHistorico, type Costo, type MetodoProrrateo } from "@/lib/costos/asignacion";

// ---------------------------------------------------------------------------
// Entrada
// ---------------------------------------------------------------------------

export interface ViajeKpi {
  id: string;
  folio: string;
  estado: "abierto" | "cerrado" | "cancelado";
  fechaSalida: string;
  fechaLlegada: string | null;
  llegadaCarga: string | null;
  salidaCarga: string | null;
  llegadaDescarga: string | null;
  salidaDescarga: string | null;
  unidadId: string;
  operadorId: string;
  clienteId: string | null;
  /** "ORIGEN → DESTINO" del tramo cargado. */
  ruta: string | null;
  kmVacio: number;
  kmCargado: number;
  kmSinViaje: number;
  toneladasCargadas: number | null;
  toneladasDescargadas: number | null;
  toneladasFacturadas: number | null;
  /** $ por tonelada (o su equivalente si la tarifa es fija). */
  tarifaPorTonelada: number | null;
  ingreso: number | null;
  /** Diésel validado sin IVA acreditable. */
  costoDiesel: number;
  litros: number;
  /** Litros que debió consumir según rendimiento esperado (null si la unidad no tiene rendimiento). */
  litrosTeoricos: number | null;
  /** Costo para rentabilidad por nombre de categoría. */
  gastosPorCategoria: Record<string, number>;
  gastosViaje: number;
  pagoOperador: number | null;
  costoVariable: number;
  /** Lo mismo con lo pagado (con IVA), para la vista "mostrar con IVA". */
  conIva: {
    costoDiesel: number;
    gastosPorCategoria: Record<string, number>;
    gastosViaje: number;
    costoVariable: number;
  };
  mermaToneladas: number | null;
  mermaPesos: number | null;
  /** Un elemento por tramo que se desvió de su ruta más que la tolerancia. */
  desvios: { conMotivo: boolean }[];
}

export interface UnidadKpi {
  id: string;
  nombre: string;
  activa: boolean;
}

export interface EntradaKpis {
  viajes: readonly ViajeKpi[];
  unidades: readonly UnidadKpi[];
  nombres: { operadores: Record<string, string>; clientes: Record<string, string> };
  costos: readonly Costo[];
  armados: readonly ArmadoHistorico[];
  /** Categoría de costo → ¿entra en la rentabilidad? */
  incluirCategoria: Readonly<Record<string, boolean>>;
  nombreCategoriaCosto: Readonly<Record<string, string>>;
  metodoProrrateo: MetodoProrrateo;
  parametros: {
    toleranciaPct: number;
    precioDiesel: number | null;
    diasAlertaViajeAbierto: number;
    horasLimiteEstadia: number;
  };
  /** ISO de "ahora" (para días abiertos). */
  ahora: string;
}

export interface Filtros {
  unidad?: string;
  operador?: string;
  cliente?: string;
  ruta?: string;
  incluirAbiertos?: boolean;
}

/**
 * La misma entrada, con lo pagado con IVA en vez del costo real: diésel,
 * gastos del viaje y costos de unidad y generales. El ingreso no cambia
 * (es subtotal sin IVA). Es lo que se ve con "mostrar con IVA".
 */
export function entradaConIva(e: EntradaKpis): EntradaKpis {
  return {
    ...e,
    viajes: e.viajes.map((v) => ({ ...v, ...v.conIva })),
    costos: e.costos.map((c) => ({ ...c, monto: c.total ?? c.monto })),
  };
}

// ---------------------------------------------------------------------------
// Utilidades
// ---------------------------------------------------------------------------

const DESFASE_MS = -6 * 3_600_000;
const r2 = (n: number) => Math.round(n * 100) / 100;
const div = (a: number, b: number): number | null => (b ? a / b : null);
const pct = (a: number, b: number): number | null => (b ? Math.round((a / b) * 1000) / 10 : null);
const suma = <T>(xs: readonly T[], f: (x: T) => number | null) => r2(xs.reduce((s, x) => s + (f(x) ?? 0), 0));

/** Mes "aaaa-mm" (hora del centro) de un ISO. */
export const mesDe = (iso: string) => new Date(Date.parse(iso) + DESFASE_MS).toISOString().slice(0, 7);
/** Día "aaaa-mm-dd" (hora del centro) de un ISO. */
const diaDe = (iso: string) => new Date(Date.parse(iso) + DESFASE_MS).toISOString().slice(0, 10);

/** Meses consecutivos de `desde` a `hasta` ("aaaa-mm"). */
export function mesesEntre(desde: string, hasta: string): string[] {
  const res: string[] = [];
  let [a, m] = desde.split("-").map(Number);
  const [ah, mh] = hasta.split("-").map(Number);
  while (a < ah || (a === ah && m <= mh)) {
    res.push(`${a}-${String(m).padStart(2, "0")}`);
    m++;
    if (m > 12) {
      m = 1;
      a++;
    }
    if (res.length > 120) break;
  }
  return res;
}

/** Los `n` meses anteriores a `mes` (sin incluirlo). */
export function mesesAnteriores(mes: string, n: number): string[] {
  const [a, m] = mes.split("-").map(Number);
  const total = a * 12 + (m - 1);
  return Array.from({ length: n }, (_, i) => {
    const t = total - n + i;
    return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, "0")}`;
  });
}

export function diasDelMes(mes: string): number {
  const [a, m] = mes.split("-").map(Number);
  return new Date(Date.UTC(a, m, 0)).getUTCDate();
}

const horas = (desde: string | null, hasta: string | null) =>
  desde && hasta ? (Date.parse(hasta) - Date.parse(desde)) / 3_600_000 : null;

// ---------------------------------------------------------------------------
// Agregados por grupo (unidad, cliente, ruta, operador)
// ---------------------------------------------------------------------------

export interface FilaGrupo {
  clave: string;
  nombre: string;
  viajes: number;
  km: number;
  kmVacio: number;
  ingreso: number;
  costoVariable: number;
  /** Ingreso − costo variable. */
  contribucion: number;
  /** Solo unidades: costos de equipo + parte de generales del periodo. */
  costosFijos: number;
  utilidad: number;
  utilidadPorKm: number | null;
  margenPct: number | null;
  litros: number;
  kmPorLitro: number | null;
  kmPorLitroEsperado: number | null;
  /** Diferencia del km/l real contra el esperado, en %. */
  rendimientoVsEsperadoPct: number | null;
  costoKmVacio: number;
  mermaToneladas: number;
  mermaPesos: number;
  kmSinViaje: number;
  viajesConDesvio: number;
  pctViajesConDesvio: number | null;
  desviosSinMotivo: number;
}

function agrupar(
  viajes: readonly ViajeKpi[],
  clave: (v: ViajeKpi) => string | null,
  nombre: (k: string) => string,
  costoVariablePorKm: number | null,
  fijos: Readonly<Record<string, number>> = {},
): FilaGrupo[] {
  const grupos = new Map<string, ViajeKpi[]>();
  for (const v of viajes) {
    const k = clave(v);
    if (k === null) continue;
    grupos.set(k, [...(grupos.get(k) ?? []), v]);
  }
  for (const k of Object.keys(fijos)) if (!grupos.has(k)) grupos.set(k, []);
  return [...grupos.entries()].map(([k, vs]) => {
    const km = suma(vs, (v) => v.kmVacio + v.kmCargado);
    const ingreso = suma(vs, (v) => v.ingreso);
    const costoVariable = suma(vs, (v) => v.costoVariable);
    const contribucion = r2(ingreso - costoVariable);
    const costosFijos = r2(fijos[k] ?? 0);
    const utilidad = r2(contribucion - costosFijos);
    const conLitros = vs.filter((v) => v.litros > 0);
    const litros = suma(conLitros, (v) => v.litros);
    const kmConLitros = suma(conLitros, (v) => v.kmVacio + v.kmCargado);
    const conTeoricos = conLitros.filter((v) => v.litrosTeoricos);
    const kmTeo = suma(conTeoricos, (v) => v.kmVacio + v.kmCargado);
    const litrosTeo = suma(conTeoricos, (v) => v.litrosTeoricos);
    const kmPorLitro = div(kmConLitros, litros);
    const kmPorLitroEsperado = div(kmTeo, litrosTeo);
    const conDesvio = vs.filter((v) => v.desvios.length > 0).length;
    return {
      clave: k,
      nombre: nombre(k),
      viajes: vs.length,
      km,
      kmVacio: suma(vs, (v) => v.kmVacio),
      ingreso,
      costoVariable,
      contribucion,
      costosFijos,
      utilidad,
      utilidadPorKm: div(utilidad, km),
      margenPct: pct(utilidad, ingreso),
      litros,
      kmPorLitro,
      kmPorLitroEsperado,
      rendimientoVsEsperadoPct:
        kmPorLitro !== null && kmPorLitroEsperado ? Math.round(((kmPorLitro - kmPorLitroEsperado) / kmPorLitroEsperado) * 1000) / 10 : null,
      costoKmVacio: r2((costoVariablePorKm ?? 0) * suma(vs, (v) => v.kmVacio)),
      mermaToneladas: suma(vs, (v) => v.mermaToneladas),
      mermaPesos: suma(vs, (v) => v.mermaPesos),
      kmSinViaje: suma(vs, (v) => Math.max(0, v.kmSinViaje)),
      viajesConDesvio: conDesvio,
      pctViajesConDesvio: pct(conDesvio, vs.length),
      desviosSinMotivo: vs.reduce((s, v) => s + v.desvios.filter((d) => !d.conMotivo).length, 0),
    };
  });
}

// ---------------------------------------------------------------------------
// Cálculo principal
// ---------------------------------------------------------------------------

export interface Alerta {
  tipo: "perdida" | "rendimiento" | "desvio_sin_motivo" | "viaje_abierto" | "sin_tarifa" | "estadia";
  texto: string;
  /** Para enlazar al viaje, si aplica. */
  viajeId?: string;
}

export interface Kpis {
  meses: string[];
  dias: number;
  /** true si el filtro (operador, cliente o ruta) deja fuera los costos fijos. */
  sinCostosFijos: boolean;
  operacion: {
    viajes: number;
    kmTotales: number;
    kmCargados: number;
    kmVacios: number;
    pctKmVacio: number | null;
    toneladas: number;
    unidadesActivas: number;
    viajesPorUnidad: number | null;
    kmPorUnidad: number | null;
    diasEnRuta: number;
    utilizacionPct: number | null;
    kmSinViaje: number;
  };
  diesel: {
    litros: number;
    kmPorLitro: number | null;
    kmPorLitroEsperado: number | null;
    litrosFaltantes: number;
    pesosFaltantes: number;
    costoDiesel: number;
    dieselPorKm: number | null;
    pctDieselSobreCosto: number | null;
  };
  financieros: {
    ingreso: number;
    ingresoPorKm: number | null;
    ingresoPorTonelada: number | null;
    ingresoPorUnidadDia: number | null;
    gastosPorCategoria: Record<string, number>;
    gastosViaje: number;
    pagoOperador: number;
    costoVariable: number;
    costoVariablePorKm: number | null;
    costosEquipo: number;
    costosGenerales: number;
    equipoSinAsignar: number;
    costosFijos: number;
    costoFijoPorUnidadMes: number | null;
    costosPorCategoria: Record<string, number>;
    costoTotal: number;
    costoTotalPorKm: number | null;
    contribucion: number;
    utilidad: number;
    margenPct: number | null;
    utilidadSobreCostoPct: number | null;
    utilidadPorKm: number | null;
    utilidadPorViaje: number | null;
    pctViajesRentables: number | null;
    equilibrioKmMes: number | null;
    equilibrioIngresoMes: number | null;
    costosExcluidos: number;
    costosExcluidosPorCategoria: Record<string, number>;
    viajesSinTarifa: number;
  };
  merma: { toneladas: number; pct: number | null; pesos: number };
  porUnidad: FilaGrupo[];
  porCliente: FilaGrupo[];
  porRuta: FilaGrupo[];
  porOperador: FilaGrupo[];
  porViaje: { id: string; folio: string; ingreso: number | null; utilidad: number | null; costoKmVacio: number; mermaPesos: number | null }[];
  concentracion: { cliente: string; ingreso: number; pct: number | null }[];
  tiemposPorCliente: {
    cliente: string;
    viajes: number;
    horasCargaPromedio: number | null;
    horasDescargaPromedio: number | null;
    viajesSobreLimite: number;
  }[];
  rutas: {
    ruta: string;
    viajes: number;
    kmCargadoPromedio: number;
    kmVacioPromedio: number;
    toneladasPromedio: number | null;
    tarifaEquilibrio: number | null;
    tarifaReal: number | null;
    casetasPorKm: number | null;
    ureaPorKm: number | null;
  }[];
  alertas: Alerta[];
}

export function calcularKpis(entrada: EntradaKpis, meses: readonly string[], f: Filtros = {}): Kpis {
  const e = { ...entrada, viajes: entrada.viajes.filter((v) => v.estado !== "cancelado") };
  const enPeriodo = new Set(meses);
  const dias = meses.reduce((s, m) => s + diasDelMes(m), 0);
  const delPeriodo = e.viajes.filter(
    (v) =>
      enPeriodo.has(mesDe(v.fechaSalida)) &&
      (f.incluirAbiertos || v.estado === "cerrado") &&
      (!f.unidad || v.unidadId === f.unidad) &&
      (!f.operador || v.operadorId === f.operador) &&
      (!f.cliente || v.clienteId === f.cliente) &&
      (!f.ruta || v.ruta === f.ruta),
  );
  const sinCostosFijos = !!(f.operador || f.cliente || f.ruta);

  // Unidades activas: las activas hoy y las que tuvieron viaje en el mes.
  const todosDelMes = (m: string) =>
    e.viajes.filter((v) => mesDe(v.fechaSalida) === m && (f.incluirAbiertos || v.estado === "cerrado"));
  const unidadesPorMes: Record<string, string[]> = {};
  const kmPorUnidadMes: Record<string, Record<string, number>> = {};
  for (const m of meses) {
    const vs = todosDelMes(m);
    unidadesPorMes[m] = [...new Set([...e.unidades.filter((u) => u.activa).map((u) => u.id), ...vs.map((v) => v.unidadId)])];
    kmPorUnidadMes[m] = {};
    for (const v of vs) kmPorUnidadMes[m][v.unidadId] = (kmPorUnidadMes[m][v.unidadId] ?? 0) + v.kmVacio + v.kmCargado;
  }
  const asignacion = asignarCostos({
    costos: e.costos,
    armados: e.armados,
    incluir: e.incluirCategoria,
    unidadesPorMes,
    kmPorUnidadMes,
    metodo: e.metodoProrrateo,
  });

  // Costos fijos por unidad del periodo (equipo + generales prorrateados).
  const fijosPorUnidad: Record<string, number> = {};
  const costosPorCategoria: Record<string, number> = {};
  const excluidosPorCategoria: Record<string, number> = {};
  let costosEquipo = 0;
  let costosGenerales = 0;
  let sinAsignar = 0;
  let excluidos = 0;
  const nombreCat = (id: string) => e.nombreCategoriaCosto[id] ?? id;
  const agregarCat = (destino: Record<string, number>, porCategoria: Record<string, number>) => {
    for (const [c, monto] of Object.entries(porCategoria)) destino[nombreCat(c)] = r2((destino[nombreCat(c)] ?? 0) + monto);
  };
  for (const m of meses) {
    const a = asignacion[m];
    if (!a) continue;
    excluidos = r2(excluidos + a.excluidos.total);
    agregarCat(excluidosPorCategoria, a.excluidos.porCategoria);
    for (const [u, b] of Object.entries(a.porUnidad)) {
      if (f.unidad && u !== f.unidad) continue;
      fijosPorUnidad[u] = r2((fijosPorUnidad[u] ?? 0) + b.total);
      costosEquipo = r2(costosEquipo + b.total);
      agregarCat(costosPorCategoria, b.porCategoria);
    }
    for (const [u, monto] of Object.entries(a.generalesPorUnidad)) {
      if (f.unidad && u !== f.unidad) continue;
      fijosPorUnidad[u] = r2((fijosPorUnidad[u] ?? 0) + monto);
      costosGenerales = r2(costosGenerales + monto);
    }
    if (!f.unidad) {
      // Generales de meses sin unidades a quién prorratear también cuentan para la flotilla.
      costosGenerales = r2(costosGenerales + (Object.keys(a.generalesPorUnidad).length ? 0 : a.generales.total));
      agregarCat(costosPorCategoria, a.generales.porCategoria);
      sinAsignar = r2(sinAsignar + a.sinAsignar.total);
      agregarCat(costosPorCategoria, a.sinAsignar.porCategoria);
    } else if (a.generales.total) {
      // Con filtro de unidad, solo su parte de cada categoría general.
      const parte = (a.generalesPorUnidad[f.unidad] ?? 0) / a.generales.total;
      agregarCat(
        costosPorCategoria,
        Object.fromEntries(Object.entries(a.generales.porCategoria).map(([c, x]) => [c, r2(x * parte)])),
      );
    }
  }
  const costosFijos = sinCostosFijos ? 0 : r2(costosEquipo + costosGenerales + sinAsignar);

  // Operación
  const kmCargados = suma(delPeriodo, (v) => v.kmCargado);
  const kmVacios = suma(delPeriodo, (v) => v.kmVacio);
  const kmTotales = r2(kmCargados + kmVacios);
  const unidadesActivas = f.unidad
    ? 1
    : new Set(meses.flatMap((m) => unidadesPorMes[m] ?? [])).size;
  const diasConViaje = (unidad: string) => {
    const set = new Set<string>();
    for (const v of delPeriodo.filter((x) => x.unidadId === unidad)) {
      let d = Date.parse(`${diaDe(v.fechaSalida)}T12:00:00Z`);
      const fin = Date.parse(`${diaDe(v.fechaLlegada ?? v.fechaSalida)}T12:00:00Z`);
      for (; d <= fin; d += 86_400_000) {
        const dia = new Date(d).toISOString().slice(0, 10);
        if (enPeriodo.has(dia.slice(0, 7))) set.add(dia);
      }
    }
    return set.size;
  };
  const unidadesConViaje = [...new Set(delPeriodo.map((v) => v.unidadId))];
  const utilizacion = unidadesActivas
    ? pct(unidadesConViaje.reduce((s, u) => s + diasConViaje(u), 0), unidadesActivas * dias)
    : null;

  // Diésel
  const conLitros = delPeriodo.filter((v) => v.litros > 0);
  const litros = suma(delPeriodo, (v) => v.litros);
  const kmConLitros = suma(conLitros, (v) => v.kmVacio + v.kmCargado);
  const conTeoricos = conLitros.filter((v) => v.litrosTeoricos);
  const costoDiesel = suma(delPeriodo, (v) => v.costoDiesel);
  // Costo promedio por litro del periodo (el que se paga de verdad); si no hay
  // cargas con pesos, el precio del parámetro.
  const precioLitro = (costoDiesel > 0 ? div(costoDiesel, litros) : null) ?? e.parametros.precioDiesel;
  const litrosFaltantes = suma(conTeoricos, (v) => Math.max(0, v.litros - (v.litrosTeoricos ?? 0)));

  // Financieros
  const ingreso = suma(delPeriodo, (v) => v.ingreso);
  const costoVariable = suma(delPeriodo, (v) => v.costoVariable);
  const costoTotal = r2(costoVariable + costosFijos);
  const contribucion = r2(ingreso - costoVariable);
  const utilidad = r2(ingreso - costoTotal);
  const costoVariablePorKm = div(costoVariable, kmTotales);
  const ingresoPorKm = div(ingreso, kmTotales);
  const fijosMes = costosFijos / Math.max(1, meses.length);
  const margenKm = ingresoPorKm !== null && costoVariablePorKm !== null ? ingresoPorKm - costoVariablePorKm : null;
  const gastosPorCategoria: Record<string, number> = {};
  for (const v of delPeriodo) {
    for (const [c, x] of Object.entries(v.gastosPorCategoria)) gastosPorCategoria[c] = r2((gastosPorCategoria[c] ?? 0) + x);
  }
  const conToneladas = delPeriodo.filter((v) => v.toneladasCargadas !== null && v.toneladasDescargadas !== null);
  const mermaTon = suma(conToneladas, (v) => v.mermaToneladas);

  // Grupos
  const nombreUnidad = (id: string) => e.unidades.find((u) => u.id === id)?.nombre ?? "—";
  const porUnidad = agrupar(delPeriodo, (v) => v.unidadId, nombreUnidad, costoVariablePorKm, sinCostosFijos ? {} : fijosPorUnidad);
  const porCliente = agrupar(delPeriodo, (v) => v.clienteId ?? "sin_cliente", (k) => e.nombres.clientes[k] ?? "Sin cliente", costoVariablePorKm);
  const porRuta = agrupar(delPeriodo, (v) => v.ruta, (k) => k, costoVariablePorKm);
  const porOperador = agrupar(delPeriodo, (v) => v.operadorId, (k) => e.nombres.operadores[k] ?? "—", costoVariablePorKm);
  const porMayorUtilidad = (a: FilaGrupo, b: FilaGrupo) => b.utilidad - a.utilidad;
  porUnidad.sort(porMayorUtilidad);
  // Remolques o dollies sin enganchar el día del costo: línea aparte, al final.
  if (sinAsignar && !sinCostosFijos) {
    porUnidad.push({ ...filaVacia("sin_asignar", "Equipo sin asignar"), costosFijos: sinAsignar, utilidad: -sinAsignar });
  }
  porCliente.sort(porMayorUtilidad);
  porRuta.sort(porMayorUtilidad);
  porOperador.sort((a, b) => (b.rendimientoVsEsperadoPct ?? -Infinity) - (a.rendimientoVsEsperadoPct ?? -Infinity));

  const costoTotalPorKm = div(costoTotal, kmTotales);
  const rutas = porRuta.map((g) => {
    const vs = delPeriodo.filter((v) => v.ruta === g.clave);
    const conTon = vs.filter((v) => v.toneladasFacturadas);
    const conTarifa = vs.filter((v) => v.tarifaPorTonelada !== null);
    const kmC = suma(vs, (v) => v.kmCargado) / vs.length;
    const kmV = suma(vs, (v) => v.kmVacio) / vs.length;
    const tonProm = conTon.length ? suma(conTon, (v) => v.toneladasFacturadas) / conTon.length : null;
    const gasto = (patron: RegExp) =>
      suma(vs, (v) => Object.entries(v.gastosPorCategoria).reduce((s, [c, x]) => s + (patron.test(c) ? x : 0), 0));
    return {
      ruta: g.clave,
      viajes: vs.length,
      kmCargadoPromedio: r2(kmC),
      kmVacioPromedio: r2(kmV),
      toneladasPromedio: tonProm === null ? null : r2(tonProm),
      // Tarifa mínima por tonelada para no perder: (km cargado + km vacío promedio) × costo total/km ÷ toneladas promedio.
      tarifaEquilibrio: tonProm && costoTotalPorKm !== null ? r2(((kmC + kmV) * costoTotalPorKm) / tonProm) : null,
      tarifaReal: conTarifa.length ? r2(suma(conTarifa, (v) => v.tarifaPorTonelada) / conTarifa.length) : null,
      casetasPorKm: div(gasto(/caseta/i), g.km),
      ureaPorKm: div(gasto(/urea/i), g.km),
    };
  });

  const limite = e.parametros.horasLimiteEstadia;
  const tiemposPorCliente = porCliente.map((g) => {
    const vs = delPeriodo.filter((v) => (v.clienteId ?? "sin_cliente") === g.clave);
    const hc = vs.map((v) => horas(v.llegadaCarga, v.salidaCarga)).filter((x): x is number => x !== null);
    const hd = vs.map((v) => horas(v.llegadaDescarga, v.salidaDescarga)).filter((x): x is number => x !== null);
    const prom = (xs: number[]) => (xs.length ? Math.round((xs.reduce((s, x) => s + x, 0) / xs.length) * 10) / 10 : null);
    return {
      cliente: g.nombre,
      viajes: vs.length,
      horasCargaPromedio: prom(hc),
      horasDescargaPromedio: prom(hd),
      viajesSobreLimite: vs.filter((v) => (horas(v.llegadaCarga, v.salidaCarga) ?? 0) > limite || (horas(v.llegadaDescarga, v.salidaDescarga) ?? 0) > limite).length,
    };
  });

  // Alertas
  const alertas: Alerta[] = [];
  for (const v of delPeriodo) {
    if (v.ingreso === null) alertas.push({ tipo: "sin_tarifa", texto: `Viaje ${v.folio} sin tarifa`, viajeId: v.id });
    else if (v.ingreso - v.costoVariable < 0) {
      alertas.push({ tipo: "perdida", texto: `Viaje ${v.folio} con pérdida de ${r2(v.costoVariable - v.ingreso).toLocaleString("es-MX")} pesos`, viajeId: v.id });
    }
    const sinMotivo = v.desvios.filter((d) => !d.conMotivo).length;
    if (sinMotivo) alertas.push({ tipo: "desvio_sin_motivo", texto: `Viaje ${v.folio}: desvío de ruta sin motivo`, viajeId: v.id });
    const hc = horas(v.llegadaCarga, v.salidaCarga);
    const hd = horas(v.llegadaDescarga, v.salidaDescarga);
    if ((hc ?? 0) > limite || (hd ?? 0) > limite) {
      alertas.push({
        tipo: "estadia",
        texto: `Viaje ${v.folio}: ${Math.round(Math.max(hc ?? 0, hd ?? 0) * 10) / 10} h en ${(hc ?? 0) > (hd ?? 0) ? "carga" : "descarga"} (límite ${limite} h)`,
        viajeId: v.id,
      });
    }
  }
  for (const g of porUnidad) {
    if (g.rendimientoVsEsperadoPct !== null && g.rendimientoVsEsperadoPct < -e.parametros.toleranciaPct) {
      alertas.push({ tipo: "rendimiento", texto: `${g.nombre}: ${g.kmPorLitro?.toFixed(2)} km/l contra ${g.kmPorLitroEsperado?.toFixed(2)} esperado (${g.rendimientoVsEsperadoPct}%)` });
    }
  }
  // Viajes abiertos con muchos días: todos los abiertos, no solo los del periodo.
  const ahora = Date.parse(e.ahora);
  for (const v of e.viajes) {
    if (v.estado !== "abierto" || (f.unidad && v.unidadId !== f.unidad)) continue;
    const diasAbierto = Math.floor((ahora - Date.parse(v.fechaSalida)) / 86_400_000);
    if (diasAbierto > e.parametros.diasAlertaViajeAbierto) {
      alertas.push({ tipo: "viaje_abierto", texto: `Viaje ${v.folio} abierto desde hace ${diasAbierto} días`, viajeId: v.id });
    }
  }

  return {
    meses: [...meses],
    dias,
    sinCostosFijos,
    operacion: {
      viajes: delPeriodo.length,
      kmTotales,
      kmCargados,
      kmVacios,
      pctKmVacio: pct(kmVacios, kmTotales),
      toneladas: suma(delPeriodo, (v) => v.toneladasCargadas),
      unidadesActivas,
      viajesPorUnidad: div(delPeriodo.length, unidadesActivas),
      kmPorUnidad: div(kmTotales, unidadesActivas),
      diasEnRuta: r2(suma(delPeriodo.filter((v) => v.fechaLlegada), (v) => (Date.parse(v.fechaLlegada!) - Date.parse(v.fechaSalida)) / 86_400_000)),
      utilizacionPct: utilizacion,
      kmSinViaje: suma(delPeriodo, (v) => Math.max(0, v.kmSinViaje)),
    },
    diesel: {
      litros,
      kmPorLitro: div(kmConLitros, suma(conLitros, (v) => v.litros)),
      kmPorLitroEsperado: div(suma(conTeoricos, (v) => v.kmVacio + v.kmCargado), suma(conTeoricos, (v) => v.litrosTeoricos)),
      litrosFaltantes,
      pesosFaltantes: r2(litrosFaltantes * (precioLitro ?? 0)),
      costoDiesel,
      dieselPorKm: div(costoDiesel, kmTotales),
      pctDieselSobreCosto: pct(costoDiesel, costoTotal),
    },
    financieros: {
      ingreso,
      ingresoPorKm,
      ingresoPorTonelada: div(ingreso, suma(delPeriodo, (v) => v.toneladasFacturadas)),
      ingresoPorUnidadDia: div(ingreso, unidadesActivas * dias),
      gastosPorCategoria,
      gastosViaje: suma(delPeriodo, (v) => v.gastosViaje),
      pagoOperador: suma(delPeriodo, (v) => v.pagoOperador),
      costoVariable,
      costoVariablePorKm,
      costosEquipo: sinCostosFijos ? 0 : costosEquipo,
      costosGenerales: sinCostosFijos ? 0 : costosGenerales,
      equipoSinAsignar: sinCostosFijos ? 0 : sinAsignar,
      costosFijos,
      costoFijoPorUnidadMes: sinCostosFijos ? null : div(costosEquipo + costosGenerales, unidadesActivas * meses.length),
      costosPorCategoria: sinCostosFijos ? {} : costosPorCategoria,
      costoTotal,
      costoTotalPorKm,
      contribucion,
      utilidad,
      margenPct: pct(utilidad, ingreso),
      utilidadSobreCostoPct: pct(utilidad, costoTotal),
      utilidadPorKm: div(utilidad, kmTotales),
      utilidadPorViaje: div(utilidad, delPeriodo.length),
      pctViajesRentables: pct(delPeriodo.filter((v) => v.ingreso !== null && v.ingreso - v.costoVariable > 0).length, delPeriodo.length),
      // Punto de equilibrio: costos fijos del mes ÷ lo que deja cada km (ingreso/km − costo variable/km).
      equilibrioKmMes: !sinCostosFijos && margenKm && margenKm > 0 ? Math.round(fijosMes / margenKm) : null,
      equilibrioIngresoMes: !sinCostosFijos && ingreso > costoVariable ? r2(fijosMes / (1 - costoVariable / ingreso)) : null,
      costosExcluidos: excluidos,
      costosExcluidosPorCategoria: excluidosPorCategoria,
      viajesSinTarifa: delPeriodo.filter((v) => v.ingreso === null).length,
    },
    merma: {
      toneladas: mermaTon,
      pct: pct(mermaTon, suma(conToneladas, (v) => v.toneladasCargadas)),
      pesos: suma(delPeriodo, (v) => v.mermaPesos),
    },
    porUnidad,
    porCliente,
    porRuta,
    porOperador,
    porViaje: delPeriodo
      .map((v) => ({
        id: v.id,
        folio: v.folio,
        ingreso: v.ingreso,
        utilidad: v.ingreso === null ? null : r2(v.ingreso - v.costoVariable),
        costoKmVacio: r2((costoVariablePorKm ?? 0) * v.kmVacio),
        mermaPesos: v.mermaPesos,
      }))
      .sort((a, b) => (a.utilidad ?? Infinity) - (b.utilidad ?? Infinity)),
    concentracion: porCliente
      .map((g) => ({ cliente: g.nombre, ingreso: g.ingreso, pct: pct(g.ingreso, ingreso) }))
      .sort((a, b) => b.ingreso - a.ingreso),
    tiemposPorCliente,
    rutas,
    alertas,
  };
}

function filaVacia(clave: string, nombre: string): FilaGrupo {
  return {
    clave,
    nombre,
    viajes: 0,
    km: 0,
    kmVacio: 0,
    ingreso: 0,
    costoVariable: 0,
    contribucion: 0,
    costosFijos: 0,
    utilidad: 0,
    utilidadPorKm: null,
    margenPct: null,
    litros: 0,
    kmPorLitro: null,
    kmPorLitroEsperado: null,
    rendimientoVsEsperadoPct: null,
    costoKmVacio: 0,
    mermaToneladas: 0,
    mermaPesos: 0,
    kmSinViaje: 0,
    viajesConDesvio: 0,
    pctViajesConDesvio: null,
    desviosSinMotivo: 0,
  };
}

/** Tendencia mes a mes (mismos filtros): costo total/km, utilidad y km/l. */
export function tendencia(e: EntradaKpis, meses: readonly string[], f: Filtros = {}) {
  return meses.map((m) => {
    const k = calcularKpis(e, [m], f);
    return {
      mes: m,
      viajes: k.operacion.viajes,
      costoTotalPorKm: k.financieros.costoTotalPorKm,
      costoVariablePorKm: k.financieros.costoVariablePorKm,
      utilidad: k.financieros.utilidad,
      kmPorLitro: k.diesel.kmPorLitro,
    };
  });
}

/** Variación % contra el periodo anterior (null si no hay base). */
export function variacion(actual: number | null, anterior: number | null): number | null {
  if (actual === null || anterior === null || anterior === 0) return null;
  return Math.round(((actual - anterior) / Math.abs(anterior)) * 1000) / 10;
}
