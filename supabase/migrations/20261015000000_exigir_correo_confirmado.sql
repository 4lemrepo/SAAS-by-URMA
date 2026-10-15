-- =====================================================================
-- Control Diésel — exigir correo confirmado para dar de alta una empresa
-- La app ya bloquea a usuarios sin confirmar; esto cubre a quien llame a la
-- API de Supabase directo con una sesión de correo sin confirmar.
-- =====================================================================

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
  if not exists (select 1 from auth.users where id = auth.uid() and email_confirmed_at is not null) then
    raise exception 'Confirma tu correo antes de dar de alta una empresa';
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

-- create or replace conserva los permisos; se repiten por claridad.
revoke execute on function crear_empresa(text, text) from public, anon;
grant execute on function crear_empresa(text, text) to authenticated;
