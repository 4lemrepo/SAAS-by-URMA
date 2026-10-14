-- =====================================================================
-- Control Diésel — esquema inicial (MVP)
-- Multiempresa: cada fila pertenece a una empresa (transportista) y
-- Row Level Security garantiza que un usuario solo ve su empresa.
-- =====================================================================

-- ---------- Tipos ----------
create type rol_miembro as enum ('dueno', 'administracion', 'operador');
create type configuracion_unidad as enum ('sencillo', 'full');
create type tipo_fuente_diesel as enum ('tanque_propio', 'estacion', 'tarjeta');
create type estado_viaje as enum ('abierto', 'cerrado');
create type origen_captura as enum ('app', 'oficina');
create type estado_carga as enum ('pendiente', 'validada', 'rechazada');
create type tipo_movimiento_tanque as enum ('entrada_pipa', 'lectura_fisica', 'ajuste');

-- ---------- Empresas y usuarios ----------
create table empresas (
  id                   uuid primary key default gen_random_uuid(),
  nombre               text not null,
  rfc                  text,
  -- Parámetros de conciliación (editables por el dueño)
  tolerancia_pct       numeric(5,2) not null default 5 check (tolerancia_pct > 0),
  precio_diesel_litro  numeric(8,2),
  creado_en            timestamptz not null default now()
);

create table operadores (
  id          uuid primary key default gen_random_uuid(),
  empresa_id  uuid not null references empresas(id) on delete cascade,
  nombre      text not null,
  telefono    text,
  activo      boolean not null default true,
  creado_en   timestamptz not null default now()
);

create table miembros (
  empresa_id   uuid not null references empresas(id) on delete cascade,
  usuario_id   uuid not null references auth.users(id) on delete cascade,
  rol          rol_miembro not null,
  -- Si el usuario es operador, a qué operador del catálogo corresponde
  operador_id  uuid references operadores(id) on delete set null,
  creado_en    timestamptz not null default now(),
  primary key (empresa_id, usuario_id),
  check (rol <> 'operador' or operador_id is not null)
);

-- ---------- Catálogos ----------
create table unidades (
  id                 uuid primary key default gen_random_uuid(),
  empresa_id         uuid not null references empresas(id) on delete cascade,
  numero_economico   text not null,             -- p. ej. 0708
  placas             text,
  marca              text,
  modelo             text,
  anio               int,
  configuracion      configuracion_unidad not null default 'full',
  tipo_equipo        text,                      -- góndola granelera, jaula ganadera…
  -- Rendimiento esperado de la unidad en km/l (se puede sobrescribir por ruta)
  rend_cargado_kml   numeric(5,2) check (rend_cargado_kml > 0),
  rend_vacio_kml     numeric(5,2) check (rend_vacio_kml > 0),
  activa             boolean not null default true,
  creado_en          timestamptz not null default now(),
  unique (empresa_id, numero_economico)
);

create table clientes (
  id          uuid primary key default gen_random_uuid(),
  empresa_id  uuid not null references empresas(id) on delete cascade,
  nombre      text not null,
  rfc         text,
  creado_en   timestamptz not null default now()
);

create table rutas (
  id                 uuid primary key default gen_random_uuid(),
  empresa_id         uuid not null references empresas(id) on delete cascade,
  origen             text not null,
  destino            text not null,
  km                 numeric(8,1) not null check (km > 0),
  -- Opcional: rendimiento esperado específico de esta ruta (sierra, carga pesada…)
  rend_cargado_kml   numeric(5,2) check (rend_cargado_kml > 0),
  rend_vacio_kml     numeric(5,2) check (rend_vacio_kml > 0),
  creado_en          timestamptz not null default now()
);

create table fuentes_diesel (
  id                uuid primary key default gen_random_uuid(),
  empresa_id        uuid not null references empresas(id) on delete cascade,
  nombre            text not null,              -- "Tanque La Barca", "Gasolinera X"
  tipo              tipo_fuente_diesel not null,
  capacidad_litros  numeric(10,1),
  activa            boolean not null default true,
  creado_en         timestamptz not null default now()
);

