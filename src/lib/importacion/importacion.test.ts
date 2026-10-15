// Datos inventados: nunca usar datos reales de clientes en pruebas.
import { describe, expect, it } from "vitest";
import { CATALOGOS } from "@/lib/catalogos/definiciones";
import { kmDeRuta, leerControlDeViajes, rutaRequiereDecision, type ControlDeViajes } from "./control";
import { parsearCsv } from "./csv";
import { encabezadosPlantilla, entradasDeFilas, mapearEncabezados, resumen, validarRegistros } from "./plantilla";

describe("parsearCsv", () => {
  it("lee comas, comillas y saltos de línea dentro de comillas", () => {
    expect(parsearCsv('a,b\n"x, y","di ""hola""\nadiós"\n')).toEqual([
      ["a", "b"],
      ["x, y", 'di "hola"\nadiós'],
    ]);
  });
  it("detecta punto y coma (Excel en español), CRLF y BOM", () => {
    expect(parsearCsv("﻿Nombre;Teléfono\r\nAna López;3312345678\r\n")).toEqual([
      ["Nombre", "Teléfono"],
      ["Ana López", "3312345678"],
    ]);
  });
  it("detecta tabuladores", () => {
    expect(parsearCsv("a\tb\n1\t2")).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
  });
});

describe("plantilla", () => {
  const def = CATALOGOS.unidades;
  it("los encabezados marcan con * lo obligatorio", () => {
    expect(encabezadosPlantilla(def)[0]).toBe("Número económico *");
    expect(encabezadosPlantilla(CATALOGOS.remolques)).toContain("Número económico");
  });
  it("relaciona encabezados sin importar acentos, mayúsculas, espacios ni *", () => {
    const m = mapearEncabezados(def, ["NUMERO ECONOMICO *", " placas ", "Color", null]);
    expect(m.indices).toEqual({ numero_economico: 0, placas: 1 });
    expect(m.faltantes).toEqual([]);
    expect(m.ignoradas).toEqual(["Color"]);
  });
  it("avisa si falta una columna obligatoria (salvo las que tienen valor por defecto)", () => {
    expect(mapearEncabezados(CATALOGOS.rutas, ["Origen", "Destino"]).faltantes).toEqual(["Kilómetros"]);
    expect(mapearEncabezados(CATALOGOS.clientes, ["Nombre o razón social"]).faltantes).toEqual([]);
  });
});

describe("validarRegistros", () => {
  const def = CATALOGOS.unidades;
  const mapeo = mapearEncabezados(def, ["Número económico", "Placas", "Año"]);
  const filas = [
    ["U-01", "AB-1", 2019],
    ["", "", ""],
    ["u-02", "AB-2", "dos mil"],
    [" U-01 ", "AB-9", 2020],
    ["U-03", "AB-3", null],
    ["U-04", null, 2021],
  ];
  const previa = validarRegistros(def, entradasDeFilas(filas, mapeo), [{ numero_economico: "U-04" }]);

  it("numera por fila del archivo y salta las vacías", () => {
    expect(previa.map((f) => f.numero)).toEqual([2, 4, 5, 6, 7]);
  });
  it("marca errores por campo, duplicados del archivo y existentes", () => {
    expect(previa.map((f) => f.estado)).toEqual(["nueva", "error", "error", "nueva", "existe"]);
    expect(previa[1].errores).toEqual({ anio: "Escribe un número" });
    expect(previa[2].aviso).toBe("Repetida: es igual a la fila 2");
    expect(previa[4].aviso).toBe("Ya está en el catálogo: se omite");
    expect(resumen(previa)).toEqual({ nuevas: 2, existentes: 1, errores: 2 });
  });
  it("las filas nuevas traen los datos listos para guardar", () => {
    expect(previa[0].datos).toMatchObject({ numero_economico: "U-01", placas: "AB-1", anio: 2019 });
  });
});

