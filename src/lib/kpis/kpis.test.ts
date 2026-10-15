// Datos inventados: nunca usar datos reales de clientes en pruebas.
import { describe, expect, it } from "vitest";
import type { Costo } from "@/lib/costos/asignacion";
import { calcularKpis, mesDe, mesesAnteriores, mesesEntre, tendencia, variacion, type EntradaKpis, type ViajeKpi } from "./index";

const viaje = (o: Partial<ViajeKpi>): ViajeKpi => ({
  id: "v",
  folio: "F",
  estado: "cerrado",
  fechaSalida: "2026-10-05T14:00:00Z",
  fechaLlegada: "2026-10-06T14:00:00Z",
  llegadaCarga: null,
  salidaCarga: null,
  llegadaDescarga: null,
  salidaDescarga: null,
  unidadId: "T1",
  operadorId: "O1",
  clienteId: "C1",
  ruta: "A → B",
  kmVacio: 200,
  kmCargado: 800,
  kmSinViaje: 0,
  toneladasCargadas: 40,
  toneladasDescargadas: 39.5,
  toneladasFacturadas: 40,
  tarifaPorTonelada: 1000,
  ingreso: 40_000,
  costoDiesel: 15_000,
  litros: 600,
  litrosTeoricos: 500,
  gastosPorCategoria: { Casetas: 3_000, "Urea (DEF)": 200 },
  gastosViaje: 3_200,
  pagoOperador: 5_040,
  costoVariable: 23_240,
  mermaToneladas: 0.5,
  mermaPesos: 500,
  desvios: [],
  ...o,
});

const costo = (o: Partial<Costo>): Costo => ({
  fecha: "2026-10-10",
  mes: "2026-10-01",
  meses: 1,
  monto: 0,
  categoriaId: "mtto",
  unidadId: null,
  remolqueId: null,
  dollyId: null,
  cancelado: false,
  ...o,
});

const entrada: EntradaKpis = {
  viajes: [
    viaje({ id: "v1", folio: "F1" }),
    viaje({
      id: "v2",
      folio: "F2",
      unidadId: "T2",
      operadorId: "O2",
      clienteId: "C2",
      ruta: "C → D",
      kmVacio: 500,
      kmCargado: 500,
      ingreso: 20_000,
      costoVariable: 25_000,
      costoDiesel: 18_000,
      litros: 800,
      litrosTeoricos: 400,
      mermaToneladas: null,
      mermaPesos: null,
      toneladasDescargadas: null,
      fechaSalida: "2026-10-20T14:00:00Z",
      fechaLlegada: "2026-10-22T14:00:00Z",
      llegadaCarga: "2026-10-20T20:00:00Z",
      salidaCarga: "2026-10-21T06:00:00Z",
      desvios: [{ conMotivo: false }],
      kmSinViaje: 35,
    }),
    // Abierto: no cuenta por defecto
    viaje({ id: "v3", folio: "F3", estado: "abierto", fechaSalida: "2026-10-01T14:00:00Z" }),
    // Otro mes
    viaje({ id: "v4", folio: "F4", fechaSalida: "2026-09-10T14:00:00Z", fechaLlegada: "2026-09-11T14:00:00Z" }),
  ],
  unidades: [
    { id: "T1", nombre: "T1", activa: true },
    { id: "T2", nombre: "T2", activa: true },
  ],
  nombres: { operadores: { O1: "Ana", O2: "Beto" }, clientes: { C1: "Cliente Uno", C2: "Cliente Dos" } },
  costos: [
    costo({ monto: 6_000, unidadId: "T1" }),
    costo({ monto: 2_000, categoriaId: "oficina" }),
    costo({ monto: 9_000, categoriaId: "sueldo", unidadId: "T1" }),
    costo({ monto: 1_000, remolqueId: "R9" }),
  ],
  armados: [],
  incluirCategoria: { sueldo: false },
  nombreCategoriaCosto: { mtto: "Mantenimiento", oficina: "Oficina", sueldo: "Sueldo" },
  metodoProrrateo: "partes_iguales",
  parametros: { toleranciaPct: 5, precioDiesel: 25, diasAlertaViajeAbierto: 5, horasLimiteEstadia: 6 },
  ahora: "2026-10-31T18:00:00Z",
};

describe("periodos", () => {
  it("mes en hora del centro y rangos de meses", () => {
    expect(mesDe("2026-11-01T05:00:00Z")).toBe("2026-10");
    expect(mesesEntre("2026-11", "2027-02")).toEqual(["2026-11", "2026-12", "2027-01", "2027-02"]);
    expect(mesesAnteriores("2026-01", 2)).toEqual(["2025-11", "2025-12"]);
  });
});

