-- =====================================================================
-- Control Diésel — folios, permisos por usuario y bitácora de cambios
-- 1. Folios consecutivos por empresa (viajes, gastos, costos) con prefijo y
--    número inicial en Parámetros. Nunca se repiten.
-- 2. Permisos que otorga el dueño: "puede reabrir viajes" (administración) y
--    "ve tarifas e ingresos" (dueño y administración siempre; captura si se lo dan).
-- 3. Bitácora: quién cambió qué campo, cuándo, valor anterior y nuevo.
-- 4. Pago al operador: esquema por empresa y, opcionalmente, por operador.
-- =====================================================================

-- ---------- 1. Folios ----------
alter table parametros_empresa
  add column folio_viaje_prefijo   text not null default '' check (length(folio_viaje_prefijo) <= 10),
  add column folio_viaje_siguiente int  not null default 1 check (folio_viaje_siguiente > 0),
  add column folio_gasto_prefijo   text not null default 'G-' check (length(folio_gasto_prefijo) <= 10),
  add column folio_gasto_siguiente int  not null default 1 check (folio_gasto_siguiente > 0),
  add column folio_costo_prefijo   text not null default 'C-' check (length(folio_costo_prefijo) <= 10),
  add column folio_costo_siguiente int  not null default 1 check (folio_costo_siguiente > 0),
  add column folio_digitos         int  not null default 4 check (folio_digitos between 1 and 8),
  -- Alertas del tablero
  add column dias_alerta_viaje_abierto int not null default 5 check (dias_alerta_viaje_abierto between 1 and 90),
  add column horas_limite_estadia numeric(5,1) not null default 6 check (horas_limite_estadia > 0);

-- Siguiente folio libre del tipo dado ('viaje', 'gasto', 'costo'). Si alguien
-- ya usó ese folio a mano, se brinca al siguiente. security definer: captura
-- también recibe folio aunque no pueda leer ni editar parámetros.
create function siguiente_folio(p_empresa uuid, p_tipo text) returns text
language plpgsql security definer set search_path = public as $$
declare
  v_prefijo text;
  v_numero int;
  v_digitos int;
  v_folio text;
  v_tabla text := case p_tipo when 'viaje' then 'viajes' when 'gasto' then 'gastos_viaje' when 'costo' then 'costos' end;
  v_ocupado boolean;
