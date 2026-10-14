-- =====================================================================
-- Control Diésel — endurecimiento de seguridad
-- 1. Llaves foráneas por empresa: una fila solo puede apuntar a catálogos
--    de su misma empresa (antes B podía ligar su viaje a una unidad de A).
-- 2. capturado_por lo fija la base de datos, no el cliente.
-- 3. Una empresa nunca se queda sin dueño.
-- 4. Fotos de tickets: el operador solo ve las que él subió; límites de
--    tamaño y tipo de archivo en el bucket.
-- 5. crear_empresa valida datos; las funciones no se exponen a anon.
-- =====================================================================

-- ---------- 1. Llaves foráneas por empresa ----------
alter table operadores     add constraint operadores_empresa_id_id_key     unique (empresa_id, id);
alter table unidades       add constraint unidades_empresa_id_id_key       unique (empresa_id, id);
alter table clientes       add constraint clientes_empresa_id_id_key       unique (empresa_id, id);
alter table rutas          add constraint rutas_empresa_id_id_key          unique (empresa_id, id);
alter table fuentes_diesel add constraint fuentes_diesel_empresa_id_id_key unique (empresa_id, id);
alter table viajes         add constraint viajes_empresa_id_id_key         unique (empresa_id, id);

alter table miembros add constraint miembros_operador_misma_empresa
  foreign key (empresa_id, operador_id) references operadores (empresa_id, id)
  on delete set null (operador_id);

alter table viajes
  add constraint viajes_unidad_misma_empresa
    foreign key (empresa_id, unidad_id) references unidades (empresa_id, id),
  add constraint viajes_operador_misma_empresa
    foreign key (empresa_id, operador_id) references operadores (empresa_id, id),
  add constraint viajes_cliente_misma_empresa
    foreign key (empresa_id, cliente_id) references clientes (empresa_id, id),
  add constraint viajes_ruta_misma_empresa
    foreign key (empresa_id, ruta_id) references rutas (empresa_id, id);

alter table cargas_diesel
  add constraint cargas_viaje_misma_empresa
    foreign key (empresa_id, viaje_id) references viajes (empresa_id, id)
    on delete set null (viaje_id),
  add constraint cargas_unidad_misma_empresa
    foreign key (empresa_id, unidad_id) references unidades (empresa_id, id),
  add constraint cargas_operador_misma_empresa
    foreign key (empresa_id, operador_id) references operadores (empresa_id, id),
  add constraint cargas_fuente_misma_empresa
    foreign key (empresa_id, fuente_id) references fuentes_diesel (empresa_id, id);

alter table movimientos_tanque add constraint movimientos_fuente_misma_empresa
  foreign key (empresa_id, fuente_id) references fuentes_diesel (empresa_id, id);

-- El operador solo puede ligar una carga a un viaje suyo y abierto.
drop policy cargas_alta_operador on cargas_diesel;
create policy cargas_alta_operador on cargas_diesel for insert with check (
  mi_rol(empresa_id) = 'operador'
  and operador_id = mi_operador(empresa_id)
  and origen = 'app'
  and estado = 'pendiente'
  and (viaje_id is null or exists (
    select 1 from viajes v
    where v.id = viaje_id and v.operador_id = mi_operador(empresa_id) and v.estado = 'abierto'
  ))
);

-- ---------- 2. capturado_por lo pone la base de datos ----------
create function fijar_capturado_por() returns trigger
language plpgsql set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    new.capturado_por := auth.uid();
  else
    new.capturado_por := old.capturado_por;
  end if;
  return new;
end;
$$;

create trigger cargas_fijar_capturado_por
  before insert or update on cargas_diesel
  for each row execute function fijar_capturado_por();

-- ---------- 3. Siempre al menos un dueño ----------
create function proteger_ultimo_dueno() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  -- Si la empresa se está borrando (cascade), no hay nada que proteger.
  if not exists (select 1 from empresas where id = old.empresa_id) then
    return coalesce(new, old);
  end if;
  if old.rol = 'dueno'
     and (tg_op = 'DELETE' or new.rol <> 'dueno' or new.empresa_id <> old.empresa_id)
     and not exists (
       select 1 from miembros
       where empresa_id = old.empresa_id and rol = 'dueno' and usuario_id <> old.usuario_id
     ) then
    raise exception 'La empresa debe conservar al menos un dueño';
  end if;
  return coalesce(new, old);
end;
$$;

create trigger miembros_proteger_ultimo_dueno
  before update or delete on miembros
  for each row execute function proteger_ultimo_dueno();

-- ---------- 4. Fotos de tickets ----------
update storage.buckets
set file_size_limit = 5242880, -- 5 MB
    allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp', 'image/heic']
where id = 'tickets';

drop policy tickets_leer on storage.objects;
create policy tickets_leer on storage.objects for select using (
  bucket_id = 'tickets'
  and (
    es_admin(((storage.foldername(name))[1])::uuid)
    or (owner_id = auth.uid()::text and mi_rol(((storage.foldername(name))[1])::uuid) is not null)
  )
);

-- ---------- 5. Validaciones y permisos de funciones ----------
alter table empresas
  add constraint empresas_nombre_valido check (length(btrim(nombre)) between 2 and 120),
  add constraint empresas_tolerancia_max check (tolerancia_pct <= 100),
  add constraint empresas_precio_positivo check (precio_diesel_litro is null or precio_diesel_litro > 0);

create or replace function crear_empresa(p_nombre text, p_rfc text default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
  v_nombre text := btrim(coalesce(p_nombre, ''));
  v_rfc text := nullif(upper(btrim(coalesce(p_rfc, ''))), '');
begin
  if auth.uid() is null then
    raise exception 'Se requiere sesión iniciada';
  end if;
  if length(v_nombre) not between 2 and 120 then
    raise exception 'El nombre de la empresa debe tener entre 2 y 120 caracteres';
  end if;
  if v_rfc is not null and v_rfc !~ '^[A-ZÑ&]{3,4}[0-9]{6}[A-Z0-9]{3}$' then
    raise exception 'RFC inválido';
  end if;
  -- Evita que una cuenta cree empresas sin límite.
  if (select count(*) from miembros where usuario_id = auth.uid() and rol = 'dueno') >= 5 then
    raise exception 'Límite de empresas por cuenta alcanzado';
  end if;
  insert into empresas (nombre, rfc) values (v_nombre, v_rfc) returning id into v_id;
  insert into miembros (empresa_id, usuario_id, rol) values (v_id, auth.uid(), 'dueno');
  return v_id;
end;
$$;

-- Supabase da EXECUTE a anon por defecto. crear_empresa solo tiene sentido con sesión;
-- los triggers no se llaman directo. (mi_rol/es_admin se dejan: las políticas los usan
-- y para anon devuelven null, o sea "sin acceso", en vez de lanzar error.)
revoke execute on function crear_empresa(text, text) from public, anon;
revoke execute on function fijar_capturado_por() from public, anon, authenticated;
revoke execute on function proteger_ultimo_dueno() from public, anon, authenticated;
grant execute on function crear_empresa(text, text) to authenticated;
