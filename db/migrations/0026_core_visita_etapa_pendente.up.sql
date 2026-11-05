-- 0026_core_visita_etapa_pendente (up) — T-0039 §2 (tolerância no checkout; pedido R-20261105-022419-engenheiro-software;
-- desenho docs/desenho/T-0039.md §2.2; complemento da RN-CORE-12 no doc 03, 05/11). Dicionário: docs/banco/core.md.
-- Migração ADITIVA e idempotente (if not exists / drop if exists + add): nenhuma linha existente é reescrita (as colunas
-- novas de visita_etapa nascem nulas; core.visita.etapas_pendentes nasce 0 pelo padrão, sem reescrever a tabela nem mexer
-- em updated_at). Não liga nada: o Core passa a gravar 'pendente' só quando o gerente liberar a §2 da T-0039.
--
-- core.visita_etapa (uma linha por (tenant_id, visita_id, modulo, etapa), único visita_etapa_uk da 0006, alvo do upsert):
--   situacao: CHECK visita_etapa_situacao_valida passa a aceitar 'pendente' (concluida | dispensada | pendente).
--     'pendente' = etapa obrigatória de OUTRO módulo (consulta <modulo>.etapas_checkout@1) não concluída no servidor
--     quando o checkout chegou; o checkout é aceito (RN-CORE-12, complemento). A baixa troca para 'concluida'.
--   rotulo (text, null): texto da etapa como veio da consulta (EtapaCheckoutSchema.rotulo, 1..120), para o BKO e a
--     notificação sem chamar o módulo. CHECK visita_etapa_rotulo_preenchido (null ou não vazio, até 120).
--   pendente_desde (timestamptz, null): instante do SERVIDOR no checkout que marcou a pendência. Obrigatório com
--     situacao = 'pendente' (CHECK visita_etapa_pendente_tem_desde); continua preenchido depois da baixa (histórico).
--   resolvida_em (timestamptz, null): instante do servidor na baixa (evento pesquisa.resposta.registrada@1 + reconsulta).
--     Só fora de 'pendente' e só numa linha que já esteve pendente (CHECK visita_etapa_resolvida_coerente).
--   alertada_em (timestamptz, null): instante em que o job do alerta (checkout_pendencia_alerta_h) notificou; uma vez
--     por pendência. Só numa linha que esteve pendente (CHECK visita_etapa_alertada_coerente).
--   Índice parcial visita_etapa_pendente_ix (tenant_id, pendente_desde) where situacao = 'pendente' and deleted_at is null:
--     varredura do alerta por tenant e por idade (pendente_desde < agora - prazo) e a lista de pendências abertas.
--     A baixa por visita usa o único visita_etapa_uk (tenant_id, visita_id, modulo, etapa).
-- core.visita:
--   etapas_pendentes (smallint not null default 0, CHECK visita_etapas_pendentes_nao_negativa >= 0): contagem das linhas
--     'pendente' vivas da visita, mantida pelo Core NA MESMA TRANSAÇÃO que mexe em visita_etapa (o banco não recalcula).
--     Vai no pull da visita (o aparelho e o BKO não leem visita_etapa).
--   Índice parcial visita_etapas_pendentes_ix (tenant_id, checkin_em desc) where etapas_pendentes > 0 and deleted_at is
--     null: filtro "Com etapa pendente" do BKO (fica pequeno: só visitas com pendência aberta).
-- Parâmetro do prazo: plataforma.parametro (modulo 'core', chave 'checkout_pendencia_alerta_h', inteiro 1..168 horas),
--   SEM linha semeada: ausente = padrão 24 do contrato do Core (mesma convenção de inicio.parado_min, 0021/T-0073). Nada
--   muda no banco para o parâmetro (tabela, único parametro_uk e RLS da 0001 já servem); faixa e padrão moram no Core.
--
-- RLS: as duas tabelas já têm enable/force e a política isolamento_tenant (0006); nenhuma política nova, grants iguais.
-- FK visita_etapa_visita_fk (tenant_id, visita_id) -> core.visita (tenant_id, id) da 0006 continua (visita do PRÓPRIO tenant).
-- Caminho de volta: 0026_core_visita_etapa_pendente.down.sql (APAGA as linhas 'pendente' de visita_etapa, que o código
-- anterior não entende, as 4 colunas novas, a contagem da visita e os 2 índices; volta o CHECK concluida | dispensada).

-- core.visita_etapa ------------------------------------------------------------------------------------------------------
alter table core.visita_etapa add column if not exists rotulo text;
alter table core.visita_etapa add column if not exists pendente_desde timestamptz;
alter table core.visita_etapa add column if not exists resolvida_em timestamptz;
alter table core.visita_etapa add column if not exists alertada_em timestamptz;

alter table core.visita_etapa drop constraint if exists visita_etapa_situacao_valida;
alter table core.visita_etapa add constraint visita_etapa_situacao_valida
  check (situacao in ('concluida', 'dispensada', 'pendente'));

alter table core.visita_etapa drop constraint if exists visita_etapa_rotulo_preenchido;
alter table core.visita_etapa add constraint visita_etapa_rotulo_preenchido
  check (rotulo is null or (btrim(rotulo) <> '' and char_length(rotulo) <= 120));

alter table core.visita_etapa drop constraint if exists visita_etapa_pendente_tem_desde;
alter table core.visita_etapa add constraint visita_etapa_pendente_tem_desde
  check (situacao <> 'pendente' or pendente_desde is not null);

alter table core.visita_etapa drop constraint if exists visita_etapa_resolvida_coerente;
alter table core.visita_etapa add constraint visita_etapa_resolvida_coerente
  check (resolvida_em is null or (situacao <> 'pendente' and pendente_desde is not null));

alter table core.visita_etapa drop constraint if exists visita_etapa_alertada_coerente;
alter table core.visita_etapa add constraint visita_etapa_alertada_coerente
  check (alertada_em is null or pendente_desde is not null);

create index if not exists visita_etapa_pendente_ix on core.visita_etapa (tenant_id, pendente_desde)
  where situacao = 'pendente' and deleted_at is null;

-- core.visita ------------------------------------------------------------------------------------------------------------
alter table core.visita add column if not exists etapas_pendentes smallint not null default 0;

alter table core.visita drop constraint if exists visita_etapas_pendentes_nao_negativa;
alter table core.visita add constraint visita_etapas_pendentes_nao_negativa check (etapas_pendentes >= 0);

create index if not exists visita_etapas_pendentes_ix on core.visita (tenant_id, checkin_em desc)
  where etapas_pendentes > 0 and deleted_at is null;
