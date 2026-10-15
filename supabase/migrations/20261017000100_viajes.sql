-- =====================================================================
-- Control Diésel — viajes completos
-- Un viaje = tramo VACÍO (A → B, lugar de carga) + tramo CARGADO (B → C,
-- lugar de descarga). El siguiente viaje de la unidad empieza en C.
-- - Odómetros por tramo; si el inicial no coincide con el último registrado de
--   la unidad, son "km sin viaje" y se pide explicación.
-- - Tarifa, ingreso y pago al operador viven en viajes_finanzas: solo los ve
--   quien tiene "ve tarifas e ingresos".
-- - Gastos del viaje con folio, categoría y comprobante.
-- - Cerrado: nadie edita el viaje, sus tramos, gastos ni cargas. Solo se
--   reabre con permiso y motivo (queda en reaperturas_viaje y en la bitácora).
-- =====================================================================

-- ---------- 1. Viaje ----------
-- Lo que pasa a los tramos (todavía no hay pantallas que lo usen).
alter table viajes
  drop column ruta_cargado_id,
  drop column ruta_vacio_id,
  drop column km_cargado,
  drop column km_vacio,
  drop column km_cargado_ruta,
  drop column km_vacio_ruta,
  drop column odometro_salida,
  drop column odometro_llegada;

alter table viajes rename column toneladas to toneladas_cargadas;
alter table viajes
  add column toneladas_descargadas numeric(6,2) check (toneladas_descargadas is null or toneladas_descargadas >= 0),
  add column producto text check (producto is null or length(btrim(producto)) between 1 and 80),
  -- Tiempos en el punto de carga y en el de descarga
  add column llegada_carga     timestamptz,
  add column salida_carga      timestamptz,
  add column llegada_descarga  timestamptz,
  add column salida_descarga   timestamptz,
  -- Continuidad del odómetro con el viaje anterior de la unidad
  add column odometro_anterior numeric(10,1),
  add column km_sin_viaje      numeric(10,1) not null default 0,
  add column explicacion_km_sin_viaje text,
  add column cerrado_por uuid references auth.users(id),
  add column cerrado_en  timestamptz,
  add column actualizado_en timestamptz not null default now(),
  add constraint viajes_toneladas_cargadas_validas check (toneladas_cargadas is null or toneladas_cargadas >= 0),
  add constraint viajes_fechas_en_orden check (fecha_llegada is null or fecha_llegada >= fecha_salida),
  add constraint viajes_carga_en_orden check (salida_carga is null or llegada_carga is null or salida_carga >= llegada_carga),
  add constraint viajes_descarga_en_orden check (salida_descarga is null or llegada_descarga is null or salida_descarga >= llegada_descarga),
  add constraint viajes_km_sin_viaje_explicado check (km_sin_viaje = 0 or length(btrim(coalesce(explicacion_km_sin_viaje, ''))) >= 3);

-- Folio consecutivo por empresa, nunca repetido.
update viajes set folio = null where btrim(coalesce(folio, '')) = '';
create trigger viajes_asignar_folio before insert or update on viajes
  for each row execute function asignar_folio('viaje');
-- Los viajes que ya existan reciben folio.
update viajes v set folio = siguiente_folio(v.empresa_id, 'viaje') where folio is null;
alter table viajes alter column folio set not null;
create unique index viajes_folio_unico on viajes (empresa_id, upper(folio));

-- El cliente define si se factura por peso cargado o descargado.
create type peso_factura as enum ('cargado', 'descargado');
alter table clientes add column factura_por peso_factura not null default 'cargado';

-- El importador también guarda con qué peso factura cada cliente.
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

  insert into fuentes_diesel (empresa_id, nombre, tipo, capacidad_litros)
  select p_empresa, nombre, tipo::tipo_fuente_diesel, capacidad_litros
  from jsonb_to_recordset(coalesce(p_datos->'fuentes', '[]')) as x(nombre text, tipo text, capacidad_litros numeric);
  get diagnostics v_fuentes = row_count;

  return jsonb_build_object(
    'unidades', v_unidades, 'operadores', v_operadores, 'clientes', v_clientes,
    'rutas', v_rutas, 'fuentes', v_fuentes
  );
end;
$$;

-- ---------- 2. Tramos ----------
create type tipo_tramo as enum ('vacio', 'cargado');
create type motivo_desvio as enum ('carga_diesel', 'refaccionaria', 'taller_mecanico', 'otro');

