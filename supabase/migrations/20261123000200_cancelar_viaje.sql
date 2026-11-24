-- =====================================================================
-- Control Diésel — cancelar un viaje
-- El dueño (o quien tenga "puede reabrir viajes") cancela un viaje ABIERTO con
-- motivo. No se borra: queda en la bitácora con el motivo, sale de los KPIs y
-- de las alertas, y se ve en la lista con el filtro "cancelados".
-- Cancelado es definitivo: nadie edita el viaje ni sus tramos, gastos,
-- cargas, tarifa o cargos. Sus cargas validadas siguen existiendo (el diésel
-- sí salió del tanque), pero no cuentan en los KPIs del viaje.
-- También: dueño y administración ya no pueden borrar viajes ni cargas por la API.
-- Requiere 20261123000100 (valor 'cancelado' del enum) ya aplicada.
-- =====================================================================

alter table viajes
  add column cancelado_por uuid references auth.users(id),
  add column cancelado_en timestamptz,
  add column motivo_cancelacion text,
  add constraint viajes_cancelado_con_motivo check (
    estado <> 'cancelado' or length(btrim(coalesce(motivo_cancelacion, ''))) >= 5
  );

-- ---------- Bitácora ----------
alter table bitacora drop constraint bitacora_accion_check;
alter table bitacora add constraint bitacora_accion_check
  check (accion in ('alta', 'cambio', 'cierre', 'reapertura', 'cancelacion'));

create or replace function registrar_bitacora() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_viaje uuid;
  v_nuevo jsonb := to_jsonb(new);
  v_viejo jsonb;
  v_campo text;
  v_ignorar text[] := array['actualizado_en', 'creado_en', 'validado_en', 'validado_por', 'cerrado_en', 'cerrado_por',
                            'cancelado_en', 'cancelado_por', 'motivo_cancelacion', 'km', 'costo'];
begin
  v_viaje := nullif(v_nuevo->>case when tg_table_name = 'viajes' then 'id' else 'viaje_id' end, '')::uuid;
  if tg_op = 'INSERT' then
    insert into bitacora (empresa_id, tabla, registro_id, viaje_id, accion, usuario_id)
    values (new.empresa_id, tg_table_name, (v_nuevo->>coalesce(tg_argv[0], 'id'))::uuid, v_viaje, 'alta', auth.uid());
    return new;
  end if;
  v_viejo := to_jsonb(old);
  for v_campo in select jsonb_object_keys(v_nuevo) loop
    if v_campo <> all (v_ignorar) and (v_nuevo->v_campo) is distinct from (v_viejo->v_campo) then
      insert into bitacora (empresa_id, tabla, registro_id, viaje_id, accion, campo, valor_anterior, valor_nuevo, usuario_id)
      values (
        new.empresa_id, tg_table_name, (v_nuevo->>coalesce(tg_argv[0], 'id'))::uuid, v_viaje,
        case when v_campo = 'estado' and tg_table_name = 'viajes'
          then case v_nuevo->>'estado' when 'cerrado' then 'cierre' when 'cancelado' then 'cancelacion' else 'reapertura' end
          else 'cambio' end,
        v_campo, v_viejo->>v_campo, v_nuevo->>v_campo, auth.uid()
      );
    end if;
  end loop;
  return new;
end;
$$;

-- ---------- Reglas del viaje ----------
-- Cancelar: solo con cancelar_viaje() y solo desde abierto. Cancelado: no se edita.
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

-- Tramos, gastos, finanzas, cargas y cargos: nada cambia si su viaje está
-- cerrado o cancelado (ni el nuevo ni, al mover una carga, el anterior).
create or replace function proteger_viaje_cerrado() returns trigger
language plpgsql set search_path = public as $$
declare
  v_folio text;
  v_estado estado_viaje;
begin
  select folio, estado into v_folio, v_estado from viajes
  where estado in ('cerrado', 'cancelado')
    and id in (
      case when tg_op <> 'DELETE' then (to_jsonb(new)->>'viaje_id')::uuid end,
      case when tg_op <> 'INSERT' then (to_jsonb(old)->>'viaje_id')::uuid end
    )
  limit 1;
  if v_folio is not null then
    raise exception 'El viaje % está %: no se puede modificar', v_folio, v_estado;
  end if;
  if tg_op <> 'DELETE' and to_jsonb(new) ? 'actualizado_en' then
    new := jsonb_populate_record(new, jsonb_build_object('actualizado_en', now()));
  end if;
  return coalesce(new, old);
end;
$$;

-- Cancelar con motivo. security definer: escribe la nota en la bitácora, que
-- nadie edita directo. Revisa el permiso con puede_reabrir() (sesión del usuario).
create function cancelar_viaje(p_viaje uuid, p_motivo text) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_empresa uuid;
  v_estado estado_viaje;
  v_motivo text := btrim(coalesce(p_motivo, ''));
begin
  select empresa_id, estado into v_empresa, v_estado from viajes where id = p_viaje;
  if v_empresa is null then
    raise exception 'Viaje no encontrado';
  end if;
  if not puede_reabrir(v_empresa) then
    raise exception 'No tienes permiso para cancelar viajes' using errcode = 'insufficient_privilege';
  end if;
  if v_estado <> 'abierto' then
    raise exception 'Solo se cancela un viaje abierto';
  end if;
  if length(v_motivo) < 5 then
    raise exception 'Escribe el motivo de la cancelación';
  end if;
  -- Una carga pendiente ya no se podría revisar.
  if exists (select 1 from cargas_diesel where viaje_id = p_viaje and estado = 'pendiente') then
    raise exception 'No se puede cancelar: valida o rechaza antes las cargas de diésel pendientes';
  end if;
  perform set_config('control_diesel.cancelar', p_viaje::text, true);
  update viajes set estado = 'cancelado', motivo_cancelacion = v_motivo where id = p_viaje;
  perform set_config('control_diesel.cancelar', '', true);
  update bitacora set nota = v_motivo
  where viaje_id = p_viaje and tabla = 'viajes' and accion = 'cancelacion' and en = now() and usuario_id = auth.uid();
end;
$$;

-- ---------- Nada se borra ----------
-- Las políticas "for all" de dueño y administración también dejaban borrar
-- viajes y cargas por la API. Un viaje se cancela; una carga se rechaza.
drop policy viajes_escribir on viajes;
create policy viajes_alta_admin on viajes for insert with check (es_admin(empresa_id));
create policy viajes_editar_admin on viajes for update
  using (es_admin(empresa_id)) with check (es_admin(empresa_id));

drop policy cargas_escribir_admin on cargas_diesel;
create policy cargas_alta_admin on cargas_diesel for insert with check (es_admin(empresa_id));
create policy cargas_editar_admin on cargas_diesel for update
  using (es_admin(empresa_id)) with check (es_admin(empresa_id));

revoke execute on function registrar_bitacora() from public, anon, authenticated;
revoke execute on function controlar_viaje() from public, anon, authenticated;
revoke execute on function proteger_viaje_cerrado() from public, anon, authenticated;
revoke execute on function cancelar_viaje(uuid, text) from public, anon;
grant execute on function cancelar_viaje(uuid, text) to authenticated;
