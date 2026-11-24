-- =====================================================================
-- Control Diésel — remisiones del cliente y No. de factura al cliente
-- - Remisiones: uno o varios folios que pide el cliente (p. ej. una por
--   remolque en un full).
-- - No. de factura al cliente: texto libre; varios viajes pueden compartir la
--   misma factura. Se factura después de terminar el viaje, así que dueño y
--   administración lo capturan aunque el viaje esté cerrado (solo ese campo;
--   el cambio queda en la bitácora).
-- =====================================================================

alter table viajes
  add column remisiones text[] not null default '{}',
  add column factura_cliente text,
  add constraint viajes_remisiones_validas check (
    cardinality(remisiones) <= 20
    and array_position(remisiones, null) is null
  ),
  add constraint viajes_factura_cliente_valida check (
    factura_cliente is null or length(btrim(factura_cliente)) between 1 and 40
  );

-- Para buscar los viajes de una factura.
create index viajes_factura_cliente on viajes (empresa_id, upper(factura_cliente)) where factura_cliente is not null;

-- Cada remisión: de 1 a 40 caracteres, sin espacios a los lados.
create function validar_remisiones() returns trigger
language plpgsql set search_path = public as $$
begin
  if exists (select 1 from unnest(new.remisiones) r where length(btrim(r)) not between 1 and 40) then
    raise exception 'Cada remisión debe tener de 1 a 40 caracteres';
  end if;
  new.remisiones := array(select btrim(r) from unnest(new.remisiones) r);
  new.factura_cliente := nullif(btrim(coalesce(new.factura_cliente, '')), '');
  return new;
end;
$$;
create trigger viajes_validar_remisiones before insert or update on viajes
  for each row execute function validar_remisiones();

-- Cerrado: solo cambia el No. de factura al cliente (dueño y administración).
create or replace function controlar_viaje() returns trigger
language plpgsql set search_path = public as $$
begin
  new.actualizado_en := now();
  if tg_op = 'INSERT' then
    if new.estado <> 'abierto' then
      raise exception 'Un viaje nuevo empieza abierto';
    end if;
    return new;
  end if;

  if old.estado = 'cancelado' then
    raise exception 'El viaje % está cancelado: no se puede modificar', old.folio;
  end if;

  if old.estado = 'cerrado' then
    -- La única salida de "cerrado" es reabrir_viaje(): pone esta señal local a la
    -- transacción solo mientras reabre ese viaje (los usuarios no pueden ponerla:
    -- set_config no está expuesta en la API).
    if new.estado = 'abierto' and current_setting('control_diesel.reabrir', true) = old.id::text then
      new.cerrado_por := null;
      new.cerrado_en := null;
      return new;
    end if;
    -- La factura al cliente se captura después de cerrar.
    if (to_jsonb(new) - 'factura_cliente' - 'actualizado_en') = (to_jsonb(old) - 'factura_cliente' - 'actualizado_en') then
      if not es_admin(new.empresa_id) then
        raise exception 'Solo dueño y administración capturan la factura de un viaje cerrado' using errcode = 'insufficient_privilege';
      end if;
      return new;
    end if;
    raise exception 'El viaje % está cerrado: no se puede modificar', old.folio;
  end if;

  if new.estado = 'cancelado' then
    -- Igual que reabrir: solo cancelar_viaje() pone esta señal.
    if current_setting('control_diesel.cancelar', true) is distinct from old.id::text then
      raise exception 'Un viaje se cancela con su motivo desde «Cancelar viaje»' using errcode = 'insufficient_privilege';
    end if;
    new.cancelado_por := auth.uid();
    new.cancelado_en := now();
    return new;
  end if;

  if new.estado = 'cerrado' then
    if not es_admin(new.empresa_id) then
      raise exception 'Solo dueño y administración cierran viajes' using errcode = 'insufficient_privilege';
    end if;
    if exists (select 1 from cargas_diesel where viaje_id = new.id and estado = 'pendiente') then
      raise exception 'No se puede cerrar: hay cargas de diésel pendientes de validar';
    end if;
    if (select count(*) from tramos_viaje where viaje_id = new.id) < 2 then
      raise exception 'No se puede cerrar: faltan el tramo vacío o el cargado';
    end if;
    if new.fecha_llegada is null then
      raise exception 'No se puede cerrar: falta la fecha de llegada';
    end if;
    new.cerrado_por := auth.uid();
    new.cerrado_en := now();
  end if;
  return new;
