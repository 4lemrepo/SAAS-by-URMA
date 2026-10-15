-- =====================================================================
-- Control Diésel — remolques, dollies y armados
-- Una unidad (número económico) es el tractocamión. Se le enganchan
-- remolques y dolly, y eso cambia según la operación:
--   sencillo = remolque 1
--   full     = remolque 1 + dolly + remolque 2
-- Cada armado es un periodo (desde/hasta) que no se edita: cambiar el armado
-- cierra el vigente y abre uno nuevo, así se sabe qué traía en cada fecha.
-- La configuración sencillo/full sale del armado, ya no se captura en la unidad.
-- =====================================================================

-- ---------- 1. Tracto ----------
alter table unidades add column numero_serie text;
alter table unidades add constraint unidades_serie_valida
  check (numero_serie is null or length(btrim(numero_serie)) between 3 and 30);
create unique index unidades_serie_unica on unidades (empresa_id, upper(btrim(numero_serie)))
  where numero_serie is not null;
-- La configuración sale del armado y el tipo de equipo ahora es del remolque.
alter table unidades drop column configuracion;
alter table unidades drop column tipo_equipo;

-- ---------- 2. Tipos de remolque (catálogo editable por empresa) ----------
create table tipos_remolque (
  id          uuid primary key default gen_random_uuid(),
  empresa_id  uuid not null references empresas(id) on delete cascade,
  nombre      text not null check (length(btrim(nombre)) between 2 and 60),
  activo      boolean not null default true,
  creado_en   timestamptz not null default now(),
  unique (empresa_id, id)
);
create unique index tipos_remolque_nombre_unico on tipos_remolque (empresa_id, lower(btrim(nombre)));

create function precargar_tipos_remolque(p_empresa uuid) returns void
language sql security definer set search_path = public as $$
  insert into tipos_remolque (empresa_id, nombre)
  select p_empresa, nombre
  from unnest(array[
    'Góndola granelera', 'Jaula ganadera', 'Caja seca', 'Caja refrigerada',
    'Plataforma', 'Tolva', 'Tanque/pipa', 'Chasis portacontenedor'
  ]) as nombre
  on conflict do nothing;
$$;

-- Cada empresa nueva arranca con sus catálogos base.
create function inicializar_empresa() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform precargar_tipos_remolque(new.id);
  return new;
end;
$$;
create trigger empresas_inicializar after insert on empresas
  for each row execute function inicializar_empresa();

-- Las empresas que ya existen también.
select precargar_tipos_remolque(id) from empresas;

-- ---------- 3. Remolques y dollies ----------
create table remolques (
  id                uuid primary key default gen_random_uuid(),
  empresa_id        uuid not null references empresas(id) on delete cascade,
  numero_economico  text check (numero_economico is null or length(btrim(numero_economico)) between 1 and 20),
  placas            text not null check (length(btrim(placas)) between 5 and 15),
  numero_serie      text not null check (length(btrim(numero_serie)) between 3 and 30),
  tipo_id           uuid not null,
  activo            boolean not null default true,
  creado_en         timestamptz not null default now(),
  unique (empresa_id, id),
  constraint remolques_tipo_misma_empresa foreign key (empresa_id, tipo_id) references tipos_remolque (empresa_id, id)
);
create unique index remolques_placas_unicas on remolques (empresa_id, upper(btrim(placas)));
create unique index remolques_serie_unica on remolques (empresa_id, upper(btrim(numero_serie)));
create unique index remolques_numero_unico on remolques (empresa_id, upper(btrim(numero_economico)))
  where numero_economico is not null;

-- Los dollies no llevan placa.
create table dollies (
  id                uuid primary key default gen_random_uuid(),
  empresa_id        uuid not null references empresas(id) on delete cascade,
  numero_economico  text check (numero_economico is null or length(btrim(numero_economico)) between 1 and 20),
  numero_serie      text not null check (length(btrim(numero_serie)) between 3 and 30),
  activo            boolean not null default true,
  creado_en         timestamptz not null default now(),
  unique (empresa_id, id)
);
create unique index dollies_serie_unica on dollies (empresa_id, upper(btrim(numero_serie)));
create unique index dollies_numero_unico on dollies (empresa_id, upper(btrim(numero_economico)))
  where numero_economico is not null;

