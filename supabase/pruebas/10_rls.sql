-- Pruebas de aislamiento entre empresas y permisos por rol. Cada línea debe salir OK o con el valor esperado.
\set QUIET on
insert into auth.users values
 ('00000000-0000-0000-0000-0000000000a1','duenoA'),
 ('00000000-0000-0000-0000-0000000000a2','capturaA'),
 ('00000000-0000-0000-0000-0000000000a3','adminA'),
 ('00000000-0000-0000-0000-0000000000b1','duenoB'),
 ('00000000-0000-0000-0000-0000000000d1','sinEmpresa');
create temp table ctx (k text primary key, v uuid);
grant all on ctx to authenticated;

set role authenticated;
-- Dueño A arma su empresa: catálogos, un usuario de captura y uno de administración.
-- Juan es un chofer: solo un registro del catálogo, no un usuario.
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000a1',false);
insert into ctx values ('empA', crear_empresa('URMA prueba'));
with x as (insert into operadores (empresa_id, nombre) select v,'Juan' from ctx where k='empA' returning id)
  insert into ctx select 'opA', id from x;
insert into unidades (empresa_id, numero_economico) select v,'0708' from ctx where k='empA';
with x as (insert into fuentes_diesel (empresa_id, nombre, tipo) select v,'Tanque La Barca','tanque_propio' from ctx where k='empA' returning id)
  insert into ctx select 'fA', id from x;
insert into clientes (empresa_id, nombre) select v,'Agro SA' from ctx where k='empA';
insert into miembros (empresa_id, usuario_id, rol) select v,'00000000-0000-0000-0000-0000000000a2','captura' from ctx where k='empA';
insert into miembros (empresa_id, usuario_id, rol) select v,'00000000-0000-0000-0000-0000000000a3','administracion' from ctx where k='empA';

-- Dueño B arma la suya
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000b1',false);
insert into ctx values ('empB', crear_empresa('Otra flotilla'));
insert into unidades (empresa_id, numero_economico) select v,'B-01' from ctx where k='empB';
\set QUIET off

do $$
declare n int; e uuid := (select v from ctx where k='empA'); o uuid := (select v from ctx where k='opA');
  f uuid := (select v from ctx where k='fA'); u uuid;
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

  -- 4. Captura da de alta una carga (de cualquier chofer) y queda pendiente
  perform set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000a2',false);
  insert into cargas_diesel (empresa_id, unidad_id, operador_id, fuente_id, litros)
    values (e,u,o,f,350);
  select count(*) into n from cargas_diesel where estado = 'pendiente';
  raise notice '4 captura ve su carga pendiente (esperado 1): %', n;
  -- 5. Captura no puede darla de alta ya validada
  begin insert into cargas_diesel (empresa_id, unidad_id, operador_id, fuente_id, litros, estado)
    values (e,u,o,f,350,'validada'); raise notice '5 FALLA: captura dio de alta una carga validada';
  exception when insufficient_privilege or raise_exception then raise notice '5 OK: captura no da de alta cargas validadas'; end;
  -- 6. Captura consulta catálogos (clientes para el viaje)
  select count(*) into n from clientes; raise notice '6 captura ve clientes (esperado 1): %', n;
  -- 7. Captura no puede dar de alta usuarios
  begin insert into miembros (empresa_id, usuario_id, rol) values (e,'00000000-0000-0000-0000-0000000000b1','dueno');
    raise notice '7 FALLA: captura agregó miembro';
  exception when insufficient_privilege then raise notice '7 OK: captura no administra usuarios'; end;
  -- 8. Captura corrige su carga pendiente, pero no la valida
  update cargas_diesel set litros = 340; get diagnostics n = row_count;
  raise notice '8 cargas pendientes que captura corrigió (esperado 1): %', n;
  begin update cargas_diesel set estado = 'validada';
    raise notice '8b FALLA: captura validó su propia carga';
  exception when insufficient_privilege or raise_exception then raise notice '8b OK: captura no valida'; end;

  -- 9. Dueño B no ve cargas de A
  perform set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000b1',false);
  select count(*) into n from cargas_diesel; raise notice '9 B ve cargas de A (esperado 0): %', n;
  -- 10. Sin sesión no se ve nada
  perform set_config('request.jwt.claim.sub','',false);
  select count(*) into n from empresas; raise notice '10 sin sesión ve empresas (esperado 0): %', n;
end $$;

-- ---------- Endurecimiento (migración 20261014000100) ----------
do $$
declare n int; e uuid := (select v from ctx where k='empA'); o uuid := (select v from ctx where k='opA');
  f uuid := (select v from ctx where k='fA'); eb uuid := (select v from ctx where k='empB');
  u uuid; v_abierto uuid; v_cerrado uuid;