end;
$$;

-- Guardar el viaje y sus tramos (ahora con remisiones y factura al cliente).
create or replace function guardar_viaje(p_id uuid, p_viaje jsonb, p_tramos jsonb) returns uuid
language plpgsql security invoker set search_path = public as $$
declare
  r viajes%rowtype := jsonb_populate_record(null::viajes, p_viaje);
  t tramos_viaje%rowtype;
  v_id uuid := p_id;
  v_empresa uuid;
begin
  if v_id is null then
    insert into viajes (
      empresa_id, folio, unidad_id, operador_id, cliente_id, armado_id, producto,
      toneladas_cargadas, toneladas_descargadas, fecha_salida, llegada_carga, salida_carga,
      llegada_descarga, salida_descarga, fecha_llegada, odometro_anterior, km_sin_viaje,
      explicacion_km_sin_viaje, notas, remisiones, factura_cliente)
    values (
      r.empresa_id, nullif(btrim(coalesce(r.folio, '')), ''), r.unidad_id, r.operador_id, r.cliente_id, r.armado_id, r.producto,
      r.toneladas_cargadas, r.toneladas_descargadas, r.fecha_salida, r.llegada_carga, r.salida_carga,
      r.llegada_descarga, r.salida_descarga, r.fecha_llegada, r.odometro_anterior, coalesce(r.km_sin_viaje, 0),
      r.explicacion_km_sin_viaje, r.notas, coalesce(r.remisiones, '{}'), r.factura_cliente)
    returning id, empresa_id into v_id, v_empresa;
  else
    update viajes set
      folio = coalesce(nullif(btrim(coalesce(r.folio, '')), ''), folio),
      unidad_id = r.unidad_id, operador_id = r.operador_id, cliente_id = r.cliente_id, armado_id = r.armado_id,
      producto = r.producto, toneladas_cargadas = r.toneladas_cargadas, toneladas_descargadas = r.toneladas_descargadas,
      fecha_salida = r.fecha_salida, llegada_carga = r.llegada_carga, salida_carga = r.salida_carga,
      llegada_descarga = r.llegada_descarga, salida_descarga = r.salida_descarga, fecha_llegada = r.fecha_llegada,
      odometro_anterior = r.odometro_anterior, km_sin_viaje = coalesce(r.km_sin_viaje, 0),
      explicacion_km_sin_viaje = r.explicacion_km_sin_viaje, notas = r.notas,
      remisiones = coalesce(r.remisiones, '{}'), factura_cliente = r.factura_cliente
    where id = v_id
    returning empresa_id into v_empresa;
    if v_empresa is null then
      raise exception 'Viaje no encontrado o sin permiso para editarlo';
    end if;
  end if;

  for t in select * from jsonb_populate_recordset(null::tramos_viaje, coalesce(p_tramos, '[]')) loop
    insert into tramos_viaje (empresa_id, viaje_id, tipo, origen, destino, odometro_inicial, odometro_final,
                              ruta_id, km_ruta, motivo_desvio, nota_desvio)
    values (v_empresa, v_id, t.tipo, t.origen, t.destino, t.odometro_inicial, t.odometro_final,
            t.ruta_id, t.km_ruta, t.motivo_desvio, t.nota_desvio)
    on conflict (viaje_id, tipo) do update set
      origen = excluded.origen, destino = excluded.destino,
      odometro_inicial = excluded.odometro_inicial, odometro_final = excluded.odometro_final,
      ruta_id = excluded.ruta_id, km_ruta = excluded.km_ruta,
      motivo_desvio = excluded.motivo_desvio, nota_desvio = excluded.nota_desvio;
  end loop;
  return v_id;
end;
$$;

revoke execute on function validar_remisiones() from public, anon, authenticated;
revoke execute on function controlar_viaje() from public, anon, authenticated;
revoke execute on function guardar_viaje(uuid, jsonb, jsonb) from public, anon;
grant execute on function guardar_viaje(uuid, jsonb, jsonb) to authenticated;
