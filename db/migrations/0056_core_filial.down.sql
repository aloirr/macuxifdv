-- 0056_core_filial (down) — desfaz a 0056 (T-0149) e volta ao catálogo da 0055.
-- APAGA: core.filial (as filiais cadastradas e a padrão), core.cliente.filial_id, catalogo.deposito.filial_id,
-- catalogo.tabela_preco_item.filial_id, catalogo.tabela_escalonada.filial_id e vendedor.pedido.filial_id/filial (o retrato da
-- filial nos pedidos). Os itens de preço e as faixas de filial NÃO padrão são apagados logicamente antes de recriar os únicos
-- antigos (sem a filial, o mesmo produto/tabela/início de duas filiais colidiria): voltam com a próxima carga do ERP. Depósitos
-- de outras filiais ficam (perdem só a coluna; o estoque deles volta a somar no total do tenant).
-- integracao: APAGA o que o Hub recebeu da entidade `filial` (sessões e o recebido, lotes com staging e erros, registro_atual,
-- cursores, reconciliações, pendências e a auditoria delas), tira `filial` da lista dos Conectores (lista vazia volta ao
-- padrão das 8) e volta os CHECKs às 15 da 0037.
-- Volte antes o Core, o Catálogo, o Vendedor e o Hub que leem/gravam as colunas novas (senão 42703/42P01).
-- Idempotente (if exists em tudo). Pré-condição: 0057+ desfeitas.

-- integracao
delete from integracao.sessao_carga_recebido r using integracao.sessao_carga s
  where s.tenant_id = r.tenant_id and s.id = r.sessao_id and s.entidade = 'filial';
delete from integracao.lote_linha_erro e using integracao.lote l
  where l.tenant_id = e.tenant_id and l.id = e.lote_id and l.entidade = 'filial';
delete from integracao.lote_staging e using integracao.lote l
  where l.tenant_id = e.tenant_id and l.id = e.lote_id and l.entidade = 'filial';
delete from integracao.inativacao_auditoria where entidade = 'filial';
delete from integracao.pendencia_inativacao where entidade = 'filial';
delete from integracao.reconciliacao where entidade = 'filial';
delete from integracao.lote where entidade = 'filial';
delete from integracao.sessao_carga where entidade = 'filial';
delete from integracao.registro_atual where entidade = 'filial';
delete from integracao.cursor_entidade where entidade = 'filial';
update integracao.conector
   set entidades = array(select e from unnest(entidades) e where e <> 'filial')
 where 'filial' = any(entidades);
update integracao.conector set entidades = array['vendedor', 'cliente', 'produto', 'preco', 'estoque', 'titulo', 'nota', 'rota']::text[] where cardinality(entidades) = 0;
alter table integracao.conector drop constraint if exists conector_entidades_validas;
alter table integracao.conector add constraint conector_entidades_validas check (cardinality(entidades) >= 1 and entidades <@ array['vendedor', 'cliente', 'produto', 'preco', 'estoque', 'titulo', 'nota', 'rota', 'catalogo_no', 'produto_unidade', 'cliente_endereco', 'transportadora', 'forma_pagamento', 'prazo_pagamento', 'tabela_escalonada']::text[] and integracao.sem_repeticao(entidades));
alter table integracao.sessao_carga drop constraint if exists sessao_carga_entidade_valida;
alter table integracao.sessao_carga add constraint sessao_carga_entidade_valida check (entidade in ('vendedor', 'cliente', 'produto', 'preco', 'estoque', 'titulo', 'nota', 'rota', 'catalogo_no', 'produto_unidade', 'cliente_endereco', 'transportadora', 'forma_pagamento', 'prazo_pagamento', 'tabela_escalonada'));
alter table integracao.lote drop constraint if exists lote_entidade_valida;
alter table integracao.lote add constraint lote_entidade_valida check (entidade in ('vendedor', 'cliente', 'produto', 'preco', 'estoque', 'titulo', 'nota', 'rota', 'catalogo_no', 'produto_unidade', 'cliente_endereco', 'transportadora', 'forma_pagamento', 'prazo_pagamento', 'tabela_escalonada'));
alter table integracao.registro_atual drop constraint if exists registro_atual_entidade_valida;
alter table integracao.registro_atual add constraint registro_atual_entidade_valida check (entidade in ('vendedor', 'cliente', 'produto', 'preco', 'estoque', 'titulo', 'nota', 'rota', 'catalogo_no', 'produto_unidade', 'cliente_endereco', 'transportadora', 'forma_pagamento', 'prazo_pagamento', 'tabela_escalonada'));
alter table integracao.pendencia_inativacao drop constraint if exists pendencia_inativacao_entidade_valida;
alter table integracao.pendencia_inativacao add constraint pendencia_inativacao_entidade_valida check (entidade in ('vendedor', 'cliente', 'produto', 'preco', 'estoque', 'titulo', 'nota', 'rota', 'catalogo_no', 'produto_unidade', 'cliente_endereco', 'transportadora', 'forma_pagamento', 'prazo_pagamento', 'tabela_escalonada'));
alter table integracao.inativacao_auditoria drop constraint if exists inativacao_auditoria_entidade_valida;
alter table integracao.inativacao_auditoria add constraint inativacao_auditoria_entidade_valida check (entidade in ('vendedor', 'cliente', 'produto', 'preco', 'estoque', 'titulo', 'nota', 'rota', 'catalogo_no', 'produto_unidade', 'cliente_endereco', 'transportadora', 'forma_pagamento', 'prazo_pagamento', 'tabela_escalonada'));
alter table integracao.cursor_entidade drop constraint if exists cursor_entidade_entidade_valida;
alter table integracao.cursor_entidade add constraint cursor_entidade_entidade_valida check (entidade in ('vendedor', 'cliente', 'produto', 'preco', 'estoque', 'titulo', 'nota', 'rota', 'catalogo_no', 'produto_unidade', 'cliente_endereco', 'transportadora', 'forma_pagamento', 'prazo_pagamento', 'tabela_escalonada'));
alter table integracao.reconciliacao drop constraint if exists reconciliacao_entidade_valida;
alter table integracao.reconciliacao add constraint reconciliacao_entidade_valida check (entidade in ('vendedor', 'cliente', 'produto', 'preco', 'estoque', 'titulo', 'nota', 'rota', 'catalogo_no', 'produto_unidade', 'cliente_endereco', 'transportadora', 'forma_pagamento', 'prazo_pagamento', 'tabela_escalonada'));

