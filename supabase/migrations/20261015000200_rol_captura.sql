-- =====================================================================
-- Control Diésel — nuevo modelo de roles
-- El operador (chofer) ya no es usuario del sistema: solo es un registro del
-- catálogo `operadores`. Los usuarios son:
--   dueno          todo (usuarios, parámetros, catálogos, viajes, cargas, conciliación)
--   administracion catálogos, viajes, cargas y validación; no administra usuarios
--   captura        da de alta viajes y cargas con foto; consulta catálogos.
--                  No edita catálogos ni parámetros, no valida, no ve cargas ajenas.
-- Toda carga nace "pendiente"; la valida (o rechaza) dueño o administración,
-- y nunca quien la capturó.
-- =====================================================================

-- ---------- 1. Fuera lo pensado para que el chofer capture desde la app ----------
drop policy cargas_alta_operador on cargas_diesel;
drop policy cargas_leer on cargas_diesel;
drop policy viajes_leer on viajes;

alter table miembros drop constraint miembros_operador_misma_empresa;
-- Se lleva también el check (rol <> 'operador' or operador_id is not null).
alter table miembros drop column operador_id;
drop function mi_operador(uuid);

-- Si hubiera miembros con rol operador, pasan a captura.
alter type rol_miembro rename value 'operador' to 'captura';

-- "app" u "oficina" ya no distingue nada: todos capturan desde la misma app web.
alter table cargas_diesel drop column origen;
drop type origen_captura;

-- ---------- 2. Quién capturó y quién validó ----------
alter table viajes add column capturado_por uuid references auth.users(id);
create trigger viajes_fijar_capturado_por
  before insert or update on viajes
  for each row execute function fijar_capturado_por();

alter table cargas_diesel
  add column validado_por uuid references auth.users(id),
  add column validado_en  timestamptz;

-- Una carga nueva siempre queda pendiente. Al pasar a validada o rechazada se
-- registra quién y cuándo; quien la capturó no puede hacerlo.
create function controlar_validacion_carga() returns trigger
language plpgsql set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    if new.estado <> 'pendiente' then
      raise exception 'Una carga nueva queda pendiente hasta que otra persona la valide';
    end if;
    new.validado_por := null;
    new.validado_en := null;
    return new;
  end if;

  if new.estado is not distinct from old.estado then
    new.validado_por := old.validado_por;
    new.validado_en := old.validado_en;
  elsif new.estado = 'pendiente' then
    new.validado_por := null;
    new.validado_en := null;
  else
    if old.capturado_por = auth.uid() then
      raise exception 'Quien capturó la carga no puede validarla ni rechazarla';
    end if;
    new.validado_por := auth.uid();
    new.validado_en := now();
  end if;
  return new;
end;
$$;

create trigger cargas_controlar_validacion
  before insert or update on cargas_diesel
  for each row execute function controlar_validacion_carga();

revoke execute on function controlar_validacion_carga() from public, anon, authenticated;

-- ---------- 3. Políticas ----------
-- Catálogos: todos los miembros los consultan (captura elige cliente al dar de
-- alta un viaje); solo dueño y administración escriben (políticas *_escribir).
drop policy clientes_leer on clientes;
create policy clientes_leer on clientes for select using (mi_rol(empresa_id) is not null);

-- Viajes: todos los miembros los ven. Captura da de alta viajes abiertos y
-- corrige los suyos mientras sigan abiertos; cerrarlos es de dueño o administración.
create policy viajes_leer on viajes for select using (mi_rol(empresa_id) is not null);
create policy viajes_alta_captura on viajes for insert with check (
  mi_rol(empresa_id) = 'captura' and estado = 'abierto'
);
create policy viajes_editar_captura on viajes for update
  using (mi_rol(empresa_id) = 'captura' and capturado_por = auth.uid() and estado = 'abierto')
  with check (mi_rol(empresa_id) = 'captura' and estado = 'abierto');

-- Cargas: dueño y administración ven y editan todas (cargas_escribir_admin).
-- Captura ve solo las que capturó, las da de alta pendientes y las corrige
-- mientras sigan pendientes; solo puede ligarlas a viajes abiertos.
create policy cargas_leer on cargas_diesel for select using (
  es_admin(empresa_id)
  or (mi_rol(empresa_id) = 'captura' and capturado_por = auth.uid())
);
create policy cargas_alta_captura on cargas_diesel for insert with check (
  mi_rol(empresa_id) = 'captura'
  and estado = 'pendiente'
  and (viaje_id is null or exists (
    select 1 from viajes v where v.id = viaje_id and v.estado = 'abierto'
  ))
);
create policy cargas_editar_captura on cargas_diesel for update
  using (mi_rol(empresa_id) = 'captura' and capturado_por = auth.uid() and estado = 'pendiente')
  with check (
    mi_rol(empresa_id) = 'captura'
    and estado = 'pendiente'
    and (viaje_id is null or exists (
      select 1 from viajes v where v.id = viaje_id and v.estado = 'abierto'
    ))
  );

-- Sin cambios: empresas (parámetros) solo las edita el dueño; miembros solo el
-- dueño; movimientos de tanque solo dueño y administración; en el bucket de
-- tickets cada miembro sube a la carpeta de su empresa y captura ve solo sus fotos.
