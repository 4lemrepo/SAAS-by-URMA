-- =====================================================================
-- Control Diésel — permisos financieros por persona
-- Interruptores que da el dueño a cada usuario de administración:
--   ve_tarifas     tarifa, flete, cargos adicionales e ingreso (ya existía;
--                  captura también puede tenerlo, como hoy)
--   ve_utilidades  pago al operador, utilidad, margen, costo/km y el tablero
--                  financiero. Requiere ve_tarifas (sin ingreso no hay utilidad).
--   ve_costos      costos de unidad y generales (captura y consulta)
-- El dueño los tiene siempre. Administración ya NO los tiene por defecto: sin
-- ellos ve solo el tablero operativo. Captura sigue igual que hoy.
-- La base no devuelve esos datos a quien no tiene el permiso:
-- - El pago al operador del viaje sale de viajes_finanzas a viajes_pago.
-- - pago_operador_config, viajes_pago: ve_utilidades.
-- - costos, categorias_costo: ve_costos.
-- - viajes_finanzas, cargos_adicionales: ve_tarifas.
-- - bitácora: cada renglón con el permiso de su tabla.
-- =====================================================================

-- ---------- 1. Interruptores ----------
alter table miembros
  add column ve_utilidades boolean not null default false,
  add column ve_costos boolean not null default false;

