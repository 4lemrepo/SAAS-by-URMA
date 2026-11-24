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
  -- Un viaje se cierra con sus dos tramos y fecha de llegada (no nace cerrado).
  insert into viajes (empresa_id, unidad_id, operador_id, fecha_salida, fecha_llegada) values (e,u,o,now(),now()) returning id into v_cerrado;
  insert into tramos_viaje (empresa_id, viaje_id, tipo, origen, destino, odometro_inicial, odometro_final)
    values (e, v_cerrado, 'vacio', 'Pueblo X', 'Pueblo Y', 1000, 1100), (e, v_cerrado, 'cargado', 'Pueblo Y', 'Pueblo Z', 1100, 1500);
  update viajes set estado = 'cerrado' where id = v_cerrado;
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
  exception when insufficient_privilege or raise_exception then raise notice '13 OK: captura solo carga a viajes abiertos'; end;

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
  u uuid; viaje_cap uuid; carga_dueno uuid; carga_dueno2 uuid; carga_admin uuid; carga_cap uuid;
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

  -- 22. Parámetros (tolerancia, precio): captura ni los ve, administración los ve, solo el dueño los cambia
  select count(*) into n from parametros_empresa; raise notice '22 parámetros que ve captura (esperado 0): %', n;
  update parametros_empresa set tolerancia_pct = 50; get diagnostics n = row_count;
  raise notice '22a parámetros que captura editó (esperado 0): %', n;
  perform set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000a3',false);
  select count(*) into n from parametros_empresa; raise notice '22b parámetros que ve administración (esperado 1): %', n;
  update parametros_empresa set tolerancia_pct = 50; get diagnostics n = row_count;
  raise notice '22c parámetros que administración editó (esperado 0): %', n;
  perform set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000a1',false);
  update parametros_empresa set tolerancia_pct = 7, precio_diesel_litro = 24.5 where empresa_id = e; get diagnostics n = row_count;
  raise notice '22d parámetros que el dueño editó (esperado 1): %', n;
  select count(*) into n from information_schema.columns where table_name = 'empresas' and column_name in ('tolerancia_pct', 'precio_diesel_litro');
  raise notice '22e parámetros que quedan en empresas (esperado 0): %', n;
  begin delete from parametros_empresa where empresa_id = e; get diagnostics n = row_count;
    raise notice '22f parámetros que el dueño borró (esperado 0): %', n; end;

  -- 23. Administración edita catálogos pero no administra usuarios
  perform set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000a3',false);
  update unidades set rend_cargado_kml = 2.4, rend_vacio_kml = 3.1 where empresa_id = e; get diagnostics n = row_count;
  raise notice '23 unidades que administración editó (esperado 1): %', n;
  begin insert into miembros (empresa_id, usuario_id, rol) values (e,'00000000-0000-0000-0000-0000000000d1','captura');
    raise notice '23b FALLA: administración agregó un usuario';
  exception when insufficient_privilege then raise notice '23b OK: administración no administra usuarios'; end;
  update miembros set rol = 'administracion' where usuario_id = '00000000-0000-0000-0000-0000000000a2'; get diagnostics n = row_count;
  raise notice '23c roles que administración cambió (esperado 0): %', n;

  -- 24. Viajes: captura da de alta y corrige cualquier viaje abierto; cerrarlos no
  perform set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000a2',false);
  insert into viajes (empresa_id, unidad_id, operador_id, fecha_salida, toneladas_cargadas) values (e,u,o,now(),30) returning id into viaje_cap;
  raise notice '24 OK: captura dio de alta un viaje';
  begin insert into viajes (empresa_id, unidad_id, operador_id, fecha_salida, estado) values (e,u,o,now(),'cerrado');
    raise notice '24b FALLA: captura dio de alta un viaje cerrado';
  exception when insufficient_privilege or raise_exception then raise notice '24b OK: captura no da de alta viajes cerrados'; end;
  update viajes set toneladas_descargadas = 29.5 where id = viaje_cap; get diagnostics n = row_count;
  raise notice '24c viajes propios que captura corrigió (esperado 1): %', n;
  begin update viajes set estado = 'cerrado' where id = viaje_cap;
    raise notice '24d FALLA: captura cerró un viaje';
  exception when insufficient_privilege then raise notice '24d OK: captura no cierra viajes'; end;
  update viajes set producto = 'Maíz' where id = v_abierto; get diagnostics n = row_count;
  raise notice '24e viajes abiertos de otros que captura corrigió (esperado 1): %', n;
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

  -- 27. Administración y captura no revisan lo que capturaron; el dueño sí (queda autovalidada)
  perform set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000a3',false);
  insert into cargas_diesel (empresa_id, unidad_id, operador_id, fuente_id, litros)
    values (e,u,o,f,150) returning id into carga_admin;
  begin update cargas_diesel set estado = 'validada' where id = carga_admin;
    raise notice '27 FALLA: administración validó su propia carga';
  exception when raise_exception then raise notice '27 OK: administración no valida lo que capturó'; end;
  begin update cargas_diesel set estado = 'rechazada' where id = carga_admin;
    raise notice '27a FALLA: administración rechazó su propia carga';
  exception when raise_exception then raise notice '27a OK: administración no rechaza lo que capturó'; end;
  update cargas_diesel set estado = 'validada' where id = carga_dueno; get diagnostics n = row_count;
  raise notice '27b cargas del dueño validadas por administración (esperado 1): %', n;
  select validado_por::text || '/' || autovalidada into t from cargas_diesel where id = carga_dueno;
  raise notice '27c validada por administración, no autovalidada: %', case when t = '00000000-0000-0000-0000-0000000000a3/false' then 'OK' else 'FALLA ' || t end;

  perform set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000a1',false);
  insert into cargas_diesel (empresa_id, unidad_id, operador_id, fuente_id, litros)
    values (e,u,o,f,120) returning id into carga_dueno2;
  update cargas_diesel set estado = 'validada', autovalidada = false where id = carga_dueno2; get diagnostics n = row_count;
  raise notice '27d cargas propias que el dueño validó (esperado 1): %', n;
  select autovalidada::text into t from cargas_diesel where id = carga_dueno2;
  raise notice '27e la carga del dueño queda autovalidada (aunque intente ocultarlo): %', case when t = 'true' then 'OK' else 'FALLA' end;
  update cargas_diesel set estado = 'validada' where id = carga_admin;
  select autovalidada::text into t from cargas_diesel where id = carga_admin;
  raise notice '27f el dueño valida la de administración, no autovalidada: %', case when t = 'false' then 'OK' else 'FALLA' end;
  update cargas_diesel set estado = 'validada', validado_por = '00000000-0000-0000-0000-0000000000a3' where id = carga_cap;
  select validado_por::text into t from cargas_diesel where id = carga_cap;
  raise notice '27g el dueño valida la carga de captura y no puede falsear quién: %', case when t = '00000000-0000-0000-0000-0000000000a1' then 'OK' else 'FALLA' end;

  -- 28. Una carga ya validada queda fuera del alcance de captura
  perform set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000a2',false);
  update cargas_diesel set litros = 1 where id = carga_cap; get diagnostics n = row_count;
  raise notice '28 cargas validadas que captura editó (esperado 0): %', n;
  begin update cargas_diesel set estado = 'pendiente' where id = carga_cap;
    get diagnostics n = row_count;
    raise notice '28b cargas validadas que captura regresó a pendiente (esperado 0): %', n;
  exception when insufficient_privilege then raise notice '28b OK: captura no reabre cargas validadas'; end;
