-- 0081_vendedor_prazo_percentual_ajuste (up) — v1.0.14: "% Acres.Fin." do prazo de pagamento ajusta a tabela de cada produto
-- (RN-VEN-43 a 46, RN-INT-15). Proposta aprovada: docs/modulos/vendedor/prazo-desconto-acrescimo.md §5, §6 e §9 (SHA 454ee68,
-- R-20261115-123000). Dicionário: docs/banco/vendedor.md ("0081").
--
-- Migração ADITIVA: 2 colunas e 3 CHECKs. Nenhum contrato muda de versão (campo opcional no v1, RN-INT-09); RLS, políticas,
-- grants e índices de vendedor.prazo_pagamento e vendedor.pedido não mudam (as colunas herdam os da tabela). Sem backfill:
-- `add column ... not null default 0` preenche os prazos existentes sem reescrever a tabela (PG >= 11) e SEM andar o
-- updated_at (nenhum aparelho puxa de novo por causa da 0081; ausente = 0 no app).
--
-- vendedor.prazo_pagamento.percentual_ajuste  numeric(5,2) not null default 0
--   % do prazo vindo do ERP ("% Acres.Fin."), −99,99 a +99,99 (prazo_pagamento_percentual_ajuste_faixa); negativo = desconto.
--   Somente leitura no BKO e no CSV; prazo criado no BKO entra com 0 (RN-VEN-46). Quem grava: consumidor do Hub (RN-INT-15).
-- vendedor.pedido.prazo_percentual_ajuste  numeric(5,2) null
--   RETRATO do percentual do prazo no momento do pedido (RN-VEN-45), mesma faixa (pedido_prazo_percentual_ajuste_faixa).
--   Nulo no pedido antigo e no do APK anterior à v1.0.14 (= sem ajuste). Fora do CHECK pedido_pagamento_completo (0037) de
--   propósito: o APK antigo manda os 8 campos do pagamento sem o percentual. Só existe com prazo (pedido_prazo_percentual_com_prazo).
--   A API recalcula e revalida (faixa, 2 casas, vigente ou cadastro mudado depois do criado_em; RN-VEN-40/45).
-- Volume: o de hoje (dezenas de prazos; pedidos por tenant). Consultas: as de hoje; nenhum índice novo.
--
-- Caminho de volta: 0081_vendedor_prazo_percentual_ajuste.down.sql (apaga os 3 CHECKs e as 2 colunas; os percentuais vindos
-- do ERP e os retratos dos pedidos se perdem — a próxima carga do ERP repõe os do prazo). Volte antes o código do Vendedor e da
-- Integração que lê ou grava as colunas (senão 42703).

alter table vendedor.prazo_pagamento add column percentual_ajuste numeric(5,2) not null default 0;
alter table vendedor.prazo_pagamento add constraint prazo_pagamento_percentual_ajuste_faixa
  check (percentual_ajuste between -99.99 and 99.99);

alter table vendedor.pedido add column prazo_percentual_ajuste numeric(5,2);
alter table vendedor.pedido add constraint pedido_prazo_percentual_ajuste_faixa
  check (prazo_percentual_ajuste is null or prazo_percentual_ajuste between -99.99 and 99.99);
alter table vendedor.pedido add constraint pedido_prazo_percentual_com_prazo
  check (prazo_percentual_ajuste is null or prazo_pagamento_id is not null);
