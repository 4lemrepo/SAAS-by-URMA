-- =====================================================================
-- Control Diésel — montos e impuestos
-- Regla: se captura lo que dice el ticket, tal cual (el TOTAL pagado, con IVA
-- si lo trae) y si tiene factura con su tasa (16 %, 8 % frontera, 0 %/exento).
-- - Con factura: costo para rentabilidad = total ÷ (1 + tasa); el IVA se
--   guarda aparte como IVA acreditable.
-- - Sin factura: costo = total.
-- La app calcula el IVA (src/lib/costos/iva.ts) y guarda total, IVA y costo
-- (costo = total − IVA, columna calculada).
-- 1. Gastos del viaje: ya no hay "se factura al cliente". Los que lo estaban
--    quedan como gastos normales (facturable_anterior, para revisarlos). Todos
--    los existentes quedan sin factura (costo = monto) hasta que se revisen.
-- 2. Cargas de diésel: litros y precio por litro como vienen en el ticket.
--    Las existentes toman el valor por defecto de su fuente (TOKA y SERVIFACIL
--    con factura).
-- 3. Costos de unidad y generales: mismo tratamiento; los existentes sin factura.
-- 4. "¿Tiene factura?" por defecto en categorías de gasto y de costo y en fuentes.
-- 5. Cargos adicionales al cliente (maniobras, estadías…): suman al ingreso,
--    subtotal sin IVA. Solo los ve quien ve tarifas.
-- 6. Pago "% del flete" con base peso cargado (por defecto) o peso facturado.
--    URMA: 12.6 % de toneladas cargadas × tarifa.
-- =====================================================================

-- ---------- 0. Bitácora ----------
-- "costo" es calculada (total − IVA): basta con registrar el cambio del IVA.
create or replace function registrar_bitacora() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_viaje uuid;
  v_nuevo jsonb := to_jsonb(new);
  v_viejo jsonb;
  v_campo text;
  v_ignorar text[] := array['actualizado_en', 'creado_en', 'validado_en', 'validado_por', 'cerrado_en', 'cerrado_por', 'km', 'costo'];
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

-- ---------- 1. Gastos del viaje ----------
alter table gastos_viaje rename column facturable to facturable_anterior;
comment on column gastos_viaje.facturable_anterior is
  'Hasta nov-2026 el gasto se marcaba "se factura al cliente". Ya no se usa en ningún cálculo: queda para revisión.';
alter table gastos_viaje
  add column tiene_factura boolean not null default false,
  add column tasa_iva numeric(4,2) not null default 16,
  add column iva numeric(12,2) not null default 0,
  add column costo numeric(12,2) generated always as (monto - iva) stored,
  add constraint gastos_tasa_iva_valida check (tasa_iva in (16, 8, 0)),
  add constraint gastos_iva_valido check (iva >= 0 and iva <= monto and (tiene_factura or iva = 0));

alter table categorias_gasto add column tiene_factura boolean not null default false;
update categorias_gasto set tiene_factura = true
where lower(nombre) ~ '(caseta|urea|refacci|reparaci|di[eé]sel)';

-- Propinas: sin factura.
insert into categorias_gasto (empresa_id, nombre, tiene_factura)
select id, 'Propinas', false from empresas
on conflict do nothing;

create or replace function precargar_categorias_gasto(p_empresa uuid) returns void
language sql security definer set search_path = public as $$
  insert into categorias_gasto (empresa_id, nombre, tiene_factura)
  select p_empresa, nombre, lower(nombre) ~ '(caseta|urea|refacci|reparaci)'
  from unnest(array[
    'Casetas', 'Maniobras de carga', 'Maniobras de descarga', 'Estadías', 'Pensión',
    'Viáticos/comidas', 'Propinas', 'Básculas', 'Lavado de equipo', 'Reparaciones en ruta',
    'Refacciones', 'Urea (DEF)', 'Otros'
  ]) as nombre
  on conflict do nothing;
$$;

-- ---------- 2. Cargas de diésel ----------
alter table fuentes_diesel add column tiene_factura boolean not null default false;
update fuentes_diesel set tiene_factura = true where nombre ~* '(toka|servif[aá]cil)';

alter table cargas_diesel
  -- El precio por litro como viene en el ticket (puede traer 3 o 4 decimales).
  alter column precio_litro type numeric(9,4),
  add column tiene_factura boolean not null default false,
  add column tasa_iva numeric(4,2) not null default 16,
  add column iva numeric(12,2) not null default 0,
  -- Sin importe no hay costo guardado: la app lo estima con el precio del parámetro.
  add column costo numeric(12,2) generated always as (importe - iva) stored,
  add constraint cargas_tasa_iva_valida check (tasa_iva in (16, 8, 0)),
  add constraint cargas_iva_valido check (
    iva >= 0 and (tiene_factura or iva = 0) and (importe is null and iva = 0 or iva <= importe)
  );

