/**
 * ¿A dónde va un usuario según tenga o no empresa? Prueba las funciones reales
 * de sesion.ts y la acción crearEmpresa, con Supabase y Next simulados.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { destinoInicial } from "./acceso";

// redirect() de Next lanza una excepción; aquí lanza una fácil de reconocer.
class Redireccion extends Error {
  constructor(public destino: string) {
    super(`redirect ${destino}`);
  }
}

const supabase = vi.hoisted(() => ({
  membresias: [] as { empresa_id: string; rol: string; empresas: { nombre: string } }[],
  rpc: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("next/server", () => ({ connection: async () => {} }));
vi.mock("next/cache", () => ({ cacheLife: () => {} }));
vi.mock("next/navigation", () => ({
  redirect: (destino: string) => {
    throw new Redireccion(destino);
  },
}));
vi.mock("@/lib/supabase/env", () => ({
  supabaseEnv: () => ({ url: "https://prueba.supabase.co", anonKey: "anon" }),
}));
vi.mock("@/lib/supabase/server", () => ({
  crearClienteServidor: async () => ({
    auth: {
      getUser: async () => ({
        data: { user: { id: "u1", email: "alan@urma.mx", email_confirmed_at: "2026-10-14T18:00:00Z" } },
      }),
    },
    from: () => {
      const consulta = {
        select: () => consulta,
        eq: () => consulta,
        order: async () => ({ data: supabase.membresias, error: null }),
      };
      return consulta;
    },
    rpc: supabase.rpc,
  }),
}));
// /auth/v1/settings: confirmación de correo encendida.
vi.stubGlobal("fetch", async () => new Response(JSON.stringify({ mailer_autoconfirm: false })));

const { usuarioConEmpresa, usuarioSinEmpresa } = await import("./sesion");
const { crearEmpresa } = await import("@/app/(acceso)/acciones");

/** Corre fn y devuelve a dónde redirigió, o null si no redirigió. */
async function destinoDe(fn: () => Promise<unknown>) {
  try {
    await fn();
    return null;
  } catch (e) {
    if (e instanceof Redireccion) return e.destino;
    throw e;
  }
}

const conEmpresa = () => {
  supabase.membresias = [{ empresa_id: "e1", rol: "dueno", empresas: { nombre: "URMA Logistic" } }];
};

const formEmpresa = () => {
  const f = new FormData();
  f.set("nombre", "URMA Logistic");
  return f;
};

beforeEach(() => {
  supabase.membresias = [];
  supabase.rpc.mockReset();
  supabase.rpc.mockResolvedValue({ data: "e-nueva", error: null });
});

describe("destinoInicial", () => {
  it("con empresa va al tablero; sin empresa, al alta", () => {
    expect(destinoInicial([{ empresaId: "e1" }])).toBe("/tablero");
    expect(destinoInicial([])).toBe("/alta-empresa");
  });
});

describe("tablero (usuarioConEmpresa)", () => {
  it("usuario con empresa: entra al tablero con su empresa", async () => {
    conEmpresa();
    const u = await usuarioConEmpresa();
    expect(u.empresa).toEqual({
      empresaId: "e1",
      empresaNombre: "URMA Logistic",
      rol: "dueno",
      veTarifas: true,
      veUtilidades: true,
      veCostos: true,
      puedeReabrir: true,
    });
  });
  it("usuario sin empresa: va al alta", async () => {
    expect(await destinoDe(usuarioConEmpresa)).toBe("/alta-empresa");
  });
});

describe("alta de empresa (usuarioSinEmpresa)", () => {
  it("usuario con empresa: va al tablero, no ve el formulario", async () => {
    conEmpresa();
    expect(await destinoDe(usuarioSinEmpresa)).toBe("/tablero");
  });
  it("usuario sin empresa: ve el formulario", async () => {
    expect(await destinoDe(usuarioSinEmpresa)).toBeNull();
  });
});

describe("crearEmpresa", () => {
  it("si ya tiene empresa no crea otra y lo manda al tablero", async () => {
    conEmpresa();
    expect(await destinoDe(() => crearEmpresa({}, formEmpresa()))).toBe("/tablero");
    expect(supabase.rpc).not.toHaveBeenCalled();
  });
  it("sin empresa la crea y va al tablero", async () => {
    expect(await destinoDe(() => crearEmpresa({}, formEmpresa()))).toBe("/tablero");
    expect(supabase.rpc).toHaveBeenCalledWith("crear_empresa", { p_nombre: "URMA Logistic", p_rfc: null });
  });
  it("si la base rechaza un duplicado (doble envío simultáneo), va al tablero sin error", async () => {
    supabase.rpc.mockResolvedValue({ data: null, error: { message: "Ya perteneces a una empresa" } });
    expect(await destinoDe(() => crearEmpresa({}, formEmpresa()))).toBe("/tablero");
  });
});
