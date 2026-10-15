"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { Aviso, BotonEnviar, Campo, Selector } from "@/components/campos";
import { claveComparacion, parsearNumero } from "@/lib/catalogos/validacion";
import { continuidadOdometro } from "@/lib/viajes/calculos";
import { MOMENTOS, MOTIVOS_DESVIO } from "@/lib/viajes/formulario";
import { revisarKm } from "@/lib/viajes/km";
import { guardarViaje } from "./acciones";

export interface DatosFormularioViaje {
  unidades: { id: string; nombre: string }[];
  operadores: { id: string; nombre: string }[];
  clientes: { id: string; nombre: string }[];
  /** Último punto de cada unidad (para prellenar un viaje nuevo). */
  ultimos: Record<string, { lugar: string | null; odometro: number | null; operadorId: string | null }>;
  rutas: { origen: string; destino: string; km: number }[];
  toleranciaKmPct: number;
  lugares: string[];
  productos: string[];
  esAdmin: boolean;
}

export function FormularioViaje({
  id,
  iniciales,
  datos,
  odometroAnterior,
}: {
  id: string | null;
  iniciales: Record<string, string>;
  datos: DatosFormularioViaje;
  /** En edición: odómetro final del viaje anterior (no cambia al editar). */
  odometroAnterior?: number | null;
}) {
  const [estado, accion] = useActionState(guardarViaje.bind(null, id), {});
  const v = estado.valores ?? iniciales;
  const e = estado.errores ?? {};

  // Lo que se calcula en vivo va controlado.
  const [unidad, setUnidad] = useState(v.unidad_id ?? "");
  const [operador, setOperador] = useState(v.operador_id ?? "");
  const [lugares, setLugares] = useState({ origen: v.origen ?? "", carga: v.lugar_carga ?? "", descarga: v.lugar_descarga ?? "" });
  const [odos, setOdos] = useState({ inicial: v.odometro_inicial ?? "", carga: v.odometro_carga ?? "", final: v.odometro_final ?? "" });

  const anterior = id ? (odometroAnterior ?? null) : (datos.ultimos[unidad]?.odometro ?? null);

  function elegirUnidad(nueva: string) {
    setUnidad(nueva);
    if (id) return;
    // Un viaje nuevo empieza donde terminó el anterior de esa unidad.
    const ultimo = datos.ultimos[nueva];
    if (ultimo?.lugar) setLugares((l) => ({ ...l, origen: ultimo.lugar! }));
    if (ultimo?.odometro !== null && ultimo?.odometro !== undefined) setOdos((o) => ({ ...o, inicial: String(ultimo.odometro) }));
    if (ultimo?.operadorId && !operador) setOperador(ultimo.operadorId);
  }

  const n = (t: string) => {
    const x = parsearNumero(t);
    return x === null || Number.isNaN(x) ? null : x;
  };
  const kmRuta = (o: string, d: string) =>
    datos.rutas.find((r) => claveComparacion(r.origen) === claveComparacion(o) && claveComparacion(r.destino) === claveComparacion(d))?.km ?? null;
  const tramo = (o: string, d: string, ini: string, fin: string) => {
    const a = n(ini);
    const b = n(fin);
    const km = a !== null && b !== null && b >= a ? Math.round((b - a) * 10) / 10 : null;
    const ruta = o && d ? kmRuta(o, d) : null;
    return { km, ruta, revision: revisarKm(km, ruta, datos.toleranciaKmPct), completo: !!(o && d && km !== null) };
  };
  const vacio = tramo(lugares.origen, lugares.carga, odos.inicial, odos.carga);
  const cargado = tramo(lugares.carga, lugares.descarga, odos.carga, odos.final);
  const continuidad = continuidadOdometro(anterior, n(odos.inicial));

  return (
    <form action={accion} className="flex flex-col gap-6">
      <Aviso texto={estado.mensaje} />
      <datalist id="lugares">
        {datos.lugares.map((l) => (
          <option key={l} value={l} />
        ))}
      </datalist>
      <datalist id="productos">
        {datos.productos.map((p) => (
          <option key={p} value={p} />
        ))}
      </datalist>

      <Seccion titulo="Unidad y carga">
        <Selector
          etiqueta="Unidad"
          name="unidad_id"
          value={unidad}
          onChange={(ev) => elegirUnidad(ev.target.value)}
          opciones={datos.unidades.map((u) => ({ valor: u.id, etiqueta: u.nombre }))}
          vacio="Elige…"
          required
          error={e.unidad_id}
        />
        <Selector
          etiqueta="Operador"
          name="operador_id"
          value={operador}
          onChange={(ev) => setOperador(ev.target.value)}
          opciones={datos.operadores.map((o) => ({ valor: o.id, etiqueta: o.nombre }))}
          vacio="Elige…"
          required
          error={e.operador_id}
        />
        <Selector
          etiqueta="Cliente"
          name="cliente_id"
          defaultValue={v.cliente_id ?? ""}
          opciones={datos.clientes.map((c) => ({ valor: c.id, etiqueta: c.nombre }))}
          vacio="—"
          error={e.cliente_id}
        />
        <Campo etiqueta="Producto" name="producto" list="productos" defaultValue={v.producto ?? ""} maxLength={80} error={e.producto} />
        <Campo
          etiqueta="Toneladas cargadas"
          name="toneladas_cargadas"
          inputMode="decimal"
          defaultValue={v.toneladas_cargadas ?? ""}
          error={e.toneladas_cargadas}
        />
        <Campo
          etiqueta="Toneladas descargadas"
          name="toneladas_descargadas"
          inputMode="decimal"
          defaultValue={v.toneladas_descargadas ?? ""}
          ayuda="Al llegar a descarga"
          error={e.toneladas_descargadas}
        />
        {datos.esAdmin && (
          <Campo
            etiqueta="Folio"
            name="folio"
            defaultValue={v.folio ?? ""}
            placeholder="Automático"
            ayuda="Déjalo vacío para el consecutivo"
            error={e.folio}
          />
        )}
      </Seccion>

      <Seccion titulo="Recorrido" columnas={false}>
        <p className="text-sm text-zinc-500">
          Tramo vacío: de donde sale la unidad al lugar de carga. Tramo cargado: del lugar de carga al de descarga. El
          siguiente viaje empieza en la descarga.
        </p>
        <div className="grid gap-4 sm:grid-cols-2">
          <Campo
            etiqueta="Sale de (A)"
            name="origen"
            list="lugares"
            value={lugares.origen}
            onChange={(ev) => setLugares({ ...lugares, origen: ev.target.value })}
            required
            error={e.origen}
          />
          <Campo
            etiqueta="Odómetro al salir"
            name="odometro_inicial"
            inputMode="decimal"
            value={odos.inicial}
            onChange={(ev) => setOdos({ ...odos, inicial: ev.target.value })}
            required
            ayuda={anterior !== null ? `Último registrado de la unidad: ${anterior.toLocaleString("es-MX")}` : undefined}
            error={e.odometro_inicial}
          />
        </div>
        {continuidad.requiereExplicacion && (
          <div className="rounded-md border border-amber-400 bg-amber-50 p-3 dark:border-amber-700 dark:bg-amber-950/30">
            <p className="mb-2 text-sm">
              {continuidad.kmSinViaje > 0
                ? `Hay ${continuidad.kmSinViaje.toLocaleString("es-MX")} km sin viaje desde el último registrado. ¿Qué pasó?`
                : "El odómetro es menor que el último registrado. ¿Por qué?"}
            </p>
            <Campo
              etiqueta="Explicación"
              name="explicacion_km_sin_viaje"
              defaultValue={v.explicacion_km_sin_viaje ?? ""}
              required
              error={e.explicacion_km_sin_viaje}
            />
          </div>
        )}
        <div className="grid gap-4 sm:grid-cols-2">
          <Campo
            etiqueta="Lugar de carga (B)"
            name="lugar_carga"
            list="lugares"
            value={lugares.carga}
            onChange={(ev) => setLugares({ ...lugares, carga: ev.target.value })}
            error={e.lugar_carga}
          />
          <Campo
            etiqueta="Odómetro al llegar a carga"
            name="odometro_carga"
            inputMode="decimal"
            value={odos.carga}
            onChange={(ev) => setOdos({ ...odos, carga: ev.target.value })}
            error={e.odometro_carga}
          />
        </div>
        <InfoTramo nombre="Tramo vacío" tipo="vacio" t={vacio} v={v} e={e} esAdmin={datos.esAdmin} tolerancia={datos.toleranciaKmPct} />
        <div className="grid gap-4 sm:grid-cols-2">
          <Campo
            etiqueta="Lugar de descarga (C)"
            name="lugar_descarga"
            list="lugares"
            value={lugares.descarga}
            onChange={(ev) => setLugares({ ...lugares, descarga: ev.target.value })}
            error={e.lugar_descarga}
          />
          <Campo
            etiqueta="Odómetro al llegar a descarga"
            name="odometro_final"
            inputMode="decimal"
            value={odos.final}
            onChange={(ev) => setOdos({ ...odos, final: ev.target.value })}
            error={e.odometro_final}
          />
        </div>
        <InfoTramo nombre="Tramo cargado" tipo="cargado" t={cargado} v={v} e={e} esAdmin={datos.esAdmin} tolerancia={datos.toleranciaKmPct} />
      </Seccion>

      <Seccion titulo="Tiempos (hora del centro)">
        {MOMENTOS.map((m) => (
          <Campo
            key={m.campo}
            etiqueta={m.etiqueta}
            name={m.campo}
            type="datetime-local"
            defaultValue={v[m.campo] ?? ""}
            required={m.campo === "fecha_salida"}
            error={e[m.campo]}
          />
        ))}
      </Seccion>

      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium">Notas</span>
        <textarea
          name="notas"
          defaultValue={v.notas ?? ""}
          rows={2}
          maxLength={500}
          className="rounded-md border border-zinc-300 bg-white px-3 py-2 text-base dark:border-zinc-700 dark:bg-zinc-950"
        />
      </label>

      <div className="flex items-center gap-4">
        <BotonEnviar pendiente="Guardando…">{id ? "Guardar cambios" : "Dar de alta el viaje"}</BotonEnviar>
        <Link href={id ? `/viajes/${id}` : "/viajes"} className="mt-2 text-sm underline">
          Cancelar
        </Link>
      </div>
    </form>
  );
}

