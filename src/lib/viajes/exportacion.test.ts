import { describe, expect, it } from "vitest";
import { resumirViaje } from "./calculos";
import { filasExportacion, type ViajeParaExportar } from "./exportacion";

const viaje: ViajeParaExportar = {
  folio: "URMA-0182",
  estado: "cerrado",
  fecha_salida: "2026-10-01T12:00:00Z",
  fecha_llegada: null,
  unidad: "T715",
  armado: "Full: A + D + B",
  operador: "Operador Prueba",
  cliente: "Cliente Prueba",
  producto: "Maíz",
  toneladas_cargadas: 80,
  toneladas_descargadas: 79.5,
  tramos: [
    { tipo: "vacio", origen: "A", destino: "B" },
    { tipo: "cargado", origen: "B", destino: "C" },
  ],
  finanzas: { tipo_tarifa: "por_tonelada", tarifa: 650 },
  resumen: resumirViaje({
    tramos: [
      { tipo: "vacio", odometroInicial: 0, odometroFinal: 100 },
      { tipo: "cargado", odometroInicial: 100, odometroFinal: 500 },
    ],
    toneladasCargadas: 80,
    toneladasDescargadas: 79.5,
    tarifa: { tipo: "por_tonelada", tarifa: 650, facturaPor: "cargado" },
    pago: { esquema: "fijo", montoFijo: 5000 },
    pagoManual: null,
    gastos: [{ categoria: "Casetas", monto: 1000, facturable: false, cancelado: false }],
    cargas: [{ litros: 400, importe: 10000, precioLitro: null, estado: "validada" }],
    precioDieselParametro: null,
  }),
};

describe("filasExportacion", () => {
  it("con permiso incluye tarifa, ingreso, pago y utilidad, y una columna por categoría de gasto", () => {
    const { encabezados, filas } = filasExportacion([viaje], true);
    const fila = Object.fromEntries(encabezados.map((e, i) => [e, filas[0][i]]));
    expect(fila).toMatchObject({
      Folio: "URMA-0182",
      "Tramo cargado": "B → C",
      "Km totales": 500,
      Tarifa: "650 /t",
      Ingreso: 52000,
      "Gasto: Casetas": 1000,
      "Diésel $": 10000,
      "Pago al operador": 5000,
      Utilidad: 36000,
    });
  });
  it("sin permiso no salen tarifa, ingreso, pago ni utilidad", () => {
    const { encabezados } = filasExportacion([viaje], false);
    for (const c of ["Tarifa", "Flete", "Ingreso", "Pago al operador", "Utilidad", "Margen %"]) expect(encabezados).not.toContain(c);
    expect(encabezados).toContain("Gasto: Casetas");
  });
});
