/**
 * Lectura de archivos en el navegador: el archivo no sale de la computadora
 * del usuario hasta que confirma; al servidor solo llegan los registros.
 */
import { parsearCsv } from "@/lib/importacion/csv";

export interface Hoja {
  nombre: string;
  filas: unknown[][];
}

export const TIPOS_ACEPTADOS = ".xlsx,.csv";
const TAMANO_MAXIMO = 10 * 1024 * 1024;

export async function leerArchivo(archivo: File): Promise<Hoja[]> {
  if (archivo.size > TAMANO_MAXIMO) throw new Error("El archivo pesa más de 10 MB");
  const nombre = archivo.name.toLowerCase();
  if (nombre.endsWith(".csv")) {
    return [{ nombre: archivo.name, filas: parsearCsv(await archivo.text()) }];
  }
  if (!nombre.endsWith(".xlsx")) {
    throw new Error("Usa un archivo .xlsx o .csv (en Excel: Archivo → Guardar como)");
  }
  // Se carga solo cuando se usa, para no hacer pesada la app.
  const { default: leerXlsx } = await import("read-excel-file/browser");
  const hojas = await leerXlsx(archivo);
  return hojas.map((h) => ({ nombre: h.sheet, filas: h.data as unknown[][] }));
}

/** Primera fila con algún valor: ahí van los encabezados de una plantilla. */
export function filaDeEncabezados(filas: unknown[][]): number {
  const i = filas.findIndex((f) => f.some((c) => c !== null && c !== undefined && String(c).trim() !== ""));
  return i < 0 ? 0 : i;
}
