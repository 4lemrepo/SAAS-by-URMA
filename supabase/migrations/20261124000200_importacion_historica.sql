-- =====================================================================
-- Control Diésel — importación de viajes históricos
-- 1. Lotes de importación: cada importación es un lote. El dueño lo anula
--    completo: sus viajes se cancelan y sus costos también (nada se borra).
--    Los folios de un viaje importado y cancelado quedan libres para
--    reimportar.
-- 2. Viajes y costos llevan el lote del que vinieron (null = capturado).
-- 3. Tramos sin odómetros: el Excel solo trae km. Un tramo sin odómetros
--    guarda sus km y solo se permite en un viaje importado.
-- 4. Toneladas con 3 decimales (kilos de la báscula).
-- 5. importar_historico(): todo el lote en una transacción (todo o nada).
-- =====================================================================

-- ---------- 1. Lotes ----------
create table lotes_importacion (
  id                uuid primary key default gen_random_uuid(),
  empresa_id        uuid not null references empresas(id) on delete cascade,
  archivo           text not null check (length(btrim(archivo)) between 1 and 200),
  creado_por        uuid references auth.users(id) default auth.uid(),
  creado_en         timestamptz not null default now(),
  anulado_por       uuid references auth.users(id),
  anulado_en        timestamptz,
  motivo_anulacion  text,
  unique (empresa_id, id),
  constraint lotes_anulado_con_motivo check (anulado_en is null or length(btrim(coalesce(motivo_anulacion, ''))) >= 5)
);
create index on lotes_importacion (empresa_id, creado_en desc);

alter table lotes_importacion enable row level security;
-- Dueño y administración ven los lotes (qué viajes son importados). Solo el
-- dueño importa; anular es con anular_lote().
create policy lotes_leer on lotes_importacion for select using (es_admin(empresa_id));
create policy lotes_alta on lotes_importacion for insert with check (mi_rol(empresa_id) = 'dueno');

-- ---------- 2. Lote en viajes y costos ----------
alter table viajes
  add column lote_id uuid,
  add constraint viajes_lote_misma_empresa foreign key (empresa_id, lote_id) references lotes_importacion (empresa_id, id);
alter table costos
  add column lote_id uuid,
  add constraint costos_lote_misma_empresa foreign key (empresa_id, lote_id) references lotes_importacion (empresa_id, id);
create index on viajes (lote_id) where lote_id is not null;
create index on costos (lote_id) where lote_id is not null;

-- El lote solo lo pone importar_historico() (con esta señal local a la
-- transacción; set_config no está expuesta en la API) y no cambia después.
create function proteger_lote() returns trigger
language plpgsql set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    if new.lote_id is not null and current_setting('control_diesel.importar', true) is distinct from new.lote_id::text then
      raise exception 'Solo la importación asigna el lote' using errcode = 'insufficient_privilege';
    end if;
  elsif new.lote_id is distinct from old.lote_id then
    raise exception 'El lote de importación no se cambia' using errcode = 'insufficient_privilege';
  end if;
  return new;
end;
$$;
create trigger viajes_proteger_lote before insert or update on viajes
  for each row execute function proteger_lote();
create trigger costos_proteger_lote before insert or update on costos
  for each row execute function proteger_lote();

-- Un viaje importado y cancelado (p. ej. al anular su lote) libera su folio.
drop index viajes_folio_unico;
create unique index viajes_folio_unico on viajes (empresa_id, upper(folio))
  where estado <> 'cancelado' or lote_id is null;

-- ---------- 3. Tramos sin odómetros ----------
-- km deja de calcularse en la columna: lo calcula el trigger con los
-- odómetros, o se guarda tal cual en un tramo importado.
alter table tramos_viaje alter column km drop expression;
alter table tramos_viaje
  alter column odometro_inicial drop not null,
  alter column odometro_final drop not null,
  alter column km set not null,
  add constraint tramos_km_valido check (km >= 0),
  add constraint tramos_odometros_juntos check ((odometro_inicial is null) = (odometro_final is null));

