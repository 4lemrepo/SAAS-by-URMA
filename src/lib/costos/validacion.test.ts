import { describe, expect, it } from "vitest";
import { validarCosto } from "./validacion";

const E = "11111111-1111-1111-1111-111111111111";

describe("validarCosto", () => {
  it("costo de remolque repartido en meses", () => {
    const r = validarCosto({ fecha: "2026-10-05", mes: "2026-10", meses: "12", categoria_id: "c1", monto: "120,000", equipo: "r:abc" }, E);
    expect(r.ok && r.datos).toMatchObject({ mes: "2026-10-01", meses: 12, monto: 120000, remolque_id: "abc", unidad_id: null, dolly_id: null });
  });
  it("sin equipo es costo general; sin mes toma el de la fecha", () => {
    const r = validarCosto({ fecha: "2026-10-05", categoria_id: "c1", monto: "1500" }, E);
    expect(r.ok && r.datos).toMatchObject({ mes: "2026-10-01", meses: 1, unidad_id: null, remolque_id: null, dolly_id: null });
  });
  it("errores marcados por campo", () => {
    const r = validarCosto({ fecha: "x", mes: "2026-13", meses: "0", monto: "-5", equipo: "z:1", comprobante_path: "otra/x.pdf" }, E);
    expect(!r.ok && Object.keys(r.errores).sort()).toEqual(["categoria_id", "comprobante_path", "equipo", "fecha", "mes", "meses", "monto"]);
  });
});