begin
  perform set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000a1',false);
  select id into u from unidades where empresa_id = e;
  insert into viajes (empresa_id, unidad_id, operador_id, fecha_salida) values (e,u,o,now()) returning id into v_abierto;
  insert into viajes (empresa_id, unidad_id, operador_id, fecha_salida, estado) values (e,u,o,now(),'cerrado') returning id into v_cerrado;
  insert into ctx values ('viajeAbierto', v_abierto), ('viajeCerrado', v_cerrado);

  -- 11. B no puede ligar su viaje a catálogos de A
  perform set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000b1',false);
  begin insert into viajes (empresa_id, unidad_id, operador_id, fecha_salida) values (eb,u,o,now());
    raise notice '11 FALLA: B ligó su viaje a unidad/operador de A';
  exception when foreign_key_violation then raise notice '11 OK: llaves foráneas por empresa'; end;

  -- 12. capturado_por no se puede falsificar
  perform set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000a2',false);
  insert into cargas_diesel (empresa_id, viaje_id, unidad_id, operador_id, fuente_id, litros, capturado_por)
    values (e,v_abierto,u,o,f,100,'00000000-0000-0000-0000-0000000000a1');
  select count(*) into n from cargas_diesel where capturado_por = '00000000-0000-0000-0000-0000000000a1';
  raise notice '12 cargas atribuidas falsamente al dueño (esperado 0): %', n;

  -- 13. Captura no puede ligar carga a un viaje cerrado
  begin insert into cargas_diesel (empresa_id, viaje_id, unidad_id, operador_id, fuente_id, litros)
    values (e,v_cerrado,u,o,f,100); raise notice '13 FALLA: captura cargó a viaje cerrado';
  exception when insufficient_privilege then raise notice '13 OK: captura solo carga a viajes abiertos'; end;

  -- 14. El único dueño no puede degradarse ni darse de baja
  perform set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000a1',false);
  begin update miembros set rol='administracion' where usuario_id='00000000-0000-0000-0000-0000000000a1';
    raise notice '14 FALLA: la empresa se quedó sin dueño';
  exception when raise_exception then raise notice '14 OK: no se puede quitar al último dueño'; end;
  begin delete from miembros where usuario_id='00000000-0000-0000-0000-0000000000a1';
    raise notice '14b FALLA: el último dueño se dio de baja';
  exception when raise_exception then raise notice '14b OK: el último dueño no se puede borrar'; end;

  -- 15. Tickets: captura ve solo los suyos, dueño ve todos, otra empresa ninguno
  insert into storage.objects (bucket_id, name) values ('tickets', e || '/del-dueno.jpg');
  perform set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000a2',false);
  insert into storage.objects (bucket_id, name) values ('tickets', e || '/de-captura.jpg');
  select count(*) into n from storage.objects; raise notice '15 captura ve tickets (esperado 1): %', n;
  perform set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000a1',false);
  select count(*) into n from storage.objects; raise notice '15b dueño ve tickets (esperado 2): %', n;
  perform set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000b1',false);
  select count(*) into n from storage.objects; raise notice '15c otra empresa ve tickets (esperado 0): %', n;
  begin insert into storage.objects (bucket_id, name) values ('tickets', e || '/intruso.jpg');
    raise notice '15d FALLA: B subió a la carpeta de A';
  exception when insufficient_privilege then raise notice '15d OK: B no sube a la carpeta de A'; end;

  -- 16. crear_empresa valida nombre y RFC (usuario aún sin empresa)
  perform set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000d1',false);
  begin perform crear_empresa('  '); raise notice '16 FALLA: empresa sin nombre';
  exception when raise_exception then
    if sqlerrm like '%nombre%' then raise notice '16 OK: rechaza nombre vacío';
    else raise notice '16 FALLA: error inesperado: %', sqlerrm; end if; end;
  begin perform crear_empresa('Flotilla X', 'NO-ES-RFC'); raise notice '16b FALLA: RFC inválido aceptado';
  exception when raise_exception then
    if sqlerrm like '%RFC%' then raise notice '16b OK: rechaza RFC inválido';
    else raise notice '16b FALLA: error inesperado: %', sqlerrm; end if; end;
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

-- 18. Un correo sin confirmar no puede dar de alta una empresa (aunque tenga sesión)
reset role;
insert into auth.users values ('00000000-0000-0000-0000-0000000000c1', 'sinConfirmar', null);
set role authenticated;
do $$
begin
  perform set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000c1',false);
  begin perform crear_empresa('Flotilla sin confirmar');
    raise notice '18 FALLA: usuario sin confirmar creó empresa';
  exception when raise_exception then raise notice '18 OK: correo sin confirmar no da de alta empresa'; end;
