-- 0106_quantidade_fracionaria (up) — quantidade fracionária no pedido (v1.0.36, ADR 0076): o ERP e o vendedor passam a
-- poder usar fração (2,5 KG; "CX c/ 0,5"). Inteiro vira numeric com 4 casas:
--   core.produto_unidade.fator                       integer -> numeric(9,4)  (check produto_unidade_fator_positivo > 0 recriado)
--   vendedor.pedido_item.fator                       integer -> numeric(9,4)  (check pedido_item_fator_positivo > 0 recriado)
--   vendedor.pedido_item.quantidade, quantidade_base, quantidade_faturada, quantidade_embalagem, quantidade_unidades
--                                                    integer -> numeric(14,4)
--   integracao.pedido_retorno_erro.quantidade        integer -> numeric(14,4) (item faturado descartado; P-4)
-- Arredondamento: quantidade (4 casas) x fator (4 casas) tem até 8 casas; quantidade_base e quantidade_unidades guardam
-- round(quantidade * fator, 4) (gatilhos pedido_item_quantidade_base e pedido_item_medida) e os CHECKs de coerência passam a
-- comparar com o mesmo round (com inteiros, round = o produto: nada muda para as linhas atuais).
-- pedido_item_faturada_faixa (0 <= quantidade_faturada <= quantidade_base) e os CHECKs de positivo e de embalagem = fator são
-- recriados com o mesmo texto (sem isso o ALTER TYPE os guarda com cast e o down não voltaria ao catálogo da 0105).
-- pedido_retorno_erro_numeros_validos: quantidade >= 1 vira quantidade > 0 (0,5 KG descartado é válido).
-- Dependências conferidas no catálogo (pg_depend/pg_proc): nenhuma view nem função SQL usa essas colunas; o índice
-- pedido_item_reserva_filial_ix (include quantidade_base, quantidade_faturada) é refeito pelo próprio ALTER TYPE. As views do
-- Conector (db/conector/*.sql) rodam no ERP e não dependem do Postgres.
-- Driver pg: numeric chega como STRING; o Drizzle (modules/*/db/nuvem.ts) usa mode 'number' nessas colunas (segue number no
-- TypeScript); SQL cru com pg precisa de Number(...).
-- Custo: reescreve core.produto_unidade, vendedor.pedido_item e integracao.pedido_retorno_erro (ACCESS EXCLUSIVE durante a
-- reescrita; um ALTER TABLE por tabela).
-- Dicionário: docs/banco/core.md, vendedor.md, integracao.md. Teste: db/testes/quantidade-fracionaria.db.test.ts.
-- Volta: 0106_quantidade_fracionaria.down.sql (só sem fração gravada; com fração falha e diz onde).

-- core.produto_unidade --------------------------------------------------------------------------------------------------
alter table core.produto_unidade drop constraint if exists produto_unidade_fator_positivo;
alter table core.produto_unidade
  alter column fator type numeric(9, 4) using fator::numeric(9, 4),
  alter column fator set default 1;
alter table core.produto_unidade add constraint produto_unidade_fator_positivo check (fator > 0);

-- vendedor.pedido_item --------------------------------------------------------------------------------------------------
alter table vendedor.pedido_item drop constraint if exists pedido_item_quantidade_base_coerente;
alter table vendedor.pedido_item drop constraint if exists pedido_item_quantidade_unidades_coerente;
alter table vendedor.pedido_item drop constraint if exists pedido_item_faturada_faixa;
alter table vendedor.pedido_item drop constraint if exists pedido_item_fator_positivo;
alter table vendedor.pedido_item drop constraint if exists pedido_item_quantidade_positiva;
alter table vendedor.pedido_item drop constraint if exists pedido_item_quantidade_embalagem_positiva;
alter table vendedor.pedido_item drop constraint if exists pedido_item_embalagem_coerente;

alter table vendedor.pedido_item
  alter column quantidade type numeric(14, 4) using quantidade::numeric(14, 4),
  alter column fator type numeric(9, 4) using fator::numeric(9, 4),
  alter column fator set default 1,
  alter column quantidade_base type numeric(14, 4) using quantidade_base::numeric(14, 4),
  alter column quantidade_base set default 0,
  alter column quantidade_faturada type numeric(14, 4) using quantidade_faturada::numeric(14, 4),
  alter column quantidade_faturada set default 0,
  alter column quantidade_embalagem type numeric(14, 4) using quantidade_embalagem::numeric(14, 4),
  alter column quantidade_unidades type numeric(14, 4) using quantidade_unidades::numeric(14, 4);

create or replace function vendedor.pedido_item_quantidade_base() returns trigger
  language plpgsql
  set search_path = pg_catalog, vendedor, pg_temp
as $$
begin
  new.quantidade_base := round(new.quantidade * new.fator, 4);
  return new;
end
$$;

create or replace function vendedor.pedido_item_medida() returns trigger
  language plpgsql
  set search_path = pg_catalog, vendedor, pg_temp
as $$
begin
  new.medida := vendedor.medida_do_item(new.unidade);
  new.quantidade_embalagem := new.fator;
  new.quantidade_unidades := round(new.quantidade * new.fator, 4); -- = quantidade_base (gatilho pedido_item_quantidade_base, mesmo cálculo)
  return new;
end
$$;

alter table vendedor.pedido_item
  add constraint pedido_item_quantidade_base_coerente check (quantidade_base = round(quantidade * fator, 4));
alter table vendedor.pedido_item
  add constraint pedido_item_quantidade_unidades_coerente check (quantidade_unidades = round(quantidade * fator, 4));
alter table vendedor.pedido_item
  add constraint pedido_item_faturada_faixa check (quantidade_faturada between 0 and quantidade_base);
alter table vendedor.pedido_item add constraint pedido_item_fator_positivo check (fator > 0);
alter table vendedor.pedido_item add constraint pedido_item_quantidade_positiva check (quantidade > 0);
alter table vendedor.pedido_item add constraint pedido_item_quantidade_embalagem_positiva check (quantidade_embalagem > 0);
alter table vendedor.pedido_item add constraint pedido_item_embalagem_coerente check (quantidade_embalagem = fator);

-- integracao.pedido_retorno_erro ----------------------------------------------------------------------------------------
alter table integracao.pedido_retorno_erro drop constraint if exists pedido_retorno_erro_numeros_validos;
alter table integracao.pedido_retorno_erro
  alter column quantidade type numeric(14, 4) using quantidade::numeric(14, 4);
alter table integracao.pedido_retorno_erro
  add constraint pedido_retorno_erro_numeros_validos check (indice >= 0 and sequencia >= 1 and quantidade > 0);
