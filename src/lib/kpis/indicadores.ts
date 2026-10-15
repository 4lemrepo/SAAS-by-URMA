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
      { nombre: "Días en ruta", formula: "Σ (fin del viaje − salida)", formato: "decimal", valor: (k) => k.operacion.diasEnRuta },
      { nombre: "Utilización", formula: "Días con viaje ÷ (unidades activas × días del periodo)", formato: "pct", valor: (k) => k.operacion.utilizacionPct },
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
      { nombre: "Pesos faltantes", formula: "Litros faltantes × precio del diésel", formato: "pesos", valor: (k) => k.diesel.pesosFaltantes, menorEsMejor: true },
      { nombre: "Costo de diésel", formula: "Σ importe de cargas validadas", formato: "pesos", valor: (k) => k.diesel.costoDiesel, menorEsMejor: true },
      { nombre: "Diésel por km", formula: "Costo de diésel ÷ km totales", formato: "pesos", valor: (k) => k.diesel.dieselPorKm, menorEsMejor: true },
      { nombre: "% diésel del costo total", formula: "Costo de diésel ÷ costo total", formato: "pct", valor: (k) => k.diesel.pctDieselSobreCosto },
    ],
  },
  {
    titulo: "Financieros",
    indicadores: [
      { nombre: "Ingreso", formula: "Σ flete + gastos facturados al cliente (sin impuestos)", formato: "pesos", valor: (k) => k.financieros.ingreso },
      { nombre: "Ingreso por km", formula: "Ingreso ÷ km totales", formato: "pesos", valor: (k) => k.financieros.ingresoPorKm },
      { nombre: "Ingreso por tonelada", formula: "Ingreso ÷ toneladas facturadas", formato: "pesos", valor: (k) => k.financieros.ingresoPorTonelada },
      { nombre: "Ingreso por unidad por día", formula: "Ingreso ÷ (unidades activas × días del periodo)", formato: "pesos", valor: (k) => k.financieros.ingresoPorUnidadDia },
      { nombre: "Gastos de viaje", formula: "Σ gastos (propios y facturados)", formato: "pesos", valor: (k) => k.financieros.gastosViaje, menorEsMejor: true },
      { nombre: "Pago al operador", formula: "Σ pago de cada viaje según su esquema", formato: "pesos", valor: (k) => k.financieros.pagoOperador, menorEsMejor: true },
      { nombre: "Costo variable", formula: "Diésel + gastos de viaje + pago al operador", formato: "pesos", valor: (k) => k.financieros.costoVariable, menorEsMejor: true },
      { nombre: "Costo variable por km", formula: "Costo variable ÷ km totales", formato: "pesos", valor: (k) => k.financieros.costoVariablePorKm, menorEsMejor: true },
      { nombre: "Costos de equipo", formula: "Costos de tractos, remolques y dollies del periodo", formato: "pesos", valor: (k) => k.financieros.costosEquipo, menorEsMejor: true, usaCostosFijos: true },
      { nombre: "Costos generales", formula: "Oficina, contador, renta… prorrateados", formato: "pesos", valor: (k) => k.financieros.costosGenerales, menorEsMejor: true, usaCostosFijos: true },
      { nombre: "Equipo sin asignar", formula: "Costos de remolques o dollies no enganchados ese día", formato: "pesos", valor: (k) => k.financieros.equipoSinAsignar, menorEsMejor: true, usaCostosFijos: true },
      { nombre: "Costo fijo por unidad al mes", formula: "(Costos de equipo + generales) ÷ unidades activas ÷ meses", formato: "pesos", valor: (k) => k.financieros.costoFijoPorUnidadMes, menorEsMejor: true, usaCostosFijos: true },
      { nombre: "Costo total", formula: "Costo variable + costos fijos", formato: "pesos", valor: (k) => k.financieros.costoTotal, menorEsMejor: true },
      { nombre: "Costo total por km", formula: "Costo total ÷ km totales", formato: "pesos", valor: (k) => k.financieros.costoTotalPorKm, menorEsMejor: true },
      { nombre: "Utilidad", formula: "Ingreso − costo total", formato: "pesos", valor: (k) => k.financieros.utilidad },
      { nombre: "Margen %", formula: "Utilidad ÷ ingreso", formato: "pct", valor: (k) => k.financieros.margenPct },
      { nombre: "Utilidad sobre costo %", formula: "Utilidad ÷ costo total", formato: "pct", valor: (k) => k.financieros.utilidadSobreCostoPct },
      { nombre: "Utilidad por km", formula: "Utilidad ÷ km totales", formato: "pesos", valor: (k) => k.financieros.utilidadPorKm },
      { nombre: "Utilidad por viaje", formula: "Utilidad ÷ viajes", formato: "pesos", valor: (k) => k.financieros.utilidadPorViaje },
      { nombre: "% viajes rentables", formula: "Viajes con ingreso > costo variable ÷ viajes", formato: "pct", valor: (k) => k.financieros.pctViajesRentables },
      { nombre: "Equilibrio: km al mes", formula: "Costos fijos del mes ÷ (ingreso/km − costo variable/km)", formato: "numero", valor: (k) => k.financieros.equilibrioKmMes, usaCostosFijos: true },
      { nombre: "Equilibrio: ingreso al mes", formula: "Costos fijos del mes ÷ (1 − costo variable ÷ ingreso)", formato: "pesos", valor: (k) => k.financieros.equilibrioIngresoMes, usaCostosFijos: true },
      { nombre: "Merma (toneladas)", formula: "Σ toneladas cargadas − descargadas", formato: "decimal", valor: (k) => k.merma.toneladas, menorEsMejor: true },
      { nombre: "Merma %", formula: "Merma ÷ toneladas cargadas", formato: "pct", valor: (k) => k.merma.pct, menorEsMejor: true },
      { nombre: "Merma en pesos", formula: "Merma × tarifa del viaje", formato: "pesos", valor: (k) => k.merma.pesos, menorEsMejor: true },
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
export const COLUMNAS_RANKING: { nombre: string; formato: Formato; valor: (g: FilaGrupo) => number | null }[] = [
  { nombre: "Viajes", formato: "numero", valor: (g) => g.viajes },
  { nombre: "Km", formato: "numero", valor: (g) => g.km },
  { nombre: "Ingreso", formato: "pesos", valor: (g) => g.ingreso },
  { nombre: "Costo variable", formato: "pesos", valor: (g) => g.costoVariable },
  { nombre: "Costos fijos", formato: "pesos", valor: (g) => g.costosFijos },
  { nombre: "Utilidad", formato: "pesos", valor: (g) => g.utilidad },
  { nombre: "Utilidad/km", formato: "pesos", valor: (g) => g.utilidadPorKm },
  { nombre: "Margen %", formato: "pct", valor: (g) => g.margenPct },
  { nombre: "Km/l", formato: "decimal", valor: (g) => g.kmPorLitro },
  { nombre: "Km/l esperado", formato: "decimal", valor: (g) => g.kmPorLitroEsperado },
  { nombre: "Km/l vs esperado", formato: "pct", valor: (g) => g.rendimientoVsEsperadoPct },
  { nombre: "Costo km vacío", formato: "pesos", valor: (g) => g.costoKmVacio },
  { nombre: "Merma (t)", formato: "decimal", valor: (g) => g.mermaToneladas },
  { nombre: "Merma $", formato: "pesos", valor: (g) => g.mermaPesos },
  { nombre: "Km sin viaje", formato: "numero", valor: (g) => g.kmSinViaje },
  { nombre: "% viajes con desvío", formato: "pct", valor: (g) => g.pctViajesConDesvio },
];
