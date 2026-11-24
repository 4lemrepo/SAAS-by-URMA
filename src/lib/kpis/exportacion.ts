/** Hojas del Excel del tablero: resumen con comparación, rankings, rutas, alertas y tendencia. */
import { columnasRanking, indicadoresVisibles } from "./indicadores";
import { esAlertaOperativa, variacion, type FilaGrupo, type Kpis, type tendencia } from "./index";

export type Celda = string | number | null;
export interface Hoja {
  nombre: string;
  filas: Celda[][];
}

const ranking = (nombre: string, grupos: FilaGrupo[], financiero: boolean): Hoja => {
  const columnas = columnasRanking(financiero);
  return { nombre, filas: [["Nombre", ...columnas.map((c) => c.nombre)], ...grupos.map((g) => [g.nombre, ...columnas.map((c) => c.valor(g))])] };
};

/**
 * `financiero` false (sin "ve utilidades"): solo lo operativo, sin ingreso,
 * costos ni utilidad, igual que la pantalla.
 */
export function hojasTablero(k: Kpis, anterior: Kpis, tend: ReturnType<typeof tendencia>, titulo: string, financiero = true): Hoja[] {
  const indicadores = indicadoresVisibles(financiero, k.sinCostosFijos);
  if (!financiero) {
    return [
      {
        nombre: "Resumen",
        filas: [
          [titulo],
          ["Indicador", "Periodo", "Periodo anterior", "Variación %", "Fórmula"],
          ...indicadores.map((i) => [i.nombre, i.valor(k), i.valor(anterior), variacion(i.valor(k), i.valor(anterior)), i.formula]),
        ],
      },
      ranking("Unidades", k.porUnidad, false),
      ranking("Clientes", k.porCliente, false),
      ranking("Rutas", k.porRuta, false),
      ranking("Operadores", k.porOperador, false),
      {
        nombre: "Clientes: tiempos",
        filas: [
          ["Cliente", "Viajes", "Horas en carga (prom.)", "Horas en descarga (prom.)", "Viajes sobre el límite"],
          ...k.tiemposPorCliente.map((t) => [t.cliente, t.viajes, t.horasCargaPromedio, t.horasDescargaPromedio, t.viajesSobreLimite]),
        ],
      },
      { nombre: "Alertas", filas: [["Tipo", "Detalle"], ...k.alertas.filter(esAlertaOperativa).map((a) => [a.tipo, a.texto])] },
      { nombre: "Tendencia", filas: [["Mes", "Viajes", "Km/l"], ...tend.map((t) => [t.mes, t.viajes, t.kmPorLitro])] },
    ];
  }
  return [
    {
      nombre: "Resumen",
      filas: [
        [titulo],
        ["Indicador", "Periodo", "Periodo anterior", "Variación %", "Fórmula"],
        ...indicadores.map((i) => [i.nombre, i.valor(k), i.valor(anterior), variacion(i.valor(k), i.valor(anterior)), i.formula]),
        [],
        ["Costos registrados que no entran en la rentabilidad", k.financieros.costosExcluidos],
        ...Object.entries(k.financieros.costosExcluidosPorCategoria).map(([c, x]) => [`  ${c}`, x]),
      ],
    },
    {
      nombre: "Gastos y costos",
      filas: [
        ["Gastos de viaje por categoría", "Monto"],
        ...Object.entries(k.financieros.gastosPorCategoria).map(([c, x]) => [c, x]),
        [],
        ["Costos fijos por categoría", "Monto"],
        ...Object.entries(k.financieros.costosPorCategoria).map(([c, x]) => [c, x]),
      ],
    },
    ranking("Unidades", k.porUnidad, true),
    ranking("Clientes", k.porCliente, true),
    ranking("Rutas", k.porRuta, true),
    ranking("Operadores", k.porOperador, true),
    {
      nombre: "Tarifas por ruta",
      filas: [
        ["Ruta", "Viajes", "Km cargado prom.", "Km vacío prom.", "Toneladas prom.", "Tarifa de equilibrio $/t", "Tarifa real $/t", "Casetas/km", "Urea/km"],
        ...k.rutas.map((r) => [r.ruta, r.viajes, r.kmCargadoPromedio, r.kmVacioPromedio, r.toneladasPromedio, r.tarifaEquilibrio, r.tarifaReal, r.casetasPorKm, r.ureaPorKm]),
      ],
    },
    {
      nombre: "Clientes: tiempos",
      filas: [
        ["Cliente", "Viajes", "Horas en carga (prom.)", "Horas en descarga (prom.)", "Viajes sobre el límite", "% del ingreso"],
        ...k.tiemposPorCliente.map((t) => [t.cliente, t.viajes, t.horasCargaPromedio, t.horasDescargaPromedio, t.viajesSobreLimite, k.concentracion.find((c) => c.cliente === t.cliente)?.pct ?? null]),
      ],
    },
    { nombre: "Alertas", filas: [["Tipo", "Detalle"], ...k.alertas.map((a) => [a.tipo, a.texto])] },
    {
      nombre: "Tendencia",
      filas: [["Mes", "Viajes", "Costo total/km", "Costo variable/km", "Utilidad", "Km/l"], ...tend.map((t) => [t.mes, t.viajes, t.costoTotalPorKm, t.costoVariablePorKm, t.utilidad, t.kmPorLitro])],
    },
  ];
}
