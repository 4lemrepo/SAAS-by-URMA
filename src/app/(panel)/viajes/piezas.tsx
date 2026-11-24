"use client";

import { useActionState, useState, useTransition } from "react";
import { Aviso, BotonEnviar, Campo, Selector } from "@/components/campos";
import { CamposFactura, EditarFactura, TextoFactura, useFactura } from "@/components/factura";
import { parsearNumero } from "@/lib/catalogos/validacion";
import { BASES_FLETE, CAMPOS_ESQUEMA, ESQUEMAS_PAGO, ETIQUETA_COLUMNA_PAGO } from "@/lib/viajes/pago";
import type { EsquemaPago } from "@/lib/viajes/calculos";
import { ahoraLocal, formatearFecha, formatearFechaHora, hoy } from "@/lib/viajes/fechas";
import { FORMAS_PAGO } from "@/lib/viajes/movimientos";
import { numero, pesos } from "@/lib/formato";
import { crearClienteNavegador } from "@/lib/supabase/client";
import type { Carga, CargoAdicional, Gasto } from "@/lib/viajes/datos";
import {
  cambiarFacturaCarga,
  cambiarFacturaGasto,
  cancelarCargoAdicional,
  cancelarGasto,
  cancelarViaje,
  cerrarViaje,
  guardarCarga,
  guardarCargoAdicional,
  guardarFinanzas,
  guardarGasto,
  reabrirViaje,
  revisarCarga,
} from "./acciones";

/** Número de un campo del formulario mientras se escribe (null si vacío o inválido). */
const leer = (v: string) => {
  const n = parsearNumero(v);
  return n === null || Number.isNaN(n) ? null : n;
};