end $$;

-- ---------- Catálogos (migración 20261015000300) ----------
do $$
declare n int; e uuid := (select v from ctx where k='empA');
begin
  -- 29. Desactivar: dueño y administración sí, captura no
  perform set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000a2',false);
  update unidades set activa = false; get diagnostics n = row_count;
  raise notice '29 unidades que captura desactivó (esperado 0): %', n;
  update clientes set activo = false; get diagnostics n = row_count;
  raise notice '29b clientes que captura desactivó (esperado 0): %', n;
  perform set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000a3',false);
  update clientes set activo = false where empresa_id = e; get diagnostics n = row_count;
  raise notice '29c clientes que administración desactivó (esperado 1): %', n;
  update clientes set activo = true where empresa_id = e;

  -- 30. Sin duplicados, aunque cambien mayúsculas o espacios
  begin insert into unidades (empresa_id, numero_economico) values (e,' 0708 ');
    raise notice '30 FALLA: número económico duplicado';
  exception when unique_violation then raise notice '30 OK: número económico duplicado rechazado'; end;
  begin insert into clientes (empresa_id, nombre) values (e,'agro sa  ');
    raise notice '30b FALLA: cliente duplicado';
  exception when unique_violation then raise notice '30b OK: cliente duplicado rechazado'; end;
  begin insert into operadores (empresa_id, nombre) values (e,'JUAN');
    raise notice '30c FALLA: operador duplicado';
  exception when unique_violation then raise notice '30c OK: operador duplicado rechazado'; end;
  insert into rutas (empresa_id, origen, destino, km) values (e,'La Barca','Guadalajara',110);
  begin insert into rutas (empresa_id, origen, destino, km) values (e,'la barca ','GUADALAJARA',112);
    raise notice '30d FALLA: ruta duplicada';
  exception when unique_violation then raise notice '30d OK: ruta duplicada rechazada'; end;
  -- La otra empresa sí puede usar el mismo número económico
  perform set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000d1',false);
  insert into unidades (empresa_id, numero_economico)
    select empresa_id, '0708' from miembros where usuario_id = auth.uid();
  raise notice '30e OK: otra empresa usa el mismo número económico';

  -- 31. Un registro con historial no se puede borrar (se desactiva)
  perform set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000a1',false);
  begin delete from unidades where empresa_id = e and numero_economico = '0708';
    raise notice '31 FALLA: se borró una unidad con viajes';
  exception when foreign_key_violation then raise notice '31 OK: unidad con historial no se borra'; end;

  -- 32. Validaciones de la base
  begin insert into rutas (empresa_id, origen, destino, km) values (e,'X','Guadalajara',10);
    raise notice '32 FALLA: ruta con origen de 1 letra';
  exception when check_violation then raise notice '32 OK: origen inválido rechazado'; end;
  begin insert into unidades (empresa_id, numero_economico, anio) values (e,'0999',1900);
    raise notice '32b FALLA: año inválido';
  exception when check_violation then raise notice '32b OK: año inválido rechazado'; end;

  -- 33. Captura consulta rutas pero no las da de alta
  perform set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000a2',false);
  select count(*) into n from rutas; raise notice '33 captura ve rutas (esperado 1): %', n;
  begin insert into rutas (empresa_id, origen, destino, km) values (e,'Ocotlán','León',200);
    raise notice '33b FALLA: captura dio de alta una ruta';
  exception when insufficient_privilege then raise notice '33b OK: captura no da de alta rutas'; end;
end $$;

-- ---------- Remolques, dollies y armados (migración 20261016000000) ----------
do $$
declare n int; t text; e uuid := (select v from ctx where k='empA'); o uuid := (select v from ctx where k='opA');
  u uuid; u2 uuid; tolva uuid; r1 uuid; r2 uuid; r3 uuid; d1 uuid; d2 uuid; a uuid; a_otra uuid;
