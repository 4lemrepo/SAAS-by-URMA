/**
 * Validación del formulario de viaje (alta y edición). Pura: la usa la Server
 * Action; la base vuelve a validar lo esencial (odómetros, km sin viaje, cierre).
 *
 * Lugares: A (origen del tramo vacío), B (lugar de carga), C (lugar de descarga).
 * Odómetros: al salir de A, al llegar a B, al llegar a C.
 * Un tramo se guarda cuando tiene sus dos lugares y sus dos odómetros: el viaje
 * se puede dar de alta al salir y completarse al llegar.
 */
import { normalizarTexto, parsearNumero } from "@/lib/catalogos/validacion";
import { continuidadOdometro, type TipoTramo } from "./calculos";
import { revisarKm, type RevisionKm } from "./km";

export const MOTIVOS_DESVIO = [
  { valor: "carga_diesel", etiqueta: "Carga de diésel" },
  { valor: "refaccionaria", etiqueta: "Refaccionaria" },
  { valor: "taller_mecanico", etiqueta: "Taller mecánico" },
  { valor: "otro", etiqueta: "Otro" },
] as const;
export type MotivoDesvio = (typeof MOTIVOS_DESVIO)[number]["valor"];

/** Momentos del viaje en orden; cada uno debe ser igual o posterior al anterior. */
export const MOMENTOS = [
  { campo: "fecha_salida", etiqueta: "Salida" },
  { campo: "llegada_carga", etiqueta: "Llegada a carga" },
  { campo: "salida_carga", etiqueta: "Salida de carga" },
  { campo: "llegada_descarga", etiqueta: "Llegada a descarga" },
  { campo: "salida_descarga", etiqueta: "Salida de descarga" },
] as const;

export interface ContextoViaje {
  /** Odómetro final del viaje anterior de la unidad (null si es el primero). */
  odometroAnterior: number | null;
  /** km de la ruta del catálogo para cada tramo, si existe. */
  kmRuta: Record<TipoTramo, number | null>;
  toleranciaKmPct: number;
}

export interface TramoValidado {
  tipo: TipoTramo;
  origen: string;
  destino: string;
  odometro_inicial: number;
  odometro_final: number;
  km_ruta: number | null;
  motivo_desvio: MotivoDesvio | null;
  nota_desvio: string | null;
}

export interface ViajeValidado {
  unidad_id: string;
  operador_id: string;
  cliente_id: string | null;
  producto: string | null;
  toneladas_cargadas: number | null;
  toneladas_descargadas: number | null;
  fecha_salida: string;
  llegada_carga: string | null;
  salida_carga: string | null;
  llegada_descarga: string | null;
  salida_descarga: string | null;
  /** Fin del viaje: sale de la descarga (o llega, si aún no sale). */
  fecha_llegada: string | null;
  odometro_anterior: number | null;
  km_sin_viaje: number;
  explicacion_km_sin_viaje: string | null;
  notas: string | null;
  /** Folios de remisión que pide el cliente (uno por remolque, por ejemplo). */
  remisiones: string[];
  /** No. de factura al cliente; varios viajes pueden compartirla. */
  factura_cliente: string | null;
}

/**
 * Remisiones escritas en un solo campo: separadas por coma, punto y coma,
 * diagonal o renglón. Sin repetidas (sin importar mayúsculas).
 */
export function parsearRemisiones(v: string | undefined): string[] {
  const vistas = new Set<string>();
  const res: string[] = [];
  for (const parte of (v ?? "").split(/[,;/\n]+/)) {
    const r = normalizarTexto(parte);
    if (r && !vistas.has(r.toUpperCase())) {
      vistas.add(r.toUpperCase());
      res.push(r);
    }
  }
  return res;
}

/** Errores de remisiones y factura al cliente (los mismos límites que la base). */
export function revisarRemisionesFactura(remisiones: string[], factura: string | null): Record<string, string> {
  const errores: Record<string, string> = {};
  if (remisiones.length > 20) errores.remisiones = "Máximo 20 remisiones";
  else if (remisiones.some((r) => r.length > 40)) errores.remisiones = "Cada remisión: máximo 40 caracteres";
  if (factura && factura.length > 40) errores.factura_cliente = "Máximo 40 caracteres";
  return errores;
}

export type ResultadoViaje =
  | {
      ok: true;
      viaje: ViajeValidado;
      tramos: TramoValidado[];
      revision: Record<TipoTramo, RevisionKm>;
    }
  | { ok: false; errores: Record<string, string> };

type Valores = Record<string, string | undefined>;

const texto = (v: string | undefined) => normalizarTexto(v);
const lugar = (v: string | undefined) => texto(v).toUpperCase();
const opcional = (v: string | undefined) => texto(v) || null;

