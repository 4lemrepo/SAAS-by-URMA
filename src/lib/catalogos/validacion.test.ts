import { describe, expect, it } from "vitest";
import { CATALOGOS, esClaveCatalogo } from "./definiciones";
import { claveComparacion, llaveDuplicado, parsearNumero, validarRegistro } from "./validacion";

describe("parsearNumero", () => {
  it.each([
    ["2.5", 2.5],
    ["2,5", 2.5],
    [" 2.45 ", 2.45],
    ["1,500", 1500],
    ["1,234.5", 1234.5],
    ["1 500", 1500],
    [".5", 0.5],
    [1500, 1500],
  ])("%j → %d", (entrada, esperado) => {
    expect(parsearNumero(entrada)).toBe(esperado);
  });
  it("vacío es null", () => {
    expect(parsearNumero("")).toBeNull();
    expect(parsearNumero("  ")).toBeNull();
    expect(parsearNumero(null)).toBeNull();
    expect(parsearNumero(undefined)).toBeNull();
  });
  it.each(["2.5 km/l", "abc", "1.2.3", "--1", Infinity])("%j no es número", (entrada) => {
    expect(parsearNumero(entrada)).toBeNaN();
  });
});

describe("validarRegistro: unidades", () => {
  const def = CATALOGOS.unidades;
  it("normaliza y acepta una unidad completa", () => {
    const r = validarRegistro(def, {
      numero_economico: " u-0708 ",
      placas: "ab-123-cd",
      numero_serie: "3akjgld5xgsga0001",
      marca: "Kenworth",
      modelo: "T680",
      anio: "2019",
      rend_cargado_kml: "2,2",
      rend_vacio_kml: 3.1,
    });
    expect(r).toEqual({
      ok: true,
      datos: {
        numero_economico: "U-0708",
        placas: "AB-123-CD",
        numero_serie: "3AKJGLD5XGSGA0001",
        marca: "Kenworth",
        modelo: "T680",
        anio: 2019,
        rend_cargado_kml: 2.2,
        rend_vacio_kml: 3.1,
      },
    });
  });
  it("solo el número económico es obligatorio", () => {
    const r = validarRegistro(def, { numero_economico: "708" });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.datos).toMatchObject({ numero_economico: "708", numero_serie: null, anio: null, rend_vacio_kml: null });
  });
  it("marca cada campo con error", () => {
    const r = validarRegistro(def, {
      numero_economico: "",
      anio: "2019.5",
      rend_cargado_kml: "0",
      rend_vacio_kml: "25",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errores).toEqual({
        numero_economico: "Requerido",
        anio: "Escribe un número entero",
        rend_cargado_kml: "Debe ser mayor que cero",
        rend_vacio_kml: "Máximo 15 km/l",
      });
    }
  });
});

describe("validarRegistro: remolques y dollies", () => {
  const tipos = { tipo_id: [{ valor: "id-tolva", etiqueta: "Tolva" }, { valor: "id-gondola", etiqueta: "Góndola granelera" }] };
  it("el tipo se elige por id (formulario) o por nombre (archivo)", () => {
    const base = { placas: "10-ab-1a", numero_serie: "s-1" };
    const porId = validarRegistro(CATALOGOS.remolques, { ...base, tipo_id: "id-tolva" }, tipos);
    expect(porId.ok && porId.datos.tipo_id).toBe("id-tolva");
    const porNombre = validarRegistro(CATALOGOS.remolques, { ...base, tipo_id: "gondola granelera" }, tipos);
    expect(porNombre).toEqual({
      ok: true,
      datos: { placas: "10-AB-1A", numero_serie: "S-1", tipo_id: "id-gondola", numero_economico: null },
    });
  });
  it("rechaza un tipo que no está en el catálogo y exige placas y serie", () => {
    const r = validarRegistro(CATALOGOS.remolques, { tipo_id: "otro-id" }, tipos);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errores).toEqual({ placas: "Requerido", numero_serie: "Requerido", tipo_id: "Elige una opción de la lista" });
    }
  });
  it("el dolly solo exige número de serie", () => {
    expect(validarRegistro(CATALOGOS.dollies, { numero_serie: "d-001" })).toEqual({
      ok: true,
      datos: { numero_serie: "D-001", numero_economico: null },
    });
    expect(validarRegistro(CATALOGOS.dollies, { numero_economico: "D1" }).ok).toBe(false);
  });
});

describe("validarRegistro: otros catálogos", () => {
  it("operador: nombre obligatorio y teléfono de números", () => {
    expect(validarRegistro(CATALOGOS.operadores, { nombre: "Juan Pérez", telefono: "33 1234 5678" }).ok).toBe(true);
    const r = validarRegistro(CATALOGOS.operadores, { nombre: "J", telefono: "llámale" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(Object.keys(r.errores).sort()).toEqual(["nombre", "telefono"]);
  });
  it("cliente: RFC opcional, en mayúsculas y bien formado", () => {
    const r = validarRegistro(CATALOGOS.clientes, { nombre: "Agro SA", rfc: "agr010101ab1" });
    expect(r).toEqual({ ok: true, datos: { nombre: "Agro SA", rfc: "AGR010101AB1", factura_por: "cargado" } });
    expect(validarRegistro(CATALOGOS.clientes, { nombre: "Agro SA", rfc: "123" }).ok).toBe(false);
  });
  it("ruta: km obligatorio y mayor que cero; rendimientos opcionales", () => {
    expect(validarRegistro(CATALOGOS.rutas, { origen: "La Barca", destino: "Guadalajara", km: "110" }).ok).toBe(true);
    const r = validarRegistro(CATALOGOS.rutas, { origen: "La Barca", destino: "Guadalajara", km: "0" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errores).toEqual({ km: "Debe ser mayor que cero" });
  });
  it("fuente: el tipo acepta etiqueta o valor, con o sin acento", () => {
    for (const tipo of ["Estación", "estacion", "ESTACION"]) {
      const r = validarRegistro(CATALOGOS.fuentes, { nombre: "Gasolinera X", tipo });
      expect(r.ok && r.datos.tipo).toBe("estacion");
    }
    for (const tipo of ["tanque propio", "tanque_propio", "Tanque Propio"]) {
      const r = validarRegistro(CATALOGOS.fuentes, { nombre: "Tanque", tipo });
      expect(r.ok && r.datos.tipo).toBe("tanque_propio");
    }
    expect(validarRegistro(CATALOGOS.fuentes, { nombre: "Tanque" }).ok).toBe(false);
  });
});

describe("duplicados", () => {
  it("la llave ignora mayúsculas, espacios y acentos", () => {
    expect(claveComparacion("  Ocotlán  JAL ")).toBe("ocotlan jal");
    const a = llaveDuplicado(CATALOGOS.rutas, { origen: "Ocotlán", destino: "León" });
    const b = llaveDuplicado(CATALOGOS.rutas, { origen: "ocotlan ", destino: "LEON" });
    expect(a).toBe(b);
  });
});

describe("esClaveCatalogo", () => {
  it("solo acepta catálogos conocidos", () => {
    expect(esClaveCatalogo("unidades")).toBe(true);
    expect(esClaveCatalogo("miembros")).toBe(false);
    expect(esClaveCatalogo("toString")).toBe(false);
  });
});
