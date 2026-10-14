/**
 * Lógica de conciliación de diésel.
 *
 * Funciones puras (sin base de datos ni red) para que se puedan probar a fondo.
 * Es el corazón del producto: si estos números están mal, todo lo demás también.
 */

export type Semaforo = "verde" | "amarillo" | "rojo" | "sin_datos";

/** Rendimiento esperado en km por litro. */
export interface Rendimiento {
  cargado: number;
  vacio: number;
}

/** Rendimiento opcional (de una unidad o de una ruta): cualquiera de los dos puede faltar. */
export interface RendimientoParcial {
  cargado?: number | null;
  vacio?: number | null;
}

/**
 * Rendimiento a usar en un viaje: el de la ruta manda (sierra, carga pesada…);
 * si la ruta no lo trae, se usa el de la unidad. Devuelve null si falta alguno.
 */
export function rendimientoEsperado(
  unidad: RendimientoParcial,
  ruta?: RendimientoParcial | null,
): Rendimiento | null {
  const cargado = ruta?.cargado ?? unidad.cargado;
  const vacio = ruta?.vacio ?? unidad.vacio;
  if (!cargado || !vacio || cargado <= 0 || vacio <= 0) return null;
  return { cargado, vacio };
}

/** Litros que el viaje debió consumir según km recorridos y rendimiento esperado. */
export function litrosTeoricos(
  km: { cargado: number; vacio: number },
  rend: Rendimiento,
): number {
  return km.cargado / rend.cargado + km.vacio / rend.vacio;
}

export interface EntradaViaje {
  kmCargado: number;
  kmVacio: number;
  /** Suma de litros de todas las cargas de diésel asignadas al viaje. */
  litrosReales: number;
  rendimiento: Rendimiento | null;
  /** Tolerancia en %, p. ej. 5 = ±5%. */
  toleranciaPct: number;
  /** Precio por litro para convertir litros faltantes a pesos. */
  precioLitro?: number | null;
}

export interface ResultadoViaje {
  kmTotales: number;
  pctKmVacio: number;
  litrosReales: number;
  litrosTeoricos: number;
  /** Positivo = se consumió de más (posible pérdida). */
  desviacionLitros: number;
  desviacionPct: number;
  kmPorLitroReal: number | null;
  pesosFaltantes: number;
  semaforo: Semaforo;
  motivo: string;
}

/**
 * Concilia un viaje: compara litros reales contra teóricos y asigna semáforo.
 *
 * - verde:    desviación dentro de la tolerancia
 * - amarillo: entre 1× y 2× la tolerancia, o consumo sospechosamente BAJO
 *             (suele ser una carga sin registrar o km mal capturados)
 * - rojo:     más de 2× la tolerancia por encima de lo esperado
 */
export function conciliarViaje(v: EntradaViaje): ResultadoViaje {
  const kmTotales = v.kmCargado + v.kmVacio;
  const pctKmVacio = kmTotales > 0 ? (v.kmVacio / kmTotales) * 100 : 0;
  const kmPorLitroReal = v.litrosReales > 0 ? kmTotales / v.litrosReales : null;

  const base = { kmTotales, pctKmVacio, litrosReales: v.litrosReales, kmPorLitroReal };

  if (!v.rendimiento || kmTotales <= 0) {
    return {
      ...base,
      litrosTeoricos: 0,
      desviacionLitros: 0,
      desviacionPct: 0,
      pesosFaltantes: 0,
      semaforo: "sin_datos",
      motivo: !v.rendimiento
        ? "Falta el rendimiento esperado de la unidad o la ruta"
        : "El viaje no tiene km capturados",
    };
  }

  const teoricos = litrosTeoricos({ cargado: v.kmCargado, vacio: v.kmVacio }, v.rendimiento);
  const desviacionLitros = v.litrosReales - teoricos;
  const desviacionPct = (desviacionLitros / teoricos) * 100;
  const pesosFaltantes = Math.max(0, desviacionLitros) * (v.precioLitro ?? 0);
  const tol = v.toleranciaPct;

  let semaforo: Semaforo;
  let motivo: string;
  if (v.litrosReales === 0) {
    semaforo = "sin_datos";
    motivo = "El viaje no tiene cargas de diésel registradas";
  } else if (desviacionPct > 2 * tol) {
    semaforo = "rojo";
    motivo = "Consumo muy por encima de lo esperado";
  } else if (desviacionPct > tol) {
    semaforo = "amarillo";
    motivo = "Consumo por encima de la tolerancia";
  } else if (desviacionPct < -2 * tol) {
    semaforo = "amarillo";
    motivo = "Consumo muy bajo: revisar cargas sin registrar o km mal capturados";
  } else {
    semaforo = "verde";
    motivo = "Dentro de la tolerancia";
  }

  return {
    ...base,
    litrosTeoricos: teoricos,
    desviacionLitros,
    desviacionPct,
    pesosFaltantes,
    semaforo,
    motivo,
  };
}