-- vendedor
drop index if exists vendedor.pedido_filial_ix;
alter table vendedor.pedido drop constraint if exists pedido_filial_coerente;
alter table vendedor.pedido drop constraint if exists pedido_filial_objeto;
alter table vendedor.pedido drop column if exists filial;
alter table vendedor.pedido drop column if exists filial_id;

-- catalogo: faixas e itens de filial não padrão saem antes de recriar os únicos sem a filial (só se a 0056 ainda está
-- aplicada: rodar o down de novo não acha core.filial nem as colunas)
drop trigger if exists tabela_preco_item_filial_padrao on catalogo.tabela_preco_item;
do $$
begin
  if to_regclass('core.filial') is not null then
    update catalogo.tabela_escalonada t set deleted_at = now()
     where t.deleted_at is null and t.filial_id is not null
       and not exists (select 1 from core.filial f where f.tenant_id = t.tenant_id and f.id = t.filial_id and f.padrao);
    update catalogo.tabela_preco_item i set deleted_at = now()
     where i.deleted_at is null
       and not exists (select 1 from core.filial f where f.tenant_id = i.tenant_id and f.id = i.filial_id and f.padrao);
  end if;
end
$$;
drop index if exists catalogo.tabela_escalonada_faixa_uk;
create unique index tabela_escalonada_faixa_uk on catalogo.tabela_escalonada
  (tenant_id, produto_id, medida, quantidade_minima, tabela_preco_id, vigencia_inicio) nulls not distinct where deleted_at is null;
alter table catalogo.tabela_escalonada drop column if exists filial_id;

drop index if exists catalogo.tabela_preco_item_filial_ix;
drop index if exists catalogo.tabela_preco_item_filial_vigencia_uk;
create unique index tabela_preco_item_unidade_vigencia_uk on catalogo.tabela_preco_item
  (tenant_id, tabela_preco_id, produto_id, unidade, vigencia_inicio) nulls not distinct where deleted_at is null;
alter table catalogo.tabela_preco_item drop column if exists filial_id;

drop trigger if exists deposito_filial_padrao on catalogo.deposito;
drop index if exists catalogo.deposito_filial_ix;
alter table catalogo.deposito drop column if exists filial_id;

-- core
drop trigger if exists cliente_filial_padrao on core.cliente;
drop index if exists core.cliente_filial_ix;
alter table core.cliente drop constraint if exists cliente_filial_fk;
alter table core.cliente drop column if exists filial_id;
drop function if exists core.preencher_filial_padrao();
drop function if exists core.filial_padrao_id(uuid);
drop trigger if exists tenant_semear_filial on plataforma.tenant;
drop function if exists core.semear_tenant_filial();
drop function if exists core.semear_filial(uuid);
drop table if exists core.filial;
