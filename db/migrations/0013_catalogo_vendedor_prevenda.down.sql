-- 0013_catalogo_vendedor_prevenda (down)
-- Desfaz a 0013 na ordem inversa. APAGA: faturamentos dos pedidos e transportadoras;
-- no pedido, orçamento (tipo, validade, conversão), acréscimo, desconto efetivo, frete, transportadora, endereço de
-- entrega, marcos do ERP e total faturado; no item, fator, quantidade na unidade base, acréscimo, preço mínimo e
-- quantidade faturada. ORÇAMENTOS (tipo = 'orcamento') SÃO APAGADOS com itens e histórico antes de tirar a coluna, para
-- não virarem pedidos. No Catálogo: uso da cota de IA, árvore, conteúdo, atributos, mídias, sinônimos, documento de busca,
-- depósitos, saldos e log de busca; preços próprios por unidade (linhas com unidade preenchida) são APAGADOS e o único
-- da 0008 volta. No Core: unidades de venda, endereços dos clientes e as colunas novas de cliente e produto (IE,
-- observação, cadastro incompleto, custo, preço de venda, desconto máximo).
-- Integração: some exige_conector da fila; as linhas (lotes, sessões, espelho, pendências, auditoria, cursores,
-- reconciliações) das 4 entidades novas são APAGADAS e os CHECKs voltam às 8 entidades da 0010; a lista de entidades dos
-- Conectores perde as 4 novas.
-- Pré-condição: 0014+ desfeitas.

-- INTEGRACAO -----------------------------------------------------------------------------------
alter table integracao.pedido_fila_erp drop constraint if exists pedido_fila_erp_exige_conector_formato;
alter table integracao.pedido_fila_erp drop column if exists exige_conector;
delete from integracao.inativacao_auditoria where entidade in ('catalogo_no', 'produto_unidade', 'cliente_endereco', 'transportadora');
delete from integracao.pendencia_inativacao where entidade in ('catalogo_no', 'produto_unidade', 'cliente_endereco', 'transportadora');
delete from integracao.sessao_carga_recebido r using integracao.sessao_carga s
  where s.tenant_id = r.tenant_id and s.id = r.sessao_id and s.entidade in ('catalogo_no', 'produto_unidade', 'cliente_endereco', 'transportadora');
delete from integracao.lote_linha_erro e using integracao.lote l
  where l.tenant_id = e.tenant_id and l.id = e.lote_id and l.entidade in ('catalogo_no', 'produto_unidade', 'cliente_endereco', 'transportadora');
delete from integracao.lote_staging e using integracao.lote l
  where l.tenant_id = e.tenant_id and l.id = e.lote_id and l.entidade in ('catalogo_no', 'produto_unidade', 'cliente_endereco', 'transportadora');
delete from integracao.lote where entidade in ('catalogo_no', 'produto_unidade', 'cliente_endereco', 'transportadora');
delete from integracao.sessao_carga where entidade in ('catalogo_no', 'produto_unidade', 'cliente_endereco', 'transportadora');
delete from integracao.registro_atual where entidade in ('catalogo_no', 'produto_unidade', 'cliente_endereco', 'transportadora');
delete from integracao.cursor_entidade where entidade in ('catalogo_no', 'produto_unidade', 'cliente_endereco', 'transportadora');
delete from integracao.reconciliacao where entidade in ('catalogo_no', 'produto_unidade', 'cliente_endereco', 'transportadora');
update integracao.conector
   set entidades = array(select e from unnest(entidades) e where e not in ('catalogo_no', 'produto_unidade', 'cliente_endereco', 'transportadora'))
 where entidades && array['catalogo_no', 'produto_unidade', 'cliente_endereco', 'transportadora']::text[];
