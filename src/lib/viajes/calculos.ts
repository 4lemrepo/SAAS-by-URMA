/**
 * Cálculos de un viaje. Funciones puras: las usan la pantalla del viaje, la
 * lista, la exportación y el tablero, así todos dan el mismo número.
 *
 * Un viaje = tramo VACÍO (A → B, lugar de carga) + tramo CARGADO (B → C,
 * lugar de descarga). Km de cada tramo = odómetro final − inicial.
 */

export type TipoTramo = "vacio" | "cargado";

export interface Tramo {
  tipo: TipoTramo;
  odometroInicial: number;
  odometroFinal: number;
}

export const kmTramo = (t: Pick<Tramo, "odometroInicial" | "odometroFinal">) => t.odometroFinal - t.odometroInicial;

/**
 * Continuidad con el viaje anterior de la unidad: si el odómetro inicial no es
 * el último registrado, la diferencia son km sin viaje (movimiento no
 * registrado) y se pide explicación. Si es menor, también: el odómetro no regresa.
 */
export function continuidadOdometro(odometroAnterior: number | null, odometroInicial: number | null) {
  if (odometroAnterior === null || odometroInicial === null) return { kmSinViaje: 0, requiereExplicacion: false };
  const diferencia = Math.round((odometroInicial - odometroAnterior) * 10) / 10;
  return { kmSinViaje: diferencia, requiereExplicacion: diferencia !== 0 };
}

// ---------------------------------------------------------------------------
// Ingreso
// ---------------------------------------------------------------------------

export type PesoFactura = "cargado" | "descargado";
export type TipoTarifa = "por_tonelada" | "fija";

export interface Tarifa {
  tipo: TipoTarifa;
  /** $ por tonelada, o el monto del flete si es fija. */
  tarifa: number;
  facturaPor: PesoFactura;
}

/** Toneladas con las que se factura, según el cliente (peso cargado o descargado). */
export function toneladasFacturadas(
  facturaPor: PesoFactura,
  cargadas: number | null,
  descargadas: number | null,
): number | null {
  return facturaPor === "descargado" ? descargadas : cargadas;
}

/** Flete: tarifa × toneladas facturadas, o el monto fijo. null si faltan las toneladas. */
export function flete(t: Tarifa, cargadas: number | null, descargadas: number | null): number | null {
  if (t.tipo === "fija") return t.tarifa;
  const ton = toneladasFacturadas(t.facturaPor, cargadas, descargadas);
  return ton === null ? null : redondear(t.tarifa * ton);
}

// ---------------------------------------------------------------------------
// Pago al operador
// ---------------------------------------------------------------------------

export type EsquemaPago = "pct_subtotal" | "pct_flete" | "por_km" | "por_tonelada" | "fijo" | "sueldo_comision";

export const NOMBRE_ESQUEMA_PAGO: Record<EsquemaPago, string> = {
  pct_subtotal: "% del subtotal de la factura",
  pct_flete: "% del flete",
  por_km: "Por km (cargado y vacío)",
  por_tonelada: "Por tonelada",
  fijo: "Monto fijo por viaje",
  sueldo_comision: "Sueldo base + comisión",
};

export interface ConfigPago {
  esquema: EsquemaPago;
  pct?: number | null;
  tarifaKmCargado?: number | null;
  tarifaKmVacio?: number | null;
  tarifaTonelada?: number | null;
  montoFijo?: number | null;
}

/**
 * Pago al operador por el viaje. En "sueldo base + comisión" la comisión es un
 * % del subtotal; el sueldo base es mensual y se registra en Costos.
 * null si falta un dato para calcularlo.
 */
export function pagoOperador(
  c: ConfigPago,
  v: { flete: number | null; gastosFacturables: number; kmCargado: number; kmVacio: number; toneladas: number | null },
): number | null {
  const pct = (c.pct ?? 0) / 100;
  switch (c.esquema) {
    case "pct_subtotal":
    case "sueldo_comision":
      return v.flete === null ? null : redondear(pct * (v.flete + v.gastosFacturables));
    case "pct_flete":
      return v.flete === null ? null : redondear(pct * v.flete);
    case "por_km":
      return redondear((c.tarifaKmCargado ?? 0) * v.kmCargado + (c.tarifaKmVacio ?? 0) * v.kmVacio);
    case "por_tonelada":
      return v.toneladas === null ? null : redondear((c.tarifaTonelada ?? 0) * v.toneladas);
    case "fijo":
      return c.montoFijo ?? null;
  }
}

// ---------------------------------------------------------------------------
// Diésel
// ---------------------------------------------------------------------------

export interface CargaDiesel {
  litros: number;
  importe: number | null;
  precioLitro: number | null;
  estado: "pendiente" | "validada" | "rechazada";
}

/** Pesos de una carga: su importe; si no, litros × su precio; si no, litros × precio del parámetro. */
export function costoCarga(c: CargaDiesel, precioParametro: number | null): number | null {
  if (c.importe !== null) return c.importe;
  const precio = c.precioLitro ?? precioParametro;
  return precio === null ? null : redondear(c.litros * precio);
}

// ---------------------------------------------------------------------------
// Resumen del viaje
// ---------------------------------------------------------------------------

export interface GastoViaje {
  categoria: string;
  monto: number;
  facturable: boolean;
  cancelado: boolean;
}