-- ---------- 4. Armados ----------
create table armados (
  id             uuid primary key default gen_random_uuid(),
  empresa_id     uuid not null references empresas(id) on delete cascade,
  unidad_id      uuid not null,
  remolque1_id   uuid not null,
  dolly_id       uuid,
  remolque2_id   uuid,
  configuracion  configuracion_unidad not null generated always as (
    case when remolque2_id is null then 'sencillo'::configuracion_unidad else 'full'::configuracion_unidad end
  ) stored,
  desde          timestamptz not null default now(),
  hasta          timestamptz,
  creado_por     uuid references auth.users(id),
  creado_en      timestamptz not null default now(),
  unique (empresa_id, id),
  unique (empresa_id, unidad_id, id),
  constraint armados_unidad_misma_empresa foreign key (empresa_id, unidad_id) references unidades (empresa_id, id),
  constraint armados_remolque1_misma_empresa foreign key (empresa_id, remolque1_id) references remolques (empresa_id, id),
  constraint armados_dolly_misma_empresa foreign key (empresa_id, dolly_id) references dollies (empresa_id, id),
  constraint armados_remolque2_misma_empresa foreign key (empresa_id, remolque2_id) references remolques (empresa_id, id),
  -- Full lleva dolly y segundo remolque; sencillo, ninguno de los dos.
  constraint armados_full_completo check ((dolly_id is null) = (remolque2_id is null)),
  constraint armados_remolques_distintos check (remolque2_id is null or remolque2_id <> remolque1_id),
  constraint armados_periodo_valido check (hasta is null or hasta > desde)
);
-- Un solo armado vigente por unidad.
create unique index armados_vigente_por_unidad on armados (unidad_id) where hasta is null;
create index on armados (empresa_id, unidad_id, desde desc);
create index on armados (remolque1_id);
create index on armados (remolque2_id);
create index on armados (dolly_id);

-- Historial inmutable y sin empalmes: ni la unidad ni un remolque o dolly
-- pueden estar en dos armados a la vez.
create function validar_armado() returns trigger
language plpgsql set search_path = public as $$
declare
  v_choque record;
  v_rango tstzrange := tstzrange(new.desde, new.hasta);
begin
  if tg_op = 'UPDATE' then
    if (new.empresa_id, new.unidad_id, new.remolque1_id, new.dolly_id, new.remolque2_id, new.desde)
       is distinct from (old.empresa_id, old.unidad_id, old.remolque1_id, old.dolly_id, old.remolque2_id, old.desde) then
      raise exception 'El historial de armados no se edita: registra un cambio de armado';
    end if;
    new.creado_por := old.creado_por;
  else
    new.creado_por := auth.uid();
  end if;

  -- Serializa cambios de armado de la misma empresa.
  perform pg_advisory_xact_lock(hashtextextended('armados:' || new.empresa_id::text, 0));

  select a.*, u.numero_economico as unidad_txt into v_choque
  from armados a join unidades u on u.id = a.unidad_id
  where a.empresa_id = new.empresa_id and a.id <> new.id and a.unidad_id = new.unidad_id
    and tstzrange(a.desde, a.hasta) && v_rango
  limit 1;
  if found then
    raise exception 'La unidad % ya tiene un armado en esas fechas', v_choque.unidad_txt;
  end if;

  select coalesce(r.numero_economico, r.placas) as equipo, u.numero_economico as unidad_txt into v_choque
  from armados a
  join unidades u on u.id = a.unidad_id
  join remolques r on r.id in (new.remolque1_id, new.remolque2_id)
  where a.empresa_id = new.empresa_id and a.id <> new.id
    and r.id in (a.remolque1_id, a.remolque2_id)
    and tstzrange(a.desde, a.hasta) && v_rango
  limit 1;
  if found then
    raise exception 'El remolque % está en la unidad % en esas fechas; quítalo de ahí primero', v_choque.equipo, v_choque.unidad_txt;
  end if;

  if new.dolly_id is not null then
    select coalesce(d.numero_economico, d.numero_serie) as equipo, u.numero_economico as unidad_txt into v_choque
    from armados a
    join unidades u on u.id = a.unidad_id
    join dollies d on d.id = a.dolly_id
    where a.empresa_id = new.empresa_id and a.id <> new.id and a.dolly_id = new.dolly_id
      and tstzrange(a.desde, a.hasta) && v_rango
    limit 1;
    if found then
      raise exception 'El dolly % está en la unidad % en esas fechas; quítalo de ahí primero', v_choque.equipo, v_choque.unidad_txt;
    end if;
  end if;
  return new;
end;
$$;
create trigger armados_validar before insert or update on armados
  for each row execute function validar_armado();

-- Un remolque o dolly enganchado no se puede desactivar.
create function proteger_equipo_enganchado() returns trigger
language plpgsql set search_path = public as $$
begin
  if old.activo and not new.activo and exists (
    select 1 from armados a
    where a.hasta is null
      and (case tg_table_name when 'dollies' then a.dolly_id = old.id
           else old.id in (a.remolque1_id, a.remolque2_id) end)
  ) then
    raise exception 'Está enganchado a una unidad: cambia ese armado antes de desactivarlo';
  end if;
  return new;
end;
$$;
create trigger remolques_proteger_enganchado before update on remolques
  for each row execute function proteger_equipo_enganchado();
create trigger dollies_proteger_enganchado before update on dollies
  for each row execute function proteger_equipo_enganchado();

