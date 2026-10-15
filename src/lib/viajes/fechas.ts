/**
 * Fechas de la operación en hora del centro de México (sin horario de verano
 * desde 2022). Se usa la misma zona al mostrar y al guardar, así el servidor
 * (en UTC) y el navegador ven lo mismo.
 */
export const ZONA = "-06:00";
const DESFASE_MS = -6 * 3_600_000;

/** "2026-10-01T08:30" (de <input type="datetime-local">) → ISO UTC. "" si viene vacío o inválido. */
export function localAIso(local: string | null | undefined): string {
  if (!local || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(local.trim())) return "";
  const ms = Date.parse(`${local.trim()}:00${ZONA}`);
  return Number.isNaN(ms) ? "" : new Date(ms).toISOString();
}

/** ISO → valor para <input type="datetime-local"> en hora del centro. */
export function isoALocal(iso: string | null | undefined): string {
  if (!iso) return "";
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? "" : new Date(ms + DESFASE_MS).toISOString().slice(0, 16);
}

/** ISO → "01/10/2026 08:30". */
export function formatearFechaHora(iso: string | null | undefined): string {
  const local = isoALocal(iso);
  if (!local) return "—";
  const [f, h] = local.split("T");
  const [a, m, d] = f.split("-");
  return `${d}/${m}/${a} ${h}`;
}

/** "2026-10-01" → "01/10/2026". */
export function formatearFecha(fecha: string | null | undefined): string {
  if (!fecha) return "—";
  const [a, m, d] = fecha.slice(0, 10).split("-");
  return `${d}/${m}/${a}`;
}

/** Hoy en hora del centro, "aaaa-mm-dd". */
export function hoy(ahora = new Date()): string {
  return new Date(ahora.getTime() + DESFASE_MS).toISOString().slice(0, 10);
}

/** Ahora en hora del centro para un datetime-local. */
export function ahoraLocal(ahora = new Date()): string {
  return isoALocal(ahora.toISOString());
}