export function validarViaje(v: Valores, ctx: ContextoViaje): ResultadoViaje {
  const errores: Record<string, string> = {};

  if (!texto(v.unidad_id)) errores.unidad_id = "Elige la unidad";
  if (!texto(v.operador_id)) errores.operador_id = "Elige el operador";

  // Fechas: ISO que manda el navegador con su zona horaria.
  const fechas: Record<string, string | null> = {};
  let anterior: { etiqueta: string; ms: number } | null = null;
  for (const m of MOMENTOS) {
    const crudo = texto(v[m.campo]);
    if (!crudo) {
      fechas[m.campo] = null;
      continue;
    }
    const ms = Date.parse(crudo);
    if (Number.isNaN(ms)) {
      errores[m.campo] = "Fecha inválida";
      continue;
    }
    if (anterior && ms < anterior.ms) errores[m.campo] = `Debe ser igual o después de «${anterior.etiqueta}»`;
    fechas[m.campo] = new Date(ms).toISOString();
    anterior = { etiqueta: m.etiqueta, ms };
  }
  if (!fechas.fecha_salida && !errores.fecha_salida) errores.fecha_salida = "Requerida";

  const numero = (campo: string, { requerido = false, min = 0 } = {}) => {
    const n = parsearNumero(v[campo]);
    if (n === null) {
      if (requerido) errores[campo] = "Requerido";
      return null;
    }
    if (Number.isNaN(n)) {
      errores[campo] = "Escribe un número";
      return null;
    }
    if (n < min) {
      errores[campo] = `No puede ser menor que ${min}`;
      return null;
    }
    return n;
  };
  const tonCargadas = numero("toneladas_cargadas");
  const tonDescargadas = numero("toneladas_descargadas");
  for (const [campo, n] of [["toneladas_cargadas", tonCargadas], ["toneladas_descargadas", tonDescargadas]] as const) {
    if (n !== null && n > 200) errores[campo] = "Máximo 200 toneladas";
  }

  const A = lugar(v.origen);
  const B = lugar(v.lugar_carga);
  const C = lugar(v.lugar_descarga);
  if (!A) errores.origen = "Requerido";
  const o1 = numero("odometro_inicial", { requerido: true });
  const o2 = numero("odometro_carga");
  const o3 = numero("odometro_final");
  if (o1 !== null && o2 !== null && o2 < o1) errores.odometro_carga = "Debe ser mayor o igual al odómetro de salida";
  if (o2 !== null && o3 !== null && o3 < o2) errores.odometro_final = "Debe ser mayor o igual al odómetro en carga";
  if (o3 !== null && o2 === null) errores.odometro_carga = "Falta el odómetro al llegar a carga";

  const tramos: TramoValidado[] = [];
  const revision: Record<TipoTramo, RevisionKm> = {
    vacio: { desviacionPct: null, revisar: false },
    cargado: { desviacionPct: null, revisar: false },
  };
  const armarTramo = (tipo: TipoTramo, origen: string, destino: string, inicial: number | null, final: number | null) => {
    const conError = ["odometro_inicial", "odometro_carga", "odometro_final"].some((c) => errores[c]);
    if (!origen || !destino || inicial === null || final === null || final < inicial || conError) return;
    const r = revisarKm(final - inicial, ctx.kmRuta[tipo], ctx.toleranciaKmPct);
    revision[tipo] = r;
    const motivo = (texto(v[`motivo_${tipo}`]) || null) as MotivoDesvio | null;
    const nota = opcional(v[`nota_${tipo}`]);
    // El motivo solo se pide (y se revisa) si el tramo se desvía de su ruta.
    if (r.revisar) {
      if (!motivo) {
        errores[`motivo_${tipo}`] = `Se desvía ${r.desviacionPct}% de la ruta (${ctx.kmRuta[tipo]} km): indica el motivo`;
      } else if (!MOTIVOS_DESVIO.some((m) => m.valor === motivo)) {
        errores[`motivo_${tipo}`] = "Motivo inválido";
      } else if (motivo === "otro" && (nota ?? "").length < 3) {
        errores[`nota_${tipo}`] = "Explica el motivo";
      }
    }
    tramos.push({
      tipo,
      origen,
      destino,
      odometro_inicial: inicial,
      odometro_final: final,
      km_ruta: ctx.kmRuta[tipo],
      // Sin desvío no se guarda motivo.
      motivo_desvio: r.revisar ? motivo : null,
      nota_desvio: r.revisar ? nota : null,
    });
  };
  armarTramo("vacio", A, B, o1, o2);
  armarTramo("cargado", B, C, o2, o3);

  const continuidad = continuidadOdometro(ctx.odometroAnterior, o1);
  const explicacion = opcional(v.explicacion_km_sin_viaje);
  if (continuidad.requiereExplicacion && (explicacion ?? "").length < 3) {
    errores.explicacion_km_sin_viaje =
      continuidad.kmSinViaje > 0
        ? `El odómetro avanzó ${continuidad.kmSinViaje} km desde el último viaje (${ctx.odometroAnterior}): explica ese movimiento`
        : `El odómetro es menor que el del último viaje (${ctx.odometroAnterior}): explica por qué`;
  }

  const remisiones = parsearRemisiones(v.remisiones);
  const facturaCliente = opcional(v.factura_cliente);
  Object.assign(errores, revisarRemisionesFactura(remisiones, facturaCliente));

  if (Object.keys(errores).length) return { ok: false, errores };
  return {
    ok: true,
    tramos,
    revision,
    viaje: {
      unidad_id: texto(v.unidad_id),
      operador_id: texto(v.operador_id),
      cliente_id: opcional(v.cliente_id),
      producto: opcional(v.producto),
      toneladas_cargadas: tonCargadas,
      toneladas_descargadas: tonDescargadas,
      fecha_salida: fechas.fecha_salida!,
      llegada_carga: fechas.llegada_carga,
      salida_carga: fechas.salida_carga,
      llegada_descarga: fechas.llegada_descarga,
      salida_descarga: fechas.salida_descarga,
      fecha_llegada: fechas.salida_descarga ?? fechas.llegada_descarga,
      odometro_anterior: ctx.odometroAnterior,
      km_sin_viaje: continuidad.kmSinViaje,
      explicacion_km_sin_viaje: continuidad.requiereExplicacion ? explicacion : null,
      notas: opcional(v.notas),
      remisiones,
      factura_cliente: facturaCliente,
    },
  };
}
