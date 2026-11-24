/**
 * Catálogo de indicadores del tablero: nombre, fórmula en palabras, formato y
 * si un número menor es mejor. Lo usan la pantalla y la exportación a Excel.
 */
import type { FilaGrupo, Kpis } from "./index";

export type Formato = "pesos" | "numero" | "decimal" | "pct";

export interface Indicador {
  nombre: string;
  formula: string;
  formato: Formato;
  valor: (k: Kpis) => number | null;
  /** Para colorear la variación contra el periodo anterior. */
  menorEsMejor?: boolean;
  /** Se oculta si el filtro deja fuera los costos fijos. */
  usaCostosFijos?: boolean;
  /** Pesos del negocio: solo con "ve utilidades" (el tablero operativo no lo muestra). */
  financiero?: boolean;
}

export const GRUPOS_INDICADORES: { titulo: string; indicadores: Indicador[] }[] = [
  {
    titulo: "Operación",
    indicadores: [
      { nombre: "Viajes", formula: "Viajes con salida en el periodo", formato: "numero", valor: (k) => k.operacion.viajes },
      { nombre: "Km totales", formula: "Km cargados + km vacíos (odómetros de los tramos)", formato: "numero", valor: (k) => k.operacion.kmTotales },
      { nombre: "Km cargados", formula: "Σ km del tramo cargado", formato: "numero", valor: (k) => k.operacion.kmCargados },
      { nombre: "Km vacíos", formula: "Σ km del tramo vacío", formato: "numero", valor: (k) => k.operacion.kmVacios, menorEsMejor: true },
      { nombre: "% km vacío", formula: "Km vacíos ÷ km totales", formato: "pct", valor: (k) => k.operacion.pctKmVacio, menorEsMejor: true },
      { nombre: "Toneladas", formula: "Σ toneladas cargadas", formato: "decimal", valor: (k) => k.operacion.toneladas },
      { nombre: "Viajes por unidad", formula: "Viajes ÷ unidades activas", formato: "decimal", valor: (k) => k.operacion.viajesPorUnidad },
      { nombre: "Km por unidad", formula: "Km totales ÷ unidades activas", formato: "numero", valor: (k) => k.operacion.kmPorUnidad },
      { nombre: "Días en ruta", formula: "Σ (fin del viaje − salida), sin viajes importados", formato: "decimal", valor: (k) => k.operacion.diasEnRuta },
      { nombre: "Utilización", formula: "Días con viaje ÷ (unidades activas × días del periodo), sin viajes importados", formato: "pct", valor: (k) => k.operacion.utilizacionPct },
      { nombre: "Km sin viaje", formula: "Σ km entre el odómetro del viaje anterior y el inicial", formato: "numero", valor: (k) => k.operacion.kmSinViaje, menorEsMejor: true },
    ],
  },
  {
    titulo: "Diésel",
    indicadores: [
      { nombre: "Litros", formula: "Σ litros de cargas validadas ligadas a viajes", formato: "numero", valor: (k) => k.diesel.litros },
      { nombre: "Km/l real", formula: "Km ÷ litros (solo viajes con litros)", formato: "decimal", valor: (k) => k.diesel.kmPorLitro },
      { nombre: "Km/l esperado", formula: "Km ÷ litros teóricos (rendimiento de la unidad o de la ruta)", formato: "decimal", valor: (k) => k.diesel.kmPorLitroEsperado },
      { nombre: "Litros faltantes", formula: "Σ máx(0, litros reales − teóricos)", formato: "numero", valor: (k) => k.diesel.litrosFaltantes, menorEsMejor: true },
      { nombre: "Pesos faltantes", formula: "Litros faltantes × costo promedio por litro del periodo (o precio del diésel si no hay)", formato: "pesos", valor: (k) => k.diesel.pesosFaltantes, menorEsMejor: true },
      { nombre: "Costo de diésel", financiero: true, formula: "Σ importe de cargas validadas, sin IVA acreditable si tiene factura", formato: "pesos", valor: (k) => k.diesel.costoDiesel, menorEsMejor: true },
      { nombre: "Diésel por km", financiero: true, formula: "Costo de diésel ÷ km totales", formato: "pesos", valor: (k) => k.diesel.dieselPorKm, menorEsMejor: true },
      { nombre: "% diésel del costo total", financiero: true, formula: "Costo de diésel ÷ costo total", formato: "pct", valor: (k) => k.diesel.pctDieselSobreCosto },
    ],
  },
  {
    titulo: "Financieros",
    indicadores: [
      { financiero: true, nombre: "Ingreso", formula: "Σ flete + cargos adicionales al cliente (sin IVA)", formato: "pesos", valor: (k) => k.financieros.ingreso },
      { financiero: true, nombre: "Ingreso por km", formula: "Ingreso ÷ km totales", formato: "pesos", valor: (k) => k.financieros.ingresoPorKm },
      { financiero: true, nombre: "Ingreso por tonelada", formula: "Ingreso ÷ toneladas facturadas", formato: "pesos", valor: (k) => k.financieros.ingresoPorTonelada },
      { financiero: true, nombre: "Ingreso por unidad por día", formula: "Ingreso ÷ (unidades activas × días del periodo), sin viajes importados", formato: "pesos", valor: (k) => k.financieros.ingresoPorUnidadDia },
      { financiero: true, nombre: "Gastos de viaje", formula: "Σ costo de los gastos (total − IVA acreditable)", formato: "pesos", valor: (k) => k.financieros.gastosViaje, menorEsMejor: true },
      { financiero: true, nombre: "Pago al operador", formula: "Σ pago de cada viaje según su esquema", formato: "pesos", valor: (k) => k.financieros.pagoOperador, menorEsMejor: true },
      { financiero: true, nombre: "Costo variable", formula: "Diésel + gastos de viaje + pago al operador", formato: "pesos", valor: (k) => k.financieros.costoVariable, menorEsMejor: true },
      { financiero: true, nombre: "Costo variable por km", formula: "Costo variable ÷ km totales", formato: "pesos", valor: (k) => k.financieros.costoVariablePorKm, menorEsMejor: true },
      { financiero: true, nombre: "Costos de equipo", formula: "Costos de tractos, remolques y dollies del periodo", formato: "pesos", valor: (k) => k.financieros.costosEquipo, menorEsMejor: true, usaCostosFijos: true },
      { financiero: true, nombre: "Costos generales", formula: "Oficina, contador, renta… prorrateados", formato: "pesos", valor: (k) => k.financieros.costosGenerales, menorEsMejor: true, usaCostosFijos: true },
      { financiero: true, nombre: "Equipo sin asignar", formula: "Costos de remolques o dollies no enganchados ese día", formato: "pesos", valor: (k) => k.financieros.equipoSinAsignar, menorEsMejor: true, usaCostosFijos: true },
      { financiero: true, nombre: "Costo fijo por unidad al mes", formula: "(Costos de equipo + generales) ÷ unidades activas ÷ meses", formato: "pesos", valor: (k) => k.financieros.costoFijoPorUnidadMes, menorEsMejor: true, usaCostosFijos: true },
      { financiero: true, nombre: "Costo total", formula: "Costo variable + costos fijos", formato: "pesos", valor: (k) => k.financieros.costoTotal, menorEsMejor: true },
      { financiero: true, nombre: "Costo total por km", formula: "Costo total ÷ km totales", formato: "pesos", valor: (k) => k.financieros.costoTotalPorKm, menorEsMejor: true },
      { financiero: true, nombre: "Utilidad", formula: "Ingreso − costo total", formato: "pesos", valor: (k) => k.financieros.utilidad },
      { financiero: true, nombre: "Margen %", formula: "Utilidad ÷ ingreso", formato: "pct", valor: (k) => k.financieros.margenPct },
      { financiero: true, nombre: "Utilidad sobre costo %", formula: "Utilidad ÷ costo total", formato: "pct", valor: (k) => k.financieros.utilidadSobreCostoPct },
      { financiero: true, nombre: "Utilidad por km", formula: "Utilidad ÷ km totales", formato: "pesos", valor: (k) => k.financieros.utilidadPorKm },
      { financiero: true, nombre: "Utilidad por viaje", formula: "Utilidad ÷ viajes", formato: "pesos", valor: (k) => k.financieros.utilidadPorViaje },
      { financiero: true, nombre: "% viajes rentables", formula: "Viajes con ingreso > costo variable ÷ viajes", formato: "pct", valor: (k) => k.financieros.pctViajesRentables },
      { financiero: true, nombre: "Equilibrio: km al mes", formula: "Costos fijos del mes ÷ (ingreso/km − costo variable/km)", formato: "numero", valor: (k) => k.financieros.equilibrioKmMes, usaCostosFijos: true },
      { financiero: true, nombre: "Equilibrio: ingreso al mes", formula: "Costos fijos del mes ÷ (1 − costo variable ÷ ingreso)", formato: "pesos", valor: (k) => k.financieros.equilibrioIngresoMes, usaCostosFijos: true },
      { financiero: true, nombre: "Merma (toneladas)", formula: "Σ toneladas cargadas − descargadas", formato: "decimal", valor: (k) => k.merma.toneladas, menorEsMejor: true },
      { financiero: true, nombre: "Merma %", formula: "Merma ÷ toneladas cargadas", formato: "pct", valor: (k) => k.merma.pct, menorEsMejor: true },
      { financiero: true, nombre: "Merma en pesos", formula: "Merma × tarifa del viaje", formato: "pesos", valor: (k) => k.merma.pesos, menorEsMejor: true },
    ],
  },
];

