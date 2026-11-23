-- Rotina única da limpeza dos dados de UMA empresa (o "zerar dados"): pg_temp.macuxi_limpar_cadastros(tenant, lote, exigir_hub_parado).
-- Quem usa: o workflow .github/workflows/producao-limpar-cadastros.yml (scripts/producao/montar-limpeza.sh junta esta rotina
-- e limpar-cadastros.sql) e, depois, o botão "Zerar dados" da v1.0.30 (o worker roda este mesmo texto e chama a função na
-- transação dele; para o macuxi_worker, o banco-dados a promove a função SECURITY DEFINER numa migração, sem mudar o corpo).
-- Não abre nem fecha transação: quem chama decide entre COMMIT (apagar) e ROLLBACK (simular). Roda como o admin (dono das
-- tabelas, sem BYPASSRLS, herda o macuxi_manutencao: 0031). Devolve (r_ordem, r_tabela, r_modo, r_linhas): só nomes e contagens.
--
-- Ordem do Alexandre (23/11/2026): "APAGUE TUDO AGORA. VOU REENVIAR PELO ERP" e "1 A / 2 b / 3 A" (pedidos também saem).
--
-- RAÍZES (só do tenant):
--   - cadastros do ERP (vivos e COM external_id): core.cliente, core.produto, catalogo.catalogo_no, catalogo.tabela_preco,
--     catalogo.deposito, vendedor.forma_pagamento, vendedor.prazo_pagamento, vendedor.transportadora, core.rota, core.titulo,
--     core.nota_erp. Linha sem external_id (pré-cadastro do app, cadastro do BKO) fica, salvo se apontar para algo que sai;
--   - TODOS os pedidos vivos (vendedor.pedido);
--   - todas as linhas da empresa no Hub (c_hub) e nos números do gestor (gestor.projecao_fato físico; gestor.alerta e
--     core.indicador_diario soft: c_derivados), que contavam o que sai.
-- CASCATA: toda linha (viva) de tabela do domínio que aponta para uma linha que sai também sai, até não sobrar nenhuma: pela
--   FK (qualquer coluna que referencia o id), entre módulos pelo nome da coluna (c_nome: cliente_id, produto_id, pedido_id,
--   visita_id...) e, em plataforma.arquivo, pelo entidade_id (foto de visita, pedido ou tarefa).
-- FICA (c_fica e o schema plataforma, menos plataforma.arquivo): tenant, plano, assinatura e licenças, usuários e perfis,
--   sessões, aparelhos, equipes, parâmetros, medidas e configuração, conectores, credenciais, mapeamentos e implantação.
-- FILIAIS: todas FICAM (usuario_filial, filial_cadastro_id, clientes, depósitos e preços apontam para elas) e só perdem o
--   external_id: a filial do ERP com o mesmo código as adota de novo (modules/core/api/consumidores-erp-filial.ts:33-37).
-- MODO por tabela (conferido nos índices únicos da 0097):
--   - soft (deleted_at = updated_at = now()) no domínio: os índices únicos são parciais (deleted_at is null) e os consumidores do
--     ERP fazem "on conflict (tenant_id, external_id) where ... deleted_at is null": o reenvio cria outra linha;
--   - FÍSICO (DELETE) em c_fisico: os índices únicos não têm deleted_at (registro_atual_chave_uk, lote_idempotencia_uk,
--     cursor_entidade_uk, sessao_carga_uuid_uk, reconciliacao_uk, lote_linha_erro_uk, lote_staging_lote_uk,
--     sessao_carga_recebido_uk, cliente_fila_erp_cliente_uk, pedido_fila_erp_pedido_uk, pedido_retorno_uk,
--     projecao_fato_chave_uk), e o hash do registro_atual faria o reenvio sair "inalterado".
-- OUTBOX: sai (soft) o evento não publicado do Hub (integracao.*) ou de um registro que sai (agregado_id). Pacote de sync
--   "pronto" vira "substituido". A geracao_base do tenant gira (0022): o aparelho limpa a cópia local e puxa tudo de novo.
-- CORRIDA COM O HUB: lote, registro_atual e sessao_carga ficam travados (share row exclusive) até o fim da transação.
-- CÓPIA DE SEGURANÇA: antes de cada mudança, a linha inteira (to_jsonb) vai para public.macuxi_limpeza_backup (lote, tabela,
--   modo), na MESMA transação. Volta: limpar-cadastros-restaurar.sql. Descarte: limpar-cadastros-descartar.sql.
create or replace function pg_temp.macuxi_limpar_cadastros(p_tenant uuid, p_lote text, p_exigir_hub_parado boolean default true)
returns table (r_ordem int, r_tabela text, r_modo text, r_linhas bigint)
language plpgsql
as $rotina$
declare
  -- todas as linhas da empresa, DELETE físico, filhos antes dos pais (FKs)
  c_hub constant text[] := array['integracao.inativacao_auditoria', 'integracao.pendencia_inativacao',
    'integracao.lote_linha_erro', 'integracao.lote_staging', 'integracao.lote', 'integracao.sessao_carga_recebido',
    'integracao.sessao_carga', 'integracao.registro_atual', 'integracao.cursor_entidade', 'integracao.reconciliacao',
    'integracao.coleta_execucao', 'gestor.projecao_fato'];
  -- filas do Hub que só saem com o cliente ou o pedido (cascata), DELETE físico, filhos antes dos pais
  c_filas constant text[] := array['integracao.cliente_fila_erp', 'integracao.pedido_retorno_erro',
    'integracao.pedido_retorno', 'integracao.pedido_fila_erp'];
  c_fisico constant text[] := c_hub || c_filas;
  -- todas as linhas vivas da empresa, soft
  c_derivados constant text[] := array['gestor.alerta', 'core.indicador_diario'];
  -- nunca entram na cascata
  c_fica constant text[] := array['core.filial', 'core.usuario', 'core.usuario_filial', 'core.usuario_avatar',
    'core.usuario_contato', 'core.usuario_convite', 'core.usuario_codigo_fdv_contador', 'core.sessao', 'core.dispositivo',
    'core.equipe', 'core.medida', 'core.foto_tipo', 'core.motivo', 'core.frase_dia', 'core.documento_tipo',
    'core.documento_permissao', 'core.documento_excecao', 'core.plano_rv', 'core.meta', 'core.meta_produtividade',
    'core.ausencia_usuario', 'integracao.conector', 'integracao.conector_api', 'integracao.credencial',
    'integracao.credencial_erp', 'integracao.mapeamento', 'integracao.implantacao', 'integracao.implantacao_dia',
    'integracao.politica_versao', 'vendedor.numeracao_pedido', 'vendedor.condicao_pagamento'];
  -- referência entre módulos sem FK: nome da coluna (uuid) -> tabela
  c_nome constant jsonb := '{"cliente_id": "core.cliente", "cliente_uuid": "core.cliente", "produto_id": "core.produto",
    "relacionado_id": "core.produto", "pedido_id": "vendedor.pedido", "pedido_uuid": "vendedor.pedido",
    "orcamento_id": "vendedor.pedido", "visita_id": "core.visita", "deposito_id": "catalogo.deposito",
    "tabela_preco_id": "catalogo.tabela_preco", "rota_id": "core.rota", "rota_parada_id": "core.rota_parada",
    "no_id": "catalogo.catalogo_no"}';
  c_schemas constant text[] := array['core', 'catalogo', 'vendedor', 'promotor', 'pesquisa', 'treinamento', 'gestor', 'integracao', 'plataforma'];
  r record;
  n bigint;
  v_novos bigint;
  v_volta int := 0;
  t text;