function Seccion({ titulo, children, columnas = true }: { titulo: string; children: React.ReactNode; columnas?: boolean }) {
  return (
    <fieldset className="flex flex-col gap-4">
      <legend className="mb-2 text-lg font-semibold">{titulo}</legend>
      {columnas ? <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{children}</div> : children}
    </fieldset>
  );
}

/** km del tramo, comparación con su ruta y motivo de desvío si hace falta. */
function InfoTramo({
  nombre,
  tipo,
  t,
  v,
  e,
  esAdmin,
  tolerancia,
}: {
  nombre: string;
  tipo: "vacio" | "cargado";
  t: { km: number | null; ruta: number | null; revision: { desviacionPct: number | null; revisar: boolean }; completo: boolean };
  v: Record<string, string>;
  e: Record<string, string | undefined>;
  esAdmin: boolean;
  tolerancia: number;
}) {
  if (!t.completo) return null;
  return (
    <div
      className={`flex flex-col gap-3 rounded-md border p-3 text-sm ${t.revision.revisar ? "border-amber-400 bg-amber-50 dark:border-amber-700 dark:bg-amber-950/30" : "border-zinc-200 dark:border-zinc-800"}`}
    >
      <p>
        <strong>{nombre}:</strong> {t.km?.toLocaleString("es-MX")} km
        {t.ruta !== null ? (
          <span className="text-zinc-500">
            {" "}
            · ruta del catálogo {t.ruta.toLocaleString("es-MX")} km ({t.revision.desviacionPct! > 0 ? "+" : ""}
            {t.revision.desviacionPct}%)
          </span>
        ) : (
          <span className="text-zinc-500"> · ruta nueva</span>
        )}
      </p>
      {t.revision.revisar && (
        <div className="grid gap-3 sm:grid-cols-2">
          <Selector
            etiqueta={`Motivo del desvío (más de ${tolerancia}%)`}
            name={`motivo_${tipo}`}
            defaultValue={v[`motivo_${tipo}`] ?? ""}
            opciones={MOTIVOS_DESVIO}
            vacio="Elige…"
            required
            error={e[`motivo_${tipo}`]}
          />
          <Campo etiqueta="Nota" name={`nota_${tipo}`} defaultValue={v[`nota_${tipo}`] ?? ""} error={e[`nota_${tipo}`]} />
        </div>
      )}
      {t.ruta === null && esAdmin && (
        <label className="flex items-center gap-2">
          <input type="checkbox" name={`guardar_ruta_${tipo}`} defaultChecked={v[`guardar_ruta_${tipo}`] === "on"} />
          Guardar esta ruta en el catálogo con {t.km?.toLocaleString("es-MX")} km
        </label>
      )}
    </div>
  );
}