begin
  -- 34. Tipos de remolque precargados, también en empresas nuevas
  perform set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000a1',false);
  select count(*) into n from tipos_remolque; raise notice '34 tipos precargados en A (esperado 8): %', n;
  perform set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000d1',false);
  select count(*) into n from tipos_remolque; raise notice '34b tipos precargados en empresa nueva (esperado 8): %', n;
  select count(*) into n from parametros_empresa where tolerancia_pct = 5; raise notice '34c empresa nueva con parámetros por defecto (esperado 1): %', n;

  -- 35. Administración agrega tipos; sin duplicados
  perform set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000a3',false);
  insert into tipos_remolque (empresa_id, nombre) values (e, 'Cama baja');
  raise notice '35 OK: administración agregó un tipo de remolque';
  begin insert into tipos_remolque (empresa_id, nombre) values (e, ' TOLVA ');
    raise notice '35b FALLA: tipo duplicado';
  exception when unique_violation then raise notice '35b OK: tipo duplicado rechazado'; end;

  -- Dueño da de alta equipo
  perform set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000a1',false);
  select id into tolva from tipos_remolque where empresa_id = e and nombre = 'Tolva';
  select id into u from unidades where empresa_id = e and numero_economico = '0708';
  insert into unidades (empresa_id, numero_economico, numero_serie) values (e, 'T2', '3AKJGLD5XGSGA0001') returning id into u2;
  insert into remolques (empresa_id, placas, numero_serie, tipo_id) values (e,'10-AB-1A','SERIE-R1',tolva) returning id into r1;
  insert into remolques (empresa_id, placas, numero_serie, tipo_id, numero_economico) values (e,'10-AB-2A','SERIE-R2',tolva,'R-02') returning id into r2;
  insert into remolques (empresa_id, placas, numero_serie, tipo_id) values (e,'10-AB-3A','SERIE-R3',tolva) returning id into r3;
  insert into dollies (empresa_id, numero_serie) values (e,'SERIE-D1') returning id into d1;
  begin insert into remolques (empresa_id, placas, numero_serie, tipo_id) values (e,'10-ab-1a','OTRA',tolva);
    raise notice '36 FALLA: placas de remolque duplicadas';
  exception when unique_violation then raise notice '36 OK: placas de remolque duplicadas rechazadas'; end;
  begin insert into dollies (empresa_id) values (e);
    raise notice '36b FALLA: dolly sin número de serie';
  exception when not_null_violation then raise notice '36b OK: dolly requiere número de serie'; end;

  -- 37. Captura consulta equipo pero no lo edita ni cambia armados
  perform set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000a2',false);
  select count(*) into n from remolques; raise notice '37 captura ve remolques (esperado 3): %', n;
  begin insert into remolques (empresa_id, placas, numero_serie, tipo_id) values (e,'99-ZZ-9Z','CAP',tolva);
    raise notice '37b FALLA: captura dio de alta un remolque';
  exception when insufficient_privilege then raise notice '37b OK: captura no da de alta remolques'; end;
  begin insert into tipos_remolque (empresa_id, nombre) values (e, 'De captura');
    raise notice '37c FALLA: captura dio de alta un tipo';
  exception when insufficient_privilege then raise notice '37c OK: captura no da de alta tipos'; end;
  begin perform cambiar_armado(u, r1);
    raise notice '37d FALLA: captura cambió un armado';
  exception when insufficient_privilege then raise notice '37d OK: captura no cambia armados'; end;
  update dollies set activo = false; get diagnostics n = row_count;
  raise notice '37e dollies que captura desactivó (esperado 0): %', n;

  -- 38. Armado sencillo y luego full, con historial
  perform set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000a1',false);
  perform cambiar_armado(u, r1, null, null, now() - interval '10 days');
  select configuracion::text into t from armados where unidad_id = u and hasta is null;
  raise notice '38 configuración con un remolque: %', case when t = 'sencillo' then 'OK' else 'FALLA ' || coalesce(t,'null') end;
  a := cambiar_armado(u, r1, d1, r2, now() - interval '5 days');
  select configuracion::text into t from armados where id = a;
  raise notice '38b configuración con dolly y dos remolques: %', case when t = 'full' then 'OK' else 'FALLA ' || coalesce(t,'null') end;
  select count(*) into n from armados where unidad_id = u; raise notice '38c armados en el historial (esperado 2): %', n;
  select count(*) into n from armados where unidad_id = u and hasta is null; raise notice '38d armados vigentes (esperado 1): %', n;
  select count(*) into n from armados where unidad_id = u and now() - interval '7 days' <@ tstzrange(desde, hasta) and remolque2_id is null;
  raise notice '38e hace 7 días traía sencillo (esperado 1): %', n;

  -- 39. Un remolque o dolly no puede estar en dos tractos a la vez
  begin perform cambiar_armado(u2, r1);
    raise notice '39 FALLA: remolque en dos unidades';
  exception when raise_exception then
    if sqlerrm like '%está en la unidad 0708%' then raise notice '39 OK: remolque ya enganchado rechazado';
    else raise notice '39 FALLA: error inesperado: %', sqlerrm; end if; end;
  begin perform cambiar_armado(u2, r3, d1, r2);
    raise notice '39b FALLA: dolly en dos unidades';
  exception when raise_exception then raise notice '39b OK: dolly o remolque ya enganchado rechazado'; end;
  -- Ni metiéndolo directo a la tabla, ni en el pasado
  begin insert into armados (empresa_id, unidad_id, remolque1_id, desde, hasta) values (e, u2, r2, now() - interval '30 days', now() - interval '1 day');
    raise notice '39c FALLA: empalme en el pasado';
  exception when raise_exception then raise notice '39c OK: empalme en el pasado rechazado'; end;

  -- 40. Reglas de sencillo/full
  begin perform cambiar_armado(u2, r3, d1, null);
    raise notice '40 FALLA: dolly sin segundo remolque';
  exception when raise_exception then
    if sqlerrm like 'Un full lleva dolly%' then raise notice '40 OK: full requiere dolly y segundo remolque';
    else raise notice '40 FALLA: error inesperado: %', sqlerrm; end if; end;
  insert into dollies (empresa_id, numero_serie) values (e,'SERIE-D2') returning id into d2;
  begin insert into armados (empresa_id, unidad_id, remolque1_id, dolly_id) values (e, u2, r3, d2);
    raise notice '40b FALLA: armado con dolly sin segundo remolque';
  exception when check_violation then raise notice '40b OK: la tabla también exige el full completo'; end;

  -- 41. El historial no se edita y el equipo enganchado no se desactiva
  begin update armados set remolque1_id = r3 where id = a;
    raise notice '41 FALLA: se editó el historial';
  exception when raise_exception then raise notice '41 OK: historial de armados inmutable'; end;
  begin update remolques set activo = false where id = r2;
    raise notice '41b FALLA: se desactivó un remolque enganchado';
  exception when raise_exception then raise notice '41b OK: remolque enganchado no se desactiva'; end;
  delete from armados where id = a; get diagnostics n = row_count;
  raise notice '41c armados borrados (esperado 0): %', n;

  -- 42. La fecha del cambio debe ser posterior al armado vigente
  begin perform cambiar_armado(u, r3, null, null, now() - interval '6 days');
    raise notice '42 FALLA: cambio anterior al armado vigente';
  exception when raise_exception then raise notice '42 OK: fecha de cambio validada'; end;

  -- 43. Desenganchar libera el equipo para otro tracto
  perform cambiar_armado(u, null);
  select count(*) into n from armados where unidad_id = u and hasta is null; raise notice '43 armados vigentes tras desenganchar (esperado 0): %', n;
  a_otra := cambiar_armado(u2, r1, d1, r2);
  raise notice '43b OK: el equipo liberado se enganchó a otra unidad';
  update remolques set activo = false where id = r3; get diagnostics n = row_count;
  raise notice '43c remolques libres desactivados (esperado 1): %', n;
  begin perform cambiar_armado(u, r3);
    raise notice '43d FALLA: se enganchó un remolque inactivo';
  exception when raise_exception then raise notice '43d OK: no se engancha equipo inactivo'; end;

  -- 44. El viaje guarda un armado de su misma unidad
  insert into viajes (empresa_id, unidad_id, operador_id, fecha_salida, armado_id) values (e, u2, o, now(), a_otra);
  raise notice '44 OK: viaje con su armado';
  begin insert into viajes (empresa_id, unidad_id, operador_id, fecha_salida, armado_id) values (e, u, o, now(), a_otra);
    raise notice '44b FALLA: viaje con armado de otra unidad';
  exception when foreign_key_violation then raise notice '44b OK: armado de otra unidad rechazado'; end;

  -- 45. Otra empresa no ve el equipo de A
  perform set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000d1',false);
  select count(*) into n from remolques; raise notice '45 otra empresa ve remolques (esperado 0): %', n;
  select count(*) into n from armados; raise notice '45b otra empresa ve armados (esperado 0): %', n;
  begin perform cambiar_armado(u, r1);
    raise notice '45c FALLA: otra empresa cambió un armado';
  exception when raise_exception or insufficient_privilege then raise notice '45c OK: otra empresa no cambia armados'; end;
