"use client";

import { useState, useTransition } from "react";
import { cambiarPermiso } from "./acciones";

export function Interruptor({ usuarioId, permiso, activo, etiqueta }: { usuarioId: string; permiso: string; activo: boolean; etiqueta: string }) {
  const [pendiente, iniciar] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <label className="flex items-center gap-2 text-sm">
      <input
        type="checkbox"
        checked={activo}
        disabled={pendiente}
        onChange={(e) => {
          const valor = e.target.checked;
          iniciar(async () => setError(await cambiarPermiso(usuarioId, permiso, valor)));
        }}
      />
      {etiqueta}
      {error && <span className="text-xs text-red-600">{error}</span>}
    </label>
  );
}
