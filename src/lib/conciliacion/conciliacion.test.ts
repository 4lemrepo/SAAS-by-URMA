import { describe, expect, it } from "vitest";
import {
  conciliarTanque,
  conciliarViaje,
  litrosTeoricos,
  rendimientoEsperado,
  resumirPor,
} from "./index";

// Datos de ejemplo (no son cifras reales de URMA): full de 9 ejes,
// 2.2 km/l cargado y 2.8 km/l vacío, ruta de 1,100 km de ida cargado
// y 1,100 km de regreso vacío.
const rend = { cargado: 2.2, vacio: 2.8 };
const base = { kmCargado: 1100, kmVacio: 1100, rendimiento: rend, toleranciaPct: 5, precioLitro: 25 };
const teoricos = 1100 / 2.2 + 1100 / 2.8; // 500 + 392.857… = 892.857…

describe("rendimientoEsperado", () => {
  it("usa el de la ruta cuando existe", () => {
    expect(rendimientoEsperado({ cargado: 2.2, vacio: 2.8 }, { cargado: 1.9, vacio: null }))
      .toEqual({ cargado: 1.9, vacio: 2.8 });
  });
  it("usa el de la unidad si la ruta no trae", () => {
    expect(rendimientoEsperado({ cargado: 2.2, vacio: 2.8 }, null)).toEqual(rend);
  });
  it("devuelve null si falta alguno", () => {
    expect(rendimientoEsperado({ cargado: 2.2, vacio: null })).toBeNull();
  });
});

describe("litrosTeoricos", () => {
  it("suma tramo cargado y tramo vacío", () => {
    expect(litrosTeoricos({ cargado: 1100, vacio: 1100 }, rend)).toBeCloseTo(teoricos, 6);
  });
});

describe("conciliarViaje", () => {
  it("verde cuando el consumo está dentro de la tolerancia", () => {
    const r = conciliarViaje({ ...base, litrosReales: teoricos * 1.03 });
    expect(r.semaforo).toBe("verde");
    expect(r.desviacionPct).toBeCloseTo(3, 6);
    expect(r.pctKmVacio).toBe(50);
  });

  it("amarillo entre 1× y 2× la tolerancia", () => {
    expect(conciliarViaje({ ...base, litrosReales: teoricos * 1.08 }).semaforo).toBe("amarillo");
  });

  it("rojo arriba de 2× la tolerancia, con pesos faltantes", () => {
    const r = conciliarViaje({ ...base, litrosReales: 1000 });
    expect(r.semaforo).toBe("rojo");
    expect(r.desviacionLitros).toBeCloseTo(1000 - teoricos, 6);
    expect(r.pesosFaltantes).toBeCloseTo((1000 - teoricos) * 25, 6);
  });

  it("consumo muy bajo se marca para revisión, sin pesos faltantes", () => {
    const r = conciliarViaje({ ...base, litrosReales: teoricos * 0.8 });
    expect(r.semaforo).toBe("amarillo");
    expect(r.motivo).toMatch(/muy bajo/);
    expect(r.pesosFaltantes).toBe(0);
  });

  it("sin_datos si falta rendimiento esperado", () => {
    expect(conciliarViaje({ ...base, rendimiento: null, litrosReales: 900 }).semaforo).toBe("sin_datos");
  });

  it("sin_datos si no hay cargas registradas", () => {
    expect(conciliarViaje({ ...base, litrosReales: 0 }).semaforo).toBe("sin_datos");
  });

  it("calcula km/l real", () => {
    expect(conciliarViaje({ ...base, litrosReales: 880 }).kmPorLitroReal).toBeCloseTo(2200 / 880, 6);
  });
});

describe("resumirPor", () => {
  it("agrupa por unidad y ordena por pesos faltantes", () => {
    const viajes = [
      { unidad: "0708", r: conciliarViaje({ ...base, litrosReales: teoricos }) },
      { unidad: "0714", r: conciliarViaje({ ...base, litrosReales: 1000 }) },
      { unidad: "0714", r: conciliarViaje({ ...base, litrosReales: 950 }) },
      { unidad: "0708", r: conciliarViaje({ ...base, rendimiento: null, litrosReales: 999 }) },
    ];
    const res = resumirPor(viajes, (v) => v.unidad, (v) => v.r);

    expect(res.map((g) => g.clave)).toEqual(["0714", "0708"]);
    const u0714 = res[0];
    expect(u0714.viajes).toBe(2);
    // 1000 L es +12% (rojo); 950 L es +6.4% (amarillo)
    expect(u0714.viajesEnRojo).toBe(1);
    expect(u0714.litrosReales).toBe(1950);
    expect(u0714.pesosFaltantes).toBeCloseTo((1950 - 2 * teoricos) * 25, 6);
    expect(u0714.pctKmVacio).toBeCloseTo(50, 6);

    // El viaje sin datos cuenta como viaje pero no suma litros
    const u0708 = res[1];
    expect(u0708.viajes).toBe(2);
    expect(u0708.litrosReales).toBeCloseTo(teoricos, 6);
  });
});

describe("conciliarTanque", () => {
  it("cuadra cuando la lectura final coincide con los registros", () => {
    const r = conciliarTanque({
      lecturaInicial: 5000, entradas: [20000], despachos: [400, 380, 410], lecturaFinal: 23810, toleranciaPct: 1,
    });
    expect(r.saldoTeorico).toBe(23810);
    expect(r.diferencia).toBe(0);
    expect(r.semaforo).toBe("verde");
  });

  it("detecta litros faltantes en el tanque", () => {
    // Despachos registrados: 10,000 L. En el tanque faltan 300 L (3% de lo despachado).
    const r = conciliarTanque({
      lecturaInicial: 2000, entradas: [10000], despachos: Array(25).fill(400), lecturaFinal: 1700, toleranciaPct: 1,
    });
    expect(r.saldoTeorico).toBe(2000);
    expect(r.diferencia).toBe(-300);
    expect(r.diferenciaPct).toBeCloseTo(-3, 6);
    expect(r.semaforo).toBe("rojo");
  });

  it("considera ajustes autorizados", () => {
    const r = conciliarTanque({
      lecturaInicial: 1000, entradas: [], ajustes: [-50], despachos: [500], lecturaFinal: 450, toleranciaPct: 1,
    });
    expect(r.diferencia).toBe(0);
  });
});