-- Las cargas existentes toman el valor de su fuente. Las de viajes cerrados también:
-- se apaga un momento la protección de viaje cerrado (el cambio queda en la bitácora).
alter table cargas_diesel disable trigger cargas_proteger_cerrado;
update cargas_diesel c
set tiene_factura = true,
    tasa_iva = 16,
    iva = case when c.importe is null then 0 else c.importe - round(c.importe / 1.16, 2) end
from fuentes_diesel f
where f.id = c.fuente_id and f.tiene_factura;
alter table cargas_diesel enable trigger cargas_proteger_cerrado;

-- El importador de catálogos también guarda el valor por defecto de la fuente.
create or replace function importar_catalogos(p_empresa uuid, p_datos jsonb) returns jsonb
language plpgsql security invoker set search_path = public as $$
declare
  v_unidades int := 0; v_operadores int := 0; v_clientes int := 0; v_rutas int := 0; v_fuentes int := 0;
begin
  if not es_admin(p_empresa) then
    raise exception 'Solo dueño y administración importan catálogos' using errcode = 'insufficient_privilege';
  end if;

  insert into unidades (empresa_id, numero_economico, placas, numero_serie, marca, modelo, anio, rend_cargado_kml, rend_vacio_kml)
  select p_empresa, numero_economico, placas, numero_serie, marca, modelo, anio, rend_cargado_kml, rend_vacio_kml
  from jsonb_to_recordset(coalesce(p_datos->'unidades', '[]')) as x(
    numero_economico text, placas text, numero_serie text, marca text, modelo text, anio int,
    rend_cargado_kml numeric, rend_vacio_kml numeric);
  get diagnostics v_unidades = row_count;

  insert into operadores (empresa_id, nombre, telefono)
  select p_empresa, nombre, telefono
  from jsonb_to_recordset(coalesce(p_datos->'operadores', '[]')) as x(nombre text, telefono text);
  get diagnostics v_operadores = row_count;

  insert into clientes (empresa_id, nombre, rfc, factura_por)
  select p_empresa, nombre, rfc, coalesce(factura_por, 'cargado')::peso_factura
  from jsonb_to_recordset(coalesce(p_datos->'clientes', '[]')) as x(nombre text, rfc text, factura_por text);
  get diagnostics v_clientes = row_count;

  insert into rutas (empresa_id, origen, destino, km, rend_cargado_kml, rend_vacio_kml)
  select p_empresa, origen, destino, km, rend_cargado_kml, rend_vacio_kml
  from jsonb_to_recordset(coalesce(p_datos->'rutas', '[]')) as x(
    origen text, destino text, km numeric, rend_cargado_kml numeric, rend_vacio_kml numeric);
  get diagnostics v_rutas = row_count;

  insert into fuentes_diesel (empresa_id, nombre, tipo, capacidad_litros, tiene_factura)
  select p_empresa, nombre, tipo::tipo_fuente_diesel, capacidad_litros, coalesce(tiene_factura, false)
  from jsonb_to_recordset(coalesce(p_datos->'fuentes', '[]')) as x(nombre text, tipo text, capacidad_litros numeric, tiene_factura boolean);
  get diagnostics v_fuentes = row_count;

  return jsonb_build_object(
    'unidades', v_unidades, 'operadores', v_operadores, 'clientes', v_clientes,
    'rutas', v_rutas, 'fuentes', v_fuentes
  );
end;
$$;

-- ---------- 3. Costos de unidad y generales ----------
alter table costos
  add column tiene_factura boolean not null default false,
  add column tasa_iva numeric(4,2) not null default 16,
  add column iva numeric(12,2) not null default 0,
  add column costo numeric(12,2) generated always as (monto - iva) stored,
  add constraint costos_tasa_iva_valida check (tasa_iva in (16, 8, 0)),
  add constraint costos_iva_valido check (iva >= 0 and iva <= monto and (tiene_factura or iva = 0));

-- Por defecto con factura, salvo el sueldo del operador y "Otros".
alter table categorias_costo add column tiene_factura boolean not null default true;
update categorias_costo set tiene_factura = false
where nombre in ('Sueldo y prestaciones del operador', 'Otros');

