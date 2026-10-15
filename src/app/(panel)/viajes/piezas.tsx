"use client";

import { useActionState, useState, useTransition } from "react";
import { Aviso, BotonEnviar, Campo, Selector } from "@/components/campos";
import { CAMPOS_ESQUEMA, ESQUEMAS_PAGO, ETIQUETA_COLUMNA_PAGO } from "@/lib/viajes/pago";
import type { EsquemaPago } from "@/lib/viajes/calculos";
import { ahoraLocal, formatearFecha, formatearFechaHora, hoy } from "@/lib/viajes/fechas";
import { FORMAS_PAGO } from "@/lib/viajes/movimientos";
import { numero, pesos } from "@/lib/formato";
import { crearClienteNavegador } from "@/lib/supabase/client";
import type { Carga, Gasto } from "@/lib/viajes/datos";
import {
  cancelarGasto,
  cerrarViaje,
  guardarCarga,
  guardarFinanzas,
  guardarGasto,
  reabrirViaje,
  revisarCarga,
} from "./acciones";

const claseBoton =
  "rounded-md border border-zinc-300 px-3 py-1.5 text-sm font-medium hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-800";

/** Sube una foto o PDF a Storage (carpeta de la empresa) y deja la ruta en un campo oculto. */
export function SubirArchivo({
  bucket,
  empresaId,
  nombre,
  etiqueta,
  acepta,
  error,
}: {
  bucket: "tickets" | "comprobantes";
  empresaId: string;
  nombre: string;
  etiqueta: string;
  acepta: string;
  error?: string;
}) {
  const [ruta, setRuta] = useState("");
  const [estado, setEstado] = useState<string | null>(null);

  async function subir(archivo: File) {
    setEstado("Subiendo…");
    const ext = (archivo.name.split(".").pop() ?? "jpg").toLowerCase().replace(/[^a-z0-9]/g, "");
    const destino = `${empresaId}/${crypto.randomUUID()}.${ext}`;
    const { error: e } = await crearClienteNavegador().storage.from(bucket).upload(destino, archivo, { contentType: archivo.type });
    if (e) {
      setRuta("");
      setEstado("No se pudo subir (máximo 5 MB en fotos de ticket, 10 MB en comprobantes).");
      return;
    }
    setRuta(destino);
    setEstado(`Listo: ${archivo.name}`);
  }

  return (
    <label className="flex flex-col gap-1 text-sm">
      <span className="font-medium">{etiqueta}</span>
      <input type="hidden" name={nombre} value={ruta} />
      <input
        type="file"
        accept={acepta}
        // En celular abre la cámara para fotos.
        capture={acepta.startsWith("image") ? "environment" : undefined}
        onChange={(e) => e.target.files?.[0] && subir(e.target.files[0])}
        className="text-sm"
      />
      {(estado || error) && <span className={error ? "text-red-600" : "text-zinc-500"}>{error ?? estado}</span>}
    </label>
  );
}

function Mensaje({ texto }: { texto: string | null }) {
  return texto ? (
    <p role="alert" className="text-xs text-red-600">
      {texto}
    </p>
  ) : null;
}

const ESTADO_CARGA = {
  pendiente: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300",
  validada: "bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-300",
  rechazada: "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300",
} as const;

