"use client";

import Link from "next/link";
import { useActionState } from "react";
import { Aviso, BotonEnviar, Campo, Selector } from "@/components/campos";
import { CATALOGOS, type ClaveCatalogo } from "@/lib/catalogos/definiciones";
import type { Referencias } from "@/lib/catalogos/validacion";
import { guardarRegistro } from "./acciones";

export function FormularioCatalogo({
  clave,
  id,
  iniciales,
  referencias,
}: {
  clave: ClaveCatalogo;
  /** null = alta. */
  id: string | null;
  iniciales: Record<string, string>;
  referencias: Referencias;
}) {
  const def = CATALOGOS[clave];
  const [estado, accion] = useActionState(guardarRegistro.bind(null, clave, id), {});
  const valores = estado.valores ?? iniciales;

  return (
    // key: tras un error, los campos toman lo que el usuario escribió.
    <form action={accion} key={JSON.stringify(valores)} className="flex max-w-xl flex-col gap-4">
      <Aviso texto={estado.mensaje} />
      <div className="grid gap-4 sm:grid-cols-2">
        {def.campos.map((campo) => {
          const comun = { etiqueta: campo.etiqueta, name: campo.columna, error: estado.errores?.[campo.columna] };
          if (campo.tipo === "referencia") {
            return (
              <Selector
                key={campo.columna}
                {...comun}
                opciones={referencias[campo.columna] ?? []}
                vacio={campo.requerido ? "Elige…" : "—"}
                required={campo.requerido}
                defaultValue={valores[campo.columna] ?? ""}
              />
            );
          }
          if (campo.tipo === "booleano") {
            const actual = valores[campo.columna];
            return (
              <label key={campo.columna} className="flex items-start gap-2 text-sm sm:col-span-2">
                <input
                  type="checkbox"
                  name={campo.columna}
                  defaultChecked={actual === undefined || actual === "" ? campo.porDefecto : actual === "true" || actual === "on"}
                  className="mt-1"
                />
                <span>
                  <span className="font-medium">{campo.etiqueta}</span>
                  {campo.ayuda && <span className="block text-zinc-500">{campo.ayuda}</span>}
                </span>
              </label>
            );
          }
          if (campo.tipo === "opcion") {
            return (
              <Selector
                key={campo.columna}
                {...comun}
                opciones={campo.opciones}
                vacio={campo.requerido ? (campo.porDefecto ? undefined : "Elige…") : "—"}
                required={campo.requerido}
                defaultValue={valores[campo.columna] || campo.porDefecto || ""}
              />
            );
          }
          const listaId = campo.tipo === "texto" && campo.sugerencias ? `${campo.columna}-sugerencias` : undefined;
          return (
            <div key={campo.columna}>
              <Campo
                {...comun}
                ayuda={campo.ayuda}
                required={campo.requerido}
                defaultValue={valores[campo.columna] ?? ""}
                list={listaId}
                maxLength={campo.tipo === "texto" ? campo.max : undefined}
                // Teclado numérico en celular; se valida en el servidor (acepta coma decimal).
                inputMode={campo.tipo === "numero" ? (campo.decimales ? "decimal" : "numeric") : undefined}
                autoCapitalize={campo.tipo === "texto" && campo.mayusculas ? "characters" : undefined}
                autoComplete="off"
              />
              {listaId && campo.tipo === "texto" && (
                <datalist id={listaId}>
                  {campo.sugerencias?.map((s) => <option key={s} value={s} />)}
                </datalist>
              )}
            </div>
          );
        })}
      </div>
      <div className="flex items-center gap-4">
        <BotonEnviar pendiente="Guardando…">{id ? "Guardar cambios" : `Agregar ${def.singular}`}</BotonEnviar>
        <Link href={`/catalogos/${clave}`} className="mt-2 text-sm underline">
          Cancelar
        </Link>
      </div>
    </form>
  );
}
