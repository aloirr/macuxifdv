-- 0026_core_visita_etapa_pendente (down) — T-0039 §2
-- Desfaz a 0026 na ordem inversa. APAGA as linhas 'pendente' de core.visita_etapa (o CHECK da 0006 não as aceita e o
-- código anterior não as entende: a visita continua concluída, sem a marca da pendência), as colunas rotulo,
-- pendente_desde, resolvida_em e alertada_em (o histórico da baixa e do alerta se perde; as linhas 'concluida' e
-- 'dispensada' ficam), core.visita.etapas_pendentes e os dois índices. Linhas de plataforma.parametro
-- 'checkout_pendencia_alerta_h' gravadas pelo BKO ficam (sem efeito até um novo up). Idempotente (if exists em tudo).
-- Pré-condição: 0027+ desfeitas.

-- core.visita ------------------------------------------------------------------------------------------------------------
drop index if exists core.visita_etapas_pendentes_ix;
alter table core.visita drop constraint if exists visita_etapas_pendentes_nao_negativa;
alter table core.visita drop column if exists etapas_pendentes;

-- core.visita_etapa ------------------------------------------------------------------------------------------------------
drop index if exists core.visita_etapa_pendente_ix;
delete from core.visita_etapa where situacao = 'pendente';
alter table core.visita_etapa drop constraint if exists visita_etapa_alertada_coerente;
alter table core.visita_etapa drop constraint if exists visita_etapa_resolvida_coerente;
alter table core.visita_etapa drop constraint if exists visita_etapa_pendente_tem_desde;
alter table core.visita_etapa drop constraint if exists visita_etapa_rotulo_preenchido;
alter table core.visita_etapa drop constraint if exists visita_etapa_situacao_valida;
alter table core.visita_etapa add constraint visita_etapa_situacao_valida
  check (situacao in ('concluida', 'dispensada'));
alter table core.visita_etapa drop column if exists alertada_em;
alter table core.visita_etapa drop column if exists resolvida_em;
alter table core.visita_etapa drop column if exists pendente_desde;
alter table core.visita_etapa drop column if exists rotulo;
