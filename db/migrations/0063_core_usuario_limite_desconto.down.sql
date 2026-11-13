-- 0063_core_usuario_limite_desconto (down) — desfaz a 0063 (T-0168) e volta à core.usuario da 0062.
-- APAGA os CHECKs usuario_desconto_pedido_permil_faixa e usuario_desconto_pedido_com_limite e as colunas desconto_limita_item,
-- desconto_limita_pedido e desconto_maximo_pedido_permil (os limites gravados no BKO se perdem; reaplicar a 0063 volta todos
-- os usuários ao padrão: por item ligada, por pedido desligada, sem número).
-- Volte antes o Core (BKO, sync `usuario`, core.cadastro_resumo@1) e o Vendedor que leem/gravam as colunas (senão 42703).
-- Idempotente (if exists em tudo). Pré-condição: 0064+ desfeitas.

alter table core.usuario drop constraint if exists usuario_desconto_pedido_com_limite;
alter table core.usuario drop constraint if exists usuario_desconto_pedido_permil_faixa;
alter table core.usuario drop column if exists desconto_maximo_pedido_permil;
alter table core.usuario drop column if exists desconto_limita_pedido;
alter table core.usuario drop column if exists desconto_limita_item;