end $$;

-- ---------- Tramos, crédito en estación e importación (migración 20261016000200) ----------
do $$
declare n int; t text; j jsonb; e uuid := (select v from ctx where k='empA'); o uuid := (select v from ctx where k='opA');
  u uuid; ida uuid; regreso uuid; ruta_b uuid; viaje47 uuid;
begin
  -- 46. Fuente de tipo crédito en estación
  perform set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000a3',false);
  insert into fuentes_diesel (empresa_id, nombre, tipo) values (e, 'Crédito Estaciones X', 'credito_estacion');
  raise notice '46 OK: fuente de crédito en estación';
  select tolerancia_km_pct::int into n from parametros_empresa where empresa_id = e;
  raise notice '46b tolerancia de km por defecto (esperado 10): %', n;

  -- 47. Viaje con tramo cargado y tramo vacío, cada uno con su ruta
  select id into u from unidades where empresa_id = e and numero_economico = '0708';
  insert into rutas (empresa_id, origen, destino, km) values (e, 'Pueblo A', 'Pueblo B', 400) returning id into ida;
  insert into rutas (empresa_id, origen, destino, km) values (e, 'Pueblo B', 'Pueblo A', 410) returning id into regreso;
  insert into viajes (empresa_id, unidad_id, operador_id, fecha_salida) values (e, u, o, now()) returning id into viaje47;
  insert into tramos_viaje (empresa_id, viaje_id, tipo, origen, destino, odometro_inicial, odometro_final, ruta_id, km_ruta)
    values (e, viaje47, 'vacio', 'Pueblo B', 'Pueblo A', 5000, 5410, regreso, 410),
           (e, viaje47, 'cargado', 'Pueblo A', 'Pueblo B', 5410, 5865, ida, 400);
  select sum(km)::int into n from tramos_viaje where viaje_id = viaje47;
  raise notice '47 km del viaje = odómetro final − inicial de sus tramos (esperado 865): %', n;
  perform set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000d1',false);
  insert into rutas (empresa_id, origen, destino, km)
    select empresa_id, 'Otra', 'Empresa', 10 from miembros where usuario_id = auth.uid() returning id into ruta_b;
  perform set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000a3',false);
  begin update tramos_viaje set ruta_id = ruta_b where viaje_id = viaje47 and tipo = 'vacio';
    raise notice '47b FALLA: tramo con ruta de otra empresa';
  exception when foreign_key_violation then raise notice '47b OK: la ruta del tramo es de la misma empresa'; end;

  -- 48. Importación: todo o nada
  j := importar_catalogos(e, '{"unidades":[{"numero_economico":"IMP-1","placas":"AAA111"}],
    "operadores":[{"nombre":"Operador Importado"}],"clientes":[{"nombre":"Cliente Importado"}],
    "rutas":[{"origen":"Pueblo C","destino":"Pueblo D","km":120}],"fuentes":[{"nombre":"Tarjeta Importada","tipo":"tarjeta"}]}');
  raise notice '48 registros importados (esperado 5): %', (select sum(value::int) from jsonb_each_text(j));
  begin perform importar_catalogos(e, '{"operadores":[{"nombre":"No Debe Quedar"}],"unidades":[{"numero_economico":"imp-1"}]}');
    raise notice '48b FALLA: importación con duplicado';
  exception when unique_violation then null; end;
  select count(*) into n from operadores where nombre = 'No Debe Quedar';
  raise notice '48b si una fila falla no se guarda nada (esperado 0): %', n;
  begin perform importar_catalogos(e, '{"rutas":[{"origen":"Pueblo E","destino":"Pueblo F","km":0}]}');
    raise notice '48c FALLA: ruta con 0 km importada';
  exception when check_violation then raise notice '48c OK: la importación respeta las validaciones'; end;

  -- 49. Captura y otras empresas no importan
  perform set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000a2',false);
  begin perform importar_catalogos(e, '{"operadores":[{"nombre":"De Captura"}]}');
    raise notice '49 FALLA: captura importó';
  exception when insufficient_privilege then raise notice '49 OK: captura no importa'; end;
  perform set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000d1',false);
  begin perform importar_catalogos(e, '{"operadores":[{"nombre":"De Otra Empresa"}]}');
    raise notice '49b FALLA: otra empresa importó en A';
  exception when insufficient_privilege then raise notice '49b OK: otra empresa no importa en A'; end;
end $$;

-- ---------- Viajes completos (migraciones 20261017000000 y 20261017000100) ----------
do $$
declare n int; t text; e uuid := (select v from ctx where k='empA'); o uuid := (select v from ctx where k='opA');
  f uuid := (select v from ctx where k='fA'); u uuid; vj uuid; vj2 uuid; cat uuid; carga uuid; otra_u uuid;
