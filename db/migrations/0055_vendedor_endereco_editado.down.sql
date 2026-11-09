-- 0055_vendedor_endereco_editado (down) — desfaz a 0055 (T-0141 item C) e volta exatamente ao catálogo da 0054.
-- Só remove os 3 CHECKs; NÃO apaga nem reescreve dados: os retratos com origem 'editado' ficam no jsonb (o check
-- pedido_endereco_entrega_objeto da 0013 continua valendo) e a API lê origem ausente como 'erp'. Volte antes o Vendedor que
-- aceita endereco_entrega_editado no push se quiser parar de gravar editados. Idempotente. Pré-condição: 0056+ desfeitas.

alter table vendedor.pedido drop constraint if exists pedido_endereco_editado_completo;
alter table vendedor.pedido drop constraint if exists pedido_endereco_editado_sem_id;
alter table vendedor.pedido drop constraint if exists pedido_endereco_entrega_origem;
