-- 0097_core_cliente_pre_cadastro_erp (up) — v1.0.28 (decisão do dono do produto, 23/11/2026: "O FDV só faz pre cadastro mesmo.
-- O vendedor faz, chega no ERP e o BKO aprova por lá."; RN-CORE-78, RN-INT-22). Migração em cima da 0096
-- (integracao_cliente_fila_erp); o número segue a ordem de merge (provisório até o gerente confirmar). Dicionários:
-- docs/banco/core.md e docs/banco/integracao.md ("0097"). Teste: db/testes/cliente-pre-cadastro-erp.db.test.ts (estático
-- sempre; banco e up/down com o Postgres local).
--
-- Ninguém aprova no FDV: o pré-cadastro (campo ou BKO) entra na fila do ERP assim que o servidor o recebe ('pendente'), e o
-- ERP devolve o código (status 'aprovado') ou a recusa com o motivo (status 'recusado').
--
-- 1. core.cliente (dono: Core):
--      aprovado_por              SAI (com o CHECK cliente_aprovacao_par): ninguém aprova no FDV. O drop column leva o SELECT
--                                por coluna do macuxi_leitura.
--      aprovado_em               FICA, com outro sentido: quando o ERP aprovou (UTC, gravado no retorno 'vinculado'); só com
--                                status 'aprovado' (cliente_aprovacao_status, da 0095, não muda). Linhas aprovadas no BKO na
--                                v1.0.27 guardam a hora do BKO.
--      motivo_recusa text        NOVA: motivo da recusa do ERP, até 500 caracteres (cliente_motivo_recusa_tamanho) e só com
--                                status 'recusado' (cliente_motivo_recusa_status); nulo = sem motivo (recusa legada do BKO).
--                                Vai no pull do aparelho (o vendedor do cliente vê); nunca em log nem na auditoria. SEM grant ao
--                                macuxi_leitura (texto livre do ERP; a saída desse papel vai para o log do Actions).
--    Índice: sai cliente_aprovado_sem_erp_ix (fila dos aprovados no BKO); entra cliente_pre_cadastro_fila_ix (tenant_id,
--    created_at, id) where status_cadastro = 'pendente' and external_id is null and deleted_at is null: a consulta
--    core.clientes_pre_cadastro_sem_erp@1 (pendentes sem código, em ordem de chegada, paginada por (created_at, id)).
--    Pull: os pré-cadastros vivos (origem_cadastro <> 'erp') têm o updated_at andado uma vez, para o aparelho receber
--    status_cadastro e motivo_recusa no próximo pull (dezenas de linhas por tenant).
--
-- 2. integracao.cliente_fila_erp (dono: Integração): aprovado_em vira recebido_em (quando o Core recebeu o pré-cadastro). O
--    índice do poll cliente_fila_erp_poll_ix e o SELECT por coluna do macuxi_leitura acompanham o rename (mesmo nome do índice).
--
-- RLS: nenhuma política nova; as de core.cliente e de integracao.cliente_fila_erp valem para as colunas. Nenhum grant novo.
-- Volume: core.cliente (milhares a dezenas de milhares por tenant); os pendentes sem código são poucos (dezenas).
--
-- Caminho de volta: 0097_core_cliente_pre_cadastro_erp.down.sql (APAGA motivo_recusa e o índice novo; aprovado_por volta
-- preenchido com o UUID nulo nas linhas com aprovado_em, para o CHECK par voltar valendo; recebido_em volta a aprovado_em).
-- Volte antes o código do Core e do Hub que lê ou grava motivo_recusa ou recebido_em (senão 42703).

-- 1. core.cliente
drop index core.cliente_aprovado_sem_erp_ix;
alter table core.cliente drop constraint cliente_aprovacao_par;
alter table core.cliente drop column aprovado_por;
alter table core.cliente add column motivo_recusa text;
alter table core.cliente add constraint cliente_motivo_recusa_tamanho
  check (motivo_recusa is null or char_length(motivo_recusa) <= 500);
alter table core.cliente add constraint cliente_motivo_recusa_status
  check (motivo_recusa is null or status_cadastro = 'recusado');

create index cliente_pre_cadastro_fila_ix on core.cliente (tenant_id, created_at, id)
  where status_cadastro = 'pendente' and external_id is null and deleted_at is null;

-- pull: o aparelho recebe status_cadastro e motivo_recusa dos pré-cadastros que já tem (o gatilho cliente_updated_at anda a data)
update core.cliente set updated_at = now() where origem_cadastro <> 'erp' and deleted_at is null;

-- 2. integracao.cliente_fila_erp
alter table integracao.cliente_fila_erp rename column aprovado_em to recebido_em;
