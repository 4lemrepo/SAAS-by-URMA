/** Formatos de números para pantalla (es-MX). null o NaN se muestran como "—". */
const ok = (n: number | null | undefined): n is number => n !== null && n !== undefined && Number.isFinite(n);

export const pesos = (n: number | null | undefined, decimales = 2) =>
  ok(n) ? n.toLocaleString("es-MX", { style: "currency", currency: "MXN", minimumFractionDigits: decimales, maximumFractionDigits: decimales }) : "—";

export const numero = (n: number | null | undefined, decimales = 0) =>
  ok(n) ? n.toLocaleString("es-MX", { minimumFractionDigits: decimales, maximumFractionDigits: decimales }) : "—";

export const porcentaje = (n: number | null | undefined, decimales = 1) => (ok(n) ? `${numero(n, decimales)}%` : "—");