create table tramos_viaje (
  id                uuid primary key default gen_random_uuid(),
  empresa_id        uuid not null references empresas(id) on delete cascade,
  viaje_id          uuid not null,
  tipo              tipo_tramo not null,
  origen            text not null check (length(btrim(origen)) between 2 and 120),
  destino           text not null check (length(btrim(destino)) between 2 and 120),
  odometro_inicial  numeric(10,1) not null check (odometro_inicial >= 0),
  odometro_final    numeric(10,1) not null,
  km                numeric(10,1) generated always as (odometro_final - odometro_inicial) stored,
  -- Ruta del catálogo y sus km al capturar (referencia para el desvío)
  ruta_id           uuid,
  km_ruta           numeric(8,1) check (km_ruta is null or km_ruta > 0),
  motivo_desvio     motivo_desvio,
  nota_desvio       text,
  creado_en         timestamptz not null default now(),
  actualizado_en    timestamptz not null default now(),
  unique (viaje_id, tipo),
  constraint tramos_viaje_misma_empresa foreign key (empresa_id, viaje_id) references viajes (empresa_id, id),
  constraint tramos_ruta_misma_empresa foreign key (empresa_id, ruta_id) references rutas (empresa_id, id),
  constraint tramos_odometro_avanza check (odometro_final >= odometro_inicial),
  constraint tramos_motivo_otro_con_nota check (motivo_desvio is distinct from 'otro' or length(btrim(coalesce(nota_desvio, ''))) >= 3)
);
create index on tramos_viaje (empresa_id, viaje_id);
create index on tramos_viaje (ruta_id);

-- ---------- 3. Finanzas del viaje (solo quien ve tarifas) ----------
create type tipo_tarifa as enum ('por_tonelada', 'fija');

create table viajes_finanzas (
  viaje_id           uuid primary key,
  empresa_id         uuid not null references empresas(id) on delete cascade,
  tipo_tarifa        tipo_tarifa not null default 'por_tonelada',
  -- $ por tonelada, o monto del flete si es fija
  tarifa             numeric(12,2) not null check (tarifa >= 0),
  -- Peso con el que se factura (se toma del cliente al capturar; editable)
  factura_por        peso_factura not null default 'cargado',
  -- Pago al operador: esquema y valores que se usaron en este viaje
  pago_esquema       esquema_pago_operador not null,
  pago_pct           numeric(5,2),
  pago_tarifa_km_cargado numeric(8,2),
  pago_tarifa_km_vacio   numeric(8,2),
  pago_tarifa_tonelada   numeric(8,2),
  pago_monto_fijo    numeric(12,2),
  -- Si se escribe, manda sobre el cálculo del esquema
  pago_operador_manual numeric(12,2) check (pago_operador_manual is null or pago_operador_manual >= 0),
  actualizado_en     timestamptz not null default now(),
  constraint finanzas_viaje_misma_empresa foreign key (empresa_id, viaje_id) references viajes (empresa_id, id)
);

-- ---------- 4. Gastos del viaje ----------
create table categorias_gasto (
  id          uuid primary key default gen_random_uuid(),
  empresa_id  uuid not null references empresas(id) on delete cascade,
  nombre      text not null check (length(btrim(nombre)) between 2 and 60),
  activo      boolean not null default true,
  creado_en   timestamptz not null default now(),
  unique (empresa_id, id)
);
create unique index categorias_gasto_nombre_unico on categorias_gasto (empresa_id, lower(btrim(nombre)));

create function precargar_categorias_gasto(p_empresa uuid) returns void
language sql security definer set search_path = public as $$
  insert into categorias_gasto (empresa_id, nombre)
  select p_empresa, nombre
  from unnest(array[
    'Casetas', 'Maniobras de carga', 'Maniobras de descarga', 'Estadías', 'Pensión',
    'Viáticos/comidas', 'Básculas', 'Lavado de equipo', 'Reparaciones en ruta',
    'Refacciones', 'Urea (DEF)', 'Otros'
  ]) as nombre
  on conflict do nothing;
$$;
select precargar_categorias_gasto(id) from empresas;

create type forma_pago as enum ('efectivo', 'tarjeta', 'transferencia', 'tag', 'credito', 'otro');

