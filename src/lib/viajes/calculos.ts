/**
 * Cálculos de un viaje. Funciones puras: las usan la pantalla del viaje, la
 * lista, la exportación y el tablero, así todos dan el mismo número.
 *
 * Un viaje = tramo VACÍO (A → B, lugar de carga) + tramo CARGADO (B → C,
 * lugar de descarga). Km de cada tramo = odómetro final − inicial (lo guarda
 * la base; un tramo importado sin odómetros trae sus km).
 */
import { desglosarIva, type Desglose, type TasaIva } from "@/lib/costos/iva";

export type TipoTramo = "vacio" | "cargado";

export interface Tramo {
  tipo: TipoTramo;
  km: number;
}

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
  pct_subtotal: "% del subtotal (flete + cargos adicionales)",
  pct_flete: "% del flete",
  por_km: "Por km (cargado y vacío)",
  por_tonelada: "Por tonelada",
  fijo: "Monto fijo por viaje",
  sueldo_comision: "Sueldo base + comisión",
};

/** Base del "% del flete": peso cargado (tarifa × toneladas cargadas) o el flete facturado. */
export type BaseFlete = "cargado" | "facturado";

export interface ConfigPago {
  esquema: EsquemaPago;
  pct?: number | null;
  /** Solo "% del flete"; por defecto peso cargado. */
  baseFlete?: BaseFlete | null;
  tarifaKmCargado?: number | null;
  tarifaKmVacio?: number | null;
  tarifaTonelada?: number | null;
  montoFijo?: number | null;
}

/**
 * Flete con peso cargado: tarifa × toneladas cargadas, aunque el cliente se
 * facture por peso descargado (base del pago al operador de URMA). Con tarifa
 * fija es el mismo flete.
 */
export function fleteCargado(t: Tarifa, cargadas: number | null): number | null {
  if (t.tipo === "fija") return t.tarifa;
  return cargadas === null ? null : redondear(t.tarifa * cargadas);
}

/**
 * Pago al operador por el viaje. null si falta un dato para calcularlo.
 * - "% del subtotal" (y la comisión de "sueldo base + comisión"): % de flete +
 *   cargos adicionales al cliente. El sueldo base es mensual y va en Costos.
 * - "% del flete": % del flete con peso cargado (por defecto) o del facturado.
 *   Los cargos adicionales no generan comisión.
 */
