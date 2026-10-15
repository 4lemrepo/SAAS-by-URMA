"use client";

import Link from "next/link";
import { useMemo, useState, useTransition } from "react";
import { Aviso, Selector } from "@/components/campos";
import { CATALOGOS } from "@/lib/catalogos/definiciones";
import type { Registro } from "@/lib/catalogos/validacion";
import type { CatalogoControl } from "@/lib/importacion/catalogos";
import {
  kmDeRuta,
  leerControlDeViajes,
  rutaRequiereDecision,
  type ControlDeViajes,
  type RutaControl,
} from "@/lib/importacion/control";
import {
  CATALOGOS_IMPORTABLES,
  encabezadosPlantilla,
  entradasDeFilas,
  mapearEncabezados,
  resumen,
  validarRegistros,
  type CatalogoImportable,
  type Entrada,
  type FilaPrevia,
} from "@/lib/importacion/plantilla";
import { importarCatalogos, type ResultadoImportacion } from "./acciones";
import { filaDeEncabezados, leerArchivo, TIPOS_ACEPTADOS } from "./archivo";
import { Estado, VistaPrevia } from "./vista-previa";

type Existentes = Record<CatalogoControl, Registro[]>;

const claseBoton =
  "rounded-md bg-zinc-900 px-4 py-2 font-medium text-white hover:bg-zinc-700 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900";
const claseBotonSecundario =
  "rounded-md border border-zinc-300 px-4 py-2 font-medium hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800";