create table gastos_viaje (
  id                  uuid primary key default gen_random_uuid(),
  empresa_id          uuid not null references empresas(id) on delete cascade,
  viaje_id            uuid not null,
  folio               text not null,
  fecha               date not null default current_date,
  categoria_id        uuid not null,
  monto               numeric(12,2) not null check (monto > 0),
  forma_pago          forma_pago not null default 'efectivo',
  proveedor           text check (proveedor is null or length(btrim(proveedor)) <= 120),
  numero_comprobante  text check (numero_comprobante is null or length(btrim(numero_comprobante)) <= 60),
  -- Ruta en Storage: comprobantes/<empresa_id>/<archivo>
  comprobante_path    text,
  -- true: se factura al cliente (suma al ingreso); false: costo propio
  facturable          boolean not null default false,
  notas               text,
  -- Nada se borra: un gasto equivocado se cancela (queda en la bitácora)
  cancelado           boolean not null default false,
  capturado_por       uuid references auth.users(id),
  creado_en           timestamptz not null default now(),
  actualizado_en      timestamptz not null default now(),
  constraint gastos_viaje_misma_empresa foreign key (empresa_id, viaje_id) references viajes (empresa_id, id),
  constraint gastos_categoria_misma_empresa foreign key (empresa_id, categoria_id) references categorias_gasto (empresa_id, id)
);
create unique index gastos_viaje_folio_unico on gastos_viaje (empresa_id, upper(folio));
create index on gastos_viaje (empresa_id, viaje_id);
create trigger gastos_asignar_folio before insert or update on gastos_viaje
  for each row execute function asignar_folio('gasto');
create trigger gastos_fijar_capturado_por before insert or update on gastos_viaje
  for each row execute function fijar_capturado_por();

-- Cada empresa nueva arranca con sus catálogos base.
create or replace function inicializar_empresa() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform precargar_tipos_remolque(new.id);
  perform precargar_categorias_gasto(new.id);
  insert into parametros_empresa (empresa_id) values (new.id) on conflict do nothing;
  insert into pago_operador_config (empresa_id, esquema, pct) values (new.id, 'pct_subtotal', 12.6) on conflict do nothing;
  return new;
end;
$$;

-- ---------- 5. Reaperturas ----------
create table reaperturas_viaje (
  id          uuid primary key default gen_random_uuid(),
  empresa_id  uuid not null references empresas(id) on delete cascade,
  viaje_id    uuid not null,
  motivo      text not null check (length(btrim(motivo)) >= 5),
  usuario_id  uuid not null references auth.users(id),
  en          timestamptz not null default now(),
  constraint reaperturas_viaje_misma_empresa foreign key (empresa_id, viaje_id) references viajes (empresa_id, id)
);
create index on reaperturas_viaje (viaje_id, en desc);

-- ---------- 6. Reglas del viaje ----------
-- Cerrar: sin cargas pendientes, con los dos tramos y fecha de llegada.
-- Cerrado: no se edita. Reabrir: solo por reabrir_viaje().
create function controlar_viaje() returns trigger
language plpgsql set search_path = public as $$
begin
  new.actualizado_en := now();
  if tg_op = 'INSERT' then
    if new.estado <> 'abierto' then
      raise exception 'Un viaje nuevo empieza abierto';
    end if;
    return new;
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
create trigger viajes_controlar before insert or update on viajes
  for each row execute function controlar_viaje();

-- Tramos, gastos, finanzas y cargas: nada cambia si su viaje está cerrado
-- (ni el nuevo ni, al mover una carga, el anterior).
create function proteger_viaje_cerrado() returns trigger
language plpgsql set search_path = public as $$
declare
  v_folio text;
begin
  select folio into v_folio from viajes
  where estado = 'cerrado'
    and id in (
      case when tg_op <> 'DELETE' then (to_jsonb(new)->>'viaje_id')::uuid end,
      case when tg_op <> 'INSERT' then (to_jsonb(old)->>'viaje_id')::uuid end
    )
  limit 1;
  if v_folio is not null then
    raise exception 'El viaje % está cerrado: no se puede modificar', v_folio;
  end if;
  if tg_op <> 'DELETE' and to_jsonb(new) ? 'actualizado_en' then
    new := jsonb_populate_record(new, jsonb_build_object('actualizado_en', now()));
  end if;
  return coalesce(new, old);
end;
$$;
create trigger tramos_proteger_cerrado before insert or update or delete on tramos_viaje
  for each row execute function proteger_viaje_cerrado();
create trigger gastos_proteger_cerrado before insert or update or delete on gastos_viaje
  for each row execute function proteger_viaje_cerrado();
create trigger finanzas_proteger_cerrado before insert or update or delete on viajes_finanzas
  for each row execute function proteger_viaje_cerrado();
create trigger cargas_proteger_cerrado before insert or update or delete on cargas_diesel
  for each row execute function proteger_viaje_cerrado();