-- Tarifa, ingreso y cargos al cliente: el dueño siempre; los demás si el dueño se lo dio.
create or replace function ve_tarifas(p_empresa uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((
    select rol = 'dueno' or ve_tarifas
    from miembros where empresa_id = p_empresa and usuario_id = auth.uid()
  ), false)
$$;

-- Pago al operador, utilidad y tablero financiero: dueño, o administración con
-- "ve utilidades" y "ve tarifas".
create function ve_utilidades(p_empresa uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((
    select rol = 'dueno' or (rol = 'administracion' and ve_utilidades and ve_tarifas)
    from miembros where empresa_id = p_empresa and usuario_id = auth.uid()
  ), false)
$$;

-- Costos de unidad y generales: dueño, o administración con "ve costos".
create function ve_costos(p_empresa uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((
    select rol = 'dueno' or (rol = 'administracion' and ve_costos)
    from miembros where empresa_id = p_empresa and usuario_id = auth.uid()
  ), false)
$$;

drop function usuarios_de_empresa(uuid);
create function usuarios_de_empresa(p_empresa uuid)
returns table (usuario_id uuid, correo text, rol rol_miembro, puede_reabrir_viajes boolean, ve_tarifas boolean,
               ve_utilidades boolean, ve_costos boolean, creado_en timestamptz)
language sql stable security definer set search_path = public as $$
  select m.usuario_id, u.email::text, m.rol, m.puede_reabrir_viajes, m.ve_tarifas, m.ve_utilidades, m.ve_costos, m.creado_en
  from miembros m join auth.users u on u.id = m.usuario_id
  where m.empresa_id = p_empresa and mi_rol(p_empresa) = 'dueno'
  order by m.creado_en
$$;

-- ---------- 2. Pago al operador del viaje, aparte de la tarifa ----------
create table viajes_pago (
  viaje_id               uuid primary key,
  empresa_id             uuid not null references empresas(id) on delete cascade,
  esquema                esquema_pago_operador not null,
  base_flete             text not null default 'cargado' check (base_flete in ('cargado', 'facturado')),
  pct                    numeric(5,2),
  tarifa_km_cargado      numeric(8,2),
  tarifa_km_vacio        numeric(8,2),
  tarifa_tonelada        numeric(8,2),
  monto_fijo             numeric(12,2),
  -- Si se escribe, manda sobre el cálculo del esquema
  pago_operador_manual   numeric(12,2) check (pago_operador_manual is null or pago_operador_manual >= 0),
  actualizado_en         timestamptz not null default now(),
  constraint viajes_pago_misma_empresa foreign key (empresa_id, viaje_id) references viajes (empresa_id, id)
);

insert into viajes_pago (viaje_id, empresa_id, esquema, base_flete, pct, tarifa_km_cargado, tarifa_km_vacio,
                         tarifa_tonelada, monto_fijo, pago_operador_manual)
select viaje_id, empresa_id, pago_esquema, pago_base_flete, pago_pct, pago_tarifa_km_cargado, pago_tarifa_km_vacio,
       pago_tarifa_tonelada, pago_monto_fijo, pago_operador_manual
from viajes_finanzas;

alter table viajes_finanzas
  drop column pago_esquema,
  drop column pago_base_flete,
  drop column pago_pct,
  drop column pago_tarifa_km_cargado,
  drop column pago_tarifa_km_vacio,
  drop column pago_tarifa_tonelada,
  drop column pago_monto_fijo,
  drop column pago_operador_manual;

create trigger viajes_pago_proteger_cerrado before insert or update or delete on viajes_pago
  for each row execute function proteger_viaje_cerrado();
create trigger viajes_pago_bitacora after insert or update on viajes_pago
  for each row execute function registrar_bitacora('viaje_id');

-- Quien captura la tarifa sin ver utilidades no puede leer el esquema de pago:
-- el viaje toma el del operador (o el de la empresa) al guardar su tarifa.
-- security definer: lee pago_operador_config sin el permiso de quien captura.
create function pago_por_defecto() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_operador uuid;
begin
  select operador_id into v_operador from viajes where id = new.viaje_id;
  insert into viajes_pago (viaje_id, empresa_id, esquema, base_flete, pct, tarifa_km_cargado, tarifa_km_vacio, tarifa_tonelada, monto_fijo)
  select new.viaje_id, new.empresa_id, c.esquema, c.base_flete, c.pct, c.tarifa_km_cargado, c.tarifa_km_vacio, c.tarifa_tonelada, c.monto_fijo
  from pago_operador_config c
  where c.empresa_id = new.empresa_id and c.activo and (c.operador_id = v_operador or c.operador_id is null)
  order by c.operador_id nulls last
  limit 1
  on conflict (viaje_id) do nothing;
  return new;
end;
$$;
create trigger finanzas_pago_por_defecto after insert on viajes_finanzas
  for each row execute function pago_por_defecto();

-- ---------- 3. Políticas ----------
alter table viajes_pago enable row level security;
create policy viajes_pago_leer on viajes_pago for select using (ve_utilidades(empresa_id));
create policy viajes_pago_alta on viajes_pago for insert with check (ve_utilidades(empresa_id));
create policy viajes_pago_editar on viajes_pago for update using (ve_utilidades(empresa_id)) with check (ve_utilidades(empresa_id));

drop policy pago_config_leer on pago_operador_config;
drop policy pago_config_alta on pago_operador_config;
drop policy pago_config_editar on pago_operador_config;
create policy pago_config_leer on pago_operador_config for select using (ve_utilidades(empresa_id));
create policy pago_config_alta on pago_operador_config for insert with check (ve_utilidades(empresa_id));
create policy pago_config_editar on pago_operador_config for update
  using (ve_utilidades(empresa_id)) with check (ve_utilidades(empresa_id));

drop policy costos_leer on costos;
drop policy costos_alta on costos;
drop policy costos_editar on costos;
create policy costos_leer on costos for select using (ve_costos(empresa_id));
create policy costos_alta on costos for insert with check (ve_costos(empresa_id));
create policy costos_editar on costos for update using (ve_costos(empresa_id)) with check (ve_costos(empresa_id));

drop policy categorias_costo_leer on categorias_costo;
drop policy categorias_costo_alta on categorias_costo;
drop policy categorias_costo_editar on categorias_costo;
create policy categorias_costo_leer on categorias_costo for select using (ve_costos(empresa_id));
create policy categorias_costo_alta on categorias_costo for insert with check (ve_costos(empresa_id));
create policy categorias_costo_editar on categorias_costo for update
  using (ve_costos(empresa_id)) with check (ve_costos(empresa_id));

-- viajes_finanzas y cargos_adicionales ya usan ve_tarifas(), que ahora pide el interruptor.

-- Bitácora: dueño y administración, y cada renglón con el permiso de lo que registra
-- (un cambio de tarifa o de un costo también es el dato).
drop policy bitacora_leer on bitacora;
create policy bitacora_leer on bitacora for select using (
  es_admin(empresa_id)
  and case
    when tabla in ('viajes_finanzas', 'cargos_adicionales') then ve_tarifas(empresa_id)
    when tabla in ('viajes_pago', 'pago_operador_config') then ve_utilidades(empresa_id)
    when tabla in ('costos', 'categorias_costo') then ve_costos(empresa_id)
    else true
  end
  -- Antes de esta migración el pago vivía en viajes_finanzas (campos pago_*).
  and (tabla <> 'viajes_finanzas' or coalesce(campo, '') not like 'pago\_%' or ve_utilidades(empresa_id))
);

revoke execute on function ve_utilidades(uuid) from public, anon;
revoke execute on function ve_costos(uuid) from public, anon;
grant execute on function ve_utilidades(uuid) to authenticated;
grant execute on function ve_costos(uuid) to authenticated;
revoke execute on function usuarios_de_empresa(uuid) from public, anon;
grant execute on function usuarios_de_empresa(uuid) to authenticated;
revoke execute on function pago_por_defecto() from public, anon, authenticated;