end $$;

-- 19. No se puede dar de alta una segunda empresa (doble envío, botón "atrás")
do $$
declare n int;
begin
  perform set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000a1',false);
  begin perform crear_empresa('URMA duplicada');
    raise notice '19 FALLA: el dueño creó una segunda empresa';
  exception when raise_exception then
    if sqlerrm like 'Ya perteneces%' then raise notice '19 OK: no se crea una segunda empresa';
    else raise notice '19 FALLA: error inesperado: %', sqlerrm; end if; end;
  -- Captura tampoco puede abrir su propia empresa aparte.
  perform set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000a2',false);
  begin perform crear_empresa('Empresa de captura');
    raise notice '19b FALLA: captura creó otra empresa';
  exception when raise_exception then raise notice '19b OK: un miembro no crea otra empresa'; end;
  select count(*) into n from empresas where nombre in ('URMA duplicada', 'Empresa de captura');
  raise notice '19c empresas duplicadas creadas (esperado 0): %', n;
end $$;

-- ---------- Roles dueño / administración / captura (migración 20261015000200) ----------
do $$
declare n int; t text; e uuid := (select v from ctx where k='empA'); o uuid := (select v from ctx where k='opA');
  f uuid := (select v from ctx where k='fA'); v_abierto uuid := (select v from ctx where k='viajeAbierto');
  u uuid; viaje_cap uuid; carga_dueno uuid; carga_cap uuid;