-- Una carga ligada a un viaje debe ser de la misma unidad.
create function validar_carga_de_viaje() returns trigger
language plpgsql set search_path = public as $$
begin
  if new.viaje_id is not null and not exists (
    select 1 from viajes where id = new.viaje_id and unidad_id = new.unidad_id
  ) then
    raise exception 'La carga es de otra unidad que la del viaje';
  end if;
  return new;
end;
$$;
create trigger cargas_validar_viaje before insert or update on cargas_diesel
  for each row execute function validar_carga_de_viaje();

-- Reabrir con motivo: queda quién, cuándo y por qué.
-- security definer: escribe el motivo en la bitácora, que nadie edita directo.
-- Revisa el permiso con puede_reabrir(), que usa la sesión del usuario.
create function reabrir_viaje(p_viaje uuid, p_motivo text) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_empresa uuid;
  v_estado estado_viaje;
begin
  select empresa_id, estado into v_empresa, v_estado from viajes where id = p_viaje;
  if v_empresa is null then
    raise exception 'Viaje no encontrado';
  end if;
  if not puede_reabrir(v_empresa) then
    raise exception 'No tienes permiso para reabrir viajes' using errcode = 'insufficient_privilege';
  end if;
  if v_estado <> 'cerrado' then
    raise exception 'El viaje no está cerrado';
  end if;
  if length(btrim(coalesce(p_motivo, ''))) < 5 then
    raise exception 'Escribe el motivo de la reapertura';
  end if;
  insert into reaperturas_viaje (empresa_id, viaje_id, motivo, usuario_id)
  values (v_empresa, p_viaje, btrim(p_motivo), auth.uid());
  perform set_config('control_diesel.reabrir', p_viaje::text, true);
  update viajes set estado = 'abierto' where id = p_viaje;
  perform set_config('control_diesel.reabrir', '', true);
  -- La nota del motivo, junto al cambio de estado en la bitácora.
  update bitacora set nota = btrim(p_motivo)
  where viaje_id = p_viaje and tabla = 'viajes' and accion = 'reapertura' and en = now() and usuario_id = auth.uid();
end;
$$;

-- Guardar el viaje y sus tramos en una sola transacción. security invoker:
-- aplica RLS (captura edita viajes abiertos; nadie edita cerrados).
create function guardar_viaje(p_id uuid, p_viaje jsonb, p_tramos jsonb) returns uuid
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
      explicacion_km_sin_viaje, notas)
    values (
      r.empresa_id, nullif(btrim(coalesce(r.folio, '')), ''), r.unidad_id, r.operador_id, r.cliente_id, r.armado_id, r.producto,
      r.toneladas_cargadas, r.toneladas_descargadas, r.fecha_salida, r.llegada_carga, r.salida_carga,
      r.llegada_descarga, r.salida_descarga, r.fecha_llegada, r.odometro_anterior, coalesce(r.km_sin_viaje, 0),
      r.explicacion_km_sin_viaje, r.notas)
    returning id, empresa_id into v_id, v_empresa;
  else
    update viajes set
      folio = coalesce(nullif(btrim(coalesce(r.folio, '')), ''), folio),
      unidad_id = r.unidad_id, operador_id = r.operador_id, cliente_id = r.cliente_id, armado_id = r.armado_id,
      producto = r.producto, toneladas_cargadas = r.toneladas_cargadas, toneladas_descargadas = r.toneladas_descargadas,
      fecha_salida = r.fecha_salida, llegada_carga = r.llegada_carga, salida_carga = r.salida_carga,
      llegada_descarga = r.llegada_descarga, salida_descarga = r.salida_descarga, fecha_llegada = r.fecha_llegada,
      odometro_anterior = r.odometro_anterior, km_sin_viaje = coalesce(r.km_sin_viaje, 0),
      explicacion_km_sin_viaje = r.explicacion_km_sin_viaje, notas = r.notas
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

-- Tolerancia de km para pedir motivo de desvío. Captura la necesita al
-- capturar y no puede leer parametros_empresa.
create function tolerancia_km(p_empresa uuid) returns numeric
language sql stable security definer set search_path = public as $$
  select tolerancia_km_pct from parametros_empresa where empresa_id = p_empresa and mi_rol(p_empresa) is not null
$$;

-- ---------- 7. Bitácora ----------
create trigger viajes_bitacora after insert or update on viajes
  for each row execute function registrar_bitacora();
create trigger tramos_bitacora after insert or update on tramos_viaje
  for each row execute function registrar_bitacora();