-- Cambiar el armado de una unidad en un solo paso: cierra el vigente en
-- p_desde y abre el nuevo. Sin remolque 1 = desenganchar todo.
-- security invoker: aplica RLS (solo dueño y administración escriben armados).
create function cambiar_armado(
  p_unidad uuid,
  p_remolque1 uuid,
  p_dolly uuid default null,
  p_remolque2 uuid default null,
  p_desde timestamptz default now()
) returns uuid
language plpgsql security invoker set search_path = public as $$
declare
  v_empresa uuid;
  v_actual armados%rowtype;
  v_id uuid;
begin
  select empresa_id into v_empresa from unidades where id = p_unidad;
  if v_empresa is null then
    raise exception 'Unidad no encontrada';
  end if;
  if not es_admin(v_empresa) then
    raise exception 'Solo dueño y administración cambian armados' using errcode = 'insufficient_privilege';
  end if;
  if p_desde is null or p_desde > now() + interval '1 day' then
    raise exception 'La fecha del cambio no puede ser futura';
  end if;
  if p_remolque1 is null and (p_dolly is not null or p_remolque2 is not null) then
    raise exception 'Falta el remolque 1';
  end if;
  if (p_dolly is null) <> (p_remolque2 is null) then
    raise exception 'Un full lleva dolly y segundo remolque; un sencillo, ninguno de los dos';
  end if;
  if p_remolque2 = p_remolque1 then
    raise exception 'El remolque 1 y el remolque 2 deben ser distintos';
  end if;
  if exists (select 1 from remolques where id in (p_remolque1, p_remolque2) and not activo)
     or exists (select 1 from dollies where id = p_dolly and not activo) then
    raise exception 'No se puede enganchar un remolque o dolly inactivo';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('armados:' || v_empresa::text, 0));

  select * into v_actual from armados where unidad_id = p_unidad and hasta is null for update;
  if found then
    if (v_actual.remolque1_id, v_actual.dolly_id, v_actual.remolque2_id)
       is not distinct from (p_remolque1, p_dolly, p_remolque2) then
      raise exception 'Ese ya es el armado actual';
    end if;
    if p_desde <= v_actual.desde then
      raise exception 'La fecha del cambio debe ser posterior al inicio del armado actual (%)',
        to_char(v_actual.desde at time zone 'America/Mexico_City', 'DD/MM/YYYY HH24:MI');
    end if;
    update armados set hasta = p_desde where id = v_actual.id;
  elsif p_remolque1 is null then
    raise exception 'La unidad no tiene nada enganchado';
  end if;

  if p_remolque1 is null then
    return null;
  end if;
  insert into armados (empresa_id, unidad_id, remolque1_id, dolly_id, remolque2_id, desde)
  values (v_empresa, p_unidad, p_remolque1, p_dolly, p_remolque2, p_desde)
  returning id into v_id;
  return v_id;
end;
$$;

-- ---------- 5. El viaje guarda el armado que llevó ----------
alter table viajes add column armado_id uuid;
-- El armado debe ser de la misma unidad del viaje.
alter table viajes add constraint viajes_armado_misma_unidad
  foreign key (empresa_id, unidad_id, armado_id) references armados (empresa_id, unidad_id, id);
create index on viajes (armado_id);

-- ---------- 6. Seguridad ----------
alter table tipos_remolque enable row level security;
alter table remolques      enable row level security;
alter table dollies        enable row level security;
alter table armados        enable row level security;

-- Todos los miembros consultan; dueño y administración dan de alta y editan.
-- Sin política de borrado: se desactiva (y el historial de armados no se borra).
create policy tipos_remolque_leer on tipos_remolque for select using (mi_rol(empresa_id) is not null);
create policy tipos_remolque_alta on tipos_remolque for insert with check (es_admin(empresa_id));
create policy tipos_remolque_editar on tipos_remolque for update using (es_admin(empresa_id)) with check (es_admin(empresa_id));

create policy remolques_leer on remolques for select using (mi_rol(empresa_id) is not null);
create policy remolques_alta on remolques for insert with check (es_admin(empresa_id));
create policy remolques_editar on remolques for update using (es_admin(empresa_id)) with check (es_admin(empresa_id));

create policy dollies_leer on dollies for select using (mi_rol(empresa_id) is not null);
create policy dollies_alta on dollies for insert with check (es_admin(empresa_id));
create policy dollies_editar on dollies for update using (es_admin(empresa_id)) with check (es_admin(empresa_id));

create policy armados_leer on armados for select using (mi_rol(empresa_id) is not null);
create policy armados_alta on armados for insert with check (es_admin(empresa_id));
create policy armados_cerrar on armados for update using (es_admin(empresa_id)) with check (es_admin(empresa_id));

revoke execute on function precargar_tipos_remolque(uuid) from public, anon, authenticated;
revoke execute on function inicializar_empresa() from public, anon, authenticated;
revoke execute on function validar_armado() from public, anon, authenticated;
revoke execute on function proteger_equipo_enganchado() from public, anon, authenticated;
revoke execute on function cambiar_armado(uuid, uuid, uuid, uuid, timestamptz) from public, anon;
grant execute on function cambiar_armado(uuid, uuid, uuid, uuid, timestamptz) to authenticated;
