import { describe, expect, it } from "vitest";
import { puede, puedeRevisarCarga } from "./permisos";

describe("puede", () => {
  it("el dueño puede todo", () => {
    expect(puede("dueno", "administrarUsuarios")).toBe(true);
    expect(puede("dueno", "editarParametros")).toBe(true);
    expect(puede("dueno", "verConciliacion")).toBe(true);
  });
  it("administración opera pero no administra usuarios ni parámetros", () => {
    expect(puede("administracion", "editarCatalogos")).toBe(true);
    expect(puede("administracion", "validarCargas")).toBe(true);
    expect(puede("administracion", "verConciliacion")).toBe(true);
    expect(puede("administracion", "administrarUsuarios")).toBe(false);
    expect(puede("administracion", "editarParametros")).toBe(false);
  });
  it("captura solo captura y consulta catálogos", () => {
    expect(puede("captura", "capturar")).toBe(true);
    expect(puede("captura", "verCatalogos")).toBe(true);
    expect(puede("captura", "editarCatalogos")).toBe(false);
    expect(puede("captura", "editarParametros")).toBe(false);
    expect(puede("captura", "validarCargas")).toBe(false);
    expect(puede("captura", "verConciliacion")).toBe(false);
  });
  it("un rol desconocido (p. ej. el antiguo operador) no puede nada", () => {
    expect(puede("operador" as never, "verCatalogos")).toBe(false);
  });
});

describe("puedeRevisarCarga", () => {
  const pendiente = { capturadoPor: "u-captura", estado: "pendiente" as const };
  it("administración y dueño revisan cargas pendientes de otros", () => {
    expect(puedeRevisarCarga("administracion", "u-admin", pendiente)).toBe(true);
    expect(puedeRevisarCarga("dueno", "u-dueno", pendiente)).toBe(true);
  });
  it("administración no revisa lo que capturó; el dueño sí (autovalidada)", () => {
    expect(puedeRevisarCarga("administracion", "u-admin", { ...pendiente, capturadoPor: "u-admin" })).toBe(false);
    expect(puedeRevisarCarga("dueno", "u-dueno", { ...pendiente, capturadoPor: "u-dueno" })).toBe(true);
  });
  it("captura no revisa; una carga ya revisada no se vuelve a revisar", () => {
    expect(puedeRevisarCarga("captura", "otro", pendiente)).toBe(false);
    expect(puedeRevisarCarga("administracion", "u-admin", { ...pendiente, estado: "validada" })).toBe(false);
  });
});
