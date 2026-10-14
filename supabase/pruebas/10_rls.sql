-- Pruebas de aislamiento entre empresas y permisos por rol. Cada línea debe salir OK o con el valor esperado.
\set QUIET on
insert into auth.users values
 ('00000000-0000-0000-0000-0000000000a1','duenoA'),
 ('00000000-0000-0000-0000-0000000000a2','operadorA'),
 ('00000000-0000-0000-0000-0000000000b1','duenoB');
create temp table ctx (k text primary key, v uuid);
grant all on ctx to authenticated;

set role authenticated;
-- Dueño A arma su empresa
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000a1',false);
insert into ctx values ('empA', crear_empresa('URMA prueba'));
insert into operadores (empresa_id, nombre) select v,'Juan' from ctx where k='empA' returning id \gset opA_
insert into ctx values ('opA', :'opA_id');
insert into unidades (empresa_id, numero_economico) select v,'0708' from ctx where k='empA';
insert into fuentes_diesel (empresa_id, nombre, tipo) select v,'Tanque La Barca','tanque_propio' from ctx where k='empA' returning id \gset fA_
insert into ctx values ('fA', :'fA_id');
insert into clientes (empresa_id, nombre) select v,'Agro SA' from ctx where k='empA';
insert into miembros (empresa_id, usuario_id, rol, operador_id)
  select (select v from ctx where k='empA'), '00000000-0000-0000-0000-0000000000a2','operador',(select v from ctx where k='opA');

-- Dueño B arma la suya
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000b1',false);
insert into ctx values ('empB', crear_empresa('Otra flotilla'));
insert into unidades (empresa_id, numero_economico) select v,'B-01' from ctx where k='empB';
\set QUIET off

do $$
declare n int; e uuid := (select v from ctx where k='empA'); o uuid := (select v from ctx where k='opA');
  f uuid := (select v from ctx where k='fA'); u uuid;
  procedure_ok boolean;
begin
  -- 1. Dueño B no ve unidades de A
  perform set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000b1',false);
  select count(*) into n from unidades; raise notice '1 B ve solo sus unidades (esperado 1): %', n;
  -- 2. Dueño B no puede escribir en A
  begin insert into unidades (empresa_id, numero_economico) values (e,'HACK');
    raise notice '2 FALLA: B insertó en A';
  exception when insufficient_privilege then raise notice '2 OK: B bloqueado al insertar en A'; end;

  -- 3. Dueño A ve lo suyo
  perform set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000a1',false);
  select count(*) into n from unidades; raise notice '3 A ve sus unidades (esperado 1): %', n;
  select id into u from unidades limit 1;

  -- 4. Operador A captura carga propia desde la app
  perform set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000a2',false);
  insert into cargas_diesel (empresa_id, unidad_id, operador_id, fuente_id, litros, origen, estado)
    values (e,u,o,f,350,'app','pendiente');
  raise notice '4 OK: operador capturó su carga';
  -- 5. Operador no puede auto-validar
  begin insert into cargas_diesel (empresa_id, unidad_id, operador_id, fuente_id, litros, origen, estado)
    values (e,u,o,f,350,'app','validada'); raise notice '5 FALLA: operador validó su propia carga';
  exception when insufficient_privilege then raise notice '5 OK: operador no puede validar'; end;
  -- 6. Operador no ve clientes
  select count(*) into n from clientes; raise notice '6 operador ve clientes (esperado 0): %', n;
  -- 7. Operador no puede dar de alta usuarios
  begin insert into miembros (empresa_id, usuario_id, rol) values (e,'00000000-0000-0000-0000-0000000000b1','dueno');
    raise notice '7 FALLA: operador agregó miembro';
  exception when insufficient_privilege then raise notice '7 OK: operador no administra usuarios'; end;
  -- 8. Operador no edita la carga después
  update cargas_diesel set litros = 10; get diagnostics n = row_count;
  raise notice '8 filas que el operador pudo editar (esperado 0): %', n;

  -- 9. Dueño B no ve cargas de A
  perform set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000b1',false);
  select count(*) into n from cargas_diesel; raise notice '9 B ve cargas de A (esperado 0): %', n;
  -- 10. Sin sesión no se ve nada
  perform set_config('request.jwt.claim.sub','',false);
  select count(*) into n from empresas; raise notice '10 sin sesión ve empresas (esperado 0): %', n;
end $$;
