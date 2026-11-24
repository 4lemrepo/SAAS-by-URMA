/**
 * A quién le toca cada costo que no es de un viaje. Pura: la usa el tablero.
 *
 * - Un costo se reparte en `meses` meses a partir de `mes` (seguro anual…).
 * - De un tracto: a esa unidad. De un remolque o dolly: a la unidad que lo
 *   traía enganchado en la fecha del costo (historial de armados); si no
 *   estaba enganchado, a "equipo sin asignar".
 * - Sin equipo: costo general, que se prorratea entre las unidades activas del
 *   mes en partes iguales o por km (Parámetros).
 * - Si la categoría no entra en la rentabilidad, va a "excluidos" (se muestra
 *   aparte y no entra en ningún KPI). Se decide al calcular: cambiar el
 *   interruptor recalcula también meses pasados.
 */

export interface Costo {
  fecha: string; // aaaa-mm-dd
  mes: string; // aaaa-mm-01
  meses: number;
  /** Costo para rentabilidad: total − IVA acreditable. */
  monto: number;
  /** Lo pagado con IVA (para la vista "mostrar con IVA"); si falta, igual que monto. */
  total?: number;
  categoriaId: string;
  unidadId: string | null;
  remolqueId: string | null;
  dollyId: string | null;
  cancelado: boolean;
}

export interface ArmadoHistorico {
  unidadId: string;
  remolque1Id: string;
  dollyId: string | null;
  remolque2Id: string | null;
  desde: string; // ISO
  hasta: string | null; // ISO
}

export type MetodoProrrateo = "partes_iguales" | "km";

export interface Bolsa {
  total: number;
  porCategoria: Record<string, number>;
}

export interface AsignacionMes {
  /** Costos de equipo por unidad (sin generales). */
  porUnidad: Record<string, Bolsa>;
  /** Remolques o dollies que no estaban enganchados en la fecha del costo. */
  sinAsignar: Bolsa;
  generales: Bolsa;
  /** Parte de los generales que le toca a cada unidad. */
  generalesPorUnidad: Record<string, number>;
  /** Categorías que no entran en la rentabilidad (solo informativo). */
  excluidos: Bolsa;
}

const r2 = (n: number) => Math.round(n * 100) / 100;
const vacia = (): Bolsa => ({ total: 0, porCategoria: {} });
function sumar(b: Bolsa, categoria: string, monto: number) {
  b.total = r2(b.total + monto);
  b.porCategoria[categoria] = r2((b.porCategoria[categoria] ?? 0) + monto);
}

/** "2026-10-01" + n meses → "2026-11" … */
export function sumarMeses(mes: string, n: number): string {
  const [a, m] = mes.split("-").map(Number);
  const total = a * 12 + (m - 1) + n;
  return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, "0")}`;
}

/** Reparte el monto en sus meses; el último mes absorbe los centavos. */
export function mesesDelCosto(c: Pick<Costo, "mes" | "meses" | "monto">): { mes: string; monto: number }[] {
  const n = Math.max(1, Math.floor(c.meses));
  const parte = Math.floor((c.monto / n) * 100) / 100;
  return Array.from({ length: n }, (_, i) => ({
    mes: sumarMeses(c.mes, i),
    monto: i === n - 1 ? r2(c.monto - parte * (n - 1)) : parte,
  }));
}

/** Unidad que traía el remolque o dolly a mediodía (hora del centro) de la fecha dada. */
export function unidadQueLoTraia(
  equipo: { remolqueId: string | null; dollyId: string | null },
  fecha: string,
  armados: readonly ArmadoHistorico[],
): string | null {
  const instante = Date.parse(`${fecha.slice(0, 10)}T12:00:00-06:00`);
  const a = armados.find(
    (x) =>
      Date.parse(x.desde) <= instante &&
      (x.hasta === null || instante < Date.parse(x.hasta)) &&
      (equipo.remolqueId ? x.remolque1Id === equipo.remolqueId || x.remolque2Id === equipo.remolqueId : x.dollyId === equipo.dollyId),
  );
  return a?.unidadId ?? null;
}

export function asignarCostos(e: {
  costos: readonly Costo[];
  armados: readonly ArmadoHistorico[];
  /** Categoría → ¿entra en la rentabilidad? (las desconocidas sí entran) */
  incluir: Readonly<Record<string, boolean>>;
  /** Unidades activas de cada mes ("aaaa-mm"). */
  unidadesPorMes: Readonly<Record<string, readonly string[]>>;
  /** km de cada unidad en cada mes (para prorratear por km). */
  kmPorUnidadMes?: Readonly<Record<string, Readonly<Record<string, number>>>>;
  metodo: MetodoProrrateo;
}): Record<string, AsignacionMes> {
  const meses: Record<string, AsignacionMes> = {};
  const delMes = (mes: string) =>
    (meses[mes] ??= { porUnidad: {}, sinAsignar: vacia(), generales: vacia(), generalesPorUnidad: {}, excluidos: vacia() });

  for (const c of e.costos) {
    if (c.cancelado) continue;
    const esEquipo = c.remolqueId || c.dollyId;
    const unidad = c.unidadId ?? (esEquipo ? unidadQueLoTraia(c, c.fecha, e.armados) : null);
    for (const { mes, monto } of mesesDelCosto(c)) {
      const m = delMes(mes);
      if (e.incluir[c.categoriaId] === false) sumar(m.excluidos, c.categoriaId, monto);
      else if (unidad) sumar((m.porUnidad[unidad] ??= vacia()), c.categoriaId, monto);
      else if (esEquipo) sumar(m.sinAsignar, c.categoriaId, monto);
      else sumar(m.generales, c.categoriaId, monto);
    }
  }

  // Prorrateo de generales entre las unidades activas del mes.
  for (const [mes, m] of Object.entries(meses)) {
    const unidades = e.unidadesPorMes[mes] ?? [];
    if (!unidades.length || !m.generales.total) continue;
    const km = e.kmPorUnidadMes?.[mes] ?? {};
    const kmTotal = unidades.reduce((s, u) => s + (km[u] ?? 0), 0);
    const porKm = e.metodo === "km" && kmTotal > 0;
    let repartido = 0;
    unidades.forEach((u, i) => {
      const parte =
        i === unidades.length - 1
          ? r2(m.generales.total - repartido)
          : r2(porKm ? (m.generales.total * (km[u] ?? 0)) / kmTotal : m.generales.total / unidades.length);
      m.generalesPorUnidad[u] = parte;
      repartido = r2(repartido + parte);
    });
  }
  return meses;
}