-- Conector que só tinha entidades novas fica com a lista vazia, que o CHECK da 0010 recusa: volta ao padrão das 8.
update integracao.conector set entidades = array['vendedor', 'cliente', 'produto', 'preco', 'estoque', 'titulo', 'nota', 'rota']::text[] where cardinality(entidades) = 0;
alter table integracao.conector drop constraint if exists conector_entidades_validas;
alter table integracao.conector add constraint conector_entidades_validas check (cardinality(entidades) >= 1 and entidades <@ array['vendedor', 'cliente', 'produto', 'preco', 'estoque', 'titulo', 'nota', 'rota']::text[] and integracao.sem_repeticao(entidades));
alter table integracao.sessao_carga drop constraint if exists sessao_carga_entidade_valida;
alter table integracao.sessao_carga add constraint sessao_carga_entidade_valida check (entidade in ('vendedor', 'cliente', 'produto', 'preco', 'estoque', 'titulo', 'nota', 'rota'));
alter table integracao.lote drop constraint if exists lote_entidade_valida;
alter table integracao.lote add constraint lote_entidade_valida check (entidade in ('vendedor', 'cliente', 'produto', 'preco', 'estoque', 'titulo', 'nota', 'rota'));
alter table integracao.registro_atual drop constraint if exists registro_atual_entidade_valida;
alter table integracao.registro_atual add constraint registro_atual_entidade_valida check (entidade in ('vendedor', 'cliente', 'produto', 'preco', 'estoque', 'titulo', 'nota', 'rota'));
alter table integracao.pendencia_inativacao drop constraint if exists pendencia_inativacao_entidade_valida;
alter table integracao.pendencia_inativacao add constraint pendencia_inativacao_entidade_valida check (entidade in ('vendedor', 'cliente', 'produto', 'preco', 'estoque', 'titulo', 'nota', 'rota'));
alter table integracao.inativacao_auditoria drop constraint if exists inativacao_auditoria_entidade_valida;
alter table integracao.inativacao_auditoria add constraint inativacao_auditoria_entidade_valida check (entidade in ('vendedor', 'cliente', 'produto', 'preco', 'estoque', 'titulo', 'nota', 'rota'));
alter table integracao.cursor_entidade drop constraint if exists cursor_entidade_entidade_valida;
alter table integracao.cursor_entidade add constraint cursor_entidade_entidade_valida check (entidade in ('vendedor', 'cliente', 'produto', 'preco', 'estoque', 'titulo', 'nota', 'rota'));
alter table integracao.reconciliacao drop constraint if exists reconciliacao_entidade_valida;
alter table integracao.reconciliacao add constraint reconciliacao_entidade_valida check (entidade in ('vendedor', 'cliente', 'produto', 'preco', 'estoque', 'titulo', 'nota', 'rota'));

-- VENDEDOR -------------------------------------------------------------------------------------
drop table if exists vendedor.pedido_faturamento;

drop trigger if exists pedido_item_quantidade_base on vendedor.pedido_item;
drop function if exists vendedor.pedido_item_quantidade_base();
alter table vendedor.pedido_item drop constraint if exists pedido_item_faturada_faixa;
alter table vendedor.pedido_item drop constraint if exists pedido_item_preco_minimo_nao_negativo;
alter table vendedor.pedido_item drop constraint if exists pedido_item_desconto_ou_acrescimo;
alter table vendedor.pedido_item drop constraint if exists pedido_item_acrescimo_faixa;
alter table vendedor.pedido_item drop constraint if exists pedido_item_quantidade_base_coerente;
alter table vendedor.pedido_item drop constraint if exists pedido_item_fator_positivo;

-- orçamentos não existem antes da 0013: apaga itens, histórico e o próprio orçamento (e solta a ligação dos pedidos)
update vendedor.pedido set orcamento_id = null where orcamento_id is not null;
delete from vendedor.pedido_item i using vendedor.pedido p where p.tenant_id = i.tenant_id and p.id = i.pedido_id and p.tipo = 'orcamento';
delete from vendedor.pedido_evento e using vendedor.pedido p where p.tenant_id = e.tenant_id and p.id = e.pedido_id and p.tipo = 'orcamento';
delete from vendedor.pedido where tipo = 'orcamento';

alter table vendedor.pedido_item drop column if exists quantidade_faturada;
alter table vendedor.pedido_item drop column if exists preco_minimo_cents;
alter table vendedor.pedido_item drop column if exists acrescimo_pct;
alter table vendedor.pedido_item drop column if exists quantidade_base;
alter table vendedor.pedido_item drop column if exists fator;

