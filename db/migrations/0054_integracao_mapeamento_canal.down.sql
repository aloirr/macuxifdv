-- 0054_integracao_mapeamento_canal (down) — desfaz a 0054 (T-0115) e volta exatamente ao catálogo da 0053.
-- APAGA as linhas de integracao.mapeamento com tipo 'canal' (vivas e removidas; o CHECK da 0010 não as aceita). Sem o de-para,
-- o Hub publica o canal como veio do ERP. Volte antes o código do BKO/Hub que grava tipo 'canal' (senão o PUT de mapeamento
-- dá 23514). Idempotente. Pré-condição: 0055+ desfeitas.

alter table integracao.mapeamento drop constraint if exists mapeamento_tipo_valido;
delete from integracao.mapeamento where tipo = 'canal';
alter table integracao.mapeamento add constraint mapeamento_tipo_valido
  check (tipo in ('condicao_pagamento', 'deposito', 'status'));
