-- =====================================================================
-- Control Diésel — catálogos
-- 1. Clientes y rutas también se desactivan (los registros con historial no
--    se borran: las llaves foráneas de viajes y cargas ya lo impiden).
-- 2. Sin duplicados por empresa, sin importar mayúsculas ni espacios: es lo
--    que usa el importador para detectar repetidos.
-- 3. Validaciones mínimas que la pantalla también aplica.
-- =====================================================================

-- ---------- 1. Activo / inactivo ----------
alter table clientes add column activo boolean not null default true;
alter table rutas    add column activa boolean not null default true;

-- ---------- 2. Duplicados ----------
create unique index unidades_numero_economico_unico on unidades (empresa_id, upper(btrim(numero_economico)));
create unique index operadores_nombre_unico on operadores (empresa_id, lower(btrim(nombre)));
create unique index clientes_nombre_unico on clientes (empresa_id, lower(btrim(nombre)));
create unique index rutas_origen_destino_unico on rutas (empresa_id, lower(btrim(origen)), lower(btrim(destino)));
create unique index fuentes_diesel_nombre_unico on fuentes_diesel (empresa_id, lower(btrim(nombre)));

-- ---------- 3. Validaciones ----------
alter table unidades
  add constraint unidades_numero_valido check (length(btrim(numero_economico)) between 1 and 20),
  add constraint unidades_anio_valido check (anio is null or anio between 1950 and 2100);
alter table operadores add constraint operadores_nombre_valido check (length(btrim(nombre)) between 2 and 120);
alter table clientes   add constraint clientes_nombre_valido check (length(btrim(nombre)) between 2 and 120);
alter table rutas
  add constraint rutas_origen_valido check (length(btrim(origen)) between 2 and 120),
  add constraint rutas_destino_valido check (length(btrim(destino)) between 2 and 120);
alter table fuentes_diesel
  add constraint fuentes_nombre_valido check (length(btrim(nombre)) between 2 and 120),
  add constraint fuentes_capacidad_positiva check (capacidad_litros is null or capacidad_litros > 0);

-- Sin cambios de políticas: todos los miembros consultan catálogos y solo dueño
-- y administración los escriben (migraciones 20261014000000 y 20261015000200).
