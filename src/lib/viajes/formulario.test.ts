import { describe, expect, it } from "vitest";
import { parsearRemisiones, validarViaje, type ContextoViaje } from "./formulario";

const ctx: ContextoViaje = { odometroAnterior: 100_000, kmRuta: { vacio: null, cargado: 480 }, toleranciaKmPct: 10 };
const base = {
  unidad_id: "u1",
  operador_id: "o1",
  fecha_salida: "2026-10-01T06:00:00.000Z",
  llegada_carga: "2026-10-01T14:00:00.000Z",
  salida_carga: "2026-10-01T18:00:00.000Z",
  origen: " santa catarina ",
  lugar_carga: "Fresnillo",
  lugar_descarga: "Santa Catarina",
  odometro_inicial: "100000",
  odometro_carga: "100610",
  odometro_final: "101090",
  toneladas_cargadas: "83.15",
};

describe("validarViaje", () => {
  it("arma los dos tramos con lugares normalizados y km del odómetro", () => {
    const r = validarViaje(base, ctx);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.tramos.map((t) => [t.tipo, t.origen, t.destino, t.odometro_final - t.odometro_inicial])).toEqual([
      ["vacio", "SANTA CATARINA", "FRESNILLO", 610],
      ["cargado", "FRESNILLO", "SANTA CATARINA", 480],
    ]);
    expect(r.viaje.km_sin_viaje).toBe(0);
    expect(r.viaje.fecha_llegada).toBeNull();
  });
  it("se puede dar de alta al salir: sin odómetro final todavía no hay tramo cargado", () => {
    const r = validarViaje({ ...base, odometro_final: "", lugar_descarga: "" }, ctx);
    expect(r.ok && r.tramos.map((t) => t.tipo)).toEqual(["vacio"]);
  });
  it("el fin del viaje es la salida de la descarga", () => {
    const r = validarViaje(
      { ...base, llegada_descarga: "2026-10-02T06:00:00.000Z", salida_descarga: "2026-10-02T09:00:00.000Z" },
      ctx,
    );
    expect(r.ok && r.viaje.fecha_llegada).toBe("2026-10-02T09:00:00.000Z");
  });
  it("si el odómetro no sigue al del último viaje, pide explicación", () => {
    const r = validarViaje({ ...base, odometro_inicial: "100035", odometro_carga: "100645", odometro_final: "101125" }, ctx);
    expect(!r.ok && r.errores.explicacion_km_sin_viaje).toMatch(/avanzó 35 km/);
    const ok = validarViaje(
      { ...base, odometro_inicial: "100035", odometro_carga: "100645", odometro_final: "101125", explicacion_km_sin_viaje: "Fue al taller" },
      ctx,
    );
    expect(ok.ok && ok.viaje.km_sin_viaje).toBe(35);
  });
  it("si un tramo se desvía más que la tolerancia de su ruta, exige motivo", () => {
    const largo = { ...base, odometro_final: "101150" }; // 540 km contra 480 = 12.5 %
    const r = validarViaje(largo, ctx);
    expect(!r.ok && r.errores.motivo_cargado).toMatch(/12.5%/);
    const otroSinNota = validarViaje({ ...largo, motivo_cargado: "otro" }, ctx);
    expect(!otroSinNota.ok && otroSinNota.errores.nota_cargado).toBe("Explica el motivo");
    const ok = validarViaje({ ...largo, motivo_cargado: "taller_mecanico" }, ctx);
    expect(ok.ok && ok.tramos[1].motivo_desvio).toBe("taller_mecanico");
    expect(ok.ok && ok.revision.cargado).toEqual({ desviacionPct: 12.5, revisar: true });
  });
  it("sin desvío no se guarda motivo; sin ruta no se compara", () => {
    const r = validarViaje({ ...base, motivo_cargado: "otro", nota_cargado: "x" }, ctx);
    expect(r.ok && r.tramos[1].motivo_desvio).toBeNull();
    expect(r.ok && r.revision.vacio).toEqual({ desviacionPct: null, revisar: false });
  });
  it("odómetros y fechas en orden; datos obligatorios", () => {
    const r = validarViaje(
      { ...base, unidad_id: "", odometro_carga: "99000", salida_carga: "2026-10-01T10:00:00.000Z", toneladas_cargadas: "-3" },
      ctx,
    );
    expect(!r.ok && Object.keys(r.errores).sort()).toEqual(["odometro_carga", "salida_carga", "toneladas_cargadas", "unidad_id"]);
  });
});

describe("remisiones y factura al cliente", () => {
  it("separa remisiones por coma, punto y coma, diagonal o renglón, sin repetidas", () => {
    expect(parsearRemisiones(" R-1, r-1 ; R-2 / R-3\nR-4 ")).toEqual(["R-1", "R-2", "R-3", "R-4"]);
    expect(parsearRemisiones("")).toEqual([]);
  });
  it("las guarda con el viaje; la factura es texto libre", () => {
    const r = validarViaje({ ...base, remisiones: "UL-005928 / UL-005929", factura_cliente: " A-1520 " }, ctx);
    expect(r.ok && [r.viaje.remisiones, r.viaje.factura_cliente]).toEqual([["UL-005928", "UL-005929"], "A-1520"]);
    const sin = validarViaje(base, ctx);
    expect(sin.ok && [sin.viaje.remisiones, sin.viaje.factura_cliente]).toEqual([[], null]);
  });
  it("respeta los límites de la base", () => {
    const r = validarViaje({ ...base, remisiones: "x".repeat(41), factura_cliente: "y".repeat(41) }, ctx);
    expect(!r.ok && Object.keys(r.errores).sort()).toEqual(["factura_cliente", "remisiones"]);
  });
});
