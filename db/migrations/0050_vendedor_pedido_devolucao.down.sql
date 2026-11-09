-- 0050_vendedor_pedido_devolucao (down) — desfaz a 0050 (T-0054, RN-VEN-37) e volta exatamente ao catálogo da 0049.
-- APAGA vendedor.pedido_devolucao com as devoluções gravadas (o devolvido dos pedidos volta a 0; as notas de devolução seguem
-- no ERP e voltam pelo integracao.nota.atualizado@1 se a 0050 for reaplicada e a carga reenviada). Antes, volte o Vendedor para
-- DEVOLUCAO_LIGADA = false (modules/vendedor/api/retorno-erp.ts). Política, gatilho, índices e grant saem com a tabela.
-- Idempotente (if exists). Pré-condição: 0051+ desfeitas.

drop table if exists vendedor.pedido_devolucao;
