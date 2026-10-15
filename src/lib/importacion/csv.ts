/**
 * Lector de CSV mínimo: comillas dobles, saltos de línea dentro de comillas,
 * BOM de Excel y separador coma, punto y coma (Excel en español) o tabulador.
 */
export function parsearCsv(texto: string): string[][] {
  const limpio = texto.replace(/^﻿/, "");
  const separador = detectarSeparador(limpio);
  const filas: string[][] = [];
  let fila: string[] = [];
  let celda = "";
  let enComillas = false;

  for (let i = 0; i < limpio.length; i++) {
    const c = limpio[i];
    if (enComillas) {
      if (c === '"' && limpio[i + 1] === '"') {
        celda += '"';
        i++;
      } else if (c === '"') {
        enComillas = false;
      } else {
        celda += c;
      }
    } else if (c === '"') {
      enComillas = true;
    } else if (c === separador) {
      fila.push(celda);
      celda = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && limpio[i + 1] === "\n") i++;
      fila.push(celda);
      filas.push(fila);
      fila = [];
      celda = "";
    } else {
      celda += c;
    }
  }
  if (celda !== "" || fila.length) {
    fila.push(celda);
    filas.push(fila);
  }
  return filas;
}

/** El separador que más aparece en la primera línea (fuera de comillas). */
function detectarSeparador(texto: string): string {
  const conteo: Record<string, number> = { ",": 0, ";": 0, "\t": 0 };
  let enComillas = false;
  for (const c of texto) {
    if (c === '"') enComillas = !enComillas;
    else if (!enComillas && (c === "\n" || c === "\r")) break;
    else if (!enComillas && c in conteo) conteo[c]++;
  }
  const [masUsado, veces] = Object.entries(conteo).sort((a, b) => b[1] - a[1])[0];
  return veces > 0 ? masUsado : ",";
}