create function calcular_km_tramo() returns trigger
language plpgsql set search_path = public as $$
begin
  if new.odometro_inicial is not null and new.odometro_final is not null then
    new.km := new.odometro_final - new.odometro_inicial;
  elsif new.odometro_inicial is null and new.odometro_final is null then
    if not exists (select 1 from viajes where id = new.viaje_id and lote_id is not null) then
      raise exception 'Faltan los odómetros del tramo';
    end if;
    if new.km is null then
      raise exception 'Faltan los km del tramo';
    end if;
  else
    raise exception 'Faltan los odómetros del tramo';
  end if;
  return new;
end;
$$;
create trigger tramos_calcular_km before insert or update on tramos_viaje
  for each row execute function calcular_km_tramo();

-- ---------- 4. Toneladas con kilos ----------
alter table viajes
  alter column toneladas_cargadas type numeric(8,3),
  alter column toneladas_descargadas type numeric(8,3);

-- ---------- Reglas del viaje: anular un lote cancela sus viajes cerrados ----------
create or replace function controlar_viaje() returns trigger
language plpgsql set search_path = public as $$
declare
  v_anulando boolean := tg_op = 'UPDATE' and old.lote_id is not null
    and current_setting('control_diesel.anular_lote', true) = old.lote_id::text;
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

  -- anular_lote() cancela los viajes del lote, abiertos o cerrados.
  if new.estado = 'cancelado' and v_anulando then
    new.cancelado_por := auth.uid();
    new.cancelado_en := now();
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

-- ---------- 5. Importar ----------
-- security invoker: aplica la RLS y todos los triggers (folios, bitácora,
-- viaje cerrado, validación de cargas). Solo el dueño importa: el lote trae
-- tarifas, pago al operador y costos. La app ya validó y resolvió unidades y
-- nombres de catálogos; aquí se dan de alta operadores, clientes, fuentes y
-- categorías que falten y se guarda todo o nada.
create function importar_historico(p_empresa uuid, p_lote jsonb) returns jsonb
language plpgsql security invoker set search_path = public as $$
declare
  v_lote uuid := gen_random_uuid();
  x jsonb;
  g jsonb;
  v_viaje uuid;
  v_salida timestamptz;
  v_armado uuid;
  v_carga uuid;
  v_viajes int := 0;
  v_omitidos int := 0;
  v_costos int := 0;
  v_costos_omitidos int := 0;
