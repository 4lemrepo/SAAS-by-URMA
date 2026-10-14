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

-- ---------- Endurecimiento (migración 20261014000100) ----------
do $$
declare n int; t text; e uuid := (select v from ctx where k='empA'); o uuid := (select v from ctx where k='opA');
  f uuid := (select v from ctx where k='fA'); eb uuid := (select v from ctx where k='empB');
  u uuid; v_abierto uuid; v_cerrado uuid;
begin
  perform set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000a1',false);
  select id into u from unidades where empresa_id = e;
  insert into viajes (empresa_id, unidad_id, operador_id, fecha_salida) values (e,u,o,now()) returning id into v_abierto;
  insert into viajes (empresa_id, unidad_id, operador_id, fecha_salida, estado) values (e,u,o,now(),'cerrado') returning id into v_cerrado;

  -- 11. B no puede ligar su viaje a catálogos de A
  perform set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000b1',false);
  begin insert into viajes (empresa_id, unidad_id, operador_id, fecha_salida) values (eb,u,o,now());
    raise notice '11 FALLA: B ligó su viaje a unidad/operador de A';
  exception when foreign_key_violation then raise notice '11 OK: llaves foráneas por empresa'; end;

  -- 12. capturado_por no se puede falsificar
  perform set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000a2',false);
  insert into cargas_diesel (empresa_id, viaje_id, unidad_id, operador_id, fuente_id, litros, origen, capturado_por)
    values (e,v_abierto,u,o,f,100,'app','00000000-0000-0000-0000-0000000000a1');
  select count(*) into n from cargas_diesel where capturado_por = '00000000-0000-0000-0000-0000000000a1';
  raise notice '12 cargas atribuidas falsamente al dueño (esperado 0): %', n;

  -- 13. Operador no puede ligar carga a un viaje cerrado
  begin insert into cargas_diesel (empresa_id, viaje_id, unidad_id, operador_id, fuente_id, litros, origen)
    values (e,v_cerrado,u,o,f,100,'app'); raise notice '13 FALLA: operador cargó a viaje cerrado';
  exception when insufficient_privilege then raise notice '13 OK: operador solo carga a viajes suyos abiertos'; end;

  -- 14. El único dueño no puede degradarse ni darse de baja
  perform set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000a1',false);
  begin update miembros set rol='administracion' where usuario_id='00000000-0000-0000-0000-0000000000a1';
    raise notice '14 FALLA: la empresa se quedó sin dueño';
  exception when raise_exception then raise notice '14 OK: no se puede quitar al último dueño'; end;
  begin delete from miembros where usuario_id='00000000-0000-0000-0000-0000000000a1';
    raise notice '14b FALLA: el último dueño se dio de baja';
  exception when raise_exception then raise notice '14b OK: el último dueño no se puede borrar'; end;

  -- 15. Tickets: operador ve solo los suyos, dueño ve todos, otra empresa ninguno
  insert into storage.objects (bucket_id, name) values ('tickets', e || '/del-dueno.jpg');
  perform set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000a2',false);
  insert into storage.objects (bucket_id, name) values ('tickets', e || '/del-operador.jpg');
  select count(*) into n from storage.objects; raise notice '15 operador ve tickets (esperado 1): %', n;
  perform set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000a1',false);
  select count(*) into n from storage.objects; raise notice '15b dueño ve tickets (esperado 2): %', n;
  perform set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000b1',false);
  select count(*) into n from storage.objects; raise notice '15c otra empresa ve tickets (esperado 0): %', n;
  begin insert into storage.objects (bucket_id, name) values ('tickets', e || '/intruso.jpg');
    raise notice '15d FALLA: B subió a la carpeta de A';
  exception when insufficient_privilege then raise notice '15d OK: B no sube a la carpeta de A'; end;

  -- 16. crear_empresa valida nombre y RFC
  begin perform crear_empresa('  '); raise notice '16 FALLA: empresa sin nombre';
  exception when raise_exception then raise notice '16 OK: rechaza nombre vacío'; end;
  begin perform crear_empresa('Flotilla X', 'NO-ES-RFC'); raise notice '16b FALLA: RFC inválido aceptado';
  exception when raise_exception then raise notice '16b OK: rechaza RFC inválido'; end;
  select count(*) into n from empresas where rfc = 'URM010101AB1';
  perform crear_empresa('Flotilla Y', ' urm010101ab1 ');
  select count(*) into n from empresas where rfc = 'URM010101AB1'; raise notice '16c RFC normalizado (esperado 1): %', n;
end $$;

-- 17. Borrar una empresa completa no lo bloquea la regla del último dueño
reset role;
do $$
declare n int;
begin
  delete from empresas where id = (select v from ctx where k='empB');
  select count(*) into n from miembros where usuario_id = '00000000-0000-0000-0000-0000000000b1' and empresa_id = (select v from ctx where k='empB');
  raise notice '17 miembros de la empresa borrada (esperado 0): %', n;
end $$;
