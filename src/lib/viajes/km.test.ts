import { describe, expect, it } from "vitest";
import { revisarKm } from "./km";

describe("revisarKm", () => {
  it("dentro de la tolerancia no se revisa", () => {
    expect(revisarKm(440, 400, 10)).toEqual({ desviacionPct: 10, revisar: false });
    expect(revisarKm(360, 400, 10)).toEqual({ desviacionPct: -10, revisar: false });
  });
  it("más o menos km que la tolerancia se marca para revisión", () => {
    expect(revisarKm(455, 400, 10)).toEqual({ desviacionPct: 13.8, revisar: true });
    // Un viaje capturado como ida y vuelta sobre una ruta de un sentido
    expect(revisarKm(1230, 615, 10)).toEqual({ desviacionPct: 100, revisar: true });
    expect(revisarKm(300, 400, 10).revisar).toBe(true);
  });
  it("la tolerancia es de cada empresa", () => {
    expect(revisarKm(455, 400, 15).revisar).toBe(false);
  });
  it("sin ruta o sin km no hay con qué comparar", () => {
    expect(revisarKm(400, null, 10)).toEqual({ desviacionPct: null, revisar: false });
    expect(revisarKm(null, 400, 10)).toEqual({ desviacionPct: null, revisar: false });
  });
});
