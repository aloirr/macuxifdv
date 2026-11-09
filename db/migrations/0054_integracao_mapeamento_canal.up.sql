-- 0054_integracao_mapeamento_canal (up) — T-0115 (RN-PES-05): de-para do canal do cliente no BKO da Integração.
-- Pedido R-20261109-014928-modulo-integracao. Dicionário: docs/banco/integracao.md ("0054 — tipo 'canal' no de-para").
-- Migração em cima da 0053. ADITIVA, só integracao.mapeamento: o CHECK mapeamento_tipo_valido da 0010 é recriado com 'canal'
-- (= TIPOS_MAPEAMENTO de modules/integracao/contracts/bko.ts). O Hub traduz o código do ERP pelo de-para `canal` antes de
-- publicar o ClientePayload.canal. Índices NÃO mudam: mapeamento_codigo_erp_uk (tenant_id, tipo, codigo_erp) já vale para o
-- canal; o único-ativo por codigo_macuxi continua só da condicao_pagamento. RLS, políticas e grants herdados da 0010.
-- Sem backfill (nenhuma linha antiga tem tipo 'canal').
-- Caminho de volta: 0054_integracao_mapeamento_canal.down.sql (APAGA os de-paras de canal).

alter table integracao.mapeamento drop constraint mapeamento_tipo_valido;
alter table integracao.mapeamento add constraint mapeamento_tipo_valido
  check (tipo in ('condicao_pagamento', 'deposito', 'status', 'canal'));
