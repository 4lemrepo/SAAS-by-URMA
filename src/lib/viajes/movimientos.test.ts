import { describe, expect, it } from "vitest";
import { validarCarga, validarFinanzas, validarGasto } from "./movimientos";

const E = "11111111-1111-1111-1111-111111111111";

describe("validarGasto", () => {
  it("acepta un gasto completo con comprobante en la carpeta de la empresa", () => {
    const r = validarGasto(
      { fecha: "2026-10-01", categoria_id: "c1", monto: "1,250.50", forma_pago: "tag", numero_comprobante: " FAC-9 ", facturable: "on", comprobante_path: `${E}/a.pdf` },
      E,
    );
    expect(r).toEqual({
      ok: true,
      datos: {
        fecha: "2026-10-01",
        categoria_id: "c1",
        monto: 1250.5,
        forma_pago: "tag",
        proveedor: null,
        numero_comprobante: "FAC-9",
        comprobante_path: `${E}/a.pdf`,
        facturable: true,
        notas: null,
      },
    });
  });
  it("rechaza monto cero, sin categoría y archivos de otra empresa", () => {
    const r = validarGasto({ fecha: "2026-13-40", monto: "0", comprobante_path: "otra/a.pdf" }, E);
    expect(!r.ok && Object.keys(r.errores).sort()).toEqual(["categoria_id", "comprobante_path", "fecha", "monto"]);
  });
});

describe("validarCarga", () => {
  it("calcula el importe si hay litros y precio", () => {
    const r = validarCarga({ fecha: "2026-10-01T10:00:00Z", fuente_id: "f1", litros: "400", precio_litro: "26.40" }, E);
    expect(r.ok && r.datos.importe).toBe(10560);
  });
  it("respeta el importe del ticket", () => {
    const r = validarCarga({ fecha: "2026-10-01T10:00:00Z", fuente_id: "f1", litros: "400", precio_litro: "26.40", importe: "10500" }, E);
    expect(r.ok && r.datos.importe).toBe(10500);
  });
  it("exige litros, fuente y fecha", () => {
    const r = validarCarga({ litros: "0" }, E);
    expect(!r.ok && Object.keys(r.errores).sort()).toEqual(["fecha", "fuente_id", "litros"]);
  });
});

describe("validarFinanzas", () => {
  it("tarifa por tonelada con el pago de URMA", () => {
    const r = validarFinanzas({ tipo_tarifa: "por_tonelada", tarifa: "650", factura_por: "descargado", pago_esquema: "pct_subtotal", pago_pct: "12.6" });
    expect(r.ok && r.datos).toMatchObject({ tipo_tarifa: "por_tonelada", tarifa: 650, factura_por: "descargado", pago_pct: 12.6, pago_operador_manual: null });
  });
  it("marca los errores del esquema de pago con su campo", () => {
    const r = validarFinanzas({ tipo_tarifa: "fija", tarifa: "18000", pago_esquema: "por_km" });
    expect(!r.ok && r.errores).toEqual({ pago_tarifa_km_cargado: "Requerido", pago_tarifa_km_vacio: "Requerido" });
  });
});