begin
  perform set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000a1',false);
  select id into u from unidades where empresa_id = e and numero_economico = '0708';
  select id into otra_u from unidades where empresa_id = e and numero_economico = 'T2';

  -- 50. Folios consecutivos con prefijo; a mano solo dueño o administración; nunca repetidos
  update parametros_empresa set folio_viaje_prefijo = 'URMA-', folio_viaje_siguiente = 182 where empresa_id = e;
  insert into viajes (empresa_id, unidad_id, operador_id, fecha_salida) values (e,u,o,now()) returning id, folio into vj, t;
  raise notice '50 folio asignado solo: %', case when t = 'URMA-0182' then 'OK' else 'FALLA ' || t end;
  insert into viajes (empresa_id, unidad_id, operador_id, fecha_salida, folio) values (e,u,o,now(),'URMA-0183');
  insert into viajes (empresa_id, unidad_id, operador_id, fecha_salida) values (e,u,o,now()) returning folio into t;
  raise notice '50b el consecutivo brinca el folio puesto a mano: %', case when t = 'URMA-0184' then 'OK' else 'FALLA ' || t end;
  begin insert into viajes (empresa_id, unidad_id, operador_id, fecha_salida, folio) values (e,u,o,now(),'urma-0182');
    raise notice '50c FALLA: folio repetido';
  exception when unique_violation then raise notice '50c OK: folio repetido rechazado'; end;
  perform set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000a2',false);
  begin insert into viajes (empresa_id, unidad_id, operador_id, fecha_salida, folio) values (e,u,o,now(),'MIO-1');
    raise notice '50d FALLA: captura puso folio a mano';
  exception when raise_exception then raise notice '50d OK: captura no pone folios a mano'; end;
  begin update viajes set folio = 'MIO-2' where id = vj;
    raise notice '50e FALLA: captura cambió un folio';
  exception when raise_exception then raise notice '50e OK: captura no cambia folios'; end;

  -- 51. Tarifas e ingresos: sin el permiso, la base no los devuelve
  perform set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000a1',false);
  insert into viajes_finanzas (viaje_id, empresa_id, tarifa, pago_esquema, pago_pct) values (vj, e, 650, 'pct_subtotal', 12.6);
  perform set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000a2',false);
  select count(*) into n from viajes_finanzas; raise notice '51 finanzas que ve captura sin permiso (esperado 0): %', n;
  select count(*) into n from pago_operador_config; raise notice '51b config de pago que ve captura sin permiso (esperado 0): %', n;
  update viajes_finanzas set tarifa = 1; get diagnostics n = row_count;
  raise notice '51c finanzas que captura editó sin permiso (esperado 0): %', n;
  perform set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000a3',false);
  select count(*) into n from viajes_finanzas; raise notice '51d finanzas que ve administración (esperado 1): %', n;
  update miembros set ve_tarifas = true where usuario_id = '00000000-0000-0000-0000-0000000000a2'; get diagnostics n = row_count;
  raise notice '51e permisos que administración otorgó (esperado 0): %', n;
  perform set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000a1',false);
  update miembros set ve_tarifas = true where usuario_id = '00000000-0000-0000-0000-0000000000a2';
  perform set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000a2',false);
  select count(*) into n from viajes_finanzas; raise notice '51f finanzas que ve captura con permiso (esperado 1): %', n;
  select pct::text into t from pago_operador_config where operador_id is null;
  raise notice '51g esquema de pago por defecto 12.6 %%: %', case when t = '12.60' then 'OK' else 'FALLA ' || coalesce(t, 'null') end;
  perform set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000a1',false);
  update miembros set ve_tarifas = false where usuario_id = '00000000-0000-0000-0000-0000000000a2';

  -- 52. Gastos con folio propio y categorías precargadas
  select count(*) into n from categorias_gasto where empresa_id = e; raise notice '52 categorías de gasto precargadas (esperado 13): %', n;
  select id into cat from categorias_gasto where empresa_id = e and nombre = 'Casetas';
  perform set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000a2',false);
  insert into gastos_viaje (empresa_id, viaje_id, categoria_id, monto, forma_pago, numero_comprobante)
    values (e, vj, cat, 1250.50, 'tag', 'FAC-991') returning folio into t;
  raise notice '52b folio de gasto: %', case when t = 'G-0001' then 'OK' else 'FALLA ' || t end;
  begin insert into categorias_gasto (empresa_id, nombre) values (e, 'De captura');
    raise notice '52c FALLA: captura creó una categoría';
  exception when insufficient_privilege then raise notice '52c OK: captura no edita categorías de gasto'; end;
  delete from gastos_viaje where viaje_id = vj; get diagnostics n = row_count;
  raise notice '52d gastos borrados (esperado 0): %', n;

  -- 53. Bitácora: quién cambió qué campo; captura no la ve y nadie la escribe
  update viajes set producto = 'Sorgo' where id = vj;
  select count(*) into n from bitacora; raise notice '53 bitácora que ve captura (esperado 0): %', n;
  begin insert into bitacora (empresa_id, tabla, registro_id, accion) values (e, 'viajes', vj, 'cambio');
    raise notice '53b FALLA: se escribió la bitácora directo';
  exception when insufficient_privilege then raise notice '53b OK: nadie escribe la bitácora directo'; end;
  perform set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000a3',false);
  select valor_nuevo || ' por ' || usuario_id::text into t from bitacora where viaje_id = vj and campo = 'producto';
  raise notice '53c bitácora registra campo, valor y usuario: %', case when t = 'Sorgo por 00000000-0000-0000-0000-0000000000a2' then 'OK' else 'FALLA ' || coalesce(t, 'null') end;
  select count(*) into n from bitacora where viaje_id = vj and tabla = 'gastos_viaje' and accion = 'alta';
  raise notice '53d el alta del gasto aparece en la bitácora del viaje (esperado 1): %', n;
  delete from bitacora where viaje_id = vj; get diagnostics n = row_count;
  raise notice '53e renglones de bitácora borrados (esperado 0): %', n;

  -- 54. Cierre: no con cargas pendientes, tramos incompletos o sin llegada
  insert into tramos_viaje (empresa_id, viaje_id, tipo, origen, destino, odometro_inicial, odometro_final)
    values (e, vj, 'vacio', 'Pueblo A', 'Pueblo B', 9000, 9100);
  update viajes set fecha_llegada = now() where id = vj;
  begin update viajes set estado = 'cerrado' where id = vj;
    raise notice '54 FALLA: cerró sin tramo cargado';
  exception when raise_exception then raise notice '54 OK: no cierra sin los dos tramos'; end;
  insert into tramos_viaje (empresa_id, viaje_id, tipo, origen, destino, odometro_inicial, odometro_final)
    values (e, vj, 'cargado', 'Pueblo B', 'Pueblo C', 9100, 9600);
  insert into cargas_diesel (empresa_id, viaje_id, unidad_id, operador_id, fuente_id, litros) values (e, vj, u, o, f, 400) returning id into carga;
  begin insert into cargas_diesel (empresa_id, viaje_id, unidad_id, operador_id, fuente_id, litros) values (e, vj, otra_u, o, f, 50);
    raise notice '54b FALLA: carga de otra unidad ligada al viaje';
  exception when raise_exception then raise notice '54b OK: la carga es de la unidad del viaje'; end;
  begin update viajes set estado = 'cerrado' where id = vj;
    raise notice '54c FALLA: cerró con carga pendiente';
  exception when raise_exception then raise notice '54c OK: no cierra con cargas pendientes'; end;
  perform set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000a1',false);
  update cargas_diesel set estado = 'validada' where id = carga;
  perform set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000a3',false);
  update viajes set estado = 'cerrado' where id = vj;
  select cerrado_por::text into t from viajes where id = vj;
  raise notice '54d cerrado y quién lo cerró: %', case when t = '00000000-0000-0000-0000-0000000000a3' then 'OK' else 'FALLA' end;

  -- 55. Cerrado: nadie edita el viaje, sus tramos, gastos, finanzas ni cargas
  begin update viajes set producto = 'Otro' where id = vj; raise notice '55 FALLA: se editó un viaje cerrado';
  exception when raise_exception then raise notice '55 OK: viaje cerrado no se edita'; end;
  begin update tramos_viaje set odometro_final = 9700 where viaje_id = vj and tipo = 'cargado'; raise notice '55b FALLA: tramo editado';
  exception when raise_exception then raise notice '55b OK: tramos de viaje cerrado no se editan'; end;
  begin insert into gastos_viaje (empresa_id, viaje_id, categoria_id, monto) values (e, vj, cat, 10); raise notice '55c FALLA: gasto agregado';
  exception when raise_exception then raise notice '55c OK: no se agregan gastos a un viaje cerrado'; end;
  begin update viajes_finanzas set tarifa = 700 where viaje_id = vj; raise notice '55d FALLA: tarifa editada';
  exception when raise_exception then raise notice '55d OK: finanzas de viaje cerrado no se editan'; end;
  begin update cargas_diesel set viaje_id = null where id = carga; raise notice '55e FALLA: carga sacada del viaje cerrado';
  exception when raise_exception then raise notice '55e OK: cargas de viaje cerrado no se mueven'; end;

  -- 56. Reabrir: con permiso y motivo; queda en reaperturas y bitácora
  begin perform reabrir_viaje(vj, 'Corregir tarifa');
    raise notice '56 FALLA: administración reabrió sin permiso';
  exception when insufficient_privilege then raise notice '56 OK: administración sin permiso no reabre'; end;
  perform set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000a2',false);
  begin perform reabrir_viaje(vj, 'Corregir tarifa');
    raise notice '56b FALLA: captura reabrió';
  exception when insufficient_privilege then raise notice '56b OK: captura no reabre'; end;
  perform set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000a1',false);
  update miembros set puede_reabrir_viajes = true where usuario_id = '00000000-0000-0000-0000-0000000000a3';
  perform set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000a3',false);
  begin perform reabrir_viaje(vj, 'no');
    raise notice '56c FALLA: reabrió sin motivo';
  exception when raise_exception then raise notice '56c OK: reabrir pide motivo'; end;
  perform reabrir_viaje(vj, 'Corregir tarifa del cliente');
  select estado::text into t from viajes where id = vj; raise notice '56d viaje reabierto: %', case when t = 'abierto' then 'OK' else 'FALLA' end;
  select count(*) into n from reaperturas_viaje where viaje_id = vj and usuario_id = '00000000-0000-0000-0000-0000000000a3';
  raise notice '56e reapertura registrada (esperado 1): %', n;
  select nota into t from bitacora where viaje_id = vj and accion = 'reapertura';
  raise notice '56f motivo en la bitácora: %', case when t = 'Corregir tarifa del cliente' then 'OK' else 'FALLA ' || coalesce(t, 'null') end;
  begin update viajes set estado = 'cerrado' where id = vj; update viajes set estado = 'abierto' where id = vj;
    raise notice '56g FALLA: se reabrió sin reabrir_viaje';
  exception when raise_exception then raise notice '56g OK: solo reabrir_viaje() reabre'; end;

  -- 57. Km sin viaje: requiere explicación
  begin insert into viajes (empresa_id, unidad_id, operador_id, fecha_salida, odometro_anterior, km_sin_viaje)
      values (e, u, o, now(), 9600, 35);
    raise notice '57 FALLA: km sin viaje sin explicación';
  exception when check_violation then raise notice '57 OK: km sin viaje piden explicación'; end;
  insert into viajes (empresa_id, unidad_id, operador_id, fecha_salida, odometro_anterior, km_sin_viaje, explicacion_km_sin_viaje)
    values (e, u, o, now(), 9600, 35, 'Fue al taller') returning id into vj2;
  raise notice '57b OK: km sin viaje con explicación';

  -- 57c. guardar_viaje(): viaje y tramos en un paso; captura puede, en viajes abiertos
  perform set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000a2',false);
  vj2 := guardar_viaje(null,
    jsonb_build_object('empresa_id', e, 'unidad_id', u, 'operador_id', o, 'fecha_salida', now(), 'toneladas_cargadas', 30),
    jsonb_build_array(
      jsonb_build_object('tipo', 'vacio', 'origen', 'PUEBLO C', 'destino', 'PUEBLO D', 'odometro_inicial', 9600, 'odometro_final', 9700),
      jsonb_build_object('tipo', 'cargado', 'origen', 'PUEBLO D', 'destino', 'PUEBLO E', 'odometro_inicial', 9700, 'odometro_final', 9950)));
  perform guardar_viaje(vj2, jsonb_build_object('unidad_id', u, 'operador_id', o, 'fecha_salida', now(), 'toneladas_cargadas', 31),
    jsonb_build_array(jsonb_build_object('tipo', 'cargado', 'origen', 'PUEBLO D', 'destino', 'PUEBLO E', 'odometro_inicial', 9700, 'odometro_final', 9960)));
  select sum(km)::int into n from tramos_viaje where viaje_id = vj2;
  raise notice '57c captura guarda viaje y tramos y los corrige (esperado 360): %', n;
  select tolerancia_km(e)::int into n; raise notice '57d captura conoce la tolerancia de km (esperado 10): %', n;
  begin perform guardar_viaje((select v from ctx where k='viajeCerrado'), jsonb_build_object('unidad_id', u, 'operador_id', o, 'fecha_salida', now()), '[]');
    raise notice '57e FALLA: captura guardó un viaje cerrado';
  exception when raise_exception then raise notice '57e OK: guardar_viaje respeta el cierre'; end;
  perform set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000a3',false);

  -- 58. Usuarios: solo el dueño ve la lista con correos
  select count(*) into n from usuarios_de_empresa(e); raise notice '58 usuarios que ve administración (esperado 0): %', n;
  perform set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000a1',false);
  select count(*) into n from usuarios_de_empresa(e); raise notice '58b usuarios que ve el dueño (esperado 3): %', n;
  select factura_por::text into t from clientes where empresa_id = e limit 1;
  raise notice '58c el cliente factura por peso cargado por defecto: %', case when t = 'cargado' then 'OK' else 'FALLA' end;
