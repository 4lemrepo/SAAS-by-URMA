import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { NOMBRE_ROL, type Rol } from "@/lib/auth/permisos";
import { usuarioConPermiso } from "@/lib/auth/sesion";
import { crearClienteServidor } from "@/lib/supabase/server";
import { Interruptor } from "./interruptor";

export const metadata: Metadata = { title: "Usuarios · Control Diésel" };

export default function PaginaUsuarios() {
  return (
    <>
      <div>
        <Link href="/tablero" className="text-sm text-zinc-500 underline">
          ← Tablero
        </Link>
        <h1 className="mt-1 text-2xl font-semibold">Usuarios</h1>
        <p className="text-sm text-zinc-500">
          Permisos de cada usuario. Tú los tienes todos; administración ve solo lo que aquí le prendas. Las invitaciones por correo
          llegan después.
        </p>
      </div>
      <Suspense fallback={<p className="text-zinc-500">Cargando…</p>}>
        <Contenido />
      </Suspense>
    </>
  );
}

interface Usuario {
  usuario_id: string;
  correo: string;
  rol: Rol;
  puede_reabrir_viajes: boolean;
  ve_tarifas: boolean;
  ve_utilidades: boolean;
  ve_costos: boolean;
}

async function Contenido() {
  const { empresa, id } = await usuarioConPermiso("administrarUsuarios");
  const db = await crearClienteServidor();
  const { data, error } = await db.rpc("usuarios_de_empresa", { p_empresa: empresa.empresaId });
  if (error) throw new Error("No se pudieron leer los usuarios");
  return (
    <ul className="flex flex-col gap-2">
      {((data ?? []) as Usuario[]).map((u) => (
        <li key={u.usuario_id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-zinc-200 p-3 dark:border-zinc-800">
          <div>
            <p className="font-medium">
              {u.correo}
              {u.usuario_id === id && <span className="ml-2 text-sm text-zinc-500">(tú)</span>}
            </p>
            <p className="text-sm text-zinc-500">{NOMBRE_ROL[u.rol]}</p>
          </div>
          <div className="flex flex-col gap-1">
            {u.rol === "dueno" && <p className="text-sm text-zinc-500">Todo permitido</p>}
            {u.rol === "administracion" && (
              <>
                <Interruptor usuarioId={u.usuario_id} permiso="puede_reabrir_viajes" activo={u.puede_reabrir_viajes} etiqueta="Puede reabrir y cancelar viajes" />
                <Interruptor usuarioId={u.usuario_id} permiso="ve_tarifas" activo={u.ve_tarifas} etiqueta="Ve tarifas e ingresos" />
                <Interruptor
                  usuarioId={u.usuario_id}
                  permiso="ve_utilidades"
                  activo={u.ve_utilidades && u.ve_tarifas}
                  etiqueta="Ve utilidades (pago al operador, utilidad, margen, costo/km y tablero financiero)"
                />
                <Interruptor usuarioId={u.usuario_id} permiso="ve_costos" activo={u.ve_costos} etiqueta="Ve costos de unidad y generales (captura y consulta)" />
                {!u.ve_utilidades && <p className="text-xs text-zinc-500">Sin «ve utilidades» ve el tablero operativo.</p>}
              </>
            )}
            {u.rol === "captura" && (
              <Interruptor usuarioId={u.usuario_id} permiso="ve_tarifas" activo={u.ve_tarifas} etiqueta="Ve tarifas e ingresos" />
            )}
          </div>
        </li>
      ))}
    </ul>
  );
}
