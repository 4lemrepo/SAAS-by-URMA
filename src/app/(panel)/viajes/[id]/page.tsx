import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { puede, puedeRevisarCarga } from "@/lib/auth/permisos";
import { usuarioConPermiso } from "@/lib/auth/sesion";
import { numero, pesos, porcentaje } from "@/lib/formato";
import { crearClienteServidor } from "@/lib/supabase/server";
import { horasEntre } from "@/lib/viajes/calculos";
import { datosParaFormulario, leerViajes, type ViajeCompleto } from "@/lib/viajes/datos";
import { formatearFechaHora, isoALocal } from "@/lib/viajes/fechas";
import { MOTIVOS_DESVIO } from "@/lib/viajes/formulario";
import { revisarKm } from "@/lib/viajes/km";
import { configParaOperador, describirPago, type ConfigPagoFila } from "@/lib/viajes/pago";
import { FormularioViaje } from "../formulario-viaje";
import { Cierre, FormularioFinanzas, SeccionCargas, SeccionCargosAdicionales, SeccionGastos } from "../piezas";

export const metadata: Metadata = { title: "Viaje · Control Diésel" };

export default function PaginaViaje({ params }: PageProps<"/viajes/[id]">) {
  return (
    <Suspense fallback={<p className="text-zinc-500">Cargando…</p>}>
      <Viaje params={params} />
    </Suspense>
  );
}

