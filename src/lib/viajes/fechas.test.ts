import { describe, expect, it } from "vitest";
import { formatearFecha, formatearFechaHora, hoy, isoALocal, localAIso } from "./fechas";

describe("fechas en hora del centro", () => {
  it("ida y vuelta entre datetime-local e ISO", () => {
    expect(localAIso("2026-10-01T08:30")).toBe("2026-10-01T14:30:00.000Z");
    expect(isoALocal("2026-10-01T14:30:00.000Z")).toBe("2026-10-01T08:30");
    expect(localAIso("")).toBe("");
    expect(localAIso("mañana")).toBe("");
  });
  it("formatos para mostrar", () => {
    expect(formatearFechaHora("2026-10-02T03:15:00Z")).toBe("01/10/2026 21:15");
    expect(formatearFecha("2026-10-01")).toBe("01/10/2026");
    expect(formatearFechaHora(null)).toBe("—");
  });
  it("hoy cambia a medianoche del centro, no de UTC", () => {
    expect(hoy(new Date("2026-10-02T05:00:00Z"))).toBe("2026-10-01");
    expect(hoy(new Date("2026-10-02T06:00:00Z"))).toBe("2026-10-02");
  });
});