-- ---------- Operación ----------
-- Un viaje incluye el tramo cargado y el reposicionamiento vacío,
-- para poder medir km vacíos y calcular litros teóricos de ambos.
create table viajes (
  id                uuid primary key default gen_random_uuid(),
  empresa_id        uuid not null references empresas(id) on delete cascade,
  folio             text,
  unidad_id         uuid not null references unidades(id),
  operador_id       uuid not null references operadores(id),
  cliente_id        uuid references clientes(id),
  ruta_id           uuid references rutas(id),
  toneladas         numeric(6,2),
  fecha_salida      timestamptz not null,
  fecha_llegada     timestamptz,
  odometro_salida   numeric(10,1),
  odometro_llegada  numeric(10,1),
  km_cargado        numeric(8,1) not null default 0 check (km_cargado >= 0),
  km_vacio          numeric(8,1) not null default 0 check (km_vacio >= 0),
  estado            estado_viaje not null default 'abierto',
  notas             text,
  creado_en         timestamptz not null default now(),
  check (odometro_llegada is null or odometro_salida is null or odometro_llegada >= odometro_salida)
);

create table cargas_diesel (
  id                uuid primary key default gen_random_uuid(),
  empresa_id        uuid not null references empresas(id) on delete cascade,
  viaje_id          uuid references viajes(id) on delete set null,
  unidad_id         uuid not null references unidades(id),
  operador_id       uuid not null references operadores(id),
  fuente_id         uuid not null references fuentes_diesel(id),
  fecha             timestamptz not null default now(),
  litros            numeric(8,2) not null check (litros > 0),
  precio_litro      numeric(8,2),
  importe           numeric(12,2),
  odometro          numeric(10,1),
  folio_ticket      text,
  foto_ticket_path  text,                       -- ruta en Storage: <empresa_id>/<archivo>
  latitud           numeric(9,6),
  longitud          numeric(9,6),
  origen            origen_captura not null default 'oficina',
  estado            estado_carga not null default 'pendiente',
  capturado_por     uuid references auth.users(id) default auth.uid(),
  creado_en         timestamptz not null default now()
);

-- Entradas de pipa y lecturas físicas de los tanques propios.
-- Los despachos del tanque son las cargas_diesel cuya fuente es ese tanque.
create table movimientos_tanque (
  id            uuid primary key default gen_random_uuid(),
  empresa_id    uuid not null references empresas(id) on delete cascade,
  fuente_id     uuid not null references fuentes_diesel(id),
  fecha         timestamptz not null default now(),
  tipo          tipo_movimiento_tanque not null,
  litros        numeric(10,2) not null,         -- en lectura_fisica: litros medidos en el tanque
  precio_litro  numeric(8,2),
  folio_factura text,
  notas         text,
  creado_en     timestamptz not null default now()
);

-- ---------- Índices ----------
create index on miembros (usuario_id);
create index on operadores (empresa_id);
create index on unidades (empresa_id);
create index on clientes (empresa_id);
create index on rutas (empresa_id);
create index on fuentes_diesel (empresa_id);
create index on viajes (empresa_id, fecha_salida desc);
create index on viajes (unidad_id);
create index on viajes (operador_id);
create index on cargas_diesel (empresa_id, fecha desc);
create index on cargas_diesel (viaje_id);
create index on cargas_diesel (unidad_id);
create index on movimientos_tanque (fuente_id, fecha desc);

-- ---------- Funciones de apoyo para RLS ----------
-- security definer: leen miembros sin pasar por su propia RLS (evita recursión).
create function mi_rol(p_empresa uuid) returns rol_miembro
language sql stable security definer set search_path = public as $$
  select rol from miembros where empresa_id = p_empresa and usuario_id = auth.uid()
$$;

create function mi_operador(p_empresa uuid) returns uuid
language sql stable security definer set search_path = public as $$
  select operador_id from miembros where empresa_id = p_empresa and usuario_id = auth.uid()
$$;