async function Viaje({ params }: { params: PageProps<"/viajes/[id]">["params"] }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const { empresa, id: usuarioId } = await usuarioConPermiso("capturar");
  const esAdmin = puede(empresa.rol, "editarCatalogos");
  const db = await crearClienteServidor();
  const [viaje] = await leerViajes(empresa.empresaId, { ids: [id] }, { veTarifas: empresa.veTarifas, esAdmin }, db);
  if (!viaje) notFound();
  const abierto = viaje.estado === "abierto";
  const r = viaje.resumen;

  const [formulario, fuentes, categorias, fotos, comprobantes, tolerancia, pagoConfigs] = await Promise.all([
    abierto ? datosParaFormulario(db, empresa.empresaId, esAdmin) : null,
    db.from("fuentes_diesel").select("id, nombre, tiene_factura").eq("empresa_id", empresa.empresaId).eq("activa", true).order("nombre"),
    db.from("categorias_gasto").select("id, nombre, tiene_factura").eq("empresa_id", empresa.empresaId).eq("activo", true).order("nombre"),
    urlsFirmadas(db, "tickets", viaje.cargas.map((c) => [c.id, c.foto_ticket_path])),
    urlsFirmadas(db, "comprobantes", viaje.gastos.map((g) => [g.id, g.comprobante_path])),
    db.rpc("tolerancia_km", { p_empresa: empresa.empresaId }),
    empresa.veTarifas
      ? db.from("pago_operador_config").select("*").eq("empresa_id", empresa.empresaId)
      : Promise.resolve({ data: [] as (ConfigPagoFila & { operador_id: string | null })[] }),
  ]);

  const bloqueos = [
    ...(viaje.tramos.length < 2 ? ["Faltan el tramo vacío o el cargado (lugares y odómetros)"] : []),
    ...(!viaje.fecha_llegada ? ["Falta la llegada o salida de la descarga"] : []),
    ...(viaje.cargas.some((c) => c.estado === "pendiente") ? ["Hay cargas de diésel pendientes de validar"] : []),
  ];

  return (
    <>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link href="/viajes" className="text-sm text-zinc-500 underline">
            ← Viajes
          </Link>
          <h1 className="mt-1 text-2xl font-semibold">
            Viaje {viaje.folio}{" "}
            <span
              className={`ml-1 rounded px-2 py-0.5 align-middle text-sm font-medium ${abierto ? "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300" : "bg-zinc-200 text-zinc-700 dark:bg-zinc-700 dark:text-zinc-200"}`}
            >
              {abierto ? "Abierto" : "Cerrado"}
            </span>
          </h1>
          <p className="text-sm text-zinc-500">
            {viaje.unidad} · {viaje.armado} · {viaje.operador}
            {viaje.cliente && ` · ${viaje.cliente}`}
            {viaje.producto && ` · ${viaje.producto}`}
          </p>
        </div>
      </div>

      <Datos viaje={viaje} tolerancia={Number(tolerancia.data ?? 10)} />

      {empresa.veTarifas && (
        <section className="flex flex-col gap-3">
          <h2 className="text-lg font-semibold">Ingreso y utilidad</h2>
          {viaje.finanzas ? (
            <>
              <table className="w-full max-w-2xl text-sm">
                <tbody>
                  {r.renglones.map((x, n) => (
                    <tr key={n} className={`border-t border-zinc-100 dark:border-zinc-800 ${x.tipo === "total" ? "font-semibold" : ""}`}>
                      <td className={`py-1 pr-3 ${x.tipo === "costo" ? "pl-4 text-zinc-600 dark:text-zinc-400" : ""}`}>
                        {x.tipo === "costo" ? "− " : ""}
                        {x.concepto}
                      </td>
                      <td className={`py-1 text-right ${(x.monto ?? 0) < 0 ? "text-red-600" : ""}`}>{pesos(x.monto)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="text-sm text-zinc-500">
                Utilidad de contribución: no incluye costos fijos (mantenimiento, llantas, seguro, oficina…), que están en Costos y
                en el tablero. Los costos van sin el IVA acreditable de lo que tiene factura ({pesos(r.ivaAcreditable)} en este
                viaje).
              </p>
              <dl className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm sm:grid-cols-4">
                <Dato titulo="Margen %" valor={porcentaje(r.margenPct)} />
                <Dato titulo="Utilidad sobre costo %" valor={porcentaje(r.utilidadSobreCostoPct)} />
                <Dato titulo="Merma" valor={r.mermaToneladas === null ? "—" : `${numero(r.mermaToneladas, 2)} t (${porcentaje(r.mermaPct)}) · ${pesos(r.mermaPesos)}`} />
                <Dato titulo="Pago calculado con" valor={describirPago(finanzasComoConfig(viaje))} />
              </dl>
            </>
          ) : (
            <p className="text-sm text-amber-700 dark:text-amber-400">Este viaje todavía no tiene tarifa.</p>
          )}
          <SeccionCargosAdicionales viajeId={viaje.id} abierto={abierto} cargos={viaje.cargosAdicionales} />
          {abierto && (
            <details open={!viaje.finanzas}>
              <summary className="cursor-pointer text-sm font-medium">{viaje.finanzas ? "Cambiar tarifa y pago" : "Capturar tarifa y pago"}</summary>
              <div className="mt-3">
                <FormularioFinanzas viajeId={viaje.id} iniciales={inicialesFinanzas(viaje, (pagoConfigs.data ?? []) as (ConfigPagoFila & { operador_id: string | null })[])} />
              </div>
            </details>
          )}
        </section>
      )}

      <SeccionCargas
        viajeId={viaje.id}
        empresaId={empresa.empresaId}
        abierto={abierto}
        cargas={viaje.cargas}
        fuentes={(fuentes.data ?? []).map((f) => ({ valor: f.id, etiqueta: f.nombre, tieneFactura: f.tiene_factura }))}
        revisables={viaje.cargas
          .filter((c) => puedeRevisarCarga(empresa.rol, usuarioId, { capturadoPor: c.capturado_por, estado: c.estado }))
          .map((c) => c.id)}
        // Administración corrige cualquier carga; captura, las suyas pendientes (RLS).
        editables={viaje.cargas.filter((c) => esAdmin || (c.capturado_por === usuarioId && c.estado === "pendiente")).map((c) => c.id)}
        fotos={fotos}
      />

      <SeccionGastos
        viajeId={viaje.id}
        empresaId={empresa.empresaId}
        abierto={abierto}
        gastos={viaje.gastos}
        categorias={(categorias.data ?? []).map((c) => ({ valor: c.id, etiqueta: c.nombre, tieneFactura: c.tiene_factura }))}
        esAdmin={esAdmin}
        comprobantes={comprobantes}
      />

      {abierto && formulario && (
        <details className="rounded-xl border border-zinc-200 p-4 dark:border-zinc-800">
          <summary className="cursor-pointer font-semibold">Editar datos del viaje</summary>
          <div className="mt-4">
            <FormularioViaje id={viaje.id} iniciales={inicialesViaje(viaje)} datos={formulario} odometroAnterior={viaje.odometro_anterior} />
          </div>
        </details>
      )}

      <section className="flex flex-col gap-2 border-t border-zinc-200 pt-4 dark:border-zinc-800">
        <Cierre
          viajeId={viaje.id}
          estado={viaje.estado}
          puedeCerrar={puede(empresa.rol, "cerrarViajes")}
          puedeReabrir={empresa.puedeReabrir}
          bloqueos={bloqueos}
        />
      </section>

      {esAdmin && <Bitacora viajeId={viaje.id} empresaId={empresa.empresaId} esDueno={empresa.rol === "dueno"} />}
    </>
  );
}

function Dato({ titulo, valor, fuerte, negativo }: { titulo: string; valor: string; fuerte?: boolean; negativo?: boolean }) {
  return (
    <div className="flex flex-col">
      <dt className="text-zinc-500">{titulo}</dt>
      <dd className={`${fuerte ? "font-semibold" : ""} ${negativo ? "text-red-600" : ""}`}>{valor}</dd>
    </div>
  );
}

function Datos({ viaje, tolerancia }: { viaje: ViajeCompleto; tolerancia: number }) {
  const r = viaje.resumen;
  const motivo = (m: string | null) => MOTIVOS_DESVIO.find((x) => x.valor === m)?.etiqueta ?? m;
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-lg font-semibold">Recorrido</h2>
      {viaje.tramos.length === 0 ? (
        <p className="text-sm text-zinc-500">Sin tramos completos todavía.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {viaje.tramos.map((t) => {
            const rev = revisarKm(Number(t.km), t.km_ruta === null ? null : Number(t.km_ruta), tolerancia);
            return (
              <li key={t.id} className="rounded-md border border-zinc-200 p-3 text-sm dark:border-zinc-800">
                <p className="font-medium">
                  {t.tipo === "vacio" ? "Vacío" : "Cargado"}: {t.origen} → {t.destino} · {numero(Number(t.km))} km
                </p>
                <p className="text-zinc-500">
                  Odómetro {numero(Number(t.odometro_inicial))} → {numero(Number(t.odometro_final))}
                  {t.km_ruta !== null && ` · ruta ${numero(Number(t.km_ruta))} km (${rev.desviacionPct! > 0 ? "+" : ""}${rev.desviacionPct}%)`}
                  {t.motivo_desvio && ` · desvío: ${motivo(t.motivo_desvio)}${t.nota_desvio ? ` (${t.nota_desvio})` : ""}`}
                </p>
              </li>
            );
          })}
        </ul>
      )}
      <dl className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm sm:grid-cols-4">
        <Dato titulo="Km totales" valor={`${numero(r.kmTotales)} (vacío ${numero(r.kmVacio)} · cargado ${numero(r.kmCargado)})`} />
        <Dato titulo="Toneladas" valor={`${numero(viaje.toneladas_cargadas, 2)} cargadas · ${numero(viaje.toneladas_descargadas, 2)} descargadas`} />
        <Dato titulo="Litros validados" valor={`${numero(r.litros, 2)}${r.litrosPendientes ? ` (+${numero(r.litrosPendientes, 2)} pendientes)` : ""}`} />
        <Dato titulo="Km/l" valor={r.litros ? numero(r.kmTotales / r.litros, 2) : "—"} />
        <Dato titulo="Salida" valor={formatearFechaHora(viaje.fecha_salida)} />
        <Dato titulo="En carga" valor={`${formatearFechaHora(viaje.llegada_carga)} → ${formatearFechaHora(viaje.salida_carga)} (${numero(horasEntre(viaje.llegada_carga, viaje.salida_carga), 1)} h)`} />
        <Dato titulo="En descarga" valor={`${formatearFechaHora(viaje.llegada_descarga)} → ${formatearFechaHora(viaje.salida_descarga)} (${numero(horasEntre(viaje.llegada_descarga, viaje.salida_descarga), 1)} h)`} />
        <Dato titulo="Días en ruta" valor={viaje.fecha_llegada ? numero((Date.parse(viaje.fecha_llegada) - Date.parse(viaje.fecha_salida)) / 86_400_000, 1) : "—"} />
        {Number(viaje.km_sin_viaje) !== 0 && (
          <Dato titulo="Km sin viaje" valor={`${numero(Number(viaje.km_sin_viaje))} · ${viaje.explicacion_km_sin_viaje}`} negativo />
        )}
      </dl>
      {viaje.notas && <p className="text-sm text-zinc-600 dark:text-zinc-400">Notas: {viaje.notas}</p>}
    </section>
  );
}

/** URLs firmadas (1 h) para ver fotos y comprobantes privados. */
async function urlsFirmadas(
  db: Awaited<ReturnType<typeof crearClienteServidor>>,
  bucket: "tickets" | "comprobantes",
  pares: [string, string | null][],
): Promise<Record<string, string>> {
  const conArchivo = pares.filter((p): p is [string, string] => !!p[1]);
  if (!conArchivo.length) return {};
  const { data } = await db.storage.from(bucket).createSignedUrls(conArchivo.map((p) => p[1]), 3600);
  const resultado: Record<string, string> = {};
  conArchivo.forEach(([id], i) => {
    const url = data?.[i]?.signedUrl;
    if (url) resultado[id] = url;
  });
  return resultado;
}

function inicialesViaje(v: ViajeCompleto): Record<string, string> {
  const vacio = v.tramos.find((t) => t.tipo === "vacio");
  const cargado = v.tramos.find((t) => t.tipo === "cargado");
  const s = (x: unknown) => (x === null || x === undefined ? "" : String(x));
  return {
    unidad_id: v.unidad_id,
    operador_id: v.operador_id,
    cliente_id: s(v.cliente_id),
    producto: s(v.producto),
    toneladas_cargadas: s(v.toneladas_cargadas),
    toneladas_descargadas: s(v.toneladas_descargadas),
    folio: v.folio,
    origen: s(vacio?.origen),
    lugar_carga: s(vacio?.destino ?? cargado?.origen),
    lugar_descarga: s(cargado?.destino),
    odometro_inicial: s(vacio?.odometro_inicial),
    odometro_carga: s(vacio?.odometro_final ?? cargado?.odometro_inicial),
    odometro_final: s(cargado?.odometro_final),
    motivo_vacio: s(vacio?.motivo_desvio),
    nota_vacio: s(vacio?.nota_desvio),
    motivo_cargado: s(cargado?.motivo_desvio),
    nota_cargado: s(cargado?.nota_desvio),
    explicacion_km_sin_viaje: s(v.explicacion_km_sin_viaje),
    fecha_salida: isoALocal(v.fecha_salida),
    llegada_carga: isoALocal(v.llegada_carga),
    salida_carga: isoALocal(v.salida_carga),
    llegada_descarga: isoALocal(v.llegada_descarga),
    salida_descarga: isoALocal(v.salida_descarga),
    notas: s(v.notas),
  };
}

function finanzasComoConfig(v: ViajeCompleto): ConfigPagoFila {
  const f = v.finanzas!;
  return {
    esquema: f.pago_esquema,
    base_flete: f.pago_base_flete,
    pct: f.pago_pct,
    tarifa_km_cargado: f.pago_tarifa_km_cargado,
    tarifa_km_vacio: f.pago_tarifa_km_vacio,
    tarifa_tonelada: f.pago_tarifa_tonelada,
    monto_fijo: f.pago_monto_fijo,
    sueldo_base_mensual: null,
  };
}

/** Tarifa del viaje; si aún no tiene, el peso del cliente y el pago del operador (o de la empresa). */
function inicialesFinanzas(
  v: ViajeCompleto,
  configs: (ConfigPagoFila & { operador_id: string | null })[],
): Record<string, string> {
  const s = (x: unknown) => (x === null || x === undefined ? "" : String(x));
  if (v.finanzas) {
    const f = v.finanzas;
    return {
      tipo_tarifa: f.tipo_tarifa,
      tarifa: s(f.tarifa),
      factura_por: f.factura_por,
      pago_esquema: f.pago_esquema,
      pago_base_flete: f.pago_base_flete,
      pago_pct: s(f.pago_pct),
      pago_tarifa_km_cargado: s(f.pago_tarifa_km_cargado),
      pago_tarifa_km_vacio: s(f.pago_tarifa_km_vacio),
      pago_tarifa_tonelada: s(f.pago_tarifa_tonelada),
      pago_monto_fijo: s(f.pago_monto_fijo),
      pago_operador_manual: s(f.pago_operador_manual),
    };
  }
  const c = configParaOperador(configs, v.operador_id);
  return {
    tipo_tarifa: "por_tonelada",
    factura_por: v.facturaPorCliente ?? "cargado",
    pago_esquema: c?.esquema ?? "pct_flete",
    pago_base_flete: c?.base_flete ?? "cargado",
    pago_pct: s(c?.pct),
    pago_tarifa_km_cargado: s(c?.tarifa_km_cargado),
    pago_tarifa_km_vacio: s(c?.tarifa_km_vacio),
    pago_tarifa_tonelada: s(c?.tarifa_tonelada),
    pago_monto_fijo: s(c?.monto_fijo),
  };
}

const ETIQUETA_CAMPO: Record<string, string> = {
  estado: "Estado",
  producto: "Producto",
  toneladas_cargadas: "Toneladas cargadas",
  toneladas_descargadas: "Toneladas descargadas",
  tarifa: "Tarifa",
  tipo_tarifa: "Tipo de tarifa",
  monto: "Monto",
  cancelado: "Cancelado",
  tiene_factura: "Tiene factura",
  tasa_iva: "Tasa de IVA",
  iva: "IVA acreditable",
  concepto: "Concepto",
  pago_esquema: "Esquema de pago",
  pago_base_flete: "Base del % del flete",
  odometro_inicial: "Odómetro inicial",
  odometro_final: "Odómetro final",
  litros: "Litros",
};
const NOMBRE_TABLA: Record<string, string> = {
  viajes: "Viaje",
  tramos_viaje: "Tramo",
  viajes_finanzas: "Tarifa y pago",
  gastos_viaje: "Gasto",
  cargas_diesel: "Carga de diésel",
  cargos_adicionales: "Cargo adicional",
};

async function Bitacora({ viajeId, empresaId, esDueno }: { viajeId: string; empresaId: string; esDueno: boolean }) {
  const db = await crearClienteServidor();
  const [{ data }, usuarios] = await Promise.all([
    db.from("bitacora").select("id, tabla, accion, campo, valor_anterior, valor_nuevo, nota, usuario_id, en").eq("viaje_id", viajeId).order("en", { ascending: false }).limit(300),
    esDueno ? db.rpc("usuarios_de_empresa", { p_empresa: empresaId }) : Promise.resolve({ data: [] }),
  ]);
  const correo = new Map(((usuarios.data ?? []) as { usuario_id: string; correo: string }[]).map((u) => [u.usuario_id, u.correo]));
  const quien = (id: string | null) => (id ? (correo.get(id) ?? `usuario …${id.slice(-6)}`) : "sistema");
  return (
    <details className="rounded-xl border border-zinc-200 p-4 dark:border-zinc-800">
      <summary className="cursor-pointer font-semibold">Bitácora de cambios ({data?.length ?? 0})</summary>
      <ul className="mt-3 flex flex-col gap-1 text-sm">
        {(data ?? []).map((b) => (
          <li key={b.id} className="border-b border-zinc-100 py-1 dark:border-zinc-800">
            <span className="text-zinc-500">{formatearFechaHora(b.en)}</span> · {quien(b.usuario_id)} ·{" "}
            <strong>{NOMBRE_TABLA[b.tabla] ?? b.tabla}</strong>{" "}
            {b.accion === "alta"
              ? "dado de alta"
              : b.accion === "cierre"
                ? "cerró el viaje"
                : b.accion === "reapertura"
                  ? `reabrió el viaje${b.nota ? `: «${b.nota}»` : ""}`
                  : `${ETIQUETA_CAMPO[b.campo ?? ""] ?? b.campo}: ${b.valor_anterior ?? "—"} → ${b.valor_nuevo ?? "—"}`}
          </li>
        ))}
      </ul>
    </details>
  );
}
