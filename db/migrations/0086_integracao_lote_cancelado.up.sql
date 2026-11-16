-- 0086_integracao_lote_cancelado (up) — T-0173 (RN-INT-15): o lote ganha o estado final `cancelado` (ação "Cancelar lote"
-- do monitor; só `recebido` e `processando` podem ser cancelados: regra no domain do modulo-integracao, TRANSICOES_LOTE).
-- Migração em cima da 0085 (número provisório, renumerado na ordem de merge). Dicionário: docs/banco/integracao.md ("0086"). Teste: db/testes/lote-cancelado.db.test.ts.
--
-- O que muda (só catálogo; NENHUM dado é tocado):
--   integracao.lote.lote_status_valido  recriado com os 6 estados (= ESTADOS_LOTE_BANCO em modules/integracao/db/nuvem.ts).
--                                        Tudo o que era aceito continua aceito: a validação do ADD não recusa linha.
--   integracao.expurgar_retencao        create or replace (assinatura, SECURITY DEFINER, search_path com pg_temp da 0012 e
--                                        grants iguais): o lote `cancelado` segue a retenção do lote final, apagado 12 meses
--                                        depois de recebido (cascata em lote_staging e lote_linha_erro), e o corpo do
--                                        staging é anulado 7 dias depois (coalesce(concluido_em, recebido_em)). Sem isso o
--                                        lote cancelado e o corpo do staging (dados do ERP) nunca sairiam.
-- Conferido sem mudança: os índices parciais lote_processando_uk (status = 'processando') e lote_fila_ix (status in
-- ('recebido', 'processando')); o cancelado sai da fila e libera o "um processando por Conector+entidade", como esperado.
-- Nenhuma view (nem as views-modelo do Conector, que leem o ERP) usa integracao.lote.status.
-- Idempotente (drop if exists + add; create or replace). Lock: ACCESS EXCLUSIVE curto em integracao.lote (varredura do CHECK).
-- Caminho de volta: 0086_integracao_lote_cancelado.down.sql (exige nenhum lote `cancelado`; ver a pré-condição lá).

alter table integracao.lote drop constraint if exists lote_status_valido;
alter table integracao.lote add constraint lote_status_valido
  check (status in ('recebido', 'processando', 'concluido', 'concluido_com_erros', 'falhou', 'cancelado'));

create or replace function integracao.expurgar_retencao(p_agora timestamptz default now(), p_limite integer default 5000)
  returns table (item text, quantidade bigint)
  language plpgsql volatile security definer
  set search_path = pg_catalog, integracao, pg_temp
  as $$
#variable_conflict use_column
declare
  n bigint;
begin
  if p_agora is null or p_limite is null or p_limite < 1 then
    raise exception 'expurgar_retencao: p_agora obrigatório e p_limite >= 1';
  end if;

  delete from integracao.lote l
   where l.id in (select x.id from integracao.lote x
                   where x.status in ('concluido', 'concluido_com_erros', 'falhou', 'cancelado') and x.recebido_em < p_agora - interval '12 months'
                   order by x.recebido_em limit p_limite);
  get diagnostics n = row_count;
  item := 'lote'; quantidade := n; return next;

  delete from integracao.credencial k
   where k.id in (select x.id from integracao.credencial x
                   where x.revogada_em < p_agora - interval '12 months'
                   order by x.revogada_em limit p_limite);
  get diagnostics n = row_count;
  item := 'credencial'; quantidade := n; return next;

  update integracao.lote_linha_erro e set payload = null
   where e.id in (select x.id from integracao.lote_linha_erro x
                   where x.payload is not null and x.created_at < p_agora - interval '30 days'
                   limit p_limite);
  get diagnostics n = row_count;
  item := 'lote_linha_erro.payload'; quantidade := n; return next;

  update integracao.lote_staging s set corpo = null
   where s.id in (select x.id from integracao.lote_staging x
                    join integracao.lote l on l.tenant_id = x.tenant_id and l.id = x.lote_id
                   where x.corpo is not null
                     and ((l.status in ('concluido', 'concluido_com_erros', 'cancelado') and coalesce(l.concluido_em, l.recebido_em) < p_agora - interval '7 days')
                       or (l.status = 'falhou' and coalesce(l.concluido_em, l.recebido_em) < p_agora - interval '30 days'))
                   limit p_limite);
  get diagnostics n = row_count;
  item := 'lote_staging.corpo'; quantidade := n; return next;

  delete from integracao.sessao_carga_recebido r
   where r.id in (select x.id from integracao.sessao_carga_recebido x
                    join integracao.sessao_carga s on s.tenant_id = x.tenant_id and s.id = x.sessao_id
                   where s.situacao <> 'aberta' and coalesce(s.fechada_em, s.iniciada_em) < p_agora - interval '7 days'
                     and not exists (select 1 from integracao.pendencia_inativacao p
                                      where p.tenant_id = s.tenant_id and p.sessao_id = s.id
                                        and p.estado = 'aguardando' and p.expira_em > p_agora)
                   limit p_limite);
  get diagnostics n = row_count;
  item := 'sessao_carga_recebido'; quantidade := n; return next;

  update integracao.registro_atual r set payload = null
   where r.id in (select x.id from integracao.registro_atual x
                   where x.payload is not null and x.deleted_at < p_agora - interval '30 days'
                   limit p_limite);
  get diagnostics n = row_count;
  item := 'registro_atual.payload'; quantidade := n; return next;
end
$$;