export interface ResumenGrupo {
  clave: string;
  viajes: number;
  kmTotales: number;
  kmVacio: number;
  pctKmVacio: number;
  litrosReales: number;
  litrosTeoricos: number;
  desviacionLitros: number;
  desviacionPct: number;
  kmPorLitroReal: number | null;
  pesosFaltantes: number;
  viajesEnRojo: number;
}

/**
 * Agrupa viajes conciliados (por unidad, operador o ruta) y los ordena por pesos
 * faltantes, de mayor a menor: lo primero que ve el dueño es donde más pierde.
 * Los viajes sin datos se cuentan pero no entran a los totales de litros.
 */
export function resumirPor<T>(
  items: T[],
  clave: (item: T) => string,
  resultado: (item: T) => ResultadoViaje,
): ResumenGrupo[] {
  const grupos = new Map<string, ResumenGrupo>();

  for (const item of items) {
    const k = clave(item);
    const r = resultado(item);
    const g =
      grupos.get(k) ??
      ({
        clave: k, viajes: 0, kmTotales: 0, kmVacio: 0, pctKmVacio: 0,
        litrosReales: 0, litrosTeoricos: 0, desviacionLitros: 0, desviacionPct: 0,
        kmPorLitroReal: null, pesosFaltantes: 0, viajesEnRojo: 0,
      } satisfies ResumenGrupo);

    g.viajes += 1;
    g.kmTotales += r.kmTotales;
    g.kmVacio += (r.pctKmVacio / 100) * r.kmTotales;
    if (r.semaforo !== "sin_datos") {
      g.litrosReales += r.litrosReales;
      g.litrosTeoricos += r.litrosTeoricos;
      g.desviacionLitros += r.desviacionLitros;
      g.pesosFaltantes += r.pesosFaltantes;
    }
    if (r.semaforo === "rojo") g.viajesEnRojo += 1;
    grupos.set(k, g);
  }

  for (const g of grupos.values()) {
    g.pctKmVacio = g.kmTotales > 0 ? (g.kmVacio / g.kmTotales) * 100 : 0;
    g.desviacionPct = g.litrosTeoricos > 0 ? (g.desviacionLitros / g.litrosTeoricos) * 100 : 0;
    g.kmPorLitroReal = g.litrosReales > 0 ? g.kmTotales / g.litrosReales : null;
  }

  return [...grupos.values()].sort((a, b) => b.pesosFaltantes - a.pesosFaltantes);
}

export interface EntradaTanque {
  /** Lectura física al inicio del periodo (litros en el tanque). */
  lecturaInicial: number;
  /** Litros recibidos de pipa en el periodo. */
  entradas: number[];
  /** Ajustes manuales autorizados (positivos o negativos). */
  ajustes?: number[];
  /** Litros despachados a unidades (cargas cuya fuente es este tanque). */
  despachos: number[];
  /** Lectura física al final del periodo. */
  lecturaFinal: number;
  toleranciaPct: number;
}

export interface ResultadoTanque {
  totalEntradas: number;
  totalDespachos: number;
  saldoTeorico: number;
  /** Negativo = faltan litros en el tanque contra lo que dicen los registros. */
  diferencia: number;
  /** Diferencia como % de lo despachado en el periodo. */
  diferenciaPct: number;
  semaforo: Exclude<Semaforo, "sin_datos">;
}

/**
 * Cuadre de un tanque propio entre dos lecturas físicas:
 * saldo teórico = lectura inicial + entradas + ajustes − despachos.
 * Si la lectura final queda por debajo del saldo teórico, hay diésel sin explicar.
 */
export function conciliarTanque(t: EntradaTanque): ResultadoTanque {
  const suma = (xs: number[] = []) => xs.reduce((a, b) => a + b, 0);
  const totalEntradas = suma(t.entradas);
  const totalDespachos = suma(t.despachos);
  const saldoTeorico = t.lecturaInicial + totalEntradas + suma(t.ajustes) - totalDespachos;
  const diferencia = t.lecturaFinal - saldoTeorico;
  const diferenciaPct = totalDespachos > 0 ? (diferencia / totalDespachos) * 100 : 0;

  const faltante = -diferenciaPct; // positivo cuando faltan litros
  const semaforo =
    faltante > 2 * t.toleranciaPct ? "rojo" : faltante > t.toleranciaPct ? "amarillo" : "verde";

  return { totalEntradas, totalDespachos, saldoTeorico, diferencia, diferenciaPct, semaforo };
}