export function SeccionCargas({
  viajeId,
  empresaId,
  abierto,
  cargas,
  fuentes,
  revisables,
  fotos,
}: {
  viajeId: string;
  empresaId: string;
  abierto: boolean;
  cargas: Carga[];
  fuentes: { valor: string; etiqueta: string }[];
  /** Cargas que este usuario puede validar o rechazar. */
  revisables: string[];
  fotos: Record<string, string>;
}) {
  const [pendiente, iniciar] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [estado, accion] = useActionState(guardarCarga.bind(null, viajeId), {});
  const [abiertoForm, setAbiertoForm] = useState(false);

  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-lg font-semibold">Cargas de diésel</h2>
      {cargas.length === 0 ? (
        <p className="text-sm text-zinc-500">Sin cargas.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {cargas.map((c) => (
            <li key={c.id} className="flex flex-wrap items-start justify-between gap-2 rounded-md border border-zinc-200 p-3 text-sm dark:border-zinc-800">
              <div>
                <p className="font-medium">
                  {numero(c.litros, 2)} L · {c.fuente}{" "}
                  <span className={`ml-1 rounded px-1.5 py-0.5 text-xs ${ESTADO_CARGA[c.estado]}`}>
                    {c.estado}
                    {c.autovalidada ? " (autovalidada)" : ""}
                  </span>
                </p>
                <p className="text-zinc-500">
                  {formatearFechaHora(c.fecha)}
                  {c.importe !== null && ` · ${pesos(c.importe)}`}
                  {c.precio_litro !== null && ` · ${pesos(c.precio_litro)}/L`}
                  {c.odometro !== null && ` · odómetro ${numero(c.odometro)}`}
                  {c.folio_ticket && ` · ticket ${c.folio_ticket}`}
                  {fotos[c.id] && (
                    <>
                      {" · "}
                      <a href={fotos[c.id]} target="_blank" rel="noreferrer" className="underline">
                        foto
                      </a>
                    </>
                  )}
                </p>
              </div>
              {revisables.includes(c.id) && (
                <div className="flex gap-2">
                  {(["validada", "rechazada"] as const).map((nuevo) => (
                    <button
                      key={nuevo}
                      type="button"
                      disabled={pendiente}
                      onClick={() => iniciar(async () => setError(await revisarCarga(c.id, nuevo)))}
                      className={claseBoton}
                    >
                      {nuevo === "validada" ? "Validar" : "Rechazar"}
                    </button>
                  ))}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      <Mensaje texto={error} />
      {abierto &&
        (abiertoForm ? (
          <form action={accion} key={estado.enviadoEn ?? 0} className="flex flex-col gap-3 rounded-md border border-zinc-200 p-3 dark:border-zinc-800">
            <Aviso texto={estado.mensaje} tipo={estado.exito ? "exito" : "error"} />
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <Campo etiqueta="Fecha y hora" name="fecha" type="datetime-local" defaultValue={estado.valores?.fecha ?? ahoraLocal()} required error={estado.errores?.fecha} />
              <Selector etiqueta="Dónde" name="fuente_id" opciones={fuentes} vacio="Elige…" defaultValue={estado.valores?.fuente_id ?? ""} required error={estado.errores?.fuente_id} />
              <Campo etiqueta="Litros" name="litros" inputMode="decimal" defaultValue={estado.valores?.litros ?? ""} required error={estado.errores?.litros} />
              <Campo etiqueta="Precio por litro" name="precio_litro" inputMode="decimal" defaultValue={estado.valores?.precio_litro ?? ""} error={estado.errores?.precio_litro} />
              <Campo etiqueta="Importe del ticket" name="importe" inputMode="decimal" defaultValue={estado.valores?.importe ?? ""} ayuda="Si lo dejas vacío: litros × precio" error={estado.errores?.importe} />
              <Campo etiqueta="Odómetro" name="odometro" inputMode="decimal" defaultValue={estado.valores?.odometro ?? ""} error={estado.errores?.odometro} />
              <Campo etiqueta="Folio del ticket" name="folio_ticket" defaultValue={estado.valores?.folio_ticket ?? ""} error={estado.errores?.folio_ticket} />
              <SubirArchivo bucket="tickets" empresaId={empresaId} nombre="foto_ticket_path" etiqueta="Foto del ticket o del medidor" acepta="image/*" error={estado.errores?.foto_ticket_path} />
            </div>
            <BotonEnviar pendiente="Guardando…">Agregar carga</BotonEnviar>
          </form>
        ) : (
          <button type="button" onClick={() => setAbiertoForm(true)} className={`self-start ${claseBoton}`}>
            + Agregar carga de diésel
          </button>
        ))}
    </section>
  );
}

export function SeccionGastos({
  viajeId,
  empresaId,
  abierto,
  gastos,
  categorias,
  esAdmin,
  comprobantes,
}: {
  viajeId: string;
  empresaId: string;
  abierto: boolean;
  gastos: Gasto[];
  categorias: { valor: string; etiqueta: string }[];
  esAdmin: boolean;
  comprobantes: Record<string, string>;
}) {
  const [pendiente, iniciar] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [estado, accion] = useActionState(guardarGasto.bind(null, viajeId), {});
  const [abiertoForm, setAbiertoForm] = useState(false);
  const formaPago = (v: string) => FORMAS_PAGO.find((f) => f.valor === v)?.etiqueta ?? v;

  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-lg font-semibold">Gastos del viaje</h2>
      {gastos.length === 0 ? (
        <p className="text-sm text-zinc-500">Sin gastos.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {gastos.map((g) => (
            <li
              key={g.id}
              className={`flex flex-wrap items-start justify-between gap-2 rounded-md border border-zinc-200 p-3 text-sm dark:border-zinc-800 ${g.cancelado ? "opacity-50" : ""}`}
            >
              <div>
                <p className="font-medium">
                  {g.categoria} · {pesos(Number(g.monto))}
                  {g.facturable && <span className="ml-2 rounded bg-blue-100 px-1.5 py-0.5 text-xs text-blue-800 dark:bg-blue-950 dark:text-blue-300">se factura al cliente</span>}
                  {g.cancelado && <span className="ml-2 text-xs">(cancelado)</span>}
                </p>
                <p className="text-zinc-500">
                  {g.folio} · {formatearFecha(g.fecha)} · {formaPago(g.forma_pago)}
                  {g.proveedor && ` · ${g.proveedor}`}
                  {g.numero_comprobante && ` · comprobante ${g.numero_comprobante}`}
                  {comprobantes[g.id] && (
                    <>
                      {" · "}
                      <a href={comprobantes[g.id]} target="_blank" rel="noreferrer" className="underline">
                        ver archivo
                      </a>
                    </>
                  )}
                </p>
              </div>
              {abierto && (
                <button
                  type="button"
                  disabled={pendiente}
                  onClick={() => iniciar(async () => setError(await cancelarGasto(g.id, !g.cancelado)))}
                  className="text-sm text-zinc-600 underline dark:text-zinc-400"
                >
                  {g.cancelado ? "Reactivar" : "Cancelar"}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      <Mensaje texto={error} />
      {abierto &&
        (abiertoForm ? (
          <form action={accion} key={estado.enviadoEn ?? 0} className="flex flex-col gap-3 rounded-md border border-zinc-200 p-3 dark:border-zinc-800">
            <Aviso texto={estado.mensaje} tipo={estado.exito ? "exito" : "error"} />
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <Campo etiqueta="Fecha" name="fecha" type="date" defaultValue={estado.valores?.fecha ?? hoy()} required error={estado.errores?.fecha} />
              <Selector etiqueta="Categoría" name="categoria_id" opciones={categorias} vacio="Elige…" defaultValue={estado.valores?.categoria_id ?? ""} required error={estado.errores?.categoria_id} />
              <Campo etiqueta="Monto" name="monto" inputMode="decimal" defaultValue={estado.valores?.monto ?? ""} required error={estado.errores?.monto} />
              <Selector etiqueta="Forma de pago" name="forma_pago" opciones={FORMAS_PAGO} defaultValue={estado.valores?.forma_pago ?? "efectivo"} error={estado.errores?.forma_pago} />
              <Campo etiqueta="Proveedor" name="proveedor" defaultValue={estado.valores?.proveedor ?? ""} error={estado.errores?.proveedor} />
              <Campo etiqueta="No. de comprobante o factura" name="numero_comprobante" defaultValue={estado.valores?.numero_comprobante ?? ""} error={estado.errores?.numero_comprobante} />
              <SubirArchivo bucket="comprobantes" empresaId={empresaId} nombre="comprobante_path" etiqueta="Comprobante (foto o PDF)" acepta="image/*,application/pdf" error={estado.errores?.comprobante_path} />
              {esAdmin && <Campo etiqueta="Folio" name="folio" placeholder="Automático" defaultValue={estado.valores?.folio ?? ""} error={estado.errores?.folio} />}
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="facturable" defaultChecked={estado.valores?.facturable === "on"} />
              Se factura al cliente (suma al ingreso del viaje)
            </label>
            <BotonEnviar pendiente="Guardando…">Agregar gasto</BotonEnviar>
          </form>
        ) : (
          <button type="button" onClick={() => setAbiertoForm(true)} className={`self-start ${claseBoton}`}>
            + Agregar gasto
          </button>
        ))}
    </section>
  );
}

export function FormularioFinanzas({ viajeId, iniciales }: { viajeId: string; iniciales: Record<string, string> }) {
  const [estado, accion] = useActionState(guardarFinanzas.bind(null, viajeId), {});
  const v = estado.valores ?? iniciales;
  const [esquema, setEsquema] = useState<EsquemaPago>((v.pago_esquema as EsquemaPago) || "pct_subtotal");
  const e = estado.errores ?? {};
  return (
    <form action={accion} className="flex flex-col gap-3">
      <Aviso texto={estado.mensaje} tipo={estado.exito ? "exito" : "error"} />
      <div className="grid gap-3 sm:grid-cols-3">
        <Selector
          etiqueta="Tarifa"
          name="tipo_tarifa"
          defaultValue={v.tipo_tarifa || "por_tonelada"}
          opciones={[
            { valor: "por_tonelada", etiqueta: "Por tonelada" },
            { valor: "fija", etiqueta: "Monto fijo por viaje" },
          ]}
          error={e.tipo_tarifa}
        />
        <Campo etiqueta="$ (por tonelada o monto fijo)" name="tarifa" inputMode="decimal" defaultValue={v.tarifa ?? ""} required error={e.tarifa} />
        <Selector
          etiqueta="Se factura por peso"
          name="factura_por"
          defaultValue={v.factura_por || "cargado"}
          opciones={[
            { valor: "cargado", etiqueta: "Cargado" },
            { valor: "descargado", etiqueta: "Descargado" },
          ]}
        />
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <Selector
          etiqueta="Pago al operador"
          name="pago_esquema"
          value={esquema}
          onChange={(ev) => setEsquema(ev.target.value as EsquemaPago)}
          opciones={ESQUEMAS_PAGO}
          error={e.pago_esquema}
        />
        {CAMPOS_ESQUEMA[esquema]
          .filter((c) => c !== "sueldo_base_mensual")
          .map((c) => (
            <Campo
              key={c}
              etiqueta={ETIQUETA_COLUMNA_PAGO[c]}
              name={`pago_${c}`}
              inputMode="decimal"
              defaultValue={v[`pago_${c}`] ?? ""}
              error={e[`pago_${c}`]}
            />
          ))}
        <Campo
          etiqueta="Pago manual (opcional)"
          name="pago_operador_manual"
          inputMode="decimal"
          defaultValue={v.pago_operador_manual ?? ""}
          ayuda="Si lo escribes, manda sobre el esquema"
          error={e.pago_operador_manual}
        />
      </div>
      <BotonEnviar pendiente="Guardando…">Guardar tarifa y pago</BotonEnviar>
    </form>
  );
}

export function Cierre({
  viajeId,
  estado: estadoViaje,
  puedeCerrar,
  puedeReabrir,
  bloqueos,
}: {
  viajeId: string;
  estado: "abierto" | "cerrado";
  puedeCerrar: boolean;
  puedeReabrir: boolean;
  /** Qué falta para poder cerrar (se muestra; la base lo vuelve a revisar). */
  bloqueos: string[];
}) {
  const [pendiente, iniciar] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [estado, accion] = useActionState(reabrirViaje.bind(null, viajeId), {});

  if (estadoViaje === "abierto") {
    if (!puedeCerrar) return null;
    return (
      <div className="flex flex-col gap-2">
        {bloqueos.length > 0 && (
          <ul className="list-disc pl-5 text-sm text-amber-700 dark:text-amber-400">
            {bloqueos.map((b) => (
              <li key={b}>{b}</li>
            ))}
          </ul>
        )}
        <button
          type="button"
          disabled={pendiente || bloqueos.length > 0}
          onClick={() => iniciar(async () => setError(await cerrarViaje(viajeId)))}
          className="self-start rounded-md bg-zinc-900 px-4 py-2 font-medium text-white disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900"
        >
          {pendiente ? "Cerrando…" : "Cerrar viaje"}
        </button>
        <Mensaje texto={error} />
      </div>
    );
  }
  if (!puedeReabrir) return null;
  return (
    <form action={accion} className="flex max-w-xl flex-col gap-2">
      <Aviso texto={estado.mensaje} tipo={estado.exito ? "exito" : "error"} />
      <Campo etiqueta="Motivo para reabrir" name="motivo" required minLength={5} error={estado.errores?.motivo} />
      <BotonEnviar pendiente="Reabriendo…">Reabrir viaje</BotonEnviar>
    </form>
  );
}