describe("calcularKpis (octubre)", () => {
  const k = calcularKpis(entrada, ["2026-10"]);

  it("operación: solo viajes cerrados del periodo", () => {
    expect(k.operacion).toMatchObject({ viajes: 2, kmTotales: 2_000, kmCargados: 1_300, kmVacios: 700, pctKmVacio: 35, toneladas: 80, unidadesActivas: 2 });
    expect(k.operacion.kmSinViaje).toBe(35);
    expect(k.operacion.diasEnRuta).toBe(3);
    // T1: 5 y 6 de oct; T2: 20, 21 y 22 → 5 días con viaje de 2 × 31
    expect(k.operacion.utilizacionPct).toBe(8.1);
  });

  it("diésel: km/l real vs esperado, litros y pesos faltantes", () => {
    expect(k.diesel.kmPorLitro).toBeCloseTo(2000 / 1400);
    expect(k.diesel.kmPorLitroEsperado).toBeCloseTo(2000 / 900);
    expect(k.diesel.litrosFaltantes).toBe(500);
    expect(k.diesel.pesosFaltantes).toBe(12_500);
    expect(k.diesel.dieselPorKm).toBe(16.5);
  });

  it("costo variable, costos fijos (equipo + generales + sin asignar), excluidos aparte", () => {
    expect(k.financieros.costoVariable).toBe(48_240);
    expect(k.financieros.costoVariablePorKm).toBe(24.12);
    expect(k.financieros.costosEquipo).toBe(6_000);
    expect(k.financieros.costosGenerales).toBe(2_000);
    expect(k.financieros.equipoSinAsignar).toBe(1_000);
    expect(k.financieros.costosFijos).toBe(9_000);
    expect(k.financieros.costoTotal).toBe(57_240);
    expect(k.financieros.costoTotalPorKm).toBe(28.62);
    expect(k.financieros.costosExcluidos).toBe(9_000);
    expect(k.financieros.costosExcluidosPorCategoria).toEqual({ Sueldo: 9_000 });
    expect(k.financieros.costoFijoPorUnidadMes).toBe(4_000);
  });

  it("utilidad, margen %, utilidad sobre costo %, % viajes rentables", () => {
    expect(k.financieros.ingreso).toBe(60_000);
    expect(k.financieros.contribucion).toBe(11_760);
    expect(k.financieros.utilidad).toBe(2_760);
    expect(k.financieros.margenPct).toBe(4.6);
    expect(k.financieros.utilidadSobreCostoPct).toBe(4.8);
    expect(k.financieros.pctViajesRentables).toBe(50);
    expect(k.financieros.ingresoPorKm).toBe(30);
    expect(k.financieros.ingresoPorTonelada).toBe(750);
    expect(k.financieros.ingresoPorUnidadDia).toBeCloseTo(60_000 / 62);
  });

  it("punto de equilibrio en km e ingreso al mes", () => {
    // fijos 9 000 ÷ (30 − 24.12) $/km
    expect(k.financieros.equilibrioKmMes).toBe(1531);
    expect(k.financieros.equilibrioIngresoMes).toBeCloseTo(9_000 / (1 - 48_240 / 60_000), 0);
  });

  it("utilidad por unidad con sus costos fijos y su parte de generales", () => {
    const t1 = k.porUnidad.find((g) => g.clave === "T1")!;
    expect(t1).toMatchObject({ contribucion: 16_760, costosFijos: 7_000, utilidad: 9_760 });
    const t2 = k.porUnidad.find((g) => g.clave === "T2")!;
    expect(t2).toMatchObject({ contribucion: -5_000, costosFijos: 1_000, utilidad: -6_000 });
    expect(k.porUnidad.at(-1)).toMatchObject({ nombre: "Equipo sin asignar", utilidad: -1_000 });
    expect(k.porUnidad[0].clave).toBe("T1");
  });

  it("merma, costo del km vacío, concentración y rutas", () => {
    expect(k.merma).toEqual({ toneladas: 0.5, pct: 1.3, pesos: 500 });
    expect(k.porCliente.find((g) => g.clave === "C1")?.costoKmVacio).toBe(4_824);
    expect(k.concentracion[0]).toEqual({ cliente: "Cliente Uno", ingreso: 40_000, pct: 66.7 });
    const ab = k.rutas.find((r) => r.ruta === "A → B")!;
    // (800 + 200) km × 28.62 $/km ÷ 40 t
    expect(ab).toMatchObject({ tarifaEquilibrio: 715.5, tarifaReal: 1_000, casetasPorKm: 3, ureaPorKm: 0.2 });
  });

  it("operadores por km/l contra lo esperado, desvíos y km sin viaje", () => {
    const beto = k.porOperador.find((g) => g.nombre === "Beto")!;
    expect(beto).toMatchObject({ rendimientoVsEsperadoPct: -50, viajesConDesvio: 1, desviosSinMotivo: 1, kmSinViaje: 35 });
    expect(k.porOperador[0].nombre).toBe("Ana");
  });

  it("tiempos en carga por cliente y alertas", () => {
    expect(k.tiemposPorCliente.find((t) => t.cliente === "Cliente Dos")).toMatchObject({ horasCargaPromedio: 10, viajesSobreLimite: 1 });
    const tipos = k.alertas.map((a) => a.tipo).sort();
    expect(tipos).toEqual(["desvio_sin_motivo", "estadia", "perdida", "rendimiento", "rendimiento", "viaje_abierto"]);
  });
});

describe("filtros", () => {
  it("por operador: sin costos fijos (solo contribución)", () => {
    const k = calcularKpis(entrada, ["2026-10"], { operador: "O1" });
    expect(k.sinCostosFijos).toBe(true);
    expect(k.financieros.costosFijos).toBe(0);
    expect(k.financieros.utilidad).toBe(16_760);
  });
  it("por unidad: sus costos y su parte de generales", () => {
    const k = calcularKpis(entrada, ["2026-10"], { unidad: "T2" });
    expect(k.financieros.costosFijos).toBe(1_000);
    expect(k.financieros.utilidad).toBe(-6_000);
  });
  it("incluir abiertos", () => {
    expect(calcularKpis(entrada, ["2026-10"], { incluirAbiertos: true }).operacion.viajes).toBe(3);
  });
});

describe("tendencia y comparación", () => {
  it("mes a mes", () => {
    const t = tendencia(entrada, ["2026-09", "2026-10"]);
    expect(t.map((x) => x.viajes)).toEqual([1, 2]);
    expect(t[1].costoTotalPorKm).toBe(28.62);
  });
  it("variación contra el periodo anterior", () => {
    expect(variacion(110, 100)).toBe(10);
    expect(variacion(-50, -100)).toBe(50);
    expect(variacion(5, 0)).toBeNull();
  });
});
