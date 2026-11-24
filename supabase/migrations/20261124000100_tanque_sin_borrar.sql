-- =====================================================================
-- Control Diésel — movimientos de tanque: nada se borra
-- La política "for all" de dueño y administración también dejaba borrar
-- movimientos por la API. Igual que viajes y cargas: se dan de alta y se
-- corrigen, pero no se borran.
-- (Editar gastos y cargas de un viaje abierto no necesita cambios en la base:
-- las políticas ya lo permiten, un viaje cerrado o cancelado los protege y
-- cada cambio queda en la bitácora.)
-- =====================================================================

drop policy tanque_admin on movimientos_tanque;
create policy tanque_leer on movimientos_tanque for select using (es_admin(empresa_id));
create policy tanque_alta on movimientos_tanque for insert with check (es_admin(empresa_id));
create policy tanque_editar on movimientos_tanque for update
  using (es_admin(empresa_id)) with check (es_admin(empresa_id));
