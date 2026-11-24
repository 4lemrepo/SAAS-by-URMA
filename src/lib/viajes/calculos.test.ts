import { describe, expect, it } from "vitest";
import {
  continuidadOdometro,
  costoCarga,
  flete,
  fleteCargado,
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
  const v = { flete: 54_047.5, fleteCargado: 54_047.5, cargosAdicionales: 1_000, kmCargado: 480, kmVacio: 610, toneladas: 83.15 };
  it("% del subtotal: flete + cargos adicionales", () => {
    expect(pagoOperador({ esquema: "pct_subtotal", pct: 12.6 }, v)).toBe(6935.99);
    expect(pagoOperador({ esquema: "pct_subtotal", pct: 12.6 }, { ...v, cargosAdicionales: 0 })).toBe(6809.99);
  });
  it("% del flete con peso cargado (por defecto) o facturado; los cargos adicionales no cuentan", () => {
    // Cliente que factura por peso descargado: el flete facturado es menor que el cargado
    const d = { ...v, flete: 53_885, fleteCargado: 54_047.5 };
    expect(pagoOperador({ esquema: "pct_flete", pct: 12.6 }, d)).toBe(6809.99);
    expect(pagoOperador({ esquema: "pct_flete", pct: 12.6, baseFlete: "cargado" }, d)).toBe(6809.99);
    expect(pagoOperador({ esquema: "pct_flete", pct: 12.6, baseFlete: "facturado" }, d)).toBe(6789.51);
  });
  it("por km, por tonelada, fijo y comisión", () => {
    expect(pagoOperador({ esquema: "pct_flete", pct: 10 }, v)).toBe(5404.75);
    expect(pagoOperador({ esquema: "por_km", tarifaKmCargado: 3, tarifaKmVacio: 2 }, v)).toBe(2660);
    expect(pagoOperador({ esquema: "por_tonelada", tarifaTonelada: 50 }, v)).toBe(4157.5);
    expect(pagoOperador({ esquema: "fijo", montoFijo: 3500 }, v)).toBe(3500);
    expect(pagoOperador({ esquema: "sueldo_comision", pct: 5 }, v)).toBe(2752.38);
  });
  it("sin flete no se puede calcular un porcentaje", () => {
    expect(pagoOperador({ esquema: "pct_subtotal", pct: 12.6 }, { ...v, flete: null })).toBeNull();
    expect(pagoOperador({ esquema: "pct_flete", pct: 12.6 }, { ...v, fleteCargado: null })).toBeNull();
  });
});

describe("fleteCargado", () => {
  it("tarifa × toneladas cargadas aunque se facture por descargado; la fija no cambia", () => {
    expect(fleteCargado({ tipo: "por_tonelada", tarifa: 650, facturaPor: "descargado" }, 83.15)).toBe(54_047.5);
    expect(fleteCargado({ tipo: "por_tonelada", tarifa: 650, facturaPor: "cargado" }, null)).toBeNull();
    expect(fleteCargado({ tipo: "fija", tarifa: 18_000, facturaPor: "cargado" }, null)).toBe(18_000);
  });
});

describe("costoCarga", () => {
  const c = { litros: 100, importe: null, precioLitro: null, estado: "validada" as const, tieneFactura: false, tasaIva: 16 as const };
  it("importe, si no litros × precio de la carga, si no × precio del parámetro", () => {
    expect(costoCarga({ ...c, importe: 2_600 }, 24)?.costo).toBe(2_600);
    expect(costoCarga({ ...c, precioLitro: 26.4 }, 24)?.costo).toBe(2_640);
    expect(costoCarga(c, 24)?.costo).toBe(2_400);
    expect(costoCarga(c, null)).toBeNull();
  });
  it("con factura el costo es sin IVA; el total es lo pagado", () => {
    expect(costoCarga({ ...c, importe: 2_320, tieneFactura: true }, null)).toEqual({ total: 2_320, iva: 320, costo: 2_000 });
    // Precio con IVA de 4 decimales, como viene en el ticket
    expect(costoCarga({ ...c, precioLitro: 27.0117, tieneFactura: true }, null)).toEqual({ total: 2_701.17, iva: 372.58, costo: 2_328.59 });
  });
});

describe("viaje real de URMA (75.54 t × $1,360; 1,299.44 L × $27.01 con factura)", () => {
  const viaje: EntradaResumen = {
    tramos: [],
    toneladasCargadas: 75.54,
    toneladasDescargadas: 75.1,
    tarifa: { tipo: "por_tonelada", tarifa: 1_360, facturaPor: "descargado" },
    cargosAdicionales: [],
    pago: { esquema: "pct_flete", pct: 12.6, baseFlete: "cargado" },
    pagoManual: null,
    gastos: [],
    cargas: [{ litros: 1_299.44, importe: null, precioLitro: 27.01, estado: "validada", tieneFactura: true, tasaIva: 16 }],
    precioDieselParametro: null,
  };
  it("pago al operador: 12.6 % de toneladas CARGADAS × tarifa, aunque se facture por descargado", () => {
    expect(resumirViaje(viaje).pagoOperador).toBe(12_944.53);
  });
  it("diésel: importe ÷ 1.16 con factura", () => {
    // Con el importe del ticket de $35,100.00
    const conTicket = resumirViaje({ ...viaje, cargas: [{ ...viaje.cargas[0], importe: 35_100 }] });
    expect(conTicket.costoDiesel).toBe(30_258.62);
    expect(conTicket.dieselTotal).toBe(35_100);
    // Sin importe: litros × precio = 35,097.87 ÷ 1.16
    expect(resumirViaje(viaje).costoDiesel).toBe(30_256.78);
  });
});

