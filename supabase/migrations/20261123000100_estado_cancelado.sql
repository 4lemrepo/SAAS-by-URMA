-- =====================================================================
-- Control Diésel — estado "cancelado" del viaje
-- Va solo en su archivo: un valor nuevo de un enum no se puede usar en la
-- misma transacción en que se agrega. Correr antes de 20261123000200.
-- =====================================================================
alter type estado_viaje add value if not exists 'cancelado';