begin
  if v_tabla is null then
    raise exception 'Tipo de folio desconocido: %', p_tipo;
  end if;
  loop
    -- El update bloquea la fila: dos altas simultáneas no reciben el mismo número.
    execute format(
      'update parametros_empresa set folio_%1$s_siguiente = folio_%1$s_siguiente + 1
       where empresa_id = $1 returning folio_%1$s_prefijo, folio_%1$s_siguiente - 1, folio_digitos', p_tipo)
      into v_prefijo, v_numero, v_digitos using p_empresa;
    if v_numero is null then
      raise exception 'La empresa no tiene parámetros';
    end if;
    v_folio := v_prefijo || lpad(v_numero::text, v_digitos, '0');
    -- La tabla puede no existir todavía (costos llega en otra migración).
    if to_regclass(v_tabla) is null then
      return v_folio;
    end if;
    execute format('select exists (select 1 from %I where empresa_id = $1 and folio = $2)', v_tabla)
      into v_ocupado using p_empresa, v_folio;
    exit when not v_ocupado;
  end loop;
  return v_folio;
end;
$$;

-- Asigna folio en el alta si no viene; un folio a mano solo lo ponen dueño o
-- administración, y el folio no se cambia después salvo por ellos.
-- security definer: llama a siguiente_folio, que los usuarios no pueden ejecutar directo.
create function asignar_folio() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    if new.folio is null or btrim(new.folio) = '' then
      new.folio := siguiente_folio(new.empresa_id, tg_argv[0]);
    elsif not es_admin(new.empresa_id) then
      raise exception 'Solo dueño y administración definen el folio a mano';
    else
      new.folio := btrim(new.folio);
    end if;
  elsif new.folio is distinct from old.folio and not es_admin(new.empresa_id) then
    raise exception 'Solo dueño y administración cambian el folio';
  end if;
  return new;
end;
$$;

-- ---------- 2. Permisos por usuario ----------
alter table miembros
  add column puede_reabrir_viajes boolean not null default false,
  add column ve_tarifas boolean not null default false;

-- ¿Ve tarifa, ingreso, pago al operador y utilidad?
create function ve_tarifas(p_empresa uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((
    select rol in ('dueno', 'administracion') or ve_tarifas
    from miembros where empresa_id = p_empresa and usuario_id = auth.uid()
  ), false)
$$;

-- ¿Puede reabrir un viaje cerrado? El dueño siempre; administración si el dueño se lo dio.
create function puede_reabrir(p_empresa uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((
    select rol = 'dueno' or (rol = 'administracion' and puede_reabrir_viajes)
    from miembros where empresa_id = p_empresa and usuario_id = auth.uid()
  ), false)
$$;

-- Lista de usuarios de la empresa con su correo, para la pantalla de Usuarios (solo el dueño).
create function usuarios_de_empresa(p_empresa uuid)
returns table (usuario_id uuid, correo text, rol rol_miembro, puede_reabrir_viajes boolean, ve_tarifas boolean, creado_en timestamptz)
language sql stable security definer set search_path = public as $$
  select m.usuario_id, u.email::text, m.rol, m.puede_reabrir_viajes, m.ve_tarifas, m.creado_en
  from miembros m join auth.users u on u.id = m.usuario_id
  where m.empresa_id = p_empresa and mi_rol(p_empresa) = 'dueno'
  order by m.creado_en
$$;

-- ---------- 3. Bitácora ----------
create table bitacora (
  id              bigint generated always as identity primary key,
  empresa_id      uuid not null references empresas(id) on delete cascade,
  tabla           text not null,
  registro_id     uuid not null,
  -- Para mostrar en la pantalla del viaje todo lo que le pasó (tramos, gastos, cargas…)
  viaje_id        uuid,
  accion          text not null check (accion in ('alta', 'cambio', 'cierre', 'reapertura')),
  campo           text,
  valor_anterior  text,
  valor_nuevo     text,
  nota            text,
  usuario_id      uuid,
  en              timestamptz not null default now()
);
create index on bitacora (empresa_id, viaje_id, en desc);
create index on bitacora (empresa_id, tabla, registro_id, en desc);

-- Registra altas y cambios campo por campo. Ignora columnas que pone el sistema.
-- security definer: nadie escribe la bitácora directo.
create function registrar_bitacora() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_viaje uuid;
  v_nuevo jsonb := to_jsonb(new);
  v_viejo jsonb;
  v_campo text;
  v_ignorar text[] := array['actualizado_en', 'creado_en', 'validado_en', 'validado_por', 'cerrado_en', 'cerrado_por', 'km'];
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
          then case v_nuevo->>'estado' when 'cerrado' then 'cierre' else 'reapertura' end
          else 'cambio' end,
        v_campo, v_viejo->>v_campo, v_nuevo->>v_campo, auth.uid()
      );
    end if;
  end loop;
  return new;
end;
$$;

alter table bitacora enable row level security;
-- Solo dueño y administración la leen; nadie la escribe ni la borra directo.
create policy bitacora_leer on bitacora for select using (es_admin(empresa_id));

-- ---------- 4. Pago al operador ----------
create type esquema_pago_operador as enum (
  'pct_subtotal',     -- % del subtotal de la factura (flete + gastos facturados, sin impuestos)
  'pct_flete',        -- % del flete
  'por_km',           -- $ por km cargado y $ por km vacío
  'por_tonelada',     -- $ por tonelada facturada
  'fijo',             -- monto fijo por viaje
  'sueldo_comision'   -- sueldo base mensual (va en Costos) + % del subtotal por viaje
);

-- Configuración de pago: la de la empresa (operador_id null) y la de cada
-- operador que tenga una distinta. Solo la ven quienes ven tarifas.
create table pago_operador_config (
  id                 uuid primary key default gen_random_uuid(),
  empresa_id         uuid not null references empresas(id) on delete cascade,
  operador_id        uuid,
  esquema            esquema_pago_operador not null default 'pct_subtotal',
  pct                numeric(5,2) check (pct is null or (pct >= 0 and pct <= 100)),
  tarifa_km_cargado  numeric(8,2) check (tarifa_km_cargado is null or tarifa_km_cargado >= 0),
  tarifa_km_vacio    numeric(8,2) check (tarifa_km_vacio is null or tarifa_km_vacio >= 0),
  tarifa_tonelada    numeric(8,2) check (tarifa_tonelada is null or tarifa_tonelada >= 0),
  monto_fijo         numeric(12,2) check (monto_fijo is null or monto_fijo >= 0),
  sueldo_base_mensual numeric(12,2) check (sueldo_base_mensual is null or sueldo_base_mensual >= 0),
  -- Un operador que vuelve al pago de la empresa queda inactivo (nada se borra).
  activo             boolean not null default true,
  actualizado_en     timestamptz not null default now(),
  constraint pago_config_operador_misma_empresa foreign key (empresa_id, operador_id) references operadores (empresa_id, id)
);
create unique index pago_config_empresa_unica on pago_operador_config (empresa_id) where operador_id is null;
create unique index pago_config_operador_unica on pago_operador_config (empresa_id, operador_id) where operador_id is not null;

-- Cada empresa arranca con 12.6 % del subtotal (lo que usa URMA); se cambia en Parámetros.
insert into pago_operador_config (empresa_id, esquema, pct)
select id, 'pct_subtotal', 12.6 from empresas;

create or replace function inicializar_empresa() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform precargar_tipos_remolque(new.id);
  insert into parametros_empresa (empresa_id) values (new.id) on conflict do nothing;
  insert into pago_operador_config (empresa_id, esquema, pct) values (new.id, 'pct_subtotal', 12.6) on conflict do nothing;
  return new;
end;
$$;

alter table pago_operador_config enable row level security;
create policy pago_config_leer on pago_operador_config for select using (ve_tarifas(empresa_id));
create policy pago_config_alta on pago_operador_config for insert with check (es_admin(empresa_id));
create policy pago_config_editar on pago_operador_config for update using (es_admin(empresa_id)) with check (es_admin(empresa_id));

create trigger pago_config_actualizado before update on pago_operador_config
  for each row execute function marcar_parametros_actualizados();

revoke execute on function siguiente_folio(uuid, text) from public, anon, authenticated;
revoke execute on function asignar_folio() from public, anon, authenticated;
revoke execute on function registrar_bitacora() from public, anon, authenticated;
revoke execute on function usuarios_de_empresa(uuid) from public, anon;
grant execute on function usuarios_de_empresa(uuid) to authenticated;