begin
  if p_tenant is null or p_lote !~ '^[0-9]{8}T[0-9]{6}Z$' then
    raise exception 'tenant ou lote inválido';
  end if;
  perform set_config('app.tenant_id', p_tenant::text, true);
  lock table integracao.lote, integracao.registro_atual, integracao.sessao_carga in share row exclusive mode;
  if p_exigir_hub_parado and exists (select 1 from integracao.lote l where l.tenant_id = p_tenant and l.status = 'processando') then
    raise exception 'lote do Hub em processamento nesta empresa: espere terminar (nada mudou)';
  end if;

  drop table if exists pg_temp._limpeza_alvo, pg_temp._limpeza_ref, pg_temp._limpeza_resumo;
  create temp table _limpeza_alvo (tabela text not null, id uuid not null, primary key (tabela, id));
  create temp table _limpeza_resumo (ordem int, tabela text, modo text, linhas bigint);

  -- 1. raízes
  insert into _limpeza_alvo select 'core.cliente', x.id from core.cliente x where x.tenant_id = p_tenant and x.deleted_at is null and x.external_id is not null;
  insert into _limpeza_alvo select 'core.produto', x.id from core.produto x where x.tenant_id = p_tenant and x.deleted_at is null and x.external_id is not null;
  insert into _limpeza_alvo select 'catalogo.catalogo_no', x.id from catalogo.catalogo_no x where x.tenant_id = p_tenant and x.deleted_at is null and x.external_id is not null;
  insert into _limpeza_alvo select 'catalogo.tabela_preco', x.id from catalogo.tabela_preco x where x.tenant_id = p_tenant and x.deleted_at is null and x.external_id is not null;
  insert into _limpeza_alvo select 'catalogo.deposito', x.id from catalogo.deposito x where x.tenant_id = p_tenant and x.deleted_at is null and x.external_id is not null;
  insert into _limpeza_alvo select 'vendedor.forma_pagamento', x.id from vendedor.forma_pagamento x where x.tenant_id = p_tenant and x.deleted_at is null and x.external_id is not null;
  insert into _limpeza_alvo select 'vendedor.prazo_pagamento', x.id from vendedor.prazo_pagamento x where x.tenant_id = p_tenant and x.deleted_at is null and x.external_id is not null;
  insert into _limpeza_alvo select 'vendedor.transportadora', x.id from vendedor.transportadora x where x.tenant_id = p_tenant and x.deleted_at is null and x.external_id is not null;
  insert into _limpeza_alvo select 'core.rota', x.id from core.rota x where x.tenant_id = p_tenant and x.deleted_at is null and x.external_id is not null;
  insert into _limpeza_alvo select 'core.titulo', x.id from core.titulo x where x.tenant_id = p_tenant and x.deleted_at is null and x.external_id is not null;
  insert into _limpeza_alvo select 'core.nota_erp', x.id from core.nota_erp x where x.tenant_id = p_tenant and x.deleted_at is null and x.external_id is not null;
  insert into _limpeza_alvo select 'vendedor.pedido', x.id from vendedor.pedido x where x.tenant_id = p_tenant and x.deleted_at is null;
  foreach t in array c_hub loop
    execute format('insert into _limpeza_alvo select %L, x.id from %s x where x.tenant_id = %L', t, t, p_tenant);
  end loop;
  foreach t in array c_derivados loop
    execute format('insert into _limpeza_alvo select %L, x.id from %s x where x.tenant_id = %L and x.deleted_at is null', t, t, p_tenant);
  end loop;

  -- 2. cascata: referências (FK para o id, ou nome de coluna entre módulos) de tabelas do domínio com tenant_id, id e deleted_at
  create temp table _limpeza_ref as
  with tabelas as (
    select c.oid, n.nspname || '.' || c.relname as nome
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where c.relkind in ('r', 'p') and n.nspname = any (c_schemas)
       and (n.nspname <> 'plataforma' or c.relname = 'arquivo')
       and not (n.nspname || '.' || c.relname) = any (c_fica)
       and (select count(*) from pg_attribute a where a.attrelid = c.oid and not a.attisdropped
             and a.attname in ('tenant_id', 'id', 'deleted_at')) = 3),
  por_fk as (
    select tb.nome as tabela, a.attname::text as coluna, fn.nspname || '.' || fc.relname as alvo
      from pg_constraint k
      join tabelas tb on tb.oid = k.conrelid
      join pg_class fc on fc.oid = k.confrelid join pg_namespace fn on fn.oid = fc.relnamespace
      cross join lateral unnest(k.conkey, k.confkey) as u(ck, fk)
      join pg_attribute a on a.attrelid = k.conrelid and a.attnum = u.ck
      join pg_attribute fa on fa.attrelid = k.confrelid and fa.attnum = u.fk
     where k.contype = 'f' and fa.attname = 'id' and a.attname <> 'tenant_id'),
  por_nome as (
    select tb.nome as tabela, a.attname::text as coluna, c_nome ->> a.attname::text as alvo
      from tabelas tb join pg_attribute a on a.attrelid = tb.oid and not a.attisdropped
     where c_nome ? a.attname::text and a.atttypid = 'uuid'::regtype)
  select distinct x.tabela, x.coluna, x.alvo from (select * from por_fk union all select * from por_nome) x;

  loop
    v_volta := v_volta + 1;
    v_novos := 0;
    for r in select f.tabela, f.coluna, f.alvo from _limpeza_ref f
              where exists (select 1 from _limpeza_alvo a where a.tabela = f.alvo) order by 1, 2 loop
      execute format('insert into _limpeza_alvo select %L, x.id from %s x where x.tenant_id = %L and x.%I in (select a.id from _limpeza_alvo a where a.tabela = %L) %s on conflict do nothing',
                     r.tabela, r.tabela, p_tenant, r.coluna, r.alvo,
                     case when r.tabela = any (c_fisico) then '' else 'and x.deleted_at is null' end);
      get diagnostics n = row_count;
      v_novos := v_novos + n;
    end loop;
    -- arquivo ligado a qualquer registro que sai (foto de visita, pedido, tarefa)
    insert into _limpeza_alvo select 'plataforma.arquivo', x.id from plataforma.arquivo x
     where x.tenant_id = p_tenant and x.deleted_at is null and x.entidade_id in (select a.id from _limpeza_alvo a)
    on conflict do nothing;
    get diagnostics n = row_count;
    v_novos := v_novos + n;
    exit when v_novos = 0;
    if v_volta > 30 then raise exception 'cascata sem fim (mais de 30 voltas)'; end if;
  end loop;
  if exists (select 1 from _limpeza_alvo a where a.tabela like 'integracao.%' and not a.tabela = any (c_fisico)) then
    raise exception 'tabela do Hub fora de c_fisico: %',
      (select string_agg(distinct a.tabela, ', ') from _limpeza_alvo a where a.tabela like 'integracao.%' and not a.tabela = any (c_fisico));
  end if;

  -- 3. cópia de segurança (mesma transação) e execução
  create table if not exists public.macuxi_limpeza_backup (
    lote text not null,
    tenant_id uuid not null,
    tabela text not null,
    modo text not null check (modo in ('soft', 'fisico', 'filial', 'sync_pacote')),
    linha jsonb not null,
    copiado_em timestamptz not null default now()
  );
  revoke all on public.macuxi_limpeza_backup from public;
  create index if not exists macuxi_limpeza_backup_lote_ix on public.macuxi_limpeza_backup (lote, tabela);
  if exists (select 1 from public.macuxi_limpeza_backup b where b.lote = p_lote) then
    raise exception 'lote % já existe na cópia de segurança', p_lote;
  end if;
  for r in select x.tabela, case when x.tabela = any (c_fisico) then 'fisico' else 'soft' end as modo,
                  coalesce(array_position(c_fisico, x.tabela), 100) as ordem
             from (select distinct a.tabela from _limpeza_alvo a) x order by 3, 1 loop
    execute format('insert into public.macuxi_limpeza_backup (lote, tenant_id, tabela, modo, linha)
                    select %L, %L, %L, %L, to_jsonb(x) from %s x
                     where x.tenant_id = %L and x.id in (select a.id from _limpeza_alvo a where a.tabela = %L)',
                   p_lote, p_tenant, r.tabela, r.modo, r.tabela, p_tenant, r.tabela);
    if r.modo = 'fisico' then
      execute format('delete from %s x where x.tenant_id = %L and x.id in (select a.id from _limpeza_alvo a where a.tabela = %L)', r.tabela, p_tenant, r.tabela);
    else
      execute format('update %s x set deleted_at = now(), updated_at = now()
                       where x.tenant_id = %L and x.deleted_at is null and x.id in (select a.id from _limpeza_alvo a where a.tabela = %L)', r.tabela, p_tenant, r.tabela);
    end if;
    get diagnostics n = row_count;
    insert into _limpeza_resumo values (r.ordem, r.tabela, r.modo, n);
  end loop;

  -- 4. outbox: não publicado do Hub ou de registro que sai
  insert into public.macuxi_limpeza_backup (lote, tenant_id, tabela, modo, linha)
  select p_lote, p_tenant, 'plataforma.evento', 'soft', to_jsonb(e) from plataforma.evento e
   where e.tenant_id = p_tenant and e.publicado_em is null and e.deleted_at is null
     and (e.nome like 'integracao.%' or e.agregado_id in (select a.id from _limpeza_alvo a));
  update plataforma.evento e set deleted_at = now(), updated_at = now()
   where e.tenant_id = p_tenant and e.publicado_em is null and e.deleted_at is null
     and (e.nome like 'integracao.%' or e.agregado_id in (select a.id from _limpeza_alvo a));
  get diagnostics n = row_count;
  insert into _limpeza_resumo values (200, 'plataforma.evento (não publicados)', 'soft', n);
  -- 5. filiais: ficam, sem a chave do ERP
  insert into public.macuxi_limpeza_backup (lote, tenant_id, tabela, modo, linha)
  select p_lote, p_tenant, 'core.filial', 'filial', to_jsonb(f) from core.filial f
   where f.tenant_id = p_tenant and f.deleted_at is null and f.external_id is not null;
  update core.filial f set external_id = null where f.tenant_id = p_tenant and f.deleted_at is null and f.external_id is not null;
  get diagnostics n = row_count;
  insert into _limpeza_resumo values (201, 'core.filial (fica; só o external_id sai)', 'filial', n);
  -- 6. pacote de sync pronto -> substituido
  insert into public.macuxi_limpeza_backup (lote, tenant_id, tabela, modo, linha)
  select p_lote, p_tenant, 'plataforma.sync_pacote', 'sync_pacote', to_jsonb(s) from plataforma.sync_pacote s
   where s.tenant_id = p_tenant and s.situacao = 'pronto' and s.deleted_at is null;
  update plataforma.sync_pacote s set situacao = 'substituido', substituido_em = now()
   where s.tenant_id = p_tenant and s.situacao = 'pronto' and s.deleted_at is null;
  get diagnostics n = row_count;
  insert into _limpeza_resumo values (202, 'plataforma.sync_pacote (pronto -> substituido)', 'sync_pacote', n);
  -- 7. geração da base (0022)
  perform plataforma.girar_geracao_base(p_tenant);
  insert into _limpeza_resumo values (203, 'plataforma.tenant (geracao_base girada)', 'girar', 1);

  return query select s.ordem, s.tabela, s.modo, s.linhas from _limpeza_resumo s order by s.ordem, s.tabela;
end
$rotina$;