export interface OpcionConFactura {
  valor: string;
  etiqueta: string;
  /** Valor por defecto de "¿Tiene factura?" (categoría o fuente). */
  tieneFactura: boolean;
}

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
  editables,
  fotos,
}: {
  viajeId: string;
  empresaId: string;
  abierto: boolean;
  cargas: Carga[];
  fuentes: OpcionConFactura[];
  /** Cargas que este usuario puede validar o rechazar. */
  revisables: string[];
  /** Cargas a las que este usuario puede cambiarles la factura. */
  editables: string[];
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
                  {c.precio_litro !== null &&
                    ` · ${Number(c.precio_litro).toLocaleString("es-MX", { style: "currency", currency: "MXN", minimumFractionDigits: 2, maximumFractionDigits: 4 })}/L`}
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
                <p>
                  {c.importe !== null ? (
                    <TextoFactura total={Number(c.importe)} iva={c.iva} costo={c.costo} tieneFactura={c.tiene_factura} tasa={c.tasa_iva} />
                  ) : (
                    <span className="text-zinc-500">Sin importe: se estima con el precio del diésel de Parámetros{c.tiene_factura ? " (con factura)" : ""}</span>
                  )}
                </p>
                {abierto && editables.includes(c.id) && (
                  <EditarFactura tieneFactura={c.tiene_factura} tasa={c.tasa_iva} guardar={(t, x) => cambiarFacturaCarga(c.id, t, x)} />
                )}
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
            <FormularioCarga empresaId={empresaId} fuentes={fuentes} valores={estado.valores ?? {}} errores={estado.errores ?? {}} />
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
  categorias: OpcionConFactura[];
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
                  {g.categoria} · {pesos(g.monto)}
                  {g.facturable_anterior && (
                    <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-xs font-normal text-amber-800 dark:bg-amber-950 dark:text-amber-300">
                      antes «se factura al cliente»: revisar
                    </span>
                  )}
                  {g.cancelado && <span className="ml-2 text-xs">(cancelado)</span>}
                </p>
                <p>
                  <TextoFactura total={g.monto} iva={g.iva} costo={g.costo} tieneFactura={g.tiene_factura} tasa={g.tasa_iva} />
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
                <div className="flex flex-col items-end gap-1">
                  <button
                    type="button"
                    disabled={pendiente}
                    onClick={() => iniciar(async () => setError(await cancelarGasto(g.id, !g.cancelado)))}
                    className="text-sm text-zinc-600 underline dark:text-zinc-400"
                  >
                    {g.cancelado ? "Reactivar" : "Cancelar"}
                  </button>
                  {!g.cancelado && (
                    <EditarFactura tieneFactura={g.tiene_factura} tasa={g.tasa_iva} guardar={(t, x) => cambiarFacturaGasto(g.id, t, x)} />
                  )}
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
            <FormularioGasto empresaId={empresaId} categorias={categorias} esAdmin={esAdmin} valores={estado.valores ?? {}} errores={estado.errores ?? {}} />
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

export function FormularioFinanzas({ viajeId, iniciales, conPago }: { viajeId: string; iniciales: Record<string, string>; conPago: boolean }) {
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
        <Campo etiqueta="$ (por tonelada o monto fijo, sin IVA)" name="tarifa" inputMode="decimal" defaultValue={v.tarifa ?? ""} required error={e.tarifa} />
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
      {conPago && (
      <div className="grid gap-3 sm:grid-cols-3">
        <Selector
          etiqueta="Pago al operador"
          name="pago_esquema"
          value={esquema}
          onChange={(ev) => setEsquema(ev.target.value as EsquemaPago)}
          opciones={ESQUEMAS_PAGO}
          error={e.pago_esquema}
        />
        {esquema === "pct_flete" && (
          <Selector etiqueta="Base del % del flete" name="pago_base_flete" defaultValue={v.pago_base_flete || "cargado"} opciones={BASES_FLETE} />
        )}
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
      )}
      <BotonEnviar pendiente="Guardando…">{conPago ? "Guardar tarifa y pago" : "Guardar tarifa"}</BotonEnviar>
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
  estado: "abierto" | "cerrado" | "cancelado";
  puedeCerrar: boolean;
  /** Dueño o "puede reabrir viajes": también cancela. */
  puedeReabrir: boolean;
  /** Qué falta para poder cerrar (se muestra; la base lo vuelve a revisar). */
  bloqueos: string[];
}) {
  const [pendiente, iniciar] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [estado, accion] = useActionState(reabrirViaje.bind(null, viajeId), {});
  const [estadoCancelar, accionCancelar] = useActionState(cancelarViaje.bind(null, viajeId), {});
  const [cancelando, setCancelando] = useState(false);

  if (estadoViaje === "cancelado") return null;
  if (estadoViaje === "abierto") {
    return (
      <div className="flex flex-col gap-4">
        {puedeCerrar && (
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
        )}
        {puedeReabrir &&
          (cancelando ? (
            <form action={accionCancelar} className="flex max-w-xl flex-col gap-2 rounded-md border border-red-200 p-3 dark:border-red-900">
              <Aviso texto={estadoCancelar.mensaje} tipo={estadoCancelar.exito ? "exito" : "error"} />
              <p className="text-sm text-zinc-600 dark:text-zinc-400">
                El viaje no se borra: queda en la bitácora con el motivo, sale del tablero y de las alertas, y ya no se puede editar.
              </p>
              <Campo etiqueta="Motivo de la cancelación" name="motivo" required minLength={5} error={estadoCancelar.errores?.motivo} />
              <div className="flex items-center gap-4">
                <BotonEnviar pendiente="Cancelando…">Cancelar viaje</BotonEnviar>
                <button type="button" onClick={() => setCancelando(false)} className="mt-2 text-sm underline">
                  No cancelar
                </button>
              </div>
            </form>
          ) : (
            <button type="button" onClick={() => setCancelando(true)} className="self-start text-sm text-red-700 underline dark:text-red-400">
              Cancelar viaje…
            </button>
          ))}
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

/** Campos de una carga: litros y precio como vienen en el ticket; importe = litros × precio si no se escribe. */
function FormularioCarga({
  empresaId,
  fuentes,
  valores,
  errores,
}: {
  empresaId: string;
  fuentes: OpcionConFactura[];
  valores: Record<string, string>;
  errores: Record<string, string | undefined>;
}) {
  const [fuente, setFuente] = useState(valores.fuente_id ?? "");
  const [litros, setLitros] = useState(valores.litros ?? "");
  const [precio, setPrecio] = useState(valores.precio_litro ?? "");
  const [importe, setImporte] = useState(valores.importe ?? "");
  const factura = useFactura({ tieneFactura: valores.tiene_factura === "on" });
  const calculado = leer(litros) !== null && leer(precio) !== null ? Math.round(leer(litros)! * leer(precio)! * 100) / 100 : null;
  const total = leer(importe) ?? calculado;
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      <Campo etiqueta="Fecha y hora" name="fecha" type="datetime-local" defaultValue={valores.fecha ?? ahoraLocal()} required error={errores.fecha} />
      <Selector
        etiqueta="Dónde"
        name="fuente_id"
        opciones={fuentes}
        vacio="Elige…"
        value={fuente}
        onChange={(e) => {
          setFuente(e.target.value);
          // Cada fuente trae su valor por defecto de "¿Tiene factura?".
          factura.setTieneFactura(fuentes.find((f) => f.valor === e.target.value)?.tieneFactura ?? false);
        }}
        required
        error={errores.fuente_id}
      />
      <Campo etiqueta="Litros" name="litros" inputMode="decimal" value={litros} onChange={(e) => setLitros(e.target.value)} required error={errores.litros} />
      <Campo
        etiqueta="Precio por litro (como viene en el ticket)"
        name="precio_litro"
        inputMode="decimal"
        value={precio}
        onChange={(e) => setPrecio(e.target.value)}
        ayuda="Con IVA si el ticket lo trae"
        error={errores.precio_litro}
      />
      <Campo
        etiqueta="Importe del ticket"
        name="importe"
        inputMode="decimal"
        value={importe}
        onChange={(e) => setImporte(e.target.value)}
        placeholder={calculado === null ? "" : String(calculado)}
        ayuda={calculado === null ? "Si lo dejas vacío: litros × precio" : `Vacío: litros × precio = ${pesos(calculado)}`}
        error={errores.importe}
      />
      <Campo etiqueta="Odómetro" name="odometro" inputMode="decimal" defaultValue={valores.odometro ?? ""} error={errores.odometro} />
      <Campo etiqueta="Folio del ticket" name="folio_ticket" defaultValue={valores.folio_ticket ?? ""} error={errores.folio_ticket} />
      <SubirArchivo bucket="tickets" empresaId={empresaId} nombre="foto_ticket_path" etiqueta="Foto del ticket o del medidor" acepta="image/*" error={errores.foto_ticket_path} />
      <CamposFactura total={total} factura={factura} />
    </div>
  );
}

/** Campos de un gasto: el total que dice el ticket y si tiene factura (por defecto, el de su categoría). */
function FormularioGasto({
  empresaId,
  categorias,
  esAdmin,
  valores,
  errores,
}: {
  empresaId: string;
  categorias: OpcionConFactura[];
  esAdmin: boolean;
  valores: Record<string, string>;
  errores: Record<string, string | undefined>;
}) {
  const [categoria, setCategoria] = useState(valores.categoria_id ?? "");
  const [monto, setMonto] = useState(valores.monto ?? "");
  const factura = useFactura({ tieneFactura: valores.tiene_factura === "on" });
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      <Campo etiqueta="Fecha" name="fecha" type="date" defaultValue={valores.fecha ?? hoy()} required error={errores.fecha} />
      <Selector
        etiqueta="Categoría"
        name="categoria_id"
        opciones={categorias}
        vacio="Elige…"
        value={categoria}
        onChange={(e) => {
          setCategoria(e.target.value);
          factura.setTieneFactura(categorias.find((c) => c.valor === e.target.value)?.tieneFactura ?? false);
        }}
        required
        error={errores.categoria_id}
      />
      <Campo
        etiqueta="Total pagado (como dice el ticket)"
        name="monto"
        inputMode="decimal"
        value={monto}
        onChange={(e) => setMonto(e.target.value)}
        ayuda="Con IVA si lo trae"
        required
        error={errores.monto}
      />
      <Selector etiqueta="Forma de pago" name="forma_pago" opciones={FORMAS_PAGO} defaultValue={valores.forma_pago ?? "efectivo"} error={errores.forma_pago} />
      <Campo etiqueta="Proveedor" name="proveedor" defaultValue={valores.proveedor ?? ""} error={errores.proveedor} />
      <Campo etiqueta="No. de comprobante o factura" name="numero_comprobante" defaultValue={valores.numero_comprobante ?? ""} error={errores.numero_comprobante} />
      <SubirArchivo bucket="comprobantes" empresaId={empresaId} nombre="comprobante_path" etiqueta="Comprobante (foto o PDF)" acepta="image/*,application/pdf" error={errores.comprobante_path} />
      {esAdmin && <Campo etiqueta="Folio" name="folio" placeholder="Automático" defaultValue={valores.folio ?? ""} error={errores.folio} />}
      <CamposFactura total={leer(monto)} factura={factura} />
    </div>
  );
}

/** Cargos adicionales al cliente (maniobras, estadías…): suman al ingreso, sin IVA y sin comisión del "% del flete". */
export function SeccionCargosAdicionales({ viajeId, abierto, cargos }: { viajeId: string; abierto: boolean; cargos: CargoAdicional[] }) {
  const [pendiente, iniciar] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [estado, accion] = useActionState(guardarCargoAdicional.bind(null, viajeId), {});
  const [abiertoForm, setAbiertoForm] = useState(false);
  return (
    <div className="flex flex-col gap-2">
      <h3 className="font-medium">Cargos adicionales al cliente</h3>
      {cargos.length === 0 ? (
        <p className="text-sm text-zinc-500">Sin cargos adicionales.</p>
      ) : (
        <ul className="flex flex-col gap-1 text-sm">
          {cargos.map((c) => (
            <li key={c.id} className={`flex flex-wrap items-center justify-between gap-2 ${c.cancelado ? "opacity-50" : ""}`}>
              <span>
                {c.concepto} · {pesos(c.monto)} sin IVA{c.cancelado && " (cancelado)"}
              </span>
              {abierto && (
                <button
                  type="button"
                  disabled={pendiente}
                  onClick={() => iniciar(async () => setError(await cancelarCargoAdicional(c.id, !c.cancelado)))}
                  className="text-sm text-zinc-600 underline dark:text-zinc-400"
                >
                  {c.cancelado ? "Reactivar" : "Cancelar"}
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
            <div className="grid gap-3 sm:grid-cols-2">
              <Campo etiqueta="Concepto" name="concepto" placeholder="Maniobra, estadía…" defaultValue={estado.valores?.concepto ?? ""} required error={estado.errores?.concepto} />
              <Campo etiqueta="Monto (subtotal sin IVA)" name="monto" inputMode="decimal" defaultValue={estado.valores?.monto ?? ""} required error={estado.errores?.monto} />
            </div>
            <BotonEnviar pendiente="Guardando…">Agregar cargo</BotonEnviar>
          </form>
        ) : (
          <button type="button" onClick={() => setAbiertoForm(true)} className={`self-start ${claseBoton}`}>
            + Agregar cargo adicional
          </button>
        ))}
    </div>
  );
}
