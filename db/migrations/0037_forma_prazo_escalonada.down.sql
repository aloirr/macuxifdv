-- 0037_forma_prazo_escalonada (down) — T-0089
-- Desfaz a 0037: tira o gatilho tenant_semear_pagamento e as funções de semeadura (tenant novo deixa de nascer com a forma
-- "À vista"); APAGA as colunas do pagamento de vendedor.pedido (forma, prazo e o retrato: o pedido do modelo novo fica só
-- com a condição antiga, nula nele), as tabelas vendedor.prazo_pagamento e vendedor.forma_pagamento (com as formas e os
-- prazos, inclusive os vindos do ERP: voltam na próxima carga completa do Hub depois de reaplicar), catalogo.tabela_escalonada
-- (com as faixas) e as colunas prazo_medio_max_dias e formas_pagamento de core.cliente; por fim as funções de CHECK.
-- Ordem: o pedido antes das tabelas (FKs), as tabelas antes das funções (CHECKs). Idempotente (if exists em tudo).
-- Pré-condição: 0038+ desfeitas.
-- integracao: APAGA o que o Hub recebeu de forma_pagamento, prazo_pagamento e tabela_escalonada (sessões e o recebido,
-- lotes com staging e erros, registro_atual, cursores, reconciliações, pendências e a auditoria delas), tira as 3 da lista
-- dos Conectores (lista vazia volta ao padrão das 8) e volta os CHECKs às 12 da 0013. Depois de reaplicar, a próxima carga
-- completa do ERP repõe tudo.

delete from integracao.sessao_carga_recebido r using integracao.sessao_carga s
  where s.tenant_id = r.tenant_id and s.id = r.sessao_id and s.entidade in ('forma_pagamento', 'prazo_pagamento', 'tabela_escalonada');
delete from integracao.lote_linha_erro e using integracao.lote l
  where l.tenant_id = e.tenant_id and l.id = e.lote_id and l.entidade in ('forma_pagamento', 'prazo_pagamento', 'tabela_escalonada');
delete from integracao.lote_staging e using integracao.lote l
  where l.tenant_id = e.tenant_id and l.id = e.lote_id and l.entidade in ('forma_pagamento', 'prazo_pagamento', 'tabela_escalonada');
delete from integracao.inativacao_auditoria where entidade in ('forma_pagamento', 'prazo_pagamento', 'tabela_escalonada');
delete from integracao.pendencia_inativacao where entidade in ('forma_pagamento', 'prazo_pagamento', 'tabela_escalonada');
delete from integracao.reconciliacao where entidade in ('forma_pagamento', 'prazo_pagamento', 'tabela_escalonada');
delete from integracao.lote where entidade in ('forma_pagamento', 'prazo_pagamento', 'tabela_escalonada');
delete from integracao.sessao_carga where entidade in ('forma_pagamento', 'prazo_pagamento', 'tabela_escalonada');
delete from integracao.registro_atual where entidade in ('forma_pagamento', 'prazo_pagamento', 'tabela_escalonada');
delete from integracao.cursor_entidade where entidade in ('forma_pagamento', 'prazo_pagamento', 'tabela_escalonada');
update integracao.conector
   set entidades = array(select e from unnest(entidades) e where e not in ('forma_pagamento', 'prazo_pagamento', 'tabela_escalonada'))
 where entidades && array['forma_pagamento', 'prazo_pagamento', 'tabela_escalonada']::text[];
