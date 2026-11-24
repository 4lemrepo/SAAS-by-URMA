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
  it("sin «ve utilidades»: solo lo operativo, sin pesos del negocio", () => {
    const k = calcularKpis(vacia, ["2026-10"]);
    const hojas = hojasTablero(k, k, tendencia(vacia, ["2026-10"]), "Octubre", false);
    expect(hojas.map((h) => h.nombre)).toEqual(["Resumen", "Unidades", "Clientes", "Rutas", "Operadores", "Clientes: tiempos", "Alertas", "Tendencia"]);
    const nombres = hojas[0].filas.map((f) => f[0]);
    for (const n of ["Viajes", "Km totales", "% km vacío", "Km/l real", "Litros faltantes", "Pesos faltantes", "Km sin viaje"]) expect(nombres).toContain(n);
    for (const n of ["Ingreso", "Utilidad", "Pago al operador", "Costo total por km", "Costo de diésel", "Margen %"]) expect(nombres).not.toContain(n);
    expect(hojas[1].filas[0]).not.toContain("Utilidad");
    expect(hojas[1].filas[0]).toContain("% viajes con desvío");
  });
});
