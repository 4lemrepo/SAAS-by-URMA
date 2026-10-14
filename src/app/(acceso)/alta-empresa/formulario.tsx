"use client";

import { useActionState } from "react";
import { crearEmpresa } from "../acciones";
import { Aviso, BotonEnviar, Campo } from "../campos";

export function FormularioEmpresa() {
  const [estado, accion] = useActionState(crearEmpresa, {});

  return (
    <form action={accion} className="flex flex-col gap-4">
      <Aviso texto={estado.mensaje} />
      <Campo
        etiqueta="Nombre de la empresa"
        name="nombre"
        autoComplete="organization"
        required
        minLength={2}
        maxLength={120}
        placeholder="URMA Logística"
        defaultValue={estado.valores?.nombre}
        error={estado.errores?.nombre}
      />
      <Campo
        etiqueta="RFC (opcional)"
        name="rfc"
        maxLength={13}
        autoCapitalize="characters"
        defaultValue={estado.valores?.rfc}
        error={estado.errores?.rfc}
      />
      <BotonEnviar pendiente="Creando empresa…">Crear empresa</BotonEnviar>
    </form>
  );
}