/** Los indicadores principales para las tarjetas de arriba. */
export const PRINCIPALES = [
  "Viajes",
  "Km totales",
  "% km vacío",
  "Ingreso",
  "Costo total por km",
  "Costo variable por km",
  "Utilidad",
  "Margen %",
  "Utilidad sobre costo %",
  "Km/l real",
  "Pesos faltantes",
  "Utilización",
];

export const TODOS_LOS_INDICADORES = GRUPOS_INDICADORES.flatMap((g) => g.indicadores);

/** Columnas de los rankings. */
export const COLUMNAS_RANKING: { nombre: string; formato: Formato; valor: (g: FilaGrupo) => number | null; financiero?: boolean }[] = [
  { nombre: "Viajes", formato: "numero", valor: (g) => g.viajes },
  { nombre: "Km", formato: "numero", valor: (g) => g.km },
  { nombre: "Ingreso", formato: "pesos", valor: (g) => g.ingreso, financiero: true },
  { nombre: "Costo variable", formato: "pesos", valor: (g) => g.costoVariable, financiero: true },
  { nombre: "Costos fijos", formato: "pesos", valor: (g) => g.costosFijos, financiero: true },
  { nombre: "Utilidad", formato: "pesos", valor: (g) => g.utilidad, financiero: true },
  { nombre: "Utilidad/km", formato: "pesos", valor: (g) => g.utilidadPorKm, financiero: true },
  { nombre: "Margen %", formato: "pct", valor: (g) => g.margenPct, financiero: true },
  { nombre: "Km/l", formato: "decimal", valor: (g) => g.kmPorLitro },
  { nombre: "Km/l esperado", formato: "decimal", valor: (g) => g.kmPorLitroEsperado },
  { nombre: "Km/l vs esperado", formato: "pct", valor: (g) => g.rendimientoVsEsperadoPct },
  { nombre: "Costo km vacío", formato: "pesos", valor: (g) => g.costoKmVacio, financiero: true },
  { nombre: "Merma (t)", formato: "decimal", valor: (g) => g.mermaToneladas },
  { nombre: "Merma $", formato: "pesos", valor: (g) => g.mermaPesos, financiero: true },
  { nombre: "Km sin viaje", formato: "numero", valor: (g) => g.kmSinViaje },
  { nombre: "% viajes con desvío", formato: "pct", valor: (g) => g.pctViajesConDesvio },
];

/** Indicadores que ve cada quien: el tablero operativo deja fuera los pesos del negocio. */
export function indicadoresVisibles(financiero: boolean, sinCostosFijos: boolean): Indicador[] {
  return TODOS_LOS_INDICADORES.filter((i) => (financiero || !i.financiero) && !(sinCostosFijos && i.usaCostosFijos));
}

export const columnasRanking = (financiero: boolean) => COLUMNAS_RANKING.filter((c) => financiero || !c.financiero);
