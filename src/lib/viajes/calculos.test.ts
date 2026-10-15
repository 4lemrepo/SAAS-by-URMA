import { describe, expect, it } from "vitest";
import {
  continuidadOdometro,
  costoCarga,
  flete,
  horasEntre,
  pagoOperador,
  resumirViaje,
  toneladasFacturadas,
  type EntradaResumen,
} from "./calculos";

describe("continuidadOdometro", () => {
  it("si coincide con el último viaje, no hay km sin viaje", () => {
    expect(continuidadOdometro(150_000, 150_000)).toEqual({ kmSinViaje: 0, requiereExplicacion: false });
    expect(continuidadOdometro(null, 150_000)).toEqual({ kmSinViaje: 0, requiereExplicacion: false });
  });
  it("si avanzó o retrocedió, pide explicación", () => {
    expect(continuidadOdometro(150_000, 150_035)).toEqual({ kmSinViaje: 35, requiereExplicacion: true });
    expect(continuidadOdometro(150_000, 149_990)).toEqual({ kmSinViaje: -10, requiereExplicacion: true });
  });
});

describe("flete", () => {
  it("por tonelada usa el peso con el que factura el cliente", () => {
    expect(toneladasFacturadas("cargado", 83.15, 82.9)).toBe(83.15);
    expect(toneladasFacturadas("descargado", 83.15, 82.9)).toBe(82.9);
    expect(flete({ tipo: "por_tonelada", tarifa: 650, facturaPor: "cargado" }, 83.15, 82.9)).toBe(54047.5);
    expect(flete({ tipo: "por_tonelada", tarifa: 650, facturaPor: "descargado" }, 83.15, 82.9)).toBe(53885);
  });
  it("sin el peso no hay flete; la tarifa fija no depende del peso", () => {
    expect(flete({ tipo: "por_tonelada", tarifa: 650, facturaPor: "descargado" }, 83, null)).toBeNull();
    expect(flete({ tipo: "fija", tarifa: 18_000, facturaPor: "cargado" }, null, null)).toBe(18_000);
  });
});

describe("pagoOperador", () => {
  const v = { flete: 54_047.5, gastosFacturables: 1_000, kmCargado: 480, kmVacio: 610, toneladas: 83.15 };
  it("% del subtotal de la factura (URMA: 12.6 %)", () => {
    expect(pagoOperador({ esquema: "pct_subtotal", pct: 12.6 }, v)).toBe(6935.99);
    // Sin gastos facturados es igual a lo que da el Excel (12.6 % del ingreso)
    expect(pagoOperador({ esquema: "pct_subtotal", pct: 12.6 }, { ...v, gastosFacturables: 0 })).toBe(6809.99);
  });
  it("% del flete, por km, por tonelada, fijo y comisión", () => {
    expect(pagoOperador({ esquema: "pct_flete", pct: 10 }, v)).toBe(5404.75);
    expect(pagoOperador({ esquema: "por_km", tarifaKmCargado: 3, tarifaKmVacio: 2 }, v)).toBe(2660);
    expect(pagoOperador({ esquema: "por_tonelada", tarifaTonelada: 50 }, v)).toBe(4157.5);
    expect(pagoOperador({ esquema: "fijo", montoFijo: 3500 }, v)).toBe(3500);
    expect(pagoOperador({ esquema: "sueldo_comision", pct: 5 }, v)).toBe(2752.38);
  });
  it("sin flete no se puede calcular un porcentaje", () => {
    expect(pagoOperador({ esquema: "pct_subtotal", pct: 12.6 }, { ...v, flete: null })).toBeNull();
  });
});

describe("costoCarga", () => {
  const c = { litros: 100, importe: null, precioLitro: null, estado: "validada" as const };
  it("importe, si no litros × precio de la carga, si no × precio del parámetro", () => {
    expect(costoCarga({ ...c, importe: 2_600 }, 24)).toBe(2_600);
    expect(costoCarga({ ...c, precioLitro: 26.4 }, 24)).toBe(2_640);
    expect(costoCarga(c, 24)).toBe(2_400);
    expect(costoCarga(c, null)).toBeNull();
  });
});

describe("resumirViaje", () => {
  // Viaje como el primero de tu Excel (valores inventados redondeados)
  const base: EntradaResumen = {
    tramos: [
      { tipo: "vacio", odometroInicial: 100_000, odometroFinal: 100_610 },
      { tipo: "cargado", odometroInicial: 100_610, odometroFinal: 101_090 },
    ],
    toneladasCargadas: 83.15,
    toneladasDescargadas: 82.9,
    tarifa: { tipo: "por_tonelada", tarifa: 650, facturaPor: "cargado" },
    pago: { esquema: "pct_subtotal", pct: 12.6 },
    pagoManual: null,
    gastos: [
      { categoria: "Casetas", monto: 4_758.6, facturable: false, cancelado: false },
      { categoria: "Maniobras de descarga", monto: 1_000, facturable: true, cancelado: false },
      { categoria: "Otros", monto: 999, facturable: false, cancelado: true },
    ],
    cargas: [
      { litros: 1_054.52, importe: null, precioLitro: 26.4, estado: "validada" },
      { litros: 50, importe: null, precioLitro: 26.4, estado: "pendiente" },
      { litros: 80, importe: null, precioLitro: 26.4, estado: "rechazada" },
    ],
    precioDieselParametro: 24,
  };
  const r = resumirViaje(base);

  it("km por tramo y totales", () => {
    expect([r.kmVacio, r.kmCargado, r.kmTotales]).toEqual([610, 480, 1_090]);
  });
  it("ingreso = flete + gastos facturados; los cancelados no cuentan", () => {
    expect(r.flete).toBe(54_047.5);
    expect(r.ingreso).toBe(55_047.5);
    expect(r.gastosPropios).toBe(4_758.6);
    expect(r.gastosPorCategoria).toEqual({ Casetas: 4_758.6, "Maniobras de descarga": 1_000 });
  });
  it("diésel solo de cargas validadas", () => {
    expect(r.litros).toBe(1_054.52);
    expect(r.litrosPendientes).toBe(50);
    expect(r.costoDiesel).toBe(27_839.33);
  });
  it("costo variable, utilidad, margen y utilidad sobre costo", () => {
    expect(r.pagoOperador).toBe(6_935.99);
    expect(r.costoVariable).toBe(40_533.92);
    expect(r.utilidad).toBe(14_513.58);
    expect(r.margenPct).toBe(26.4);
    expect(r.utilidadSobreCostoPct).toBe(35.8);
  });
  it("merma en toneladas, % y pesos a la tarifa del viaje", () => {
    expect(r.mermaToneladas).toBe(0.25);
    expect(r.mermaPct).toBe(0.3);
    expect(r.mermaPesos).toBe(162.5);
  });
  it("el pago manual manda sobre el esquema", () => {
    expect(resumirViaje({ ...base, pagoManual: 5_000 }).pagoOperador).toBe(5_000);
  });
  it("sin tarifa (o sin permiso) no hay ingreso ni utilidad, pero sí costos", () => {
    const s = resumirViaje({ ...base, tarifa: null, pago: null });
    expect([s.ingreso, s.utilidad, s.pagoOperador, s.margenPct]).toEqual([null, null, null, null]);
    expect(s.costoVariable).toBe(33_597.93);
  });
});

describe("horasEntre", () => {
  it("horas en carga o descarga", () => {
    expect(horasEntre("2026-10-01T08:00:00Z", "2026-10-01T14:30:00Z")).toBe(6.5);
    expect(horasEntre(null, "2026-10-01T14:30:00Z")).toBeNull();
  });
});