export function Importador({ existentes }: { existentes: Existentes }) {
  const [modo, setModo] = useState<"plantilla" | "control">("plantilla");
  return (
    <div className="flex flex-col gap-6">
      <div role="tablist" className="flex gap-2 border-b border-zinc-200 dark:border-zinc-800">
        {(
          [
            ["plantilla", "Plantilla por catálogo"],
            ["control", "Mi control de viajes"],
          ] as const
        ).map(([valor, texto]) => (
          <button
            key={valor}
            role="tab"
            aria-selected={modo === valor}
            onClick={() => setModo(valor)}
            className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium ${modo === valor ? "border-zinc-900 dark:border-zinc-100" : "border-transparent text-zinc-500"}`}
          >
            {texto}
          </button>
        ))}
      </div>
      {modo === "plantilla" ? <PorPlantilla existentes={existentes} /> : <PorControl existentes={existentes} />}
    </div>
  );
}

/** Botón de confirmar y el resultado de la importación. */
function Confirmar({
  habilitado,
  texto,
  enviar,
}: {
  habilitado: boolean;
  texto: string;
  enviar: () => Promise<ResultadoImportacion>;
}) {
  const [pendiente, iniciar] = useTransition();
  const [resultado, setResultado] = useState<ResultadoImportacion | null>(null);

  if (resultado?.ok) {
    const guardados = Object.entries(resultado.guardados).filter(([, n]) => n);
    return (
      <div className="flex flex-col gap-2">
        <Aviso
          tipo="exito"
          texto={`Listo. Se guardaron: ${guardados.map(([c, n]) => `${n} ${CATALOGOS[c as CatalogoControl].titulo.toLowerCase()}`).join(", ") || "nada nuevo"}.`}
        />
        <div className="flex flex-wrap gap-3 text-sm">
          {guardados.map(([c]) => (
            <Link key={c} href={`/catalogos/${c}`} className="underline">
              Ver {CATALOGOS[c as CatalogoControl].titulo.toLowerCase()}
            </Link>
          ))}
        </div>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-2">
      {resultado && !resultado.ok && <Aviso texto={resultado.mensaje} />}
      <button
        type="button"
        disabled={!habilitado || pendiente}
        onClick={() => iniciar(async () => setResultado(await enviar()))}
        className={`self-start ${claseBoton}`}
      >
        {pendiente ? "Guardando…" : texto}
      </button>
    </div>
  );
}

function SubirArchivo({ etiqueta, alElegir }: { etiqueta: string; alElegir: (archivo: File) => void }) {
  return (
    <label className="flex flex-col gap-1 text-sm">
      <span className="font-medium">{etiqueta}</span>
      <input
        type="file"
        accept={TIPOS_ACEPTADOS}
        onChange={(e) => {
          const archivo = e.target.files?.[0];
          if (archivo) alElegir(archivo);
          // Permite volver a subir el mismo archivo después de corregirlo.
          e.target.value = "";
        }}
        className="text-sm file:mr-3 file:rounded-md file:border file:border-zinc-300 file:bg-white file:px-3 file:py-2 file:text-sm file:font-medium dark:file:border-zinc-700 dark:file:bg-zinc-900"
      />
    </label>
  );
}

// ---------------------------------------------------------------------------
// Plantilla por catálogo
// ---------------------------------------------------------------------------

function PorPlantilla({ existentes }: { existentes: Existentes }) {
  const [clave, setClave] = useState<CatalogoImportable>("unidades");
  const [previa, setPrevia] = useState<{ archivo: string; entradas: Entrada[]; filas: FilaPrevia[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const def = CATALOGOS[clave];

  async function descargarPlantilla() {
    const { default: escribirXlsx } = await import("write-excel-file/browser");
    const encabezados = encabezadosPlantilla(def);
    await escribirXlsx([encabezados.map((value) => ({ value, fontWeight: "bold" as const }))], {
      sheet: def.titulo,
      columns: encabezados.map((e) => ({ width: Math.max(14, e.length + 4) })),
      stickyRowsCount: 1,
    }).toFile(`plantilla-${clave}.xlsx`);
  }

  async function procesar(archivo: File) {
    setError(null);
    setPrevia(null);
    try {
      const [hoja] = await leerArchivo(archivo);
      if (!hoja) throw new Error("El archivo no tiene hojas");
      const inicio = filaDeEncabezados(hoja.filas);
      const mapeo = mapearEncabezados(def, hoja.filas[inicio] ?? []);
      if (mapeo.faltantes.length) {
        throw new Error(`Faltan columnas obligatorias: ${mapeo.faltantes.join(", ")}. Usa la plantilla de ${def.titulo.toLowerCase()}.`);
      }
      const entradas = entradasDeFilas(hoja.filas.slice(inicio + 1), mapeo, inicio + 2);
      const filas = validarRegistros(def, entradas, existentes[clave]);
      if (!filas.length) throw new Error("El archivo no tiene registros debajo de los encabezados");
      setPrevia({ archivo: archivo.name, entradas, filas });
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo leer el archivo");
    }
  }

  const cuenta = previa ? resumen(previa.filas) : null;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="w-56">
          <Selector
            etiqueta="Catálogo"
            name="catalogo"
            value={clave}
            onChange={(e) => {
              setClave(e.target.value as CatalogoImportable);
              setPrevia(null);
              setError(null);
            }}
            opciones={CATALOGOS_IMPORTABLES.map((c) => ({ valor: c, etiqueta: CATALOGOS[c].titulo }))}
          />
        </div>
        <button type="button" onClick={descargarPlantilla} className={claseBotonSecundario}>
          Descargar plantilla de {def.titulo.toLowerCase()} (.xlsx)
        </button>
      </div>
      <p className="text-sm text-zinc-500">
        Llena la plantilla (las columnas con * son obligatorias) y súbela. También acepta CSV con los mismos encabezados.
      </p>
      <SubirArchivo etiqueta="Archivo" alElegir={procesar} />
      <Aviso texto={error ?? undefined} />

      {previa && cuenta && (
        <>
          <p className="text-sm">
            <strong>{previa.archivo}</strong>: {cuenta.nuevas} nuevas · {cuenta.existentes} ya existen · {cuenta.errores} con error
          </p>
          {cuenta.errores > 0 && (
            <Aviso texto="Corrige las filas con error en tu archivo y vuelve a subirlo. Se guarda todo o nada." />
          )}
          <VistaPrevia def={def} filas={previa.filas} />
          <Confirmar
            key={previa.archivo + clave}
            habilitado={cuenta.errores === 0 && cuenta.nuevas > 0}
            texto={`Importar ${cuenta.nuevas} ${def.titulo.toLowerCase()}`}
            enviar={() => importarCatalogos({ [clave]: previa.entradas })}
          />
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Mi control de viajes
// ---------------------------------------------------------------------------

const SECCIONES: CatalogoControl[] = ["unidades", "operadores", "clientes", "fuentes", "rutas"];

function PorControl({ existentes }: { existentes: Existentes }) {
  const [control, setControl] = useState<(ControlDeViajes & { archivo: string; hoja: string }) | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [incluir, setIncluir] = useState<Record<CatalogoControl, boolean>>({
    unidades: true,
    operadores: true,
    clientes: true,
    fuentes: true,
    rutas: true,
  });
  const [decisiones, setDecisiones] = useState<Record<string, number | undefined>>({});

  async function procesar(archivo: File) {
    setError(null);
    setControl(null);
    setDecisiones({});
    try {
      const hojas = await leerArchivo(archivo);
      // Primero la hoja "Viajes"; si no, la primera que parezca un control de viajes.
      const ordenadas = [...hojas].sort((a, b) => Number(b.nombre.toLowerCase() === "viajes") - Number(a.nombre.toLowerCase() === "viajes"));
      for (const hoja of ordenadas) {
        const leido = leerControlDeViajes(hoja.filas);
        if (!("error" in leido) && leido.viajes > 0) {
          setControl({ ...leido, archivo: archivo.name, hoja: hoja.nombre });
          return;
        }
      }
      throw new Error("No encontré una hoja de viajes con columnas Unidad, Operador, Origen y Destino.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo leer el archivo");
    }
  }

  const entradas = useMemo(() => (control ? entradasDeControl(control, decisiones) : null), [control, decisiones]);
  const previas = useMemo(() => {
    if (!entradas) return null;
    return Object.fromEntries(
      SECCIONES.map((c) => [c, validarRegistros(CATALOGOS[c], entradas[c], existentes[c])]),
    ) as Record<CatalogoControl, FilaPrevia[]>;
  }, [entradas, existentes]);

  if (!control || !previas || !entradas) {
    return (
      <div className="flex flex-col gap-4">
        <p className="text-sm text-zinc-500">
          Sube tu Excel de control de viajes (una fila por viaje). Saco de ahí las unidades, operadores, clientes, fuentes
          de diésel y rutas sin repetir. No se guarda nada hasta que confirmes.
        </p>
        <SubirArchivo etiqueta="Excel de control de viajes" alElegir={procesar} />
        <Aviso texto={error ?? undefined} />
      </div>
    );
  }

  const pendientes = control.rutas.filter((r) => rutaRequiereDecision(r) && kmDeRuta(r, decisiones) === null);
  const conErrores = SECCIONES.filter((c) => incluir[c] && previas[c].some((f) => f.estado === "error"));
  const nuevas = SECCIONES.reduce((n, c) => n + (incluir[c] ? resumen(previas[c]).nuevas : 0), 0);
  const rutasBloquean = incluir.rutas && pendientes.length > 0;
  const porUnidad = new Map(control.unidades.map((u) => [u.numero_economico, u]));

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm">
          <strong>{control.archivo}</strong>, hoja «{control.hoja}»: {control.viajes} viajes (encabezados en la fila{" "}
          {control.filaEncabezados}).
        </p>
        <button type="button" onClick={() => setControl(null)} className="text-sm underline">
          Subir otro archivo
        </button>
      </div>

      <Seccion
        titulo="Unidades"
        filas={previas.unidades}
        incluir={incluir.unidades}
        alCambiar={(v) => setIncluir({ ...incluir, unidades: v })}
        nota="El rendimiento sugerido es el km/l real de tus viajes (km totales ÷ litros). No se guarda solo: si te sirve, captúralo en la unidad."
      >
        <VistaPrevia
          def={CATALOGOS.unidades}
          filas={previas.unidades}
          etiquetaFila="#"
          columnas={["numero_economico", "placas"]}
          extra={{
            titulo: "Rendimiento sugerido",
            valor: (f) => {
              const u = porUnidad.get(f.original.numero_economico);
              return u?.rendimientoSugerido ? (
                <>
                  {u.rendimientoSugerido.toLocaleString("es-MX")} km/l{" "}
                  <span className="text-xs text-zinc-500">({u.viajesConLitros} viajes)</span>
                </>
              ) : (
                <span className="text-zinc-400">sin litros</span>
              );
            },
          }}
        />
      </Seccion>

      {(["operadores", "clientes", "fuentes"] as const).map((c) => (
        <Seccion
          key={c}
          titulo={CATALOGOS[c].titulo}
          filas={previas[c]}
          incluir={incluir[c]}
          alCambiar={(v) => setIncluir({ ...incluir, [c]: v })}
          nota={c === "fuentes" ? "Se dan de alta como tipo Tarjeta. Los tanques propios y el crédito en estación agrégalos a mano." : undefined}
        >
          <VistaPrevia def={CATALOGOS[c]} filas={previas[c]} etiquetaFila="#" columnas={c === "fuentes" ? ["nombre", "tipo"] : ["nombre"]} />
        </Seccion>
      ))}

      <Seccion
        titulo="Rutas"
        filas={previas.rutas}
        incluir={incluir.rutas}
        alCambiar={(v) => setIncluir({ ...incluir, rutas: v })}
        nota="Cada ruta es un tramo de un sentido. Cuando la misma ruta tiene km distintos (viajes capturados como ida, vuelta o ida y vuelta), elige los km de un solo sentido."
      >
        <TablaRutas
          rutas={control.rutas}
          previas={previas.rutas}
          decisiones={decisiones}
          alDecidir={(clave, km) => setDecisiones((d) => ({ ...d, [clave]: km }))}
        />
      </Seccion>

      <div className="flex flex-col gap-2 border-t border-zinc-200 pt-4 dark:border-zinc-800">
        {rutasBloquean && (
          <Aviso texto={`Falta decidir los km de ${pendientes.length} ruta(s). Decídelos o quita las rutas de esta importación.`} />
        )}
        {conErrores.length > 0 && (
          <Aviso texto={`Hay errores en: ${conErrores.map((c) => CATALOGOS[c].titulo.toLowerCase()).join(", ")}. Quítalos de la importación o corrige el archivo.`} />
        )}
        <Confirmar
          key={control.archivo}
          habilitado={!rutasBloquean && conErrores.length === 0 && nuevas > 0}
          texto={`Importar ${nuevas} registros nuevos`}
          enviar={() =>
            importarCatalogos(Object.fromEntries(SECCIONES.filter((c) => incluir[c]).map((c) => [c, entradas[c]])))
          }
        />
      </div>
    </div>
  );
}

/** Registros de cada catálogo sacados del control. Las rutas sin decidir no van. */
function entradasDeControl(control: ControlDeViajes, decisiones: Record<string, number | undefined>) {
  const lista = <T,>(xs: T[], valores: (x: T) => Record<string, unknown>): Entrada[] =>
    xs.map((x, i) => ({ numero: i + 1, valores: valores(x) }));
  return {
    unidades: lista(control.unidades, (u) => ({ numero_economico: u.numero_economico, placas: u.placas })),
    operadores: lista(control.operadores, (o) => ({ nombre: o.nombre })),
    clientes: lista(control.clientes, (c) => ({ nombre: c.nombre })),
    fuentes: lista(control.fuentes, (f) => ({ nombre: f.nombre, tipo: "tarjeta" })),
    rutas: control.rutas.flatMap((r, i) => {
      const km = kmDeRuta(r, decisiones);
      return km === null ? [] : [{ numero: i + 1, valores: { origen: r.origen, destino: r.destino, km } }];
    }),
  } satisfies Record<CatalogoControl, Entrada[]>;
}

function Seccion({
  titulo,
  filas,
  incluir,
  alCambiar,
  nota,
  children,
}: {
  titulo: string;
  filas: FilaPrevia[];
  incluir: boolean;
  alCambiar: (v: boolean) => void;
  nota?: string;
  children: React.ReactNode;
}) {
  const c = resumen(filas);
  return (
    <section className="flex flex-col gap-2">
      <label className="flex flex-wrap items-center gap-2">
        <input type="checkbox" checked={incluir} onChange={(e) => alCambiar(e.target.checked)} />
        <span className="font-semibold">{titulo}</span>
        <span className="text-sm text-zinc-500">
          {c.nuevas} nuevas · {c.existentes} ya existen{c.errores ? ` · ${c.errores} con error` : ""}
        </span>
      </label>
      {nota && <p className="text-sm text-zinc-500">{nota}</p>}
      {incluir && children}
    </section>
  );
}

function TablaRutas({
  rutas,
  previas,
  decisiones,
  alDecidir,
}: {
  rutas: RutaControl[];
  previas: FilaPrevia[];
  decisiones: Record<string, number | undefined>;
  alDecidir: (clave: string, km: number | undefined) => void;
}) {
  // Primero las que necesitan decisión.
  const ordenadas = [...rutas].sort((a, b) => Number(rutaRequiereDecision(b)) - Number(rutaRequiereDecision(a)));
  const previaDe = (r: RutaControl) => previas.find((p) => p.numero === rutas.indexOf(r) + 1);

  return (
    <ul className="flex flex-col gap-2">
      {ordenadas.map((r) => {
        const decidir = rutaRequiereDecision(r);
        const previa = previaDe(r);
        const elegido = decisiones[r.clave];
        const esOtro = elegido !== undefined && !r.variantes.some((v) => v.km === elegido);
        return (
          <li
            key={r.clave}
            className={`rounded-xl border p-3 text-sm ${decidir && elegido === undefined ? "border-amber-400 bg-amber-50 dark:border-amber-700 dark:bg-amber-950/30" : "border-zinc-200 dark:border-zinc-800"}`}
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="font-medium">
                {r.origen} → {r.destino} <span className="font-normal text-zinc-500">· {r.viajes} viajes</span>
              </p>
              {previa ? (
                <span className="flex items-center gap-2">
                  <Estado estado={previa.estado} />
                  {previa.aviso && <span className="text-xs text-zinc-500">{previa.aviso}</span>}
                  {previa.errores.km && <span className="text-xs text-red-600">{previa.errores.km}</span>}
                </span>
              ) : (
                <span className="text-xs font-medium text-amber-700 dark:text-amber-400">Elige los km</span>
              )}
            </div>
            {decidir ? (
              <fieldset className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
                <legend className="sr-only">Km de {r.origen} a {r.destino}</legend>
                {r.variantes.map((v) =>
                  v.km === null ? (
                    <span key="sin-km" className="text-zinc-500">
                      sin km: {v.viajes} viaje(s)
                    </span>
                  ) : (
                    <label key={v.km} className="flex items-center gap-1">
                      <input
                        type="radio"
                        name={r.clave}
                        checked={elegido === v.km}
                        onChange={() => alDecidir(r.clave, v.km!)}
                      />
                      {v.km.toLocaleString("es-MX")} km <span className="text-zinc-500">({v.viajes} viajes)</span>
                    </label>
                  ),
                )}
                <label className="flex items-center gap-1">
                  <input type="radio" name={r.clave} checked={esOtro} readOnly />
                  Otro:
                  <input
                    type="text"
                    inputMode="decimal"
                    aria-label="Otros km"
                    defaultValue={esOtro ? String(elegido) : ""}
                    onChange={(e) => {
                      const n = Number(e.target.value.replace(",", "."));
                      alDecidir(r.clave, e.target.value.trim() && Number.isFinite(n) && n > 0 ? n : undefined);
                    }}
                    className="w-24 rounded-md border border-zinc-300 bg-white px-2 py-1 dark:border-zinc-700 dark:bg-zinc-950"
                  />
                  km
                </label>
              </fieldset>
            ) : (
              <p className="mt-1 text-zinc-600 dark:text-zinc-400">{r.variantes[0].km?.toLocaleString("es-MX")} km</p>
            )}
          </li>
        );
      })}
    </ul>
  );
}
