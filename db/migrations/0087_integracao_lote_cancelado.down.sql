-- 0087_integracao_lote_cancelado (down) — desfaz a 0087 e volta ao catálogo anterior: o CHECK lote_status_valido volta aos
-- 5 estados da 0010 e integracao.expurgar_retencao volta ao corpo da 0010 (com o search_path da 0012).
-- PRÉ-CONDIÇÃO: nenhum lote `cancelado`. O down NÃO altera dado: se houver algum, ele para com erro (P0001) sem mudar nada.
-- Antes do down, tire a ação "Cancelar lote" da API e do BKO e decida o destino dos cancelados, por exemplo
--   update integracao.lote set status = 'falhou', concluido_em = coalesce(concluido_em, now()) where status = 'cancelado';
-- (falhou é final, com retenção de 12 meses; o corpo do staging passa a sair em 30 dias). Idempotente.

do $$
begin
  if exists (select 1 from integracao.lote where status = 'cancelado') then
    raise exception '0087 down: há lote com status cancelado; mude o status deles antes (ver o cabeçalho do down)';
  end if;
end
$$;

alter table integracao.lote drop constraint if exists lote_status_valido;
alter table integracao.lote add constraint lote_status_valido
  check (status in ('recebido', 'processando', 'concluido', 'concluido_com_erros', 'falhou'));

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
                   where x.status in ('concluido', 'concluido_com_erros', 'falhou') and x.recebido_em < p_agora - interval '12 months'
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
                     and ((l.status in ('concluido', 'concluido_com_erros') and coalesce(l.concluido_em, l.recebido_em) < p_agora - interval '7 days')
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
