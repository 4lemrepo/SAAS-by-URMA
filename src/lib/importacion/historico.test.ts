import { strToU8, zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { leerFormulas, letraColumna, partesDeSuma } from "./formulas";
import {
  anioMasComun,
  armarCostos,
  armarViajes,
  fechaDeCelda,
  leerHojaCostos,
  leerHojaViajes,
  llaveCosto,
  partirFolio,
  PLANTILLA_COSTOS,
  PLANTILLA_VIAJES,
  siNo,
  type ContextoViajes,
  type FilaHistorica,
} from "./historico";

// Hoja con la forma de un control de viajes real: título, renglón vacío y encabezados en la fila 3.
const ENCABEZADOS = [
  "Fecha", "MES", "No. Viaje", "Unidad", "Placas", "Operador", "Origen", "Destino", "Ruta", "CLIENTE",
  "Km vacío", "Km cargado", "Km totales", "Litros", " DISPERSION", "Precio por litro", "Costo Diesel",
  "Rendimiento (km/l)", "Peajes / Casetas", "otros ", "Urea Def. ", "Gastos operativos", "Costo Mantenimiento",
  "Costo Total", "Tarifa", "Toneladas Carg.", "Ingreso", "PAGO OPERADOR",
];
const d = (s: string) => new Date(`${s}T00:00:00.000Z`);
const v = (o: Partial<Record<string, unknown>>, k: string, porDefecto: unknown) => (k in o ? o[k] : porDefecto);
// prettier-ignore
const fila = (o: Partial<Record<string, unknown>>) => [
  v(o, "fecha", d("2026-01-05")), 1, v(o, "folio", "F-001"), v(o, "unidad", "T1"), "PLACA", v(o, "operador", "PEDRO PRUEBA"), v(o, "origen", "LUGAR A"),
  v(o, "destino", "LUGAR B"), "", v(o, "cliente", "CLIENTE UNO"), v(o, "kmVacio", 600), v(o, "kmCargado", 480), null, v(o, "litros", 1000), v(o, "fuente", "TARJETA X"),
  v(o, "precio", 27.01163578), v(o, "costoDiesel", 27011.63578), null, v(o, "casetas", 1642.5), v(o, "otros", null), v(o, "urea", null),
  v(o, "gastosOp", null), v(o, "mantenimiento", null), v(o, "costoTotal", null), v(o, "tarifa", 650), v(o, "toneladas", 80), v(o, "ingreso", null), v(o, "pago", 6552),
];
const hoja = (...filas: unknown[][]) => [["CONTROL DE VIAJES 2026"], [], ENCABEZADOS, ...filas, [null, 1]];

const ctx: ContextoViajes = {
  archivo: "control.xlsx",
  unidades: [{ id: "u-1", numero_economico: "T1" }, { id: "u-2", numero_economico: "T2" }],
  operadores: ["PEDRO PRUEBA"],
  clientes: ["Cliente Uno"],
  fuentes: [{ nombre: "TARJETA X", tiene_factura: true }],
  foliosExistentes: ["F-900"],
};

function leer(...filas: unknown[][]): FilaHistorica[] {
  const r = leerHojaViajes(hoja(...filas), { S4: "1178+464.5", AA4: "Y4*Z4" });
  if ("error" in r) throw new Error(r.error);
  return r.filas;
}

describe("lectura de la hoja de viajes", () => {
  it("encuentra los encabezados por nombre y salta renglones vacíos", () => {
    const r = leerHojaViajes(hoja(fila({})));
    expect("error" in r).toBe(false);
    if ("error" in r) return;
    expect(r.filaEncabezados).toBe(3);
    expect(r.filas).toHaveLength(1);
    expect(r.filas[0]).toMatchObject({ fila: 4, fecha: "2026-01-05", folio: "F-001", unidad: "T1", fuente: "TARJETA X" });
    expect(r.faltantes).toContain("No. de factura al cliente");
  });
  it("sin las columnas obligatorias da error", () => {
    expect(leerHojaViajes([["Fecha", "Unidad"]])).toEqual({ error: expect.stringContaining("No encontré los encabezados") });
  });
  it("guarda las partes de una suma escrita en la celda", () => {
    expect(leer(fila({}))[0].partes).toEqual({ casetas: [1178, 464.5] });
  });
  it("un error de Excel en una columna de números se marca", () => {
    expect(leer(fila({ casetas: "#DIV/0!" }))[0].invalidos).toEqual(["Casetas"]);
  });
  it("fechas: Date, número de serie de Excel y texto", () => {
    expect(fechaDeCelda(d("2026-03-07"))).toBe("2026-03-07");
    expect(fechaDeCelda(46088)).toBe("2026-03-07");
    expect(fechaDeCelda("07/03/2026")).toBe("2026-03-07");
    expect(fechaDeCelda("2026-03-07")).toBe("2026-03-07");
    expect(fechaDeCelda("31/02/2026")).toBeNull();
    expect(fechaDeCelda("mañana")).toBeNull();
  });
  it("sí / no", () => {
    expect([siNo("Sí"), siNo("no"), siNo(""), siNo("quizá")]).toEqual([true, false, null, null]);
  });
});

describe("folios", () => {
  it("parte folios dobles y hereda el prefijo", () => {
    expect(partirFolio("UL-005928 / UL-005929")).toEqual(["UL-005928", "UL-005929"]);
    expect(partirFolio("UL-005926/005930")).toEqual(["UL-005926", "UL-005930"]);
    expect(partirFolio("UL-005993/UL-5988")).toEqual(["UL-005993", "UL-5988"]);
    expect(partirFolio("F-001")).toEqual(["F-001"]);
  });
  it("folio doble en una fila: un viaje con una remisión por remolque", () => {
    const [p] = armarViajes(leer(fila({ folio: "UL-10 / UL-11" })), ctx).previas;
    expect([p.estado, p.folio, p.remisiones, p.viaje?.folio]).toEqual(["nuevo", "UL-10", ["UL-10", "UL-11"], "UL-10"]);
  });
  it("el mismo folio doble en dos filas: dos viajes, cada uno con su folio en orden de fecha", () => {
    const r = armarViajes(
      leer(fila({ folio: "UL-26/30", fecha: d("2026-01-27") }), fila({ folio: "UL-26/30", fecha: d("2026-01-24") })),
      ctx,
    );
    expect(r.previas.map((p) => [p.fila, p.estado, p.folio, p.remisiones])).toEqual([
      [4, "nuevo", "UL-30", []],
      [5, "nuevo", "UL-26", []],
    ]);
    expect(r.previas[0].avisos[0]).toMatch(/Comparten factura al cliente/);
  });
  it("un folio repetido sin partes es error; uno que ya existe se omite", () => {
    const r = armarViajes(leer(fila({ folio: "F-1" }), fila({ folio: "F-1" }), fila({ folio: "f-900" })), ctx);
    expect(r.previas.map((p) => p.estado)).toEqual(["error", "error", "existe"]);
    expect(r.previas[0].errores[0]).toMatch(/se repite en las filas 4, 5/);
    expect(r.previas[2].viaje).toBeNull();
  });
});

describe("armar viajes", () => {
  it("diésel con el importe real del Excel, precio a 4 decimales y factura 16 %", () => {
    const [p] = armarViajes(leer(fila({})), ctx).previas;
    expect(p.viaje?.carga).toEqual({
      fuente: "TARJETA X",
      litros: 1000,
      precio_litro: 27.0116,
      importe: 27011.64,
      tiene_factura: true,
      iva: 3725.74,
    });
  });
  it("gastos: casetas con factura y sus partes en notas; otros y gastos operativos sin factura", () => {
    const [p] = armarViajes(leer(fila({ otros: 564, gastosOp: 3482.4, urea: 987.2, mantenimiento: 1300 })), ctx).previas;
    expect(p.viaje?.gastos).toEqual([
      { categoria: "Casetas", monto: 1642.5, tiene_factura: true, iva: 226.55, notas: "Del Excel: 1178 + 464.5" },
      { categoria: "Otros", monto: 564, tiene_factura: false, iva: 0, notas: null },
      { categoria: "Urea (DEF)", monto: 987.2, tiene_factura: true, iva: 136.17, notas: null },
      { categoria: "Gastos operativos", monto: 3482.4, tiene_factura: false, iva: 0, notas: null },
      { categoria: "Reparaciones en ruta", monto: 1300, tiene_factura: true, iva: 179.31, notas: null },
    ]);
  });
  it("tramos sin odómetros, tarifa por tonelada y pago manual", () => {
    const [p] = armarViajes(leer(fila({})), ctx).previas;
    expect(p.viaje).toMatchObject({
      dia: "2026-01-05",
      unidad_id: "u-1",
      operador: "PEDRO PRUEBA",
      // El cliente toma el nombre del catálogo aunque cambien mayúsculas.
      cliente: "Cliente Uno",
      origen: "LUGAR A",
      destino: "LUGAR B",
      km_vacio: 600,
      km_cargado: 480,
      toneladas: 80,
      tarifa: 650,
      pago_manual: 6552,
      notas: "Importado de «control.xlsx», fila 4",
    });
    expect(p.ingreso).toBe(52000);
  });
  it("operador, cliente y fuente nuevos se dan de alta", () => {
    const r = armarViajes(leer(fila({ operador: "NUEVO OPERADOR", cliente: "OTRO CLIENTE", fuente: "OTRA TARJETA" })), ctx);
    expect(r.nuevos).toEqual({ operadores: ["NUEVO OPERADOR"], clientes: ["OTRO CLIENTE"], fuentes: ["OTRA TARJETA"] });
  });
  it("errores: unidad que no existe, sin fecha, números negativos, litros sin fuente", () => {
    const [p] = armarViajes(leer(fila({ unidad: "T9", fecha: "ayer", casetas: -5, fuente: "" })), ctx).previas;
    expect(p.estado).toBe("error");
    expect(p.errores).toEqual([
      "Fecha inválida o vacía",
      "La unidad T9 no está en el catálogo",
      "Negativo: Casetas",
      "Hay litros pero falta la fuente del diésel (dispersión)",
    ]);
  });
  it("avisos sin bloquear: sin litros, km en 0, km altos, rendimiento, ingreso y costo total que no cuadran", () => {
    const r = armarViajes(
      leer(
        fila({ litros: null, kmVacio: null }),
        fila({ folio: "F-002", kmVacio: 2183, kmCargado: 1140, litros: 100, costoDiesel: 2701.16 }),
        fila({ folio: "F-003", ingreso: 1, costoTotal: 5 }),
      ),
      ctx,
    );
    expect(r.previas.map((p) => p.estado)).toEqual(["nuevo", "nuevo", "nuevo"]);
    expect(r.previas[0].avisos).toEqual(["Km vacío en 0", "Sin litros: el viaje entra sin carga de diésel"]);
    expect(r.previas[0].viaje?.carga).toBeNull();
    expect(r.previas[1].avisos).toEqual(["Km totales mayores a 3,000 (3,323)", "Rendimiento de 33.23 km/l (fuera de 0.8 a 3)"]);
    expect(r.previas[2].avisos[0]).toMatch(/El ingreso del Excel .* no es tarifa × toneladas/);
    expect(r.previas[2].avisos[1]).toMatch(/El costo total del Excel .* no cuadra/);
  });
  it("avisa si la fórmula del ingreso usa otra fila", () => {
    const h = leerHojaViajes(hoja(fila({}), fila({ folio: "F-002" })), { AA4: "Y4*Z4", AA5: "Y5*Z4" });
    if ("error" in h) throw new Error(h.error);
    const r = armarViajes(h.filas, ctx);
    expect(r.previas[0].avisos).toEqual([]);
    expect(r.previas[1].avisos).toEqual(["La fórmula del ingreso en el Excel (=Y5*Z4) usa datos de otra fila; aquí se calcula con los de esta"]);
  });
  it("toneladas con 3 decimales (kilos)", () => {
    const [p] = armarViajes(leer(fila({ toneladas: 80.515 })), ctx).previas;
    expect([p.viaje?.toneladas, p.ingreso]).toEqual([80.515, 52334.75]);
  });
  it("el costo total del Excel cuadra con diésel + gastos + pago (sin aviso)", () => {
    const [p] = armarViajes(leer(fila({ costoTotal: 27011.63578 + 1642.5 + 6552 })), ctx).previas;
    expect(p.avisos).toEqual([]);
  });
  it("plantilla: diésel y casetas sin factura, remisiones y factura al cliente", () => {
    const filas = leer(fila({}));
    const [p] = armarViajes([{ ...filas[0], dieselConFactura: false, casetasConFactura: false, remisiones: "R-1, R-2", factura: "A-77" }], ctx).previas;
    expect(p.viaje?.carga?.iva).toBe(0);
    expect(p.viaje?.gastos[0].iva).toBe(0);
    expect([p.viaje?.remisiones, p.viaje?.factura_cliente]).toEqual([["R-1", "R-2"], "A-77"]);
  });
});

describe("costos por unidad y mes", () => {
  const kpis = [
    ["Unidad", "Mes", "Km Totales", "MTTO TRACTO", "MTTO EQUIPO ARRASTRE", "MMTO OTROS", "Llantas/Rines", "Costo Mantto Total"],
    ["T1", 1, 0, null, null, null, null, 0],
    ["T1", 3, 4407, 6263.79, 4053.02, null, null, 10316.81],
    ["T2", 4, 100, null, null, 13000, 3618, 16618],
    ["T9", 5, 100, 10, null, null, null, 10],
  ];
  const leidas = () => {
    const r = leerHojaCostos(kpis, { D3: "6000+263.79" });
    if ("error" in r) throw new Error(r.error);
    return r.filas;
  };
  it("lee solo las filas con montos", () => {
    expect(leidas().map((f) => [f.fila, f.unidad, f.mes])).toEqual([[3, "T1", 3], [4, "T2", 4], [5, "T9", 5]]);
  });
  it("cada monto es un subtotal sin IVA: con factura, costo = monto, total = monto × 1.16", () => {
    const previas = armarCostos(leidas(), { archivo: "control.xlsx", anio: 2026, unidades: ctx.unidades, existentes: [] });
    expect(previas.map((p) => [p.unidad, p.mes, p.categoria, p.estado])).toEqual([
      ["T1", "2026-03-01", "Mantenimiento tracto", "nuevo"],
      ["T1", "2026-03-01", "Mantenimiento equipo de arrastre", "nuevo"],
      ["T2", "2026-04-01", "Otros", "nuevo"],
      ["T2", "2026-04-01", "Llantas y rines", "nuevo"],
      ["T9", "2026-05-01", "Mantenimiento tracto", "error"],
    ]);
    expect(previas[0].costo).toEqual({
      fila: 3,
      unidad_id: "u-1",
      categoria: "Mantenimiento tracto",
      mes: "2026-03-01",
      monto: 7266.0,
      iva: 1002.21,
      notas: "Importado de «control.xlsx», fila 3: subtotal sin IVA (6000 + 263.79)",
    });
    // costo para rentabilidad = monto − IVA = el subtotal del Excel
    expect(previas[0].costo!.monto - previas[0].costo!.iva).toBeCloseTo(6263.79, 2);
  });
  it("lo que ya se importó en otro lote se omite", () => {
    const existentes = [llaveCosto("u-1", "2026-03-01", "Mantenimiento tracto")];
    const previas = armarCostos(leidas(), { archivo: "x", anio: 2026, unidades: ctx.unidades, existentes });
    expect(previas[0].estado).toBe("existe");
    expect(previas[1].estado).toBe("nuevo");
  });
  it("el año sale de los viajes", () => {
    expect(anioMasComun(leer(fila({}), fila({ folio: "F-2" })), 2030)).toBe(2026);
    expect(anioMasComun([], 2030)).toBe(2030);
  });
});

describe("fórmulas del .xlsx", () => {
  it("lee las fórmulas de la hoja pedida por su nombre", () => {
    const xlsx = zipSync({
      "xl/workbook.xml": strToU8('<workbook><sheets><sheet name="Viajes" sheetId="1" r:id="rId1"/><sheet name="Otra" sheetId="2" r:id="rId2"/></sheets></workbook>'),
      "xl/_rels/workbook.xml.rels": strToU8(
        '<Relationships><Relationship Id="rId1" Type="x" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="x" Target="worksheets/sheet2.xml"/></Relationships>',
      ),
      "xl/worksheets/sheet1.xml": strToU8(
        '<sheetData><row r="4"><c r="B4"><f t="shared" ref="B4:B9" si="0">MONTH(A4)</f><v>1</v></c><c r="B5"><f t="shared" si="0"/><v>1</v></c><c r="S4" s="31"><f>1178+464.5</f><v>1642.5</v></c><c r="T4" s="8"/></row></sheetData>',
      ),
      "xl/worksheets/sheet2.xml": strToU8('<sheetData><row r="1"><c r="A1"><f>1+1</f></c></row></sheetData>'),
    });
    expect(leerFormulas(xlsx, ["Viajes"])).toEqual({ Viajes: { B4: "MONTH(A4)", S4: "1178+464.5" } });
  });
  it("columnas y sumas", () => {
    expect([letraColumna(0), letraColumna(18), letraColumna(26), letraColumna(27)]).toEqual(["A", "S", "AA", "AB"]);
    expect(partesDeSuma("=100+78.78+506.58")).toEqual([100, 78.78, 506.58]);
    expect(partesDeSuma("1001.72")).toBeNull();
    expect(partesDeSuma("Y137*Z136")).toBeNull();
  });
});

describe("plantilla", () => {
  it("todas sus columnas se reconocen al leer", () => {
    const v = leerHojaViajes([PLANTILLA_VIAJES, ["01/02/2026", "P-1", "T1", "PEDRO PRUEBA", "A", "B", "", 10, 20, 30, "TARJETA X", 25, "", "no", 100, "sí", "", "", "", "", 650, 30.5, 1000, "R-1", "F-1"]]);
    // Costo total e ingreso solo sirven para comparar contra un control propio.
    expect("error" in v ? v.error : v.faltantes).toEqual(["Costo total", "Ingreso"]);
    if ("error" in v) return;
    expect(v.filas[0]).toMatchObject({ fecha: "2026-02-01", dieselConFactura: false, casetasConFactura: true, remisiones: "R-1", factura: "F-1" });
    const c = leerHojaCostos([PLANTILLA_COSTOS, ["T1", 2025, 12, 100, null, null, 50]]);
    expect("error" in c ? c.error : c.faltantes).toEqual([]);
    if ("error" in c) return;
    expect(c.filas[0]).toMatchObject({ anio: 2025, mes: 12, montos: { mttoTracto: 100, llantas: 50 } });
  });
});
