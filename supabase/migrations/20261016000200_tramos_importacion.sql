-- =====================================================================
-- Control Diésel — tramos del viaje, crédito en estación e importación
-- 1. Una ruta del catálogo es un tramo de UN sentido (origen → destino) con
--    los km de ese sentido. Un viaje tiene un tramo cargado y un tramo vacío
--    opcional (regreso o reposicionamiento), cada uno con su ruta. Los km se
--    prellenan desde la ruta pero son editables; se guarda el km de la ruta al
--    capturar para marcar desviaciones (tolerancia_km_pct de la empresa).
-- 2. Nuevo tipo de fuente: crédito en estación (p. ej. SERVIFACIL).
-- 3. importar_catalogos(): guarda una importación completa o nada.
-- =====================================================================

-- ---------- 1. Tramos ----------
alter table viajes rename column ruta_id to ruta_cargado_id;
alter table viajes rename constraint viajes_ruta_misma_empresa to viajes_ruta_cargado_misma_empresa;
alter table viajes
  add column ruta_vacio_id   uuid,
  -- km de la ruta del catálogo al momento de capturar (para comparar con lo capturado)
  add column km_cargado_ruta numeric(8,1) check (km_cargado_ruta is null or km_cargado_ruta > 0),
  add column km_vacio_ruta   numeric(8,1) check (km_vacio_ruta is null or km_vacio_ruta > 0),
  add constraint viajes_ruta_vacio_misma_empresa
    foreign key (empresa_id, ruta_vacio_id) references rutas (empresa_id, id);
create index on viajes (ruta_cargado_id);
create index on viajes (ruta_vacio_id);

alter table parametros_empresa
  add column tolerancia_km_pct numeric(5,2) not null default 10
    check (tolerancia_km_pct > 0 and tolerancia_km_pct <= 100);

-- ---------- 2. Crédito en estación ----------
alter type tipo_fuente_diesel add value if not exists 'credito_estacion';

-- ---------- 3. Importación todo o nada ----------
-- security invoker: aplica RLS (solo dueño y administración escriben catálogos).
-- Una sola función = una sola transacción: si una fila falla, no se guarda nada.
create function importar_catalogos(p_empresa uuid, p_datos jsonb) returns jsonb
language plpgsql security invoker set search_path = public as $$
declare
  v_unidades int := 0; v_operadores int := 0; v_clientes int := 0; v_rutas int := 0; v_fuentes int := 0;
begin
  if not es_admin(p_empresa) then
    raise exception 'Solo dueño y administración importan catálogos' using errcode = 'insufficient_privilege';
  end if;

  insert into unidades (empresa_id, numero_economico, placas, numero_serie, marca, modelo, anio, rend_cargado_kml, rend_vacio_kml)
  select p_empresa, numero_economico, placas, numero_serie, marca, modelo, anio, rend_cargado_kml, rend_vacio_kml
  from jsonb_to_recordset(coalesce(p_datos->'unidades', '[]')) as x(
    numero_economico text, placas text, numero_serie text, marca text, modelo text, anio int,
    rend_cargado_kml numeric, rend_vacio_kml numeric);
  get diagnostics v_unidades = row_count;

  insert into operadores (empresa_id, nombre, telefono)
  select p_empresa, nombre, telefono
  from jsonb_to_recordset(coalesce(p_datos->'operadores', '[]')) as x(nombre text, telefono text);
  get diagnostics v_operadores = row_count;

  insert into clientes (empresa_id, nombre, rfc)
  select p_empresa, nombre, rfc
  from jsonb_to_recordset(coalesce(p_datos->'clientes', '[]')) as x(nombre text, rfc text);
  get diagnostics v_clientes = row_count;

  insert into rutas (empresa_id, origen, destino, km, rend_cargado_kml, rend_vacio_kml)
  select p_empresa, origen, destino, km, rend_cargado_kml, rend_vacio_kml
  from jsonb_to_recordset(coalesce(p_datos->'rutas', '[]')) as x(
    origen text, destino text, km numeric, rend_cargado_kml numeric, rend_vacio_kml numeric);
  get diagnostics v_rutas = row_count;

  insert into fuentes_diesel (empresa_id, nombre, tipo, capacidad_litros)
  select p_empresa, nombre, tipo::tipo_fuente_diesel, capacidad_litros
  from jsonb_to_recordset(coalesce(p_datos->'fuentes', '[]')) as x(nombre text, tipo text, capacidad_litros numeric);
  get diagnostics v_fuentes = row_count;

  return jsonb_build_object(
    'unidades', v_unidades, 'operadores', v_operadores, 'clientes', v_clientes,
    'rutas', v_rutas, 'fuentes', v_fuentes
  );
end;
$$;

revoke execute on function importar_catalogos(uuid, jsonb) from public, anon;
grant execute on function importar_catalogos(uuid, jsonb) to authenticated;