create trigger finanzas_bitacora after insert or update on viajes_finanzas
  for each row execute function registrar_bitacora('viaje_id');
create trigger gastos_bitacora after insert or update on gastos_viaje
  for each row execute function registrar_bitacora();
create trigger cargas_bitacora after insert or update on cargas_diesel
  for each row execute function registrar_bitacora();

-- ---------- 8. Seguridad ----------
alter table tramos_viaje      enable row level security;
alter table viajes_finanzas   enable row level security;
alter table categorias_gasto  enable row level security;
alter table gastos_viaje      enable row level security;
alter table reaperturas_viaje enable row level security;

-- Captura edita cualquier viaje abierto (antes solo los suyos); nunca lo cierra.
drop policy viajes_editar_captura on viajes;
create policy viajes_editar_captura on viajes for update
  using (mi_rol(empresa_id) = 'captura' and estado = 'abierto')
  with check (mi_rol(empresa_id) = 'captura' and estado = 'abierto');

-- Tramos y gastos: todos los miembros ven y capturan; nadie borra.
create policy tramos_leer on tramos_viaje for select using (mi_rol(empresa_id) is not null);
create policy tramos_alta on tramos_viaje for insert with check (mi_rol(empresa_id) is not null);
create policy tramos_editar on tramos_viaje for update using (mi_rol(empresa_id) is not null) with check (mi_rol(empresa_id) is not null);

create policy categorias_gasto_leer on categorias_gasto for select using (mi_rol(empresa_id) is not null);
create policy categorias_gasto_alta on categorias_gasto for insert with check (es_admin(empresa_id));
create policy categorias_gasto_editar on categorias_gasto for update using (es_admin(empresa_id)) with check (es_admin(empresa_id));

create policy gastos_leer on gastos_viaje for select using (mi_rol(empresa_id) is not null);
create policy gastos_alta on gastos_viaje for insert with check (mi_rol(empresa_id) is not null);
create policy gastos_editar on gastos_viaje for update using (mi_rol(empresa_id) is not null) with check (mi_rol(empresa_id) is not null);

-- Finanzas: ni las ve ni las toca quien no ve tarifas.
create policy finanzas_leer on viajes_finanzas for select using (ve_tarifas(empresa_id));
create policy finanzas_alta on viajes_finanzas for insert with check (ve_tarifas(empresa_id));
create policy finanzas_editar on viajes_finanzas for update using (ve_tarifas(empresa_id)) with check (ve_tarifas(empresa_id));

-- Solo se leen; las escribe reabrir_viaje().
create policy reaperturas_leer on reaperturas_viaje for select using (es_admin(empresa_id));

-- Cargas: captura ve las suyas y las de los viajes abiertos (edita cualquier viaje abierto).
drop policy cargas_leer on cargas_diesel;
create policy cargas_leer on cargas_diesel for select using (
  es_admin(empresa_id)
  or (mi_rol(empresa_id) = 'captura' and (
    capturado_por = auth.uid()
    or exists (select 1 from viajes v where v.id = viaje_id and v.estado = 'abierto')
  ))
);

-- Comprobantes de gastos y costos: bucket privado por empresa (fotos y PDF).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('comprobantes', 'comprobantes', false, 10485760,
        array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'application/pdf'])
on conflict (id) do nothing;

create policy comprobantes_leer on storage.objects for select using (
  bucket_id = 'comprobantes'
  and (
    es_admin(((storage.foldername(name))[1])::uuid)
    or (owner_id = auth.uid()::text and mi_rol(((storage.foldername(name))[1])::uuid) is not null)
  )
);
create policy comprobantes_subir on storage.objects for insert with check (
  bucket_id = 'comprobantes'
  and mi_rol(((storage.foldername(name))[1])::uuid) is not null
);

revoke execute on function precargar_categorias_gasto(uuid) from public, anon, authenticated;
revoke execute on function inicializar_empresa() from public, anon, authenticated;
revoke execute on function controlar_viaje() from public, anon, authenticated;
revoke execute on function proteger_viaje_cerrado() from public, anon, authenticated;
revoke execute on function validar_carga_de_viaje() from public, anon, authenticated;
revoke execute on function reabrir_viaje(uuid, text) from public, anon;
grant execute on function reabrir_viaje(uuid, text) to authenticated;
revoke execute on function guardar_viaje(uuid, jsonb, jsonb) from public, anon;
grant execute on function guardar_viaje(uuid, jsonb, jsonb) to authenticated;
revoke execute on function tolerancia_km(uuid) from public, anon;
grant execute on function tolerancia_km(uuid) to authenticated;
