import { describe, expect, it } from "vitest";
import { validarParametros } from "./parametros";

describe("validarParametros", () => {
  it("acepta tolerancia y precio, con coma decimal", () => {
    expect(validarParametros({ tolerancia_pct: "5", precio_diesel_litro: "24,85" })).toEqual({
      ok: true,
      datos: { tolerancia_pct: 5, precio_diesel_litro: 24.85 },
    });
  });
  it("el precio es opcional; la tolerancia no", () => {
    expect(validarParametros({ tolerancia_pct: "7.5", precio_diesel_litro: "" })).toEqual({
      ok: true,
      datos: { tolerancia_pct: 7.5, precio_diesel_litro: null },
    });
    const r = validarParametros({ tolerancia_pct: "", precio_diesel_litro: "24" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errores).toEqual({ tolerancia_pct: "Requerido" });
  });
  it("rechaza tolerancia de cero o más de 100% y precio negativo", () => {
    const r = validarParametros({ tolerancia_pct: "0", precio_diesel_litro: "-1" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(Object.keys(r.errores).sort()).toEqual(["precio_diesel_litro", "tolerancia_pct"]);
    expect(validarParametros({ tolerancia_pct: "101" }).ok).toBe(false);
  });
});
