import { describe, expect, it } from "vitest";
import { rutaSegura, validarCredenciales, validarEmpresa } from "./validacion";

const form = (campos: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(campos)) f.set(k, v);
  return f;
};

describe("validarCredenciales", () => {
  it("normaliza el correo y acepta credenciales válidas", () => {
    expect(validarCredenciales(form({ correo: "  Alan@URMA.mx ", contrasena: "secreto123" })))
      .toEqual({ ok: true, datos: { correo: "alan@urma.mx", contrasena: "secreto123" } });
  });
  it("rechaza correo inválido y contraseña vacía", () => {
    const r = validarCredenciales(form({ correo: "alan", contrasena: "" }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(Object.keys(r.errores).sort()).toEqual(["contrasena", "correo"]);
  });
  it("exige largo mínimo solo en cuentas nuevas", () => {
    const f = form({ correo: "a@b.mx", contrasena: "corta" });
    expect(validarCredenciales(f).ok).toBe(true);
    expect(validarCredenciales(f, { nueva: true }).ok).toBe(false);
  });
});

describe("validarEmpresa", () => {
  it("acepta empresa sin RFC y limpia espacios", () => {
    expect(validarEmpresa(form({ nombre: "  URMA   Logística ", rfc: "" })))
      .toEqual({ ok: true, datos: { nombre: "URMA Logística", rfc: null } });
  });
  it("acepta RFC de persona moral y física en minúsculas", () => {
    expect(validarEmpresa(form({ nombre: "URMA", rfc: "urm010101ab1" })).ok).toBe(true);
    expect(validarEmpresa(form({ nombre: "URMA", rfc: "URBA900101AB1" })).ok).toBe(true);
  });
  it("rechaza RFC mal formado y nombre corto", () => {
    const r = validarEmpresa(form({ nombre: "U", rfc: "123" }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(Object.keys(r.errores).sort()).toEqual(["nombre", "rfc"]);
  });
});

describe("rutaSegura", () => {
  it("deja pasar rutas internas", () => {
    expect(rutaSegura("/viajes?semana=3")).toBe("/viajes?semana=3");
  });
  it.each([
    "https://malo.com",
    "//malo.com",
    "/\\malo.com",
    "javascript:alert(1)",
    "",
    null,
  ])("bloquea %s", (destino) => {
    expect(rutaSegura(destino)).toBe("/tablero");
  });
});
