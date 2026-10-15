import { describe, expect, it } from "vitest";
import { asignarCostos, mesesDelCosto, sumarMeses, unidadQueLoTraia, type ArmadoHistorico, type Costo } from "./asignacion";

const base: Costo = { fecha: "2026-10-05", mes: "2026-10-01", meses: 1, monto: 1000, categoriaId: "llantas", unidadId: null, remolqueId: null, dollyId: null, cancelado: false };
const armados: ArmadoHistorico[] = [
  { unidadId: "T1", remolque1Id: "R1", dollyId: "D1", remolque2Id: "R2", desde: "2026-09-01T00:00:00Z", hasta: "2026-10-10T12:00:00Z" },
  { unidadId: "T2", remolque1Id: "R1", dollyId: null, remolque2Id: null, desde: "2026-10-10T12:00:00Z", hasta: null },
];

describe("mesesDelCosto", () => {
  it("reparte en N meses; el último absorbe los centavos", () => {
    expect(mesesDelCosto({ mes: "2026-11-01", meses: 3, monto: 100 })).toEqual([
      { mes: "2026-11", monto: 33.33 },
      { mes: "2026-12", monto: 33.33 },
      { mes: "2027-01", monto: 33.34 },
    ]);
    expect(sumarMeses("2026-12-01", 1)).toBe("2027-01");
  });
});

describe("unidadQueLoTraia", () => {
  it("la unidad que tenía el remolque o dolly enganchado ese día", () => {
    expect(unidadQueLoTraia({ remolqueId: "R1", dollyId: null }, "2026-10-05", armados)).toBe("T1");
    expect(unidadQueLoTraia({ remolqueId: "R1", dollyId: null }, "2026-10-15", armados)).toBe("T2");
    expect(unidadQueLoTraia({ remolqueId: "R2", dollyId: null }, "2026-10-05", armados)).toBe("T1");
    expect(unidadQueLoTraia({ remolqueId: null, dollyId: "D1" }, "2026-10-05", armados)).toBe("T1");
  });
  it("si no estaba enganchado, a nadie", () => {
    expect(unidadQueLoTraia({ remolqueId: "R2", dollyId: null }, "2026-10-15", armados)).toBeNull();
    expect(unidadQueLoTraia({ remolqueId: "R9", dollyId: null }, "2026-10-05", armados)).toBeNull();
  });
});

describe("asignarCostos", () => {
  const costos: Costo[] = [
    { ...base, unidadId: "T1" },
    { ...base, monto: 500, remolqueId: "R1", fecha: "2026-10-15" },
    { ...base, monto: 300, remolqueId: "R2", fecha: "2026-10-15" },
    { ...base, monto: 1200, categoriaId: "oficina" },
    { ...base, monto: 9000, categoriaId: "sueldo", unidadId: "T1" },
    { ...base, monto: 7777, cancelado: true, unidadId: "T1" },
    { ...base, monto: 12000, meses: 12, categoriaId: "seguro", unidadId: "T2" },
  ];
  const r = asignarCostos({
    costos,
    armados,
    incluir: { sueldo: false },
    unidadesPorMes: { "2026-10": ["T1", "T2", "T3"] },
    kmPorUnidadMes: { "2026-10": { T1: 6000, T2: 3000, T3: 0 } },
    metodo: "partes_iguales",
  })["2026-10"];

  it("tracto directo, remolque a quien lo traía, el resto sin asignar", () => {
    expect(r.porUnidad.T1).toEqual({ total: 1000, porCategoria: { llantas: 1000 } });
    expect(r.porUnidad.T2).toEqual({ total: 1500, porCategoria: { llantas: 500, seguro: 1000 } });
    expect(r.sinAsignar.total).toBe(300);
  });
  it("categorías excluidas aparte; cancelados no cuentan", () => {
    expect(r.excluidos).toEqual({ total: 9000, porCategoria: { sueldo: 9000 } });
  });
  it("generales en partes iguales entre unidades activas", () => {
    expect(r.generales.total).toBe(1200);
    expect(r.generalesPorUnidad).toEqual({ T1: 400, T2: 400, T3: 400 });
  });
  it("generales por km", () => {
    const k = asignarCostos({
      costos: [{ ...base, monto: 900, categoriaId: "oficina" }],
      armados: [],
      incluir: {},
      unidadesPorMes: { "2026-10": ["T1", "T2", "T3"] },
      kmPorUnidadMes: { "2026-10": { T1: 6000, T2: 3000, T3: 0 } },
      metodo: "km",
    })["2026-10"];
    expect(k.generalesPorUnidad).toEqual({ T1: 600, T2: 300, T3: 0 });
  });
  it("cambiar el interruptor de una categoría cambia el cálculo (también meses pasados)", () => {
    const conSueldo = asignarCostos({ costos, armados, incluir: { sueldo: true }, unidadesPorMes: {}, metodo: "partes_iguales" })["2026-10"];
    expect(conSueldo.excluidos.total).toBe(0);
    expect(conSueldo.porUnidad.T1.total).toBe(10_000);
  });
});
