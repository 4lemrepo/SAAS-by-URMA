"use client";

import { useFormStatus } from "react-dom";

interface PropsCampo extends React.InputHTMLAttributes<HTMLInputElement> {
  etiqueta: string;
  name: string;
  error?: string;
  ayuda?: string;
}

export function Campo({ etiqueta, name, error, ayuda, ...input }: PropsCampo) {
  const idAyuda = `${name}-ayuda`;
  return (
    <label className="flex flex-col gap-1 text-sm">
      <span className="font-medium">{etiqueta}</span>
      <input
        name={name}
        aria-invalid={Boolean(error)}
        aria-describedby={error || ayuda ? idAyuda : undefined}
        className="rounded-md border border-zinc-300 bg-white px-3 py-2 text-base outline-none focus:border-zinc-900 focus:ring-2 focus:ring-zinc-900/10 aria-[invalid=true]:border-red-500 dark:border-zinc-700 dark:bg-zinc-950 dark:focus:border-zinc-200"
        {...input}
      />
      {(error || ayuda) && (
        <span id={idAyuda} className={error ? "text-red-600" : "text-zinc-500"}>
          {error ?? ayuda}
        </span>
      )}
    </label>
  );
}

export function BotonEnviar({ children, pendiente }: { children: React.ReactNode; pendiente: string }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="mt-2 rounded-md bg-zinc-900 px-4 py-2 font-medium text-white hover:bg-zinc-700 disabled:opacity-60 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
    >
      {pending ? pendiente : children}
    </button>
  );
}

export function Aviso({ texto, tipo = "error" }: { texto?: string; tipo?: "error" | "exito" }) {
  if (!texto) return null;
  return (
    <p
      role={tipo === "error" ? "alert" : "status"}
      className={
        tipo === "error"
          ? "rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300"
          : "rounded-md bg-green-50 px-3 py-2 text-sm text-green-800 dark:bg-green-950 dark:text-green-300"
      }
    >
      {texto}
    </p>
  );
}

interface PropsSelector extends React.SelectHTMLAttributes<HTMLSelectElement> {
  etiqueta: string;
  name: string;
  opciones: readonly { valor: string; etiqueta: string }[];
  error?: string;
  /** Texto de la opción vacía; si no se da, no hay opción vacía. */
  vacio?: string;
}

export function Selector({ etiqueta, name, opciones, error, vacio, ...select }: PropsSelector) {
  const idAyuda = `${name}-ayuda`;
  return (
    <label className="flex flex-col gap-1 text-sm">
      <span className="font-medium">{etiqueta}</span>
      <select
        name={name}
        aria-invalid={Boolean(error)}
        aria-describedby={error ? idAyuda : undefined}
        className="rounded-md border border-zinc-300 bg-white px-3 py-2 text-base outline-none focus:border-zinc-900 focus:ring-2 focus:ring-zinc-900/10 aria-[invalid=true]:border-red-500 dark:border-zinc-700 dark:bg-zinc-950 dark:focus:border-zinc-200"
        {...select}
      >
        {vacio !== undefined && <option value="">{vacio}</option>}
        {opciones.map((o) => (
          <option key={o.valor} value={o.valor}>
            {o.etiqueta}
          </option>
        ))}
      </select>
      {error && (
        <span id={idAyuda} className="text-red-600">
          {error}
        </span>
      )}
    </label>
  );
}
