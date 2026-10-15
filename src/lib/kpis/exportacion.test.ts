import { describe, expect, it } from "vitest";
import { calcularKpis, tendencia, type EntradaKpis } from "./index";
import { hojasTablero } from "./exportacion";

const vacia: EntradaKpis = {
  viajes: [],
  unidades: [],
  nombres: { operadores: {}, clientes: {} },
  costos: [],
  armados: [],
  incluirCategoria: {},
  nombreCategoriaCosto: {},
  metodoProrrateo: "partes_iguales",
  parametros: { toleranciaPct: 5, precioDiesel: null, diasAlertaViajeAbierto: 5, horasLimiteEstadia: 6 },
  ahora: "2026-10-31T00:00:00Z",
};

describe("hojasTablero", () => {
  it("arma todas las hojas y, con filtro de operador, oculta los indicadores de costos fijos", () => {
    const k = calcularKpis(vacia, ["2026-10"], { operador: "O1" });
    const hojas = hojasTablero(k, calcularKpis(vacia, ["2026-09"], { operador: "O1" }), tendencia(vacia, ["2026-10"]), "Octubre");
    expect(hojas.map((h) => h.nombre)).toEqual([
      "Resumen", "Gastos y costos", "Unidades", "Clientes", "Rutas", "Operadores", "Tarifas por ruta", "Clientes: tiempos", "Alertas", "Tendencia",
    ]);
    const nombres = hojas[0].filas.map((f) => f[0]);
    expect(nombres).toContain("Costo variable por km");
    expect(nombres).not.toContain("Costo fijo por unidad al mes");
    // Nombres de tu Excel, con su significado correcto
    expect(nombres).toContain("Margen %");
    expect(nombres).toContain("Utilidad sobre costo %");
  });
});
