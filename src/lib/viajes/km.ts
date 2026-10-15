/**
 * Kilómetros de un tramo del viaje contra los de su ruta del catálogo. Los km
 * se prellenan desde la ruta y siempre son editables; si se desvían más que la
 * tolerancia de la empresa (parametros_empresa.tolerancia_km_pct), el viaje se
 * marca para revisión.
 */
export interface RevisionKm {
  /** Desviación en % respecto a la ruta (positivo = más km). null si no hay con qué comparar. */
  desviacionPct: number | null;
  revisar: boolean;
}

export function revisarKm(kmCapturado: number | null, kmRuta: number | null, toleranciaPct: number): RevisionKm {
  if (kmCapturado === null || kmRuta === null || kmRuta <= 0) return { desviacionPct: null, revisar: false };
  const desviacionPct = Math.round(((kmCapturado - kmRuta) / kmRuta) * 1000) / 10;
  return { desviacionPct, revisar: Math.abs(desviacionPct) > toleranciaPct };
}