export function pagoOperador(
  c: ConfigPago,
  v: {
    flete: number | null;
    fleteCargado: number | null;
    cargosAdicionales: number;
    kmCargado: number;
    kmVacio: number;
    toneladas: number | null;
  },
): number | null {
  const pct = (c.pct ?? 0) / 100;
  switch (c.esquema) {
    case "pct_subtotal":
    case "sueldo_comision":
      return v.flete === null ? null : redondear(pct * (v.flete + v.cargosAdicionales));
    case "pct_flete": {
      const base = c.baseFlete === "facturado" ? v.flete : v.fleteCargado;
      return base === null ? null : redondear(pct * base);
    }
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
  /** Total del ticket (con IVA si lo trae). */
  importe: number | null;
  /** Precio por litro como viene en el ticket. */
  precioLitro: number | null;
  estado: "pendiente" | "validada" | "rechazada";
  tieneFactura: boolean;
  tasaIva: TasaIva;
}

/**
 * Pesos de una carga: el importe del ticket; si no hay, litros × su precio; si
 * no, litros × precio del parámetro (estimado). Con factura, el costo es sin el
 * IVA acreditable. null si no hay con qué calcular.
 */
export function costoCarga(c: CargaDiesel, precioParametro: number | null): Desglose | null {
  const precio = c.precioLitro ?? precioParametro;
  const total = c.importe ?? (precio === null ? null : redondear(c.litros * precio));
  return total === null ? null : desglosarIva(total, c.tieneFactura, c.tasaIva);
}

// ---------------------------------------------------------------------------
// Resumen del viaje
// ---------------------------------------------------------------------------

export interface GastoViaje {
  categoria: string;
  /** Folio del gasto (para el desglose). */
  folio?: string;
  /** Total pagado (con IVA si lo trae). */
  monto: number;
  /** IVA acreditable guardado (0 sin factura). */
  iva: number;
  cancelado: boolean;
}

export interface CargoAdicional {
  concepto: string;
  /** Subtotal sin IVA que se le cobra al cliente. */
  monto: number;
  cancelado: boolean;
}

export interface EntradaResumen {
  tramos: Tramo[];
  toneladasCargadas: number | null;
  toneladasDescargadas: number | null;
  /** null si quien consulta no ve tarifas o el viaje aún no tiene tarifa. */
  tarifa: Tarifa | null;
  /** Cargos adicionales al cliente (maniobras, estadías…); vacío si no ve tarifas. */
  cargosAdicionales: CargoAdicional[];
  pago: ConfigPago | null;
  pagoManual: number | null;
  gastos: GastoViaje[];
  cargas: CargaDiesel[];
  precioDieselParametro: number | null;
}

/** Un renglón del desglose de utilidad del viaje. */
export interface RenglonUtilidad {
  concepto: string;
  monto: number | null;
  tipo: "ingreso" | "costo" | "total";
}

export interface ResumenViaje {
  kmVacio: number;
  kmCargado: number;
  kmTotales: number;
  toneladasFacturadas: number | null;
  /** Subtotal sin IVA: tarifa × toneladas facturadas (o la tarifa fija). */
  flete: number | null;
  /** Σ cargos adicionales al cliente (sin IVA). */
  cargosAdicionales: number;
  /** Flete + cargos adicionales (subtotal de la factura, sin IVA). */
  ingreso: number | null;
  /** Σ total pagado de los gastos (con IVA si lo traen). */
  gastosTotal: number;
  /** Σ costo para rentabilidad de los gastos (sin IVA acreditable). */
  gastosCosto: number;
  /** Costo para rentabilidad por categoría. */
  gastosPorCategoria: Record<string, number>;
  /** Total pagado por categoría (con IVA). */
  gastosPorCategoriaConIva: Record<string, number>;
  /** Litros de cargas validadas (las rechazadas no cuentan; las pendientes, aparte). */
  litros: number;
  litrosPendientes: number;
  /** Diésel validado, costo para rentabilidad (sin IVA acreditable). */
  costoDiesel: number;
  /** Diésel validado, lo pagado (con IVA). */
  dieselTotal: number;
  /** IVA acreditable de gastos y diésel. */
  ivaAcreditable: number;
  pagoOperador: number | null;
  /** Diésel + gastos del viaje + pago al operador, sin IVA acreditable. */
  costoVariable: number;
  /** Igual, pero con lo pagado con IVA (para comparar contra un control que trae el IVA). */
  costoVariableConIva: number;
  /** Utilidad de contribución: ingreso − costo variable. No incluye costos fijos. */
  utilidad: number | null;
  /** Utilidad ÷ ingreso. */
  margenPct: number | null;
  /** Utilidad ÷ costo. */
  utilidadSobreCostoPct: number | null;
  mermaToneladas: number | null;
  mermaPct: number | null;
  mermaPesos: number | null;
  /** Flete, cargos, ingreso, diésel, pago, cada gasto, costo variable y utilidad. */
  renglones: RenglonUtilidad[];
}

export function resumirViaje(e: EntradaResumen): ResumenViaje {
  const kmDe = (tipo: TipoTramo) => e.tramos.filter((t) => t.tipo === tipo).reduce((s, t) => s + t.km, 0);
  const kmVacio = kmDe("vacio");
  const kmCargado = kmDe("cargado");

  const vigentes = e.gastos.filter((g) => !g.cancelado);
  const costoGasto = (g: GastoViaje) => redondear(g.monto - g.iva);
  const gastosTotal = suma(vigentes.map((g) => g.monto));
  const gastosCosto = suma(vigentes.map(costoGasto));
  const gastosPorCategoria: Record<string, number> = {};
  const gastosPorCategoriaConIva: Record<string, number> = {};
  for (const g of vigentes) {
    gastosPorCategoria[g.categoria] = redondear((gastosPorCategoria[g.categoria] ?? 0) + costoGasto(g));
    gastosPorCategoriaConIva[g.categoria] = redondear((gastosPorCategoriaConIva[g.categoria] ?? 0) + g.monto);
  }

  const validadas = e.cargas.filter((c) => c.estado === "validada");
  const litros = suma(validadas.map((c) => c.litros));
  const litrosPendientes = suma(e.cargas.filter((c) => c.estado === "pendiente").map((c) => c.litros));
  const desgloses = validadas.map((c) => costoCarga(c, e.precioDieselParametro));
  const costoDiesel = suma(desgloses.map((d) => d?.costo ?? 0));
  const dieselTotal = suma(desgloses.map((d) => d?.total ?? 0));

  const cargos = e.cargosAdicionales.filter((c) => !c.cancelado);
  const cargosAdicionales = suma(cargos.map((c) => c.monto));
  const tonFact = e.tarifa
    ? toneladasFacturadas(e.tarifa.facturaPor, e.toneladasCargadas, e.toneladasDescargadas)
    : (e.toneladasCargadas ?? null);
  const fleteViaje = e.tarifa ? flete(e.tarifa, e.toneladasCargadas, e.toneladasDescargadas) : null;
  const ingreso = fleteViaje === null ? null : redondear(fleteViaje + cargosAdicionales);
  const pago =
    e.pagoManual ??
    (e.pago
      ? pagoOperador(e.pago, {
          flete: fleteViaje,
          fleteCargado: e.tarifa ? fleteCargado(e.tarifa, e.toneladasCargadas) : null,
          cargosAdicionales,
          kmCargado,
          kmVacio,
          toneladas: tonFact,
        })
      : null);

  const costoVariable = redondear(costoDiesel + gastosCosto + (pago ?? 0));
  const costoVariableConIva = redondear(dieselTotal + gastosTotal + (pago ?? 0));
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

  const renglones: RenglonUtilidad[] = [
    { concepto: "Flete: subtotal sin IVA (tarifa × toneladas)", monto: fleteViaje, tipo: "ingreso" },
    ...cargos.map((c): RenglonUtilidad => ({ concepto: `Cargo adicional: ${c.concepto}`, monto: c.monto, tipo: "ingreso" })),
    { concepto: "Ingreso (sin IVA)", monto: ingreso, tipo: "total" },
    { concepto: "Diésel (costo sin IVA acreditable)", monto: costoDiesel, tipo: "costo" },
    { concepto: "Pago al operador", monto: pago, tipo: "costo" },
    ...vigentes.map((g): RenglonUtilidad => ({
      concepto: `${g.categoria}${g.folio ? ` (${g.folio})` : ""}`,
      monto: costoGasto(g),
      tipo: "costo",
    })),
    { concepto: "Costo variable", monto: costoVariable, tipo: "total" },
    { concepto: "Utilidad de contribución", monto: utilidad, tipo: "total" },
  ];

  return {
    kmVacio,
    kmCargado,
    kmTotales: kmVacio + kmCargado,
    toneladasFacturadas: tonFact,
    flete: fleteViaje,
    cargosAdicionales,
    ingreso,
    gastosTotal,
    gastosCosto,
    gastosPorCategoria,
    gastosPorCategoriaConIva,
    litros,
    litrosPendientes,
    costoDiesel,
    dieselTotal,
    ivaAcreditable: redondear(dieselTotal - costoDiesel + gastosTotal - gastosCosto),
    pagoOperador: pago,
    costoVariable,
    costoVariableConIva,
    utilidad,
    margenPct: utilidad !== null && ingreso ? pct(utilidad, ingreso) : null,
    utilidadSobreCostoPct: utilidad !== null && costoVariable ? pct(utilidad, costoVariable) : null,
    mermaToneladas: merma,
    mermaPct: merma !== null && e.toneladasCargadas ? pct(merma, e.toneladasCargadas) : null,
    mermaPesos: merma !== null && tarifaPorTon !== null ? redondear(merma * tarifaPorTon) : null,
    renglones,
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
