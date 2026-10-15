import { describe, expect, it } from "vitest";
import { configParaOperador, describirPago, validarConfigPago } from "./pago";

describe("validarConfigPago", () => {
  it("guarda solo los valores del esquema elegido", () => {
    expect(validarConfigPago({ esquema: "pct_subtotal", pct: "12.6", monto_fijo: "999" })).toEqual({
      ok: true,
      datos: {
        esquema: "pct_subtotal",
        pct: 12.6,
        tarifa_km_cargado: null,
        tarifa_km_vacio: null,
        tarifa_tonelada: null,
        monto_fijo: null,
        sueldo_base_mensual: null,
      },
    });
  });
  it("por km pide las dos tarifas; el porcentaje no pasa de 100", () => {
    const r = validarConfigPago({ esquema: "por_km", tarifa_km_cargado: "3" });
    expect(!r.ok && r.errores).toEqual({ tarifa_km_vacio: "Requerido" });
    expect(validarConfigPago({ esquema: "pct_flete", pct: "120" }).ok).toBe(false);
    expect(validarConfigPago({ esquema: "nada" }).ok).toBe(false);
  });
  it("sueldo + comisión: el sueldo es opcional, la comisión no", () => {
    expect(validarConfigPago({ esquema: "sueldo_comision", pct: "5" }).ok).toBe(true);
    expect(validarConfigPago({ esquema: "sueldo_comision", sueldo_base_mensual: "12000" }).ok).toBe(false);
  });
});

describe("configParaOperador", () => {
  const configs = [
    { operador_id: null, esquema: "pct_subtotal" },
    { operador_id: "op-2", esquema: "fijo" },
  ];
  it("usa la del operador si tiene; si no, la de la empresa", () => {
    expect(configParaOperador(configs, "op-2")?.esquema).toBe("fijo");
    expect(configParaOperador(configs, "op-1")?.esquema).toBe("pct_subtotal");
    expect(configParaOperador([], "op-1")).toBeNull();
    // Un operador que volvió al pago de la empresa
    expect(configParaOperador([...configs, { operador_id: "op-3", esquema: "fijo", activo: false }], "op-3")?.esquema).toBe("pct_subtotal");
  });
});

describe("describirPago", () => {
  it("resume el esquema", () => {
    const base = { pct: null, tarifa_km_cargado: null, tarifa_km_vacio: null, tarifa_tonelada: null, monto_fijo: null, sueldo_base_mensual: null };
    expect(describirPago({ ...base, esquema: "pct_subtotal", pct: 12.6 })).toBe("12.6% del subtotal de la factura");
    expect(describirPago({ ...base, esquema: "por_km", tarifa_km_cargado: 3, tarifa_km_vacio: 2 })).toBe("$3/km cargado, $2/km vacío");
  });
});
