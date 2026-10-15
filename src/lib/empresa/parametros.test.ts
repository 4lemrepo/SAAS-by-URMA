import { describe, expect, it } from "vitest";
import { ejemploFolio, validarParametros } from "./parametros";

const validos = {
  tolerancia_pct: "5",
  tolerancia_km_pct: "10",
  precio_diesel_litro: "24,85",
  dias_alerta_viaje_abierto: "5",
  horas_limite_estadia: "6",
  folio_viaje_prefijo: "URMA-",
  folio_viaje_siguiente: "182",
  folio_gasto_prefijo: "G-",
  folio_gasto_siguiente: "1",
  folio_costo_prefijo: "",
  folio_costo_siguiente: "1",
  folio_digitos: "4",
};

describe("validarParametros", () => {
  it("acepta todos los parámetros, con coma decimal y prefijo vacío", () => {
    const r = validarParametros(validos);
    expect(r.ok && r.datos).toMatchObject({
      tolerancia_pct: 5,
      tolerancia_km_pct: 10,
      precio_diesel_litro: 24.85,
      folio_viaje_prefijo: "URMA-",
      folio_viaje_siguiente: 182,
      folio_costo_prefijo: "",
    });
  });
  it("el precio es opcional; las tolerancias no", () => {
    expect(validarParametros({ ...validos, precio_diesel_litro: "" }).ok).toBe(true);
    const r = validarParametros({ ...validos, tolerancia_pct: "" });
    expect(!r.ok && r.errores).toEqual({ tolerancia_pct: "Requerido" });
  });
  it("rechaza valores fuera de rango y prefijos con espacios o símbolos raros", () => {
    const r = validarParametros({ ...validos, tolerancia_pct: "0", tolerancia_km_pct: "101", folio_viaje_siguiente: "0", folio_viaje_prefijo: "UR MA", folio_digitos: "9" });
    expect(!r.ok && Object.keys(r.errores).sort()).toEqual(["folio_digitos", "folio_viaje_prefijo", "folio_viaje_siguiente", "tolerancia_km_pct", "tolerancia_pct"]);
  });
});

describe("ejemploFolio", () => {
  it("prefijo y número con ceros", () => {
    expect(ejemploFolio("URMA-", 182, 4)).toBe("URMA-0182");
    expect(ejemploFolio("", 7, 3)).toBe("007");
  });
});