end $$;

-- ---------- Costos (migración 20261017000200) ----------
do $$
declare n int; t text; e uuid := (select v from ctx where k='empA'); u uuid; r1 uuid; cat uuid; sueldo uuid; otra uuid;
begin
  perform set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000a3',false);
  -- 60. Categorías precargadas; el sueldo del operador nace fuera de la rentabilidad
  select count(*) into n from categorias_costo where empresa_id = e; raise notice '60 categorías de costo precargadas (esperado 13): %', n;
  select count(*) into n from categorias_costo where empresa_id = e and not incluir_en_rentabilidad and nombre = 'Sueldo y prestaciones del operador';
  raise notice '60b sueldo del operador excluido de la rentabilidad (esperado 1): %', n;

  -- 61. Costos de tracto, remolque y generales con folio propio
  select id into u from unidades where empresa_id = e and numero_economico = '0708';
  select id into r1 from remolques where empresa_id = e limit 1;
  select id into cat from categorias_costo where empresa_id = e and nombre = 'Llantas y rines';
  insert into costos (empresa_id, fecha, mes, categoria_id, monto, unidad_id) values (e, '2026-10-05', '2026-10-01', cat, 24000, u) returning folio into t;
  raise notice '61 folio de costo: %', case when t = 'C-0001' then 'OK' else 'FALLA ' || t end;
  insert into costos (empresa_id, fecha, mes, categoria_id, monto, remolque_id) values (e, '2026-10-05', '2026-10-01', cat, 8000, r1);
  select id into cat from categorias_costo where empresa_id = e and nombre = 'Seguro';
  insert into costos (empresa_id, fecha, mes, meses, categoria_id, monto) values (e, '2026-10-01', '2026-10-01', 12, cat, 120000);
  raise notice '61b OK: costo de remolque y costo general repartido en 12 meses';
  begin insert into costos (empresa_id, mes, categoria_id, monto, unidad_id, remolque_id) values (e, '2026-10-01', cat, 10, u, r1);
    raise notice '61c FALLA: costo con dos equipos';
  exception when check_violation then raise notice '61c OK: un costo es de un solo equipo'; end;
  begin insert into costos (empresa_id, mes, categoria_id, monto) values (e, '2026-10-15', cat, 10);
    raise notice '61d FALLA: mes que no es día 1';
  exception when check_violation then raise notice '61d OK: el mes empieza el día 1'; end;

  -- 62. Interruptor de rentabilidad por categoría
  select id into sueldo from categorias_costo where empresa_id = e and nombre = 'Sueldo y prestaciones del operador';
  update categorias_costo set incluir_en_rentabilidad = true where id = sueldo; get diagnostics n = row_count;
  raise notice '62 categorías que administración cambió (esperado 1): %', n;
  update categorias_costo set incluir_en_rentabilidad = false where id = sueldo;
  select count(*) into n from bitacora where tabla = 'categorias_costo' and registro_id = sueldo and campo = 'incluir_en_rentabilidad';
  raise notice '62b cambios del interruptor en la bitácora (esperado 2): %', n;

  -- 63. Captura no ve ni registra costos; nadie los borra
  perform set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000a2',false);
  select count(*) into n from costos; raise notice '63 costos que ve captura (esperado 0): %', n;
  select count(*) into n from categorias_costo; raise notice '63b categorías de costo que ve captura (esperado 0): %', n;
  begin insert into costos (empresa_id, mes, categoria_id, monto) values (e, '2026-10-01', cat, 10);
    raise notice '63c FALLA: captura registró un costo';
  exception when insufficient_privilege then raise notice '63c OK: captura no registra costos'; end;
  perform set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000a1',false);
  delete from costos where empresa_id = e; get diagnostics n = row_count;
  raise notice '63d costos borrados (esperado 0): %', n;

  -- 64. Otra empresa no ve costos de A ni liga su costo a equipo de A
  perform set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000d1',false);
  select count(*) into n from costos; raise notice '64 costos de A que ve otra empresa (esperado 0): %', n;
  select c.id into otra from categorias_costo c join miembros m on m.empresa_id = c.empresa_id where m.usuario_id = auth.uid() limit 1;
  begin insert into costos (empresa_id, mes, categoria_id, monto, unidad_id)
      select empresa_id, '2026-10-01', otra, 10, u from miembros where usuario_id = auth.uid();
    raise notice '64b FALLA: costo ligado a unidad de otra empresa';
  exception when foreign_key_violation then raise notice '64b OK: el equipo del costo es de la misma empresa'; end;
  select prorrateo_generales into t from parametros_empresa limit 1;
  raise notice '64c prorrateo por defecto en partes iguales: %', case when t = 'partes_iguales' then 'OK' else 'FALLA' end;