export interface EntradaResumen {
  tramos: Tramo[];
  toneladasCargadas: number | null;
  toneladasDescargadas: number | null;
  /** null si quien consulta no ve tarifas o el viaje aún no tiene tarifa. */
  tarifa: Tarifa | null;
  pago: ConfigPago | null;
  pagoManual: number | null;
  gastos: GastoViaje[];
  cargas: CargaDiesel[];
  precioDieselParametro: number | null;
}

export interface ResumenViaje {
  kmVacio: number;
  kmCargado: number;
  kmTotales: number;
  toneladasFacturadas: number | null;
  flete: number | null;
  gastosFacturables: number;
  /** Flete + gastos que se facturan al cliente (subtotal de la factura, sin impuestos). */
  ingreso: number | null;
  gastosPropios: number;
  gastosPorCategoria: Record<string, number>;
  /** Litros de cargas validadas (las rechazadas no cuentan; las pendientes, aparte). */
  litros: number;
  litrosPendientes: number;
  costoDiesel: number;
  pagoOperador: number | null;
  /** Diésel + todos los gastos del viaje + pago al operador. */
  costoVariable: number;
  /** Utilidad de contribución: ingreso − costo variable. */
  utilidad: number | null;
  /** Utilidad ÷ ingreso. */
  margenPct: number | null;
  /** Utilidad ÷ costo. */
  utilidadSobreCostoPct: number | null;
  mermaToneladas: number | null;
  mermaPct: number | null;
  mermaPesos: number | null;
}

export function resumirViaje(e: EntradaResumen): ResumenViaje {
  const kmDe = (tipo: TipoTramo) => e.tramos.filter((t) => t.tipo === tipo).reduce((s, t) => s + kmTramo(t), 0);
  const kmVacio = kmDe("vacio");
  const kmCargado = kmDe("cargado");

  const vigentes = e.gastos.filter((g) => !g.cancelado);
  const gastosFacturables = suma(vigentes.filter((g) => g.facturable).map((g) => g.monto));
  const gastosPropios = suma(vigentes.filter((g) => !g.facturable).map((g) => g.monto));
  const gastosPorCategoria: Record<string, number> = {};
  for (const g of vigentes) gastosPorCategoria[g.categoria] = redondear((gastosPorCategoria[g.categoria] ?? 0) + g.monto);

  const validadas = e.cargas.filter((c) => c.estado === "validada");
  const litros = suma(validadas.map((c) => c.litros));
  const litrosPendientes = suma(e.cargas.filter((c) => c.estado === "pendiente").map((c) => c.litros));
  const costoDiesel = suma(validadas.map((c) => costoCarga(c, e.precioDieselParametro) ?? 0));

  const tonFact = e.tarifa
    ? toneladasFacturadas(e.tarifa.facturaPor, e.toneladasCargadas, e.toneladasDescargadas)
    : (e.toneladasCargadas ?? null);
  const fleteViaje = e.tarifa ? flete(e.tarifa, e.toneladasCargadas, e.toneladasDescargadas) : null;
  const ingreso = fleteViaje === null ? null : redondear(fleteViaje + gastosFacturables);
  const pago =
    e.pagoManual ??
    (e.pago ? pagoOperador(e.pago, { flete: fleteViaje, gastosFacturables, kmCargado, kmVacio, toneladas: tonFact }) : null);

  const costoVariable = redondear(costoDiesel + gastosFacturables + gastosPropios + (pago ?? 0));
  const utilidad = ingreso === null ? null : redondear(ingreso - costoVariable);

  const merma =
    e.toneladasCargadas !== null && e.toneladasDescargadas !== null
      ? redondear(e.toneladasCargadas - e.toneladasDescargadas)
      : null;
  // Merma en pesos a la tarifa del viaje (si es fija, su equivalente por tonelada).
  const tarifaPorTon =
    e.tarifa && fleteViaje !== null
      ? e.tarifa.tipo === "por_tonelada"
        ? e.tarifa.tarifa
        : tonFact
          ? fleteViaje / tonFact
          : null
      : null;

  return {
    kmVacio,
    kmCargado,
    kmTotales: kmVacio + kmCargado,
    toneladasFacturadas: tonFact,
    flete: fleteViaje,
    gastosFacturables,
    ingreso,
    gastosPropios,
    gastosPorCategoria,
    litros,
    litrosPendientes,
    costoDiesel,
    pagoOperador: pago,
    costoVariable,
    utilidad,
    margenPct: utilidad !== null && ingreso ? pct(utilidad, ingreso) : null,
    utilidadSobreCostoPct: utilidad !== null && costoVariable ? pct(utilidad, costoVariable) : null,
    mermaToneladas: merma,
    mermaPct: merma !== null && e.toneladasCargadas ? pct(merma, e.toneladasCargadas) : null,
    mermaPesos: merma !== null && tarifaPorTon !== null ? redondear(merma * tarifaPorTon) : null,
  };
}

/** Horas entre dos momentos (tiempo en carga o en descarga). null si falta alguno. */
export function horasEntre(desde: string | null, hasta: string | null): number | null {
  if (!desde || !hasta) return null;
  const h = (Date.parse(hasta) - Date.parse(desde)) / 3_600_000;
  return Number.isFinite(h) ? Math.round(h * 10) / 10 : null;
}

export const redondear = (n: number) => Math.round(n * 100) / 100;
const suma = (xs: number[]) => redondear(xs.reduce((s, x) => s + x, 0));
const pct = (parte: number, total: number) => Math.round((parte / total) * 1000) / 10;
