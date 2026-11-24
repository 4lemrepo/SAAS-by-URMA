import { describe, expect, it } from "vitest";
import { desglosarIva, tasaIva } from "./iva";

describe("desglosarIva", () => {
  it("con factura al 16 %: costo = total ÷ 1.16 y el IVA aparte", () => {
    expect(desglosarIva(1160, true, 16)).toEqual({ total: 1160, iva: 160, costo: 1000 });
    // Total y costo cuadran al centavo
    const d = desglosarIva(35_100, true, 16);
    expect(d).toEqual({ total: 35_100, iva: 4_841.38, costo: 30_258.62 });
    expect(Math.round((d.costo + d.iva) * 100) / 100).toBe(d.total);
  });
  it("frontera al 8 %", () => {
    expect(desglosarIva(1080, true, 8)).toEqual({ total: 1080, iva: 80, costo: 1000 });
  });
  it("sin factura, o 0 % / exento: costo = total", () => {
    expect(desglosarIva(4_758.6, false, 16)).toEqual({ total: 4_758.6, iva: 0, costo: 4_758.6 });
    expect(desglosarIva(500, true, 0)).toEqual({ total: 500, iva: 0, costo: 500 });
  });
});

describe("tasaIva", () => {
  it("reconoce 16, 8 y 0; lo demás es 16", () => {
    expect(tasaIva("8")).toBe(8);
    expect(tasaIva("8.00")).toBe(8);
    expect(tasaIva(0)).toBe(0);
    expect(tasaIva("0")).toBe(0);
    expect(tasaIva("")).toBe(16);
    expect(tasaIva(null)).toBe(16);
    expect(tasaIva("16")).toBe(16);
  });
});