drop index if exists vendedor.pedido_transportadora_digitada_ix;
drop index if exists vendedor.pedido_tipo_ix;
drop index if exists vendedor.pedido_orcamento_uk;
alter table vendedor.pedido drop constraint if exists pedido_total_faturado_nao_negativo;
alter table vendedor.pedido drop constraint if exists pedido_endereco_entrega_objeto;
alter table vendedor.pedido drop constraint if exists pedido_transportadora_fk;
alter table vendedor.pedido drop constraint if exists pedido_transportadora_documento_digitos;
alter table vendedor.pedido drop constraint if exists pedido_transportadora_digitada;
alter table vendedor.pedido drop constraint if exists pedido_fob_com_transportadora;
alter table vendedor.pedido drop constraint if exists pedido_cif_sem_transportadora;
alter table vendedor.pedido drop constraint if exists pedido_frete_modalidade_valida;
alter table vendedor.pedido drop constraint if exists pedido_desconto_efetivo_faixa;
alter table vendedor.pedido drop constraint if exists pedido_desconto_ou_acrescimo;
alter table vendedor.pedido drop constraint if exists pedido_acrescimo_faixa;
alter table vendedor.pedido drop constraint if exists pedido_orcamento_fk;
alter table vendedor.pedido drop constraint if exists pedido_orcamento_origem;
alter table vendedor.pedido drop constraint if exists pedido_orcamento_campos;
alter table vendedor.pedido drop constraint if exists pedido_orcamento_status;
alter table vendedor.pedido drop constraint if exists pedido_tipo_valido;
alter table vendedor.pedido drop column if exists total_faturado_cents;
alter table vendedor.pedido drop column if exists faturado_em;
alter table vendedor.pedido drop column if exists integrado_em;
alter table vendedor.pedido drop column if exists enviado_erp_em;
alter table vendedor.pedido drop column if exists endereco_entrega;
alter table vendedor.pedido drop column if exists endereco_entrega_id;
alter table vendedor.pedido drop column if exists transportadora_telefone;
alter table vendedor.pedido drop column if exists transportadora_documento;
alter table vendedor.pedido drop column if exists transportadora_nome;
alter table vendedor.pedido drop column if exists transportadora_digitada;
alter table vendedor.pedido drop column if exists transportadora_id;
alter table vendedor.pedido drop column if exists frete_modalidade;
alter table vendedor.pedido drop column if exists desconto_efetivo_pct;
alter table vendedor.pedido drop column if exists acrescimo_pct;
alter table vendedor.pedido drop column if exists convertido_em;
alter table vendedor.pedido drop column if exists orcamento_id;
alter table vendedor.pedido drop column if exists orcamento_validade;
alter table vendedor.pedido drop column if exists tipo;

drop table if exists vendedor.transportadora;

-- CATALOGO -------------------------------------------------------------------------------------
drop index if exists catalogo.tabela_preco_item_unidade_vigencia_uk;
delete from catalogo.tabela_preco_item where unidade is not null;
alter table catalogo.tabela_preco_item drop constraint if exists tabela_preco_item_unidade_formato;
alter table catalogo.tabela_preco_item drop column if exists unidade;
create unique index tabela_preco_item_vigencia_uk on catalogo.tabela_preco_item (tenant_id, tabela_preco_id, produto_id, vigencia_inicio) nulls not distinct where deleted_at is null;

drop table if exists catalogo.busca_log;
drop table if exists catalogo.estoque_saldo;
drop table if exists catalogo.deposito;
drop table if exists catalogo.produto_busca;
drop function if exists catalogo.produto_busca_documento();
drop function if exists catalogo.sem_acento(text);
drop table if exists catalogo.sinonimo;
drop table if exists catalogo.produto_midia;
drop table if exists catalogo.produto_atributo;
drop table if exists catalogo.produto_conteudo;
drop table if exists catalogo.produto_no;
drop table if exists catalogo.catalogo_no;
drop function if exists catalogo.consultas_ia_do_dia(uuid, timestamptz);
drop function if exists catalogo.debitar_cota_ia(uuid, integer, timestamptz);
drop table if exists catalogo.uso_ia;

-- CORE -----------------------------------------------------------------------------------------
drop table if exists core.cliente_endereco;
drop table if exists core.produto_unidade;

alter table core.produto drop constraint if exists produto_desconto_maximo_faixa;
alter table core.produto drop constraint if exists produto_preco_venda_nao_negativo;
alter table core.produto drop constraint if exists produto_custo_nao_negativo;
alter table core.produto drop column if exists desconto_maximo_pct;
alter table core.produto drop column if exists preco_venda_cents;
alter table core.produto drop column if exists custo_cents;

drop index if exists core.cliente_incompleto_ix;
alter table core.cliente drop constraint if exists cliente_ie_preenchida;
alter table core.cliente drop constraint if exists cliente_cadastro_coerente;
alter table core.cliente drop column if exists cadastro_campos_faltantes;
alter table core.cliente drop column if exists cadastro_incompleto;
alter table core.cliente drop column if exists observacao;
alter table core.cliente drop column if exists inscricao_estadual;
