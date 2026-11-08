-- 0044_treinamento_xp_referencia (up) — T-0106: lançamento de XP com referência maior e chaves de idempotência
-- (pedido R-20261107-233051-modulo-treinamento; RN-TRE-01, RN-TRE-02, RN-TRE-04, RN-TRE-08). Dicionário: docs/banco/treinamento.md
-- ("Lançamento de XP (0044)"). Migração em cima da 0043 (nenhuma anterior muda). Só treinamento.xp_lancamento; sem tabela, índice,
-- política nem grant novo (append-only: o macuxi_app continua só com select e insert).
--
-- 1. referencia_id passa de 1..128 para 1..160 caracteres (CHECK xp_lancamento_referencia_tamanho, mesmo nome):
--    `desafio_id:pedido_id:evento_id` com 3 UUIDs = 110; folga para id que não é UUID. Linhas existentes já cabem.
-- 2. xp_lancamento_tenant_id_uk unique (tenant_id, id): idempotência por id com o tenant (duplicado motivo ID) e alvo de FK
--    composta, como nas outras tabelas da regra 5. O PK (id) continua.
-- 3. A chave natural xp_lancamento_chave_uk (tenant_id, usuario_id, origem, referencia_id) da 0017 FICA TOTAL, não parcial em
--    deleted_at is null como no pedido: a tabela é append-only (sem update/delete para o macuxi_app, deleted_at nunca é
--    gravado pela aplicação), então total e parcial barram o mesmo; o total é o que o repositório usa no
--    `on conflict (tenant_id, usuario_id, origem, referencia_id) do nothing` (com índice parcial esse alvo falharia: 42P10).
-- 4. SEM o índice (tenant_id, usuario_id, origem, referencia_id text_pattern_ops) do pedido: sob RLS o LIKE não é leakproof, então o
--    planejador do macuxi_app nunca o usaria como condição de índice (só os operadores leakproof das políticas e das
--    igualdades viram Index Cond). O teto do desafio (origem = 'desafio_vendas' and referencia_id like '<desafio_id>:%')
--    já entra por xp_lancamento_chave_uk com igualdade em (tenant_id, usuario_id, origem) e filtra o LIKE entre os lançamentos de
--    desafio do usuário (centenas no máximo). O teto diário segue em xp_lancamento_usuario_dia_ix (0017).
-- Volume: um lançamento por lição/quiz/trilha/streak/evento de pedido; dezenas de milhares por tenant/ano.
-- Caminho de volta: 0044_treinamento_xp_referencia.down.sql (volta o CHECK a 1..128 — recusa se houver referência com mais de
-- 128 caracteres, com a contagem; tira o único com o tenant).

alter table treinamento.xp_lancamento drop constraint xp_lancamento_referencia_tamanho;
alter table treinamento.xp_lancamento add constraint xp_lancamento_referencia_tamanho
  check (char_length(referencia_id) between 1 and 160);
alter table treinamento.xp_lancamento add constraint xp_lancamento_tenant_id_uk unique (tenant_id, id);