create or replace function precargar_categorias_costo(p_empresa uuid) returns void
language sql security definer set search_path = public as $$
  insert into categorias_costo (empresa_id, nombre, incluir_en_rentabilidad, tiene_factura)
  select p_empresa, nombre, nombre <> 'Sueldo y prestaciones del operador',
         nombre not in ('Sueldo y prestaciones del operador', 'Otros')
  from unnest(array[
    'Mantenimiento tracto', 'Mantenimiento equipo de arrastre', 'Llantas y rines', 'Seguro',
    'Financiamiento o arrendamiento', 'Sueldo y prestaciones del operador', 'GPS',
    'Permisos y verificaciones', 'Oficina', 'Contador', 'Renta de patio', 'Sistemas', 'Otros'
  ]) as nombre
  on conflict do nothing;
$$;

-- ---------- 4. Cargos adicionales al cliente ----------
create table cargos_adicionales (
  id              uuid primary key default gen_random_uuid(),
  empresa_id      uuid not null references empresas(id) on delete cascade,
  viaje_id        uuid not null,
  concepto        text not null check (length(btrim(concepto)) between 2 and 80),
  -- Subtotal sin IVA que se le cobra al cliente
  monto           numeric(12,2) not null check (monto > 0),
  -- Nada se borra: uno equivocado se cancela (queda en la bitácora)
  cancelado       boolean not null default false,
  capturado_por   uuid references auth.users(id),
  creado_en       timestamptz not null default now(),
  actualizado_en  timestamptz not null default now(),
  constraint cargos_adicionales_misma_empresa foreign key (empresa_id, viaje_id) references viajes (empresa_id, id)
);
create index on cargos_adicionales (empresa_id, viaje_id);

create trigger cargos_adicionales_proteger_cerrado before insert or update or delete on cargos_adicionales
  for each row execute function proteger_viaje_cerrado();
create trigger cargos_adicionales_fijar_capturado_por before insert or update on cargos_adicionales
  for each row execute function fijar_capturado_por();
create trigger cargos_adicionales_bitacora after insert or update on cargos_adicionales
  for each row execute function registrar_bitacora();

alter table cargos_adicionales enable row level security;
-- Son ingreso: solo quien ve tarifas los ve y los captura. Nadie los borra.
create policy cargos_adicionales_leer on cargos_adicionales for select using (ve_tarifas(empresa_id));
create policy cargos_adicionales_alta on cargos_adicionales for insert with check (ve_tarifas(empresa_id));
create policy cargos_adicionales_editar on cargos_adicionales for update
  using (ve_tarifas(empresa_id)) with check (ve_tarifas(empresa_id));

-- ---------- 5. Pago al operador: base del "% del flete" ----------
-- cargado: % de (toneladas cargadas × tarifa), aunque el cliente se facture por
-- peso descargado. facturado: % del flete facturado. Los cargos adicionales no
-- generan comisión en "% del flete".
alter table pago_operador_config
  add column base_flete text not null default 'cargado' check (base_flete in ('cargado', 'facturado'));
alter table viajes_finanzas
  add column pago_base_flete text not null default 'cargado' check (pago_base_flete in ('cargado', 'facturado'));

-- URMA (y toda empresa que siga con el valor inicial de 12.6 % del subtotal):
-- 12.6 % del flete con peso cargado. Los viajes ya capturados con ese esquema
-- también (los cerrados incluidos; el cambio queda en la bitácora).
update pago_operador_config set esquema = 'pct_flete', base_flete = 'cargado'
where esquema = 'pct_subtotal' and pct = 12.6;
alter table viajes_finanzas disable trigger finanzas_proteger_cerrado;
update viajes_finanzas set pago_esquema = 'pct_flete', pago_base_flete = 'cargado'
where pago_esquema = 'pct_subtotal' and pago_pct = 12.6;
alter table viajes_finanzas enable trigger finanzas_proteger_cerrado;

create or replace function inicializar_empresa() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform precargar_tipos_remolque(new.id);
  perform precargar_categorias_gasto(new.id);
  perform precargar_categorias_costo(new.id);
  insert into parametros_empresa (empresa_id) values (new.id) on conflict do nothing;
  insert into pago_operador_config (empresa_id, esquema, pct, base_flete)
  values (new.id, 'pct_flete', 12.6, 'cargado') on conflict do nothing;
  return new;
end;
$$;

revoke execute on function precargar_categorias_gasto(uuid) from public, anon, authenticated;
revoke execute on function precargar_categorias_costo(uuid) from public, anon, authenticated;
revoke execute on function inicializar_empresa() from public, anon, authenticated;
revoke execute on function registrar_bitacora() from public, anon, authenticated;