update integracao.conector set entidades = array['vendedor', 'cliente', 'produto', 'preco', 'estoque', 'titulo', 'nota', 'rota']::text[] where cardinality(entidades) = 0;
alter table integracao.conector drop constraint if exists conector_entidades_validas;
alter table integracao.conector add constraint conector_entidades_validas check (cardinality(entidades) >= 1 and entidades <@ array['vendedor', 'cliente', 'produto', 'preco', 'estoque', 'titulo', 'nota', 'rota', 'catalogo_no', 'produto_unidade', 'cliente_endereco', 'transportadora']::text[] and integracao.sem_repeticao(entidades));
alter table integracao.sessao_carga drop constraint if exists sessao_carga_entidade_valida;
alter table integracao.sessao_carga add constraint sessao_carga_entidade_valida check (entidade in ('vendedor', 'cliente', 'produto', 'preco', 'estoque', 'titulo', 'nota', 'rota', 'catalogo_no', 'produto_unidade', 'cliente_endereco', 'transportadora'));
alter table integracao.lote drop constraint if exists lote_entidade_valida;
alter table integracao.lote add constraint lote_entidade_valida check (entidade in ('vendedor', 'cliente', 'produto', 'preco', 'estoque', 'titulo', 'nota', 'rota', 'catalogo_no', 'produto_unidade', 'cliente_endereco', 'transportadora'));
alter table integracao.registro_atual drop constraint if exists registro_atual_entidade_valida;
alter table integracao.registro_atual add constraint registro_atual_entidade_valida check (entidade in ('vendedor', 'cliente', 'produto', 'preco', 'estoque', 'titulo', 'nota', 'rota', 'catalogo_no', 'produto_unidade', 'cliente_endereco', 'transportadora'));
alter table integracao.pendencia_inativacao drop constraint if exists pendencia_inativacao_entidade_valida;
alter table integracao.pendencia_inativacao add constraint pendencia_inativacao_entidade_valida check (entidade in ('vendedor', 'cliente', 'produto', 'preco', 'estoque', 'titulo', 'nota', 'rota', 'catalogo_no', 'produto_unidade', 'cliente_endereco', 'transportadora'));
alter table integracao.inativacao_auditoria drop constraint if exists inativacao_auditoria_entidade_valida;
alter table integracao.inativacao_auditoria add constraint inativacao_auditoria_entidade_valida check (entidade in ('vendedor', 'cliente', 'produto', 'preco', 'estoque', 'titulo', 'nota', 'rota', 'catalogo_no', 'produto_unidade', 'cliente_endereco', 'transportadora'));
alter table integracao.cursor_entidade drop constraint if exists cursor_entidade_entidade_valida;
alter table integracao.cursor_entidade add constraint cursor_entidade_entidade_valida check (entidade in ('vendedor', 'cliente', 'produto', 'preco', 'estoque', 'titulo', 'nota', 'rota', 'catalogo_no', 'produto_unidade', 'cliente_endereco', 'transportadora'));
alter table integracao.reconciliacao drop constraint if exists reconciliacao_entidade_valida;
alter table integracao.reconciliacao add constraint reconciliacao_entidade_valida check (entidade in ('vendedor', 'cliente', 'produto', 'preco', 'estoque', 'titulo', 'nota', 'rota', 'catalogo_no', 'produto_unidade', 'cliente_endereco', 'transportadora'));

drop trigger if exists tenant_semear_pagamento on plataforma.tenant;
drop function if exists vendedor.semear_tenant_pagamento();
drop function if exists vendedor.semear_pagamento(uuid);

alter table vendedor.pedido drop constraint if exists pedido_prazo_medio_coerente;
alter table vendedor.pedido drop constraint if exists pedido_prazo_parcelas_validas;
alter table vendedor.pedido drop constraint if exists pedido_pagamento_completo;
alter table vendedor.pedido drop constraint if exists pedido_prazo_pagamento_fk;
alter table vendedor.pedido drop constraint if exists pedido_forma_pagamento_fk;
alter table vendedor.pedido drop column if exists prazo_medio_dias;
alter table vendedor.pedido drop column if exists prazo_parcelas_dias;
alter table vendedor.pedido drop column if exists prazo_descricao;
alter table vendedor.pedido drop column if exists prazo_codigo;
alter table vendedor.pedido drop column if exists forma_pagamento_nome;
alter table vendedor.pedido drop column if exists forma_pagamento_codigo;
alter table vendedor.pedido drop column if exists prazo_pagamento_id;
alter table vendedor.pedido drop column if exists forma_pagamento_id;

drop table if exists vendedor.prazo_pagamento;
drop table if exists vendedor.forma_pagamento;
drop table if exists catalogo.tabela_escalonada;

alter table core.cliente drop constraint if exists cliente_formas_pagamento_validas;
alter table core.cliente drop constraint if exists cliente_prazo_medio_max_faixa;
alter table core.cliente drop column if exists formas_pagamento;
alter table core.cliente drop column if exists prazo_medio_max_dias;

drop function if exists core.codigos_forma_validos(text[]);
drop function if exists vendedor.prazo_medio_coerente(integer[], integer);
drop function if exists vendedor.parcelas_validas(integer[]);
