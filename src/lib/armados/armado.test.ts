import { describe, expect, it } from "vitest";
import { describirArmado, etiquetaDolly, etiquetaRemolque, fechaDelCambio, validarArmado } from "./armado";

const form = (campos: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(campos)) f.set(k, v);
  return f;
};

describe("validarArmado", () => {
  it("un remolque es sencillo", () => {
    expect(validarArmado(form({ remolque1: "r1", dolly: "", remolque2: "" }))).toEqual({
      ok: true,
      datos: { remolque1: "r1", dolly: null, remolque2: null },
      configuracion: "sencillo",
    });
  });
  it("remolque, dolly y remolque es full", () => {
    const r = validarArmado(form({ remolque1: "r1", dolly: "d1", remolque2: "r2" }));
    expect(r.ok && r.configuracion).toBe("full");
  });
  it("todo vacío es desenganchar", () => {
    const r = validarArmado(form({}));
    expect(r).toEqual({ ok: true, datos: { remolque1: null, dolly: null, remolque2: null }, configuracion: null });
  });
  it("full incompleto o con el mismo remolque dos veces", () => {
    const sinR2 = validarArmado(form({ remolque1: "r1", dolly: "d1" }));
    expect(!sinR2.ok && sinR2.errores).toEqual({ remolque2: "Un full lleva segundo remolque" });
    const sinDolly = validarArmado(form({ remolque1: "r1", remolque2: "r2" }));
    expect(!sinDolly.ok && sinDolly.errores).toEqual({ dolly: "Un full lleva dolly" });
    const repetido = validarArmado(form({ remolque1: "r1", dolly: "d1", remolque2: "r1" }));
    expect(!repetido.ok && repetido.errores).toEqual({ remolque2: "Debe ser distinto al remolque 1" });
    const sinR1 = validarArmado(form({ dolly: "d1", remolque2: "r2" }));
    expect(!sinR1.ok && sinR1.errores.remolque1).toBe("Elige el remolque 1");
  });
});

describe("etiquetas", () => {
  it("remolque por número económico o por placas; dolly por número o serie", () => {
    expect(etiquetaRemolque({ numero_economico: "R-02", placas: "10AB2A" })).toBe("R-02 (10AB2A)");
    expect(etiquetaRemolque({ numero_economico: null, placas: "10AB2A" })).toBe("10AB2A");
    expect(etiquetaDolly({ numero_economico: "D-1", numero_serie: "X1" })).toBe("D-1");
    expect(etiquetaDolly({ numero_economico: null, numero_serie: "X1" })).toBe("Serie X1");
  });
  it("describe el armado", () => {
    expect(describirArmado(null)).toBe("Sin remolques");
    expect(describirArmado({ remolque1: "A", dolly: null, remolque2: null })).toBe("Sencillo: A");
    expect(describirArmado({ remolque1: "A", dolly: "D", remolque2: "B" })).toBe("Full: A + D + B");
  });
});

describe("fechaDelCambio", () => {
  const ahora = new Date("2026-10-16T18:00:00Z");
  it("sin fecha es ahora; acepta una fecha pasada", () => {
    expect(fechaDelCambio(null, ahora)).toBe(ahora);
    expect(fechaDelCambio("2026-10-10T15:30:00.000Z", ahora)?.toISOString()).toBe("2026-10-10T15:30:00.000Z");
  });
  it("rechaza fechas inválidas o futuras", () => {
    expect(fechaDelCambio("no-es-fecha", ahora)).toBeNull();
    expect(fechaDelCambio("2026-10-20T00:00:00Z", ahora)).toBeNull();
  });
});
