-- =====================================================================
-- Control Diésel — costos de equipo y generales
-- Costos que no son de un viaje: mantenimiento, llantas, seguro,
-- financiamiento, GPS, permisos… (de un tracto, remolque o dolly) y costos
-- generales de la empresa (oficina, contador, renta de patio, sistemas) que
-- el tablero prorratea entre las unidades.
-- - Un costo de remolque o dolly cuenta para la unidad que lo traía
--   enganchado en la fecha del costo (lo calcula el tablero con el historial
--   de armados); si no estaba enganchado, va a "equipo sin asignar".
-- - Cada categoría decide si entra en la rentabilidad. "Sueldo y prestaciones
--   del operador" nace apagada: se registra pero no entra en los KPIs.
-- - Un costo puede repartirse en N meses (seguro anual).
-- =====================================================================

create table categorias_costo (
  id                       uuid primary key default gen_random_uuid(),
  empresa_id               uuid not null references empresas(id) on delete cascade,
  nombre                   text not null check (length(btrim(nombre)) between 2 and 60),
  incluir_en_rentabilidad  boolean not null default true,
  activo                   boolean not null default true,
  creado_en                timestamptz not null default now(),
  unique (empresa_id, id)
);
create unique index categorias_costo_nombre_unico on categorias_costo (empresa_id, lower(btrim(nombre)));

create function precargar_categorias_costo(p_empresa uuid) returns void
language sql security definer set search_path = public as $$
  insert into categorias_costo (empresa_id, nombre, incluir_en_rentabilidad)
  select p_empresa, nombre, nombre <> 'Sueldo y prestaciones del operador'
  from unnest(array[
    'Mantenimiento tracto', 'Mantenimiento equipo de arrastre', 'Llantas y rines', 'Seguro',
    'Financiamiento o arrendamiento', 'Sueldo y prestaciones del operador', 'GPS',
    'Permisos y verificaciones', 'Oficina', 'Contador', 'Renta de patio', 'Sistemas', 'Otros'
  ]) as nombre
  on conflict do nothing;
$$;
select precargar_categorias_costo(id) from empresas;

create table costos (
  id                  uuid primary key default gen_random_uuid(),
  empresa_id          uuid not null references empresas(id) on delete cascade,
  folio               text not null,
  fecha               date not null default current_date,
  -- Primer mes al que se aplica (día 1) y en cuántos meses se reparte
  mes                 date not null check (extract(day from mes) = 1),
  meses               int not null default 1 check (meses between 1 and 60),
  categoria_id        uuid not null,
  monto               numeric(12,2) not null check (monto > 0),
  proveedor           text check (proveedor is null or length(btrim(proveedor)) <= 120),
  numero_comprobante  text check (numero_comprobante is null or length(btrim(numero_comprobante)) <= 60),
  comprobante_path    text,
  -- A lo más un equipo; ninguno = costo general de la empresa
  unidad_id           uuid,
  remolque_id         uuid,
  dolly_id            uuid,
  notas               text,
  cancelado           boolean not null default false,
  capturado_por       uuid references auth.users(id),
  creado_en           timestamptz not null default now(),
  actualizado_en      timestamptz not null default now(),
  constraint costos_un_equipo check (num_nonnulls(unidad_id, remolque_id, dolly_id) <= 1),
  constraint costos_categoria_misma_empresa foreign key (empresa_id, categoria_id) references categorias_costo (empresa_id, id),
  constraint costos_unidad_misma_empresa foreign key (empresa_id, unidad_id) references unidades (empresa_id, id),
  constraint costos_remolque_misma_empresa foreign key (empresa_id, remolque_id) references remolques (empresa_id, id),
  constraint costos_dolly_misma_empresa foreign key (empresa_id, dolly_id) references dollies (empresa_id, id)
);
create unique index costos_folio_unico on costos (empresa_id, upper(folio));
create index on costos (empresa_id, mes);
create index on costos (unidad_id);

create trigger costos_asignar_folio before insert or update on costos
  for each row execute function asignar_folio('costo');
create trigger costos_fijar_capturado_por before insert or update on costos
  for each row execute function fijar_capturado_por();
create trigger costos_bitacora after insert or update on costos
  for each row execute function registrar_bitacora();
create trigger categorias_costo_bitacora after insert or update on categorias_costo
  for each row execute function registrar_bitacora();

create function marcar_actualizado() returns trigger
language plpgsql set search_path = public as $$
begin
  new.actualizado_en := now();
  return new;
end;
$$;
create trigger costos_actualizado before update on costos
  for each row execute function marcar_actualizado();

-- Cómo se prorratean los costos generales entre las unidades del mes.
alter table parametros_empresa
  add column prorrateo_generales text not null default 'partes_iguales'
    check (prorrateo_generales in ('partes_iguales', 'km'));

create or replace function inicializar_empresa() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform precargar_tipos_remolque(new.id);
  perform precargar_categorias_gasto(new.id);
  perform precargar_categorias_costo(new.id);
  insert into parametros_empresa (empresa_id) values (new.id) on conflict do nothing;
  insert into pago_operador_config (empresa_id, esquema, pct) values (new.id, 'pct_subtotal', 12.6) on conflict do nothing;
  return new;
end;
$$;

-- Los costos son pesos: solo dueño y administración. Nada se borra (se cancela).
alter table categorias_costo enable row level security;
alter table costos           enable row level security;

create policy categorias_costo_leer on categorias_costo for select using (es_admin(empresa_id));
create policy categorias_costo_alta on categorias_costo for insert with check (es_admin(empresa_id));
create policy categorias_costo_editar on categorias_costo for update using (es_admin(empresa_id)) with check (es_admin(empresa_id));

create policy costos_leer on costos for select using (es_admin(empresa_id));
create policy costos_alta on costos for insert with check (es_admin(empresa_id));
create policy costos_editar on costos for update using (es_admin(empresa_id)) with check (es_admin(empresa_id));

revoke execute on function precargar_categorias_costo(uuid) from public, anon, authenticated;
revoke execute on function inicializar_empresa() from public, anon, authenticated;
revoke execute on function marcar_actualizado() from public, anon, authenticated;
