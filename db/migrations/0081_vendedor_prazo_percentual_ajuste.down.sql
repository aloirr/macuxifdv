-- 0081_vendedor_prazo_percentual_ajuste (down) — desfaz a 0081 (v1.0.14, RN-VEN-43 a 46, RN-INT-15) e volta à 0080.
-- APAGA os CHECKs prazo_pagamento_percentual_ajuste_faixa, pedido_prazo_percentual_ajuste_faixa e
-- pedido_prazo_percentual_com_prazo e as colunas vendedor.prazo_pagamento.percentual_ajuste e
-- vendedor.pedido.prazo_percentual_ajuste (os percentuais do ERP e os retratos dos pedidos se perdem; reaplicar a 0081 volta
-- os prazos a 0 até a próxima carga do ERP). Volte antes o Vendedor (API, pull, BKO) e a Integração (consumidor do Hub,
-- envio ao ERP) que leem/gravam as colunas (senão 42703). Idempotente (if exists em tudo). Pré-condição: 0082+ desfeitas.

alter table vendedor.pedido drop constraint if exists pedido_prazo_percentual_com_prazo;
alter table vendedor.pedido drop constraint if exists pedido_prazo_percentual_ajuste_faixa;
alter table vendedor.pedido drop column if exists prazo_percentual_ajuste;
alter table vendedor.prazo_pagamento drop constraint if exists prazo_pagamento_percentual_ajuste_faixa;
alter table vendedor.prazo_pagamento drop column if exists percentual_ajuste;