create function es_admin(p_empresa uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(mi_rol(p_empresa) in ('dueno', 'administracion'), false)
$$;

-- Alta de empresa: crea la empresa y registra a quien la crea como dueño.
create function crear_empresa(p_nombre text, p_rfc text default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Se requiere sesión iniciada';
  end if;
  insert into empresas (nombre, rfc) values (p_nombre, p_rfc) returning id into v_id;
  insert into miembros (empresa_id, usuario_id, rol) values (v_id, auth.uid(), 'dueno');
  return v_id;
end;
$$;

-- ---------- Row Level Security ----------
alter table empresas           enable row level security;
alter table miembros           enable row level security;
alter table operadores         enable row level security;
alter table unidades           enable row level security;
alter table clientes           enable row level security;
alter table rutas              enable row level security;
alter table fuentes_diesel     enable row level security;
alter table viajes             enable row level security;
alter table cargas_diesel      enable row level security;
alter table movimientos_tanque enable row level security;

-- Empresas: los miembros la ven; solo el dueño la edita. El alta es vía crear_empresa().
create policy empresas_leer on empresas for select using (mi_rol(id) is not null);
create policy empresas_editar on empresas for update
  using (mi_rol(id) = 'dueno') with check (mi_rol(id) = 'dueno');

-- Miembros: se ven entre sí dentro de la empresa; solo el dueño los administra.
create policy miembros_leer on miembros for select using (mi_rol(empresa_id) is not null);
create policy miembros_alta on miembros for insert with check (mi_rol(empresa_id) = 'dueno');
create policy miembros_editar on miembros for update
  using (mi_rol(empresa_id) = 'dueno') with check (mi_rol(empresa_id) = 'dueno');
create policy miembros_baja on miembros for delete using (mi_rol(empresa_id) = 'dueno');

-- Catálogos: todos los miembros leen (el operador elige unidad y ruta en la app);
-- solo dueño y administración escriben.
create policy operadores_leer on operadores for select using (mi_rol(empresa_id) is not null);
create policy operadores_escribir on operadores for all
  using (es_admin(empresa_id)) with check (es_admin(empresa_id));

create policy unidades_leer on unidades for select using (mi_rol(empresa_id) is not null);
create policy unidades_escribir on unidades for all
  using (es_admin(empresa_id)) with check (es_admin(empresa_id));

create policy clientes_leer on clientes for select using (es_admin(empresa_id));
create policy clientes_escribir on clientes for all
  using (es_admin(empresa_id)) with check (es_admin(empresa_id));

create policy rutas_leer on rutas for select using (mi_rol(empresa_id) is not null);
create policy rutas_escribir on rutas for all
  using (es_admin(empresa_id)) with check (es_admin(empresa_id));

create policy fuentes_leer on fuentes_diesel for select using (mi_rol(empresa_id) is not null);
create policy fuentes_escribir on fuentes_diesel for all
  using (es_admin(empresa_id)) with check (es_admin(empresa_id));

-- Viajes: administración ve todo; el operador solo los suyos.
create policy viajes_leer on viajes for select using (
  es_admin(empresa_id) or operador_id = mi_operador(empresa_id)
);
create policy viajes_escribir on viajes for all
  using (es_admin(empresa_id)) with check (es_admin(empresa_id));

-- Cargas: administración ve y edita todo; el operador ve las suyas y solo
-- puede dar de alta cargas propias, desde la app y en estado pendiente.
create policy cargas_leer on cargas_diesel for select using (
  es_admin(empresa_id) or operador_id = mi_operador(empresa_id)
);
create policy cargas_alta_operador on cargas_diesel for insert with check (
  mi_rol(empresa_id) = 'operador'
  and operador_id = mi_operador(empresa_id)
  and origen = 'app'
  and estado = 'pendiente'
);
create policy cargas_escribir_admin on cargas_diesel for all
  using (es_admin(empresa_id)) with check (es_admin(empresa_id));

-- Movimientos de tanque: solo administración.
create policy tanque_admin on movimientos_tanque for all
  using (es_admin(empresa_id)) with check (es_admin(empresa_id));

-- ---------- Storage: fotos de tickets ----------
-- Bucket privado; cada archivo vive bajo una carpeta con el id de la empresa.
insert into storage.buckets (id, name, public) values ('tickets', 'tickets', false)
on conflict (id) do nothing;

create policy tickets_leer on storage.objects for select using (
  bucket_id = 'tickets'
  and mi_rol(((storage.foldername(name))[1])::uuid) is not null
);
create policy tickets_subir on storage.objects for insert with check (
  bucket_id = 'tickets'
  and mi_rol(((storage.foldername(name))[1])::uuid) is not null
);
