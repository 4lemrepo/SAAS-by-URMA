import { describe, expect, it } from "vitest";
import { correoConfirmado, esLimiteDeEnvios, motivoBloqueo } from "./acceso";

const encendida = { confirmacionApagada: false };

describe("correoConfirmado", () => {
  it("acepta una fecha de confirmación válida", () => {
    expect(correoConfirmado({ email_confirmed_at: "2026-10-14T18:00:00Z" })).toBe(true);
  });
  it.each([null, undefined, {}, { email_confirmed_at: null }, { email_confirmed_at: "" }, { email_confirmed_at: "no-es-fecha" }])(
    "rechaza %j",
    (usuario) => {
      expect(correoConfirmado(usuario)).toBe(false);
    },
  );
});

describe("motivoBloqueo", () => {
  it("deja entrar a un usuario confirmado", () => {
    expect(motivoBloqueo({ email_confirmed_at: "2026-10-14T18:00:00Z" }, encendida)).toBeNull();
  });
  it("bloquea a un usuario sin confirmar aunque tenga sesión", () => {
    expect(motivoBloqueo({ email_confirmed_at: null }, encendida)).toBe("sin_confirmar");
    expect(motivoBloqueo(null, encendida)).toBe("sin_confirmar");
  });
  it("bloquea a todos si la confirmación está apagada en Supabase (Auth autoconfirma)", () => {
    expect(motivoBloqueo({ email_confirmed_at: "2026-10-14T18:00:00Z" }, { confirmacionApagada: true }))
      .toBe("confirmacion_apagada");
  });
});

describe("esLimiteDeEnvios", () => {
  it("reconoce los límites de Supabase Auth", () => {
    expect(esLimiteDeEnvios({ status: 429 })).toBe(true);
    expect(esLimiteDeEnvios({ code: "over_email_send_rate_limit" })).toBe(true);
    expect(esLimiteDeEnvios({ code: "over_request_rate_limit", status: 400 })).toBe(true);
    expect(esLimiteDeEnvios({ code: "email_not_confirmed", status: 400 })).toBe(false);
    expect(esLimiteDeEnvios(null)).toBe(false);
  });
});