begin
  if mi_rol(p_empresa) is distinct from 'dueno' then
    raise exception 'Solo el dueño importa viajes históricos' using errcode = 'insufficient_privilege';
  end if;
  insert into lotes_importacion (id, empresa_id, archivo) values (v_lote, p_empresa, coalesce(p_lote->>'archivo', 'Excel'));
  perform set_config('control_diesel.importar', v_lote::text, true);

  -- Catálogos que falten (los nombres ya vienen como están en el catálogo si existen).
  insert into operadores (empresa_id, nombre)
  select distinct p_empresa, btrim(v->>'operador') from jsonb_array_elements(coalesce(p_lote->'viajes', '[]')) v
  on conflict do nothing;
  insert into clientes (empresa_id, nombre)
  select distinct p_empresa, btrim(v->>'cliente') from jsonb_array_elements(coalesce(p_lote->'viajes', '[]')) v
  where nullif(btrim(v->>'cliente'), '') is not null
  on conflict do nothing;
  insert into fuentes_diesel (empresa_id, nombre, tipo, tiene_factura)
  select distinct on (lower(btrim(v->'carga'->>'fuente'))) p_empresa, btrim(v->'carga'->>'fuente'), 'tarjeta', (v->'carga'->>'tiene_factura')::boolean
  from jsonb_array_elements(coalesce(p_lote->'viajes', '[]')) v
  where jsonb_typeof(v->'carga') = 'object'
  on conflict do nothing;
  insert into categorias_gasto (empresa_id, nombre, tiene_factura)
  select distinct on (lower(btrim(c->>'categoria'))) p_empresa, btrim(c->>'categoria'), (c->>'tiene_factura')::boolean
  from jsonb_array_elements(coalesce(p_lote->'viajes', '[]')) v, jsonb_array_elements(coalesce(v->'gastos', '[]')) c
  on conflict do nothing;
  insert into categorias_costo (empresa_id, nombre)
  select distinct p_empresa, btrim(c->>'categoria') from jsonb_array_elements(coalesce(p_lote->'costos', '[]')) c
  on conflict do nothing;

  for x in select * from jsonb_array_elements(coalesce(p_lote->'viajes', '[]')) loop
    -- Un folio que ya ocupa otro viaje no se sobrescribe.
    if exists (
      select 1 from viajes
      where empresa_id = p_empresa and upper(folio) = upper(btrim(x->>'folio')) and (estado <> 'cancelado' or lote_id is null)
    ) then
      v_omitidos := v_omitidos + 1;
      continue;
    end if;
    -- Sin horas en el Excel: salida y llegada ese día a mediodía (hora del centro).
    v_salida := ((x->>'dia') || ' 12:00:00-06')::timestamptz;
    select id into v_armado from armados
    where unidad_id = (x->>'unidad_id')::uuid and desde <= v_salida and (hasta is null or hasta > v_salida)
    limit 1;
    insert into viajes (empresa_id, folio, unidad_id, operador_id, cliente_id, armado_id, toneladas_cargadas,
                        fecha_salida, fecha_llegada, remisiones, factura_cliente, notas, lote_id)
    values (
      p_empresa, btrim(x->>'folio'), (x->>'unidad_id')::uuid,
      (select id from operadores where empresa_id = p_empresa and lower(btrim(nombre)) = lower(btrim(x->>'operador'))),
      (select id from clientes where empresa_id = p_empresa and lower(btrim(nombre)) = lower(btrim(x->>'cliente'))),
      v_armado, (x->>'toneladas')::numeric, v_salida, v_salida,
      coalesce(array(select jsonb_array_elements_text(x->'remisiones')), '{}'),
      nullif(btrim(coalesce(x->>'factura_cliente', '')), ''), x->>'notas', v_lote)
    returning id into v_viaje;

    insert into tramos_viaje (empresa_id, viaje_id, tipo, origen, destino, km) values
      (p_empresa, v_viaje, 'vacio', '(SIN DATO)', btrim(x->>'origen'), (x->>'km_vacio')::numeric),
      (p_empresa, v_viaje, 'cargado', btrim(x->>'origen'), btrim(x->>'destino'), (x->>'km_cargado')::numeric);

    if jsonb_typeof(x->'carga') = 'object' then
      insert into cargas_diesel (empresa_id, viaje_id, unidad_id, operador_id, fuente_id, fecha, litros, precio_litro,
                                 importe, tiene_factura, tasa_iva, iva)
      select p_empresa, v_viaje, (x->>'unidad_id')::uuid, v.operador_id,
             (select id from fuentes_diesel where empresa_id = p_empresa and lower(btrim(nombre)) = lower(btrim(x->'carga'->>'fuente'))),
             v_salida, (x->'carga'->>'litros')::numeric, (x->'carga'->>'precio_litro')::numeric, (x->'carga'->>'importe')::numeric,
             (x->'carga'->>'tiene_factura')::boolean, 16, (x->'carga'->>'iva')::numeric
      from viajes v where v.id = v_viaje
      returning id into v_carga;
      -- Ya se pagó: la valida el dueño que importa (queda como autovalidada).
      update cargas_diesel set estado = 'validada' where id = v_carga;
    end if;

    for g in select * from jsonb_array_elements(coalesce(x->'gastos', '[]')) loop
      insert into gastos_viaje (empresa_id, viaje_id, fecha, categoria_id, monto, tiene_factura, tasa_iva, iva, forma_pago, notas)
      values (
        p_empresa, v_viaje, (x->>'dia')::date,
        (select id from categorias_gasto where empresa_id = p_empresa and lower(btrim(nombre)) = lower(btrim(g->>'categoria'))),
        (g->>'monto')::numeric, (g->>'tiene_factura')::boolean, 16, (g->>'iva')::numeric, 'otro', g->>'notas');
    end loop;

    if x->>'tarifa' is not null then
      -- El pago por defecto (trigger) toma el esquema del operador o de la empresa.
      insert into viajes_finanzas (viaje_id, empresa_id, tipo_tarifa, tarifa, factura_por)
      values (v_viaje, p_empresa, 'por_tonelada', (x->>'tarifa')::numeric, 'cargado');
    end if;
    if x->>'pago_manual' is not null then
      insert into viajes_pago (viaje_id, empresa_id, esquema, pago_operador_manual)
      values (v_viaje, p_empresa, 'fijo', (x->>'pago_manual')::numeric)
      on conflict (viaje_id) do update set pago_operador_manual = excluded.pago_operador_manual;
    end if;

    update viajes set estado = 'cerrado' where id = v_viaje;
    v_viajes := v_viajes + 1;
  end loop;

  for x in select * from jsonb_array_elements(coalesce(p_lote->'costos', '[]')) loop
    -- Misma unidad, mes y categoría de un lote anterior vigente: no se duplica.
    if exists (
      select 1 from costos c join categorias_costo k on k.id = c.categoria_id
      where c.empresa_id = p_empresa and c.unidad_id = (x->>'unidad_id')::uuid and c.mes = (x->>'mes')::date
        and lower(btrim(k.nombre)) = lower(btrim(x->>'categoria')) and c.lote_id is not null and not c.cancelado
    ) then
      v_costos_omitidos := v_costos_omitidos + 1;
      continue;
    end if;
    insert into costos (empresa_id, fecha, mes, meses, categoria_id, monto, tiene_factura, tasa_iva, iva, unidad_id, notas, lote_id)
    values (
      p_empresa, (x->>'mes')::date, (x->>'mes')::date, 1,
      (select id from categorias_costo where empresa_id = p_empresa and lower(btrim(nombre)) = lower(btrim(x->>'categoria'))),
      (x->>'monto')::numeric, true, 16, (x->>'iva')::numeric, (x->>'unidad_id')::uuid, x->>'notas', v_lote);
    v_costos := v_costos + 1;
  end loop;

  perform set_config('control_diesel.importar', '', true);
  if v_viajes = 0 and v_costos = 0 then
    raise exception 'No hay nada nuevo que importar';
  end if;
  return jsonb_build_object('lote', v_lote, 'viajes', v_viajes, 'omitidos', v_omitidos,
                            'costos', v_costos, 'costos_omitidos', v_costos_omitidos);