begin
  -- 20. El rol operador y miembros.operador_id ya no existen
  select count(*) into n from pg_enum where enumtypid = 'rol_miembro'::regtype and enumlabel = 'operador';
  raise notice '20 rol operador en la base (esperado 0): %', n;
  select count(*) into n from information_schema.columns where table_name = 'miembros' and column_name = 'operador_id';
  raise notice '20b columna miembros.operador_id (esperado 0): %', n;

  -- 21. Captura consulta catálogos pero no los edita
  perform set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000a2',false);
  select count(*) into n from unidades; raise notice '21 captura ve unidades (esperado 1): %', n;
  select id into u from unidades limit 1;
  begin insert into unidades (empresa_id, numero_economico) values (e,'CAP-1');
    raise notice '21b FALLA: captura dio de alta una unidad';
  exception when insufficient_privilege then raise notice '21b OK: captura no da de alta catálogos'; end;
  update unidades set rend_cargado_kml = 9; get diagnostics n = row_count;
  raise notice '21c unidades que captura editó (esperado 0): %', n;
  update operadores set nombre = 'X'; get diagnostics n = row_count;
  raise notice '21d operadores que captura editó (esperado 0): %', n;

  -- 22. Parámetros (tolerancia, precio): solo el dueño
  update empresas set tolerancia_pct = 50; get diagnostics n = row_count;
  raise notice '22 parámetros que captura editó (esperado 0): %', n;
  perform set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000a3',false);
  update empresas set tolerancia_pct = 50; get diagnostics n = row_count;
  raise notice '22b parámetros que administración editó (esperado 0): %', n;
  perform set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000a1',false);
  update empresas set tolerancia_pct = 7, precio_diesel_litro = 24.5 where id = e; get diagnostics n = row_count;
  raise notice '22c parámetros que el dueño editó (esperado 1): %', n;

  -- 23. Administración edita catálogos pero no administra usuarios
  perform set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000a3',false);
  update unidades set rend_cargado_kml = 2.4, rend_vacio_kml = 3.1 where empresa_id = e; get diagnostics n = row_count;
  raise notice '23 unidades que administración editó (esperado 1): %', n;
  begin insert into miembros (empresa_id, usuario_id, rol) values (e,'00000000-0000-0000-0000-0000000000d1','captura');
    raise notice '23b FALLA: administración agregó un usuario';
  exception when insufficient_privilege then raise notice '23b OK: administración no administra usuarios'; end;
  update miembros set rol = 'administracion' where usuario_id = '00000000-0000-0000-0000-0000000000a2'; get diagnostics n = row_count;
  raise notice '23c roles que administración cambió (esperado 0): %', n;

  -- 24. Viajes: captura da de alta abiertos y corrige los suyos; cerrarlos no
  perform set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000a2',false);
  insert into viajes (empresa_id, unidad_id, operador_id, fecha_salida, km_cargado) values (e,u,o,now(),300) returning id into viaje_cap;
  raise notice '24 OK: captura dio de alta un viaje';
  begin insert into viajes (empresa_id, unidad_id, operador_id, fecha_salida, estado) values (e,u,o,now(),'cerrado');
    raise notice '24b FALLA: captura dio de alta un viaje cerrado';
  exception when insufficient_privilege then raise notice '24b OK: captura no da de alta viajes cerrados'; end;
  update viajes set km_vacio = 120 where id = viaje_cap; get diagnostics n = row_count;
  raise notice '24c viajes propios que captura corrigió (esperado 1): %', n;
  begin update viajes set estado = 'cerrado' where id = viaje_cap;
    raise notice '24d FALLA: captura cerró un viaje';
  exception when insufficient_privilege then raise notice '24d OK: captura no cierra viajes'; end;
  update viajes set km_vacio = 1 where id = v_abierto; get diagnostics n = row_count;
  raise notice '24e viajes ajenos que captura editó (esperado 0): %', n;
  select count(*) into n from viajes; raise notice '24f viajes que ve captura (esperado 3): %', n;
  select capturado_por::text into t from viajes where id = viaje_cap;
  raise notice '24g viaje atribuido a captura: %', case when t = '00000000-0000-0000-0000-0000000000a2' then 'OK' else 'FALLA' end;

  -- 25. Nadie da de alta una carga ya validada, ni el dueño
  perform set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000a1',false);
  begin insert into cargas_diesel (empresa_id, unidad_id, operador_id, fuente_id, litros, estado)
    values (e,u,o,f,200,'validada'); raise notice '25 FALLA: el dueño dio de alta una carga validada';
  exception when raise_exception then raise notice '25 OK: toda carga nueva queda pendiente'; end;
  insert into cargas_diesel (empresa_id, unidad_id, operador_id, fuente_id, litros)
    values (e,u,o,f,200) returning id into carga_dueno;

  -- 26. Captura no ve cargas ajenas ni movimientos de tanque
  insert into movimientos_tanque (empresa_id, fuente_id, tipo, litros) values (e,f,'entrada_pipa',10000);
  perform set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000a2',false);
  select count(*) into n from cargas_diesel where id = carga_dueno;
  raise notice '26 captura ve la carga del dueño (esperado 0): %', n;
  select count(*) into n from movimientos_tanque; raise notice '26b captura ve movimientos de tanque (esperado 0): %', n;
  update cargas_diesel set litros = 1 where id = carga_dueno; get diagnostics n = row_count;
  raise notice '26c cargas ajenas que captura editó (esperado 0): %', n;
  select id into carga_cap from cargas_diesel where capturado_por = auth.uid() limit 1;

  -- 27. Quien capturó nunca valida; otra persona de dueño/administración sí
  perform set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000a1',false);
  begin update cargas_diesel set estado = 'validada' where id = carga_dueno;
    raise notice '27 FALLA: el dueño validó su propia carga';
  exception when raise_exception then raise notice '27 OK: el dueño no valida lo que capturó'; end;
  begin update cargas_diesel set estado = 'rechazada' where id = carga_dueno;
    raise notice '27b FALLA: el dueño rechazó su propia carga';
  exception when raise_exception then raise notice '27b OK: el dueño no rechaza lo que capturó'; end;
  perform set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000a3',false);
  update cargas_diesel set estado = 'validada' where id = carga_dueno; get diagnostics n = row_count;
  raise notice '27c cargas del dueño validadas por administración (esperado 1): %', n;
  select validado_por::text into t from cargas_diesel where id = carga_dueno;
  raise notice '27d validado_por es administración: %', case when t = '00000000-0000-0000-0000-0000000000a3' then 'OK' else 'FALLA' end;
  perform set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000a1',false);
  update cargas_diesel set estado = 'validada', validado_por = '00000000-0000-0000-0000-0000000000a3' where id = carga_cap;
  select validado_por::text into t from cargas_diesel where id = carga_cap;
  raise notice '27e el dueño valida la carga de captura y no puede falsear quién: %', case when t = '00000000-0000-0000-0000-0000000000a1' then 'OK' else 'FALLA' end;

  -- 28. Una carga ya validada queda fuera del alcance de captura
  perform set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000a2',false);
  update cargas_diesel set litros = 1 where id = carga_cap; get diagnostics n = row_count;
  raise notice '28 cargas validadas que captura editó (esperado 0): %', n;
  begin update cargas_diesel set estado = 'pendiente' where id = carga_cap;
    get diagnostics n = row_count;
    raise notice '28b cargas validadas que captura regresó a pendiente (esperado 0): %', n;
  exception when insufficient_privilege then raise notice '28b OK: captura no reabre cargas validadas'; end;
end $$;