describe("leerControlDeViajes", () => {
  const hoja = [
    ["CONTROL DE PRUEBA"],
    [],
    ["Fecha", "Unidad", "Placas", "Operador", "Origen", "Destino", "Ruta", "CLIENTE", "Km vacío", "Km cargado", "Litros", " DISPERSION"],
    [new Date(), "X1", "AAA111 ", "ANA PRUEBA", "PUEBLO A", "PUEBLO B", "", "CLIENTE UNO", 100, 400, 400, "TARJETA Z"],
    [new Date(), "X1", "AAA111", "Ana  Prueba ", "pueblo a ", "PUEBLO B", "", "CLIENTE UNO", 0, 200, 150, "TARJETA Z"],
    [new Date(), "X2", "BBB222", "BETO EJEMPLO", "PUEBLO A", "PUEBLO B", "", "CLIENTE DOS", 50, 400, null, "TARJETA Z"],
    [new Date(), "X2", "BBB222", "BETO EJEMPLO", "CIUDAD C / PUEBLO A", "PUEBLO D", "", "CLIENTE DOS", 0, 300, 250, "TARJETA Z"],
    [new Date(), "X2", "BBB222", "BETO EJEMPLO", "PUEBLO D", "PUEBLO E", "", "CLIENTE DOS", 0, 0, 90, "TARJETA Z"],
    [null, null, null, null, null, null, null, null, null, null, 0, null],
  ];
  const control = leerControlDeViajes(hoja) as ControlDeViajes;

  it("encuentra los encabezados y cuenta solo filas con unidad", () => {
    expect(control.filaEncabezados).toBe(3);
    expect(control.viajes).toBe(5);
  });
  it("normaliza espacios y mayúsculas al agrupar", () => {
    expect(control.operadores).toEqual([
      { nombre: "ANA PRUEBA", viajes: 2 },
      { nombre: "BETO EJEMPLO", viajes: 3 },
    ]);
    expect(control.unidades.map((u) => [u.numero_economico, u.placas])).toEqual([
      ["X1", "AAA111"],
      ["X2", "BBB222"],
    ]);
    expect(control.fuentes).toEqual([{ nombre: "TARJETA Z", viajes: 5 }]);
  });
  it("rendimiento sugerido = km totales ÷ litros de los viajes con ambos", () => {
    // X1: (100 + 400 + 0 + 200) / (400 + 150)
    expect(control.unidades[0].rendimientoSugerido).toBe(1.27);
    expect(control.unidades[0].viajesConLitros).toBe(2);
    // X2: el viaje sin litros y el de 0 km no cuentan: 300 / 250
    expect(control.unidades[1].rendimientoSugerido).toBe(1.2);
  });
  it("agrupa rutas por sentido con sus km distintos; los orígenes compuestos se quedan igual", () => {
    expect(control.rutas.map((r) => [r.origen, r.destino, r.variantes])).toEqual([
      ["CIUDAD C / PUEBLO A", "PUEBLO D", [{ km: 300, viajes: 1 }]],
      ["PUEBLO A", "PUEBLO B", [{ km: 400, viajes: 2 }, { km: 200, viajes: 1 }]],
      ["PUEBLO D", "PUEBLO E", [{ km: null, viajes: 1 }]],
    ]);
  });
  it("pide decisión solo en rutas con km distintos o sin km", () => {
    const [unica, varias, sinKm] = control.rutas;
    expect(rutaRequiereDecision(unica)).toBe(false);
    expect(kmDeRuta(unica, {})).toBe(300);
    expect(rutaRequiereDecision(varias)).toBe(true);
    expect(kmDeRuta(varias, {})).toBeNull();
    expect(kmDeRuta(varias, { [varias.clave]: 200 })).toBe(200);
    expect(rutaRequiereDecision(sinKm)).toBe(true);
  });
  it("explica si la hoja no es un control de viajes", () => {
    expect(leerControlDeViajes([["Nombre", "Teléfono"]])).toEqual({
      error: "No encontré una fila de encabezados con Unidad, Operador, Origen y Destino.",
    });
  });
});