describe("resumirViaje", () => {
  // Viaje como el primero de tu Excel (valores inventados redondeados)
  const base: EntradaResumen = {
    tramos: [
      { tipo: "vacio", km: 610 },
      { tipo: "cargado", km: 480 },
    ],
    toneladasCargadas: 83.15,
    toneladasDescargadas: 82.9,
    tarifa: { tipo: "por_tonelada", tarifa: 650, facturaPor: "cargado" },
    cargosAdicionales: [
      { concepto: "Maniobra de descarga", monto: 1_000, cancelado: false },
      { concepto: "Estadía", monto: 500, cancelado: true },
    ],
    pago: { esquema: "pct_flete", pct: 12.6 },
    pagoManual: null,
    gastos: [
      // Casetas con factura: 4,758.60 ÷ 1.16 = 4,102.24 + IVA 656.36
      { categoria: "Casetas", folio: "G-0001", monto: 4_758.6, iva: 656.36, cancelado: false },
      { categoria: "Viáticos/comidas", folio: "G-0002", monto: 600, iva: 0, cancelado: false },
      { categoria: "Otros", folio: "G-0003", monto: 999, iva: 0, cancelado: true },
    ],
    cargas: [
      { litros: 1_054.52, importe: null, precioLitro: 26.4, estado: "validada", tieneFactura: true, tasaIva: 16 },
      { litros: 50, importe: null, precioLitro: 26.4, estado: "pendiente", tieneFactura: true, tasaIva: 16 },
      { litros: 80, importe: null, precioLitro: 26.4, estado: "rechazada", tieneFactura: true, tasaIva: 16 },
    ],
    precioDieselParametro: 24,
  };
  const r = resumirViaje(base);

  it("km por tramo y totales", () => {
    expect([r.kmVacio, r.kmCargado, r.kmTotales]).toEqual([610, 480, 1_090]);
  });
  it("ingreso = flete + cargos adicionales; los cancelados no cuentan", () => {
    expect(r.flete).toBe(54_047.5);
    expect(r.cargosAdicionales).toBe(1_000);
    expect(r.ingreso).toBe(55_047.5);
  });
  it("gastos: total pagado y costo para rentabilidad (sin IVA acreditable)", () => {
    expect(r.gastosTotal).toBe(5_358.6);
    expect(r.gastosCosto).toBe(4_702.24);
    expect(r.gastosPorCategoria).toEqual({ Casetas: 4_102.24, "Viáticos/comidas": 600 });
    expect(r.gastosPorCategoriaConIva).toEqual({ Casetas: 4_758.6, "Viáticos/comidas": 600 });
  });
  it("diésel solo de cargas validadas, sin IVA si tiene factura", () => {
    expect(r.litros).toBe(1_054.52);
    expect(r.litrosPendientes).toBe(50);
    expect(r.dieselTotal).toBe(27_839.33);
    expect(r.costoDiesel).toBe(23_999.42);
    expect(r.ivaAcreditable).toBe(4_496.27);
  });
  it("pago al operador sin comisión por cargos adicionales; costo variable, utilidad y margen", () => {
    expect(r.pagoOperador).toBe(6_809.99);
    expect(r.costoVariable).toBe(35_511.65);
    expect(r.costoVariableConIva).toBe(40_007.92);
    expect(r.utilidad).toBe(19_535.85);
    expect(r.margenPct).toBe(35.5);
    expect(r.utilidadSobreCostoPct).toBe(55);
  });
  it("desglose renglón por renglón", () => {
    expect(r.renglones.map((x) => [x.concepto, x.monto])).toEqual([
      ["Flete: subtotal sin IVA (tarifa × toneladas)", 54_047.5],
      ["Cargo adicional: Maniobra de descarga", 1_000],
      ["Ingreso (sin IVA)", 55_047.5],
      ["Diésel (costo sin IVA acreditable)", 23_999.42],
      ["Pago al operador", 6_809.99],
      ["Casetas (G-0001)", 4_102.24],
      ["Viáticos/comidas (G-0002)", 600],
      ["Costo variable", 35_511.65],
      ["Utilidad de contribución", 19_535.85],
    ]);
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
    const s = resumirViaje({ ...base, tarifa: null, pago: null, cargosAdicionales: [] });
    expect([s.ingreso, s.utilidad, s.pagoOperador, s.margenPct]).toEqual([null, null, null, null]);
    expect(s.costoVariable).toBe(28_701.66);
  });
});

describe("horasEntre", () => {
  it("horas en carga o descarga", () => {
    expect(horasEntre("2026-10-01T08:00:00Z", "2026-10-01T14:30:00Z")).toBe(6.5);
    expect(horasEntre(null, "2026-10-01T14:30:00Z")).toBeNull();
  });
});
