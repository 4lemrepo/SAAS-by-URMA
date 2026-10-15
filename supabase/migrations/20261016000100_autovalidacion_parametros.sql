-- =====================================================================
-- Control Diésel — autovalidación del dueño y parámetros aparte
-- 1. El dueño SÍ puede validar (o rechazar) las cargas que él capturó; queda
--    marcada como autovalidada. Administración y captura siguen sin poder
--    revisar lo que ellos capturaron.
-- 2. Tolerancia y precio del diésel pasan de empresas a parametros_empresa,
--    que captura no puede leer (empresas la leen todos los miembros).
-- =====================================================================

-- ---------- 1. Autovalidación ----------
alter table cargas_diesel add column autovalidada boolean not null default false;

create or replace function controlar_validacion_carga() returns trigger
language plpgsql set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    if new.estado <> 'pendiente' then
      raise exception 'Una carga nueva queda pendiente hasta que alguien la valide';
    end if;
    new.validado_por := null;
    new.validado_en := null;
    new.autovalidada := false;
    return new;
  end if;

  if new.estado is not distinct from old.estado then
    new.validado_por := old.validado_por;
    new.validado_en := old.validado_en;
    new.autovalidada := old.autovalidada;
  elsif new.estado = 'pendiente' then
    new.validado_por := null;
    new.validado_en := null;
    new.autovalidada := false;
  else
    if old.capturado_por = auth.uid() and mi_rol(new.empresa_id) is distinct from 'dueno' then
      raise exception 'Quien capturó la carga no puede validarla ni rechazarla (solo el dueño puede)';
    end if;
    new.validado_por := auth.uid();
    new.validado_en := now();
    -- "Autovalidada" también cubre el rechazo: la revisó quien la capturó.
    new.autovalidada := old.capturado_por is not distinct from auth.uid();
  end if;
  return new;
end;
$$;

-- ---------- 2. Parámetros de la empresa ----------
create table parametros_empresa (
  empresa_id           uuid primary key references empresas(id) on delete cascade,
  tolerancia_pct       numeric(5,2) not null default 5 check (tolerancia_pct > 0 and tolerancia_pct <= 100),
  precio_diesel_litro  numeric(8,2) check (precio_diesel_litro is null or precio_diesel_litro > 0),
  actualizado_en       timestamptz not null default now()
);

insert into parametros_empresa (empresa_id, tolerancia_pct, precio_diesel_litro)
select id, tolerancia_pct, precio_diesel_litro from empresas;

alter table empresas drop column tolerancia_pct;
alter table empresas drop column precio_diesel_litro;

create or replace function inicializar_empresa() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform precargar_tipos_remolque(new.id);
  insert into parametros_empresa (empresa_id) values (new.id) on conflict do nothing;
  return new;
end;
$$;

create function marcar_parametros_actualizados() returns trigger
language plpgsql set search_path = public as $$
begin
  new.actualizado_en := now();
  return new;
end;
$$;
create trigger parametros_actualizados before update on parametros_empresa
  for each row execute function marcar_parametros_actualizados();

alter table parametros_empresa enable row level security;
-- Dueño y administración los leen (la conciliación los usa); solo el dueño
-- los cambia. Se crean con la empresa y se borran con ella: sin alta ni baja.
create policy parametros_leer on parametros_empresa for select using (es_admin(empresa_id));
create policy parametros_editar on parametros_empresa for update
  using (mi_rol(empresa_id) = 'dueno') with check (mi_rol(empresa_id) = 'dueno');

revoke execute on function inicializar_empresa() from public, anon, authenticated;
revoke execute on function marcar_parametros_actualizados() from public, anon, authenticated;