end;
$$;

-- Anular un lote: cancela sus viajes y sus costos, con motivo. security
-- definer: deja el motivo en la bitácora, que nadie edita directo. Solo el dueño.
create function anular_lote(p_lote uuid, p_motivo text) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_empresa uuid;
  v_anulado timestamptz;
  v_motivo text := btrim(coalesce(p_motivo, ''));
begin
  select empresa_id, anulado_en into v_empresa, v_anulado from lotes_importacion where id = p_lote;
  if v_empresa is null then
    raise exception 'Lote no encontrado';
  end if;
  if mi_rol(v_empresa) is distinct from 'dueno' then
    raise exception 'Solo el dueño anula una importación' using errcode = 'insufficient_privilege';
  end if;
  if v_anulado is not null then
    raise exception 'El lote ya está anulado';
  end if;
  if length(v_motivo) < 5 then
    raise exception 'Escribe el motivo de la anulación';
  end if;
  if exists (select 1 from cargas_diesel c join viajes v on v.id = c.viaje_id where v.lote_id = p_lote and v.estado <> 'cancelado' and c.estado = 'pendiente') then
    raise exception 'No se puede anular: hay cargas pendientes en viajes del lote; valídalas o recházalas';
  end if;
  perform set_config('control_diesel.anular_lote', p_lote::text, true);
  update viajes set estado = 'cancelado', motivo_cancelacion = 'Importación anulada: ' || v_motivo
  where lote_id = p_lote and estado <> 'cancelado';
  perform set_config('control_diesel.anular_lote', '', true);
  update bitacora set nota = 'Importación anulada: ' || v_motivo
  where tabla = 'viajes' and accion = 'cancelacion' and en = now() and usuario_id = auth.uid()
    and viaje_id in (select id from viajes where lote_id = p_lote);
  update costos set cancelado = true where lote_id = p_lote and not cancelado;
  update lotes_importacion set anulado_en = now(), anulado_por = auth.uid(), motivo_anulacion = v_motivo where id = p_lote;
end;
$$;

revoke execute on function proteger_lote() from public, anon, authenticated;
revoke execute on function calcular_km_tramo() from public, anon, authenticated;
revoke execute on function controlar_viaje() from public, anon, authenticated;
revoke execute on function importar_historico(uuid, jsonb) from public, anon;
grant execute on function importar_historico(uuid, jsonb) to authenticated;
revoke execute on function anular_lote(uuid, text) from public, anon;
grant execute on function anular_lote(uuid, text) to authenticated;