end $$;

-- ---------- Montos e impuestos (migración 20261123000000) ----------
do $$
declare n int; t text; x numeric; e uuid := (select v from ctx where k='empA'); o uuid := (select v from ctx where k='opA');
  f uuid := (select v from ctx where k='fA'); eb uuid; u uuid; vj uuid; cat uuid; carga uuid;
begin
  perform set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000a1',false);
  -- 70. "¿Tiene factura?" por defecto por categoría
  select string_agg(nombre || '=' || tiene_factura, ', ' order by nombre) into t from categorias_gasto
  where empresa_id = e and nombre in ('Casetas', 'Urea (DEF)', 'Refacciones', 'Reparaciones en ruta', 'Viáticos/comidas', 'Propinas', 'Otros');
  raise notice '70 factura por defecto en gastos: %', case when t = 'Casetas=true, Otros=false, Propinas=false, Refacciones=true, Reparaciones en ruta=true, Urea (DEF)=true, Viáticos/comidas=false' then 'OK' else 'FALLA ' || coalesce(t, 'null') end;
  select count(*) into n from categorias_costo where empresa_id = e and tiene_factura = (nombre not in ('Sueldo y prestaciones del operador', 'Otros'));
  raise notice '70b factura por defecto en categorías de costo (esperado 13): %', n;

  -- 71. Gasto con factura: se guarda total e IVA; el costo es total − IVA
  select id into u from unidades where empresa_id = e and numero_economico = '0708';
  insert into viajes (empresa_id, unidad_id, operador_id, fecha_salida) values (e, u, o, now()) returning id into vj;
  select id into cat from categorias_gasto where empresa_id = e and nombre = 'Casetas';
  insert into gastos_viaje (empresa_id, viaje_id, categoria_id, monto, tiene_factura, tasa_iva, iva) values (e, vj, cat, 1160, true, 16, 160);
  select costo into x from gastos_viaje where viaje_id = vj;
  raise notice '71 costo para rentabilidad del gasto (esperado 1000): %', x::int;
  begin insert into gastos_viaje (empresa_id, viaje_id, categoria_id, monto, tiene_factura, iva) values (e, vj, cat, 100, false, 16);
    raise notice '71b FALLA: IVA sin factura';
  exception when check_violation then raise notice '71b OK: sin factura no hay IVA'; end;
  begin insert into gastos_viaje (empresa_id, viaje_id, categoria_id, monto, tiene_factura, tasa_iva, iva) values (e, vj, cat, 100, true, 10, 9);
    raise notice '71c FALLA: tasa de IVA inventada';
  exception when check_violation then raise notice '71c OK: solo tasas 16, 8 y 0'; end;
  begin insert into gastos_viaje (empresa_id, viaje_id, categoria_id, monto, tiene_factura, iva) values (e, vj, cat, 100, true, 200);
    raise notice '71d FALLA: IVA mayor que el total';
  exception when check_violation then raise notice '71d OK: el IVA no pasa del total'; end;

  -- 72. Carga con factura y precio de 4 decimales; sin importe no hay costo guardado
  insert into cargas_diesel (empresa_id, viaje_id, unidad_id, operador_id, fuente_id, litros, precio_litro, importe, tiene_factura, iva)
    values (e, vj, u, o, f, 1299.44, 27.0117, 35100, true, 4841.38) returning id into carga;
  select costo::text || ' ' || precio_litro::text into t from cargas_diesel where id = carga;
  raise notice '72 costo y precio de la carga: %', case when t = '30258.62 27.0117' then 'OK' else 'FALLA ' || coalesce(t, 'null') end;
  insert into cargas_diesel (empresa_id, viaje_id, unidad_id, operador_id, fuente_id, litros, tiene_factura) values (e, vj, u, o, f, 50, true) returning id into carga;
  select count(*) into n from cargas_diesel where id = carga and costo is null and iva = 0;
  raise notice '72b carga sin importe: costo se estima en la app (esperado 1): %', n;

  -- 73. Cargos adicionales: solo quien ve tarifas; nadie los borra; no en viajes cerrados
  insert into cargos_adicionales (empresa_id, viaje_id, concepto, monto) values (e, vj, 'Estadía', 1500);
  perform set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000a2',false);
  select count(*) into n from cargos_adicionales; raise notice '73 cargos adicionales que ve captura sin permiso (esperado 0): %', n;
  begin insert into cargos_adicionales (empresa_id, viaje_id, concepto, monto) values (e, vj, 'Maniobra', 800);
    raise notice '73b FALLA: captura sin permiso agregó un cargo';
  exception when insufficient_privilege then raise notice '73b OK: captura sin permiso no agrega cargos'; end;
  perform set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000d1',false);
  select count(*) into n from cargos_adicionales; raise notice '73c cargos de A que ve otra empresa (esperado 0): %', n;
  perform set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000a1',false);
  delete from cargos_adicionales where viaje_id = vj; get diagnostics n = row_count;
  raise notice '73d cargos borrados (esperado 0): %', n;
  select count(*) into n from bitacora where viaje_id = vj and tabla = 'cargos_adicionales';
  raise notice '73e el cargo aparece en la bitácora (esperado 1): %', n;
  begin insert into cargos_adicionales (empresa_id, viaje_id, concepto, monto) values (e, (select v from ctx where k='viajeCerrado'), 'Estadía', 100);
    raise notice '73f FALLA: cargo en viaje cerrado';
  exception when raise_exception then raise notice '73f OK: no se agregan cargos a un viaje cerrado'; end;

  -- 74. Pago por defecto de una empresa nueva: 12.6 % del flete con peso cargado
  -- (Flotilla Y, del usuario d1, se creó después de las migraciones)
  perform set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000d1',false);
  select empresa_id into eb from miembros where usuario_id = auth.uid();
  select esquema::text || ' ' || base_flete || ' ' || pct::text into t from pago_operador_config where empresa_id = eb and operador_id is null;
  raise notice '74 pago por defecto: %', case when t = 'pct_flete cargado 12.60' then 'OK' else 'FALLA ' || coalesce(t, 'null') end;
  select count(*) into n from categorias_gasto where empresa_id = eb and nombre = 'Propinas' and not tiene_factura;
  raise notice '74b empresa nueva con Propinas sin factura (esperado 1): %', n;
end $$;
