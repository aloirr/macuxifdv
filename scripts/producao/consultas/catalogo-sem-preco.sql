-- descricao: "Sem preço" no Catálogo pelo menu: filial padrão, itens por filial e tabela, tabela escolhida, cobertura, estoque e referências
-- parametros: nenhum
--
-- Diagnóstico do modulo-catalogo (15/11/2026, A1). O app sem cliente usa a filial padrão do tenant e a tabela ATIVA com
-- mais itens nela (domain/preco-filial.ts, tabelaDaFilialSemCliente).

-- @consulta filiais
-- @colunas id, codigo, padrao, ativo, viva, tem_external_id
select f.id, f.codigo, f.padrao, f.ativo, (f.deleted_at is null) as viva, (f.external_id is not null) as tem_external_id
  from core.filial f
 where f.tenant_id = :'tenant_id'
 order by f.padrao desc, f.codigo
 limit 100;

-- @consulta itens_por_filial_e_tabela
-- @colunas filial_id, filial_padrao, tabela_id, tabela_codigo, tabela_ativa, itens_vivos, itens_sem_unidade, itens_vencidos
select i.filial_id, coalesce(f.padrao, false) as filial_padrao, t.id as tabela_id, t.codigo as tabela_codigo,
       (t.ativo and t.deleted_at is null) as tabela_ativa,
       count(*) filter (where i.deleted_at is null) as itens_vivos,
       count(*) filter (where i.deleted_at is null and i.unidade is null) as itens_sem_unidade,
       count(*) filter (where i.deleted_at is null and i.vigencia_fim is not null and i.vigencia_fim < now()) as itens_vencidos
  from catalogo.tabela_preco_item i
  join catalogo.tabela_preco t on t.tenant_id = i.tenant_id and t.id = i.tabela_preco_id
  left join core.filial f on f.tenant_id = i.tenant_id and f.id = i.filial_id
 where i.tenant_id = :'tenant_id'
 group by 1, 2, 3, 4, 5
 order by 2 desc, 6 desc
 limit 100;

-- @consulta tabela_escolhida_sem_cliente
-- @colunas tabela_id, tabela_codigo, itens
select t.id as tabela_id, t.codigo as tabela_codigo, count(*) as itens
  from catalogo.tabela_preco_item i
  join catalogo.tabela_preco t on t.tenant_id = i.tenant_id and t.id = i.tabela_preco_id and t.ativo and t.deleted_at is null
  join core.filial f on f.tenant_id = i.tenant_id and f.id = i.filial_id and f.padrao and f.deleted_at is null
 where i.tenant_id = :'tenant_id' and i.deleted_at is null
 group by 1, 2
 order by 3 desc, 2
 limit 3;

-- @consulta cobertura_de_preco
-- @colunas produtos_ativos, produtos_com_preco_na_padrao, produtos_com_preco_vigente_na_padrao
select (select count(*) from core.produto p where p.tenant_id = :'tenant_id' and p.ativo and p.deleted_at is null) as produtos_ativos,
       (select count(distinct i.produto_id)
          from catalogo.tabela_preco_item i
          join core.filial f on f.tenant_id = i.tenant_id and f.id = i.filial_id and f.padrao
         where i.tenant_id = :'tenant_id' and i.deleted_at is null) as produtos_com_preco_na_padrao,
       (select count(distinct i.produto_id)
          from catalogo.tabela_preco_item i
          join core.filial f on f.tenant_id = i.tenant_id and f.id = i.filial_id and f.padrao
          join catalogo.tabela_preco t on t.tenant_id = i.tenant_id and t.id = i.tabela_preco_id and t.ativo and t.deleted_at is null
         where i.tenant_id = :'tenant_id' and i.deleted_at is null
           and (i.vigencia_inicio is null or i.vigencia_inicio <= now())
           and (i.vigencia_fim is null or i.vigencia_fim > now())) as produtos_com_preco_vigente_na_padrao;

-- @consulta estoque_por_filial
-- @colunas filial_id, filial_padrao, depositos, produtos_com_saldo, produtos_com_saldo_positivo
select d.filial_id, coalesce(f.padrao, false) as filial_padrao, count(distinct d.id) as depositos,
       count(distinct s.produto_id) as produtos_com_saldo,
       count(distinct s.produto_id) filter (where s.quantidade > 0) as produtos_com_saldo_positivo
  from catalogo.deposito d
  left join catalogo.estoque_saldo s on s.tenant_id = d.tenant_id and s.deposito_id = d.id and s.deleted_at is null
  left join core.filial f on f.tenant_id = d.tenant_id and f.id = d.filial_id
 where d.tenant_id = :'tenant_id' and d.deleted_at is null
 group by 1, 2
 order by 2 desc, 4 desc
 limit 100;

-- @consulta referencias_cruzadas
-- @colunas referencias, produtos_com_referencia, marcas_concorrentes
select (select count(*) from catalogo.produto_referencia r where r.tenant_id = :'tenant_id' and r.deleted_at is null) as referencias,
       (select count(distinct r.produto_id)
          from catalogo.produto_referencia r
         where r.tenant_id = :'tenant_id' and r.deleted_at is null) as produtos_com_referencia,
       (select count(*) from catalogo.marca_concorrente m where m.tenant_id = :'tenant_id' and m.deleted_at is null) as marcas_concorrentes;
