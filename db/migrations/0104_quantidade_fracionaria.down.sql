-- 0104_quantidade_fracionaria (down) — desfaz a 0104: as colunas voltam a integer, os gatilhos e os CHECKs voltam ao texto
-- da 0013/0018 (sem round) e pedido_retorno_erro_numeros_validos volta a quantidade >= 1.
-- SÓ SEM FRAÇÃO: se alguma linha (viva ou apagada) tiver fração nessas colunas, a volta FALHA (P0001) e diz a tabela, a
-- coluna e quantas linhas; nada é arredondado nem truncado. Valor acima de 2.147.483.647 falha no cast (22003).
-- Pré-condição: API, Conector e app sem gravar fração (a versão anterior à v1.0.36).

do $$
declare
  alvo record;
  qtd bigint;
begin
  for alvo in
    select * from (values
      ('core', 'produto_unidade', 'fator'),
      ('vendedor', 'pedido_item', 'quantidade'),
      ('vendedor', 'pedido_item', 'fator'),
      ('vendedor', 'pedido_item', 'quantidade_base'),
      ('vendedor', 'pedido_item', 'quantidade_faturada'),
      ('vendedor', 'pedido_item', 'quantidade_embalagem'),
      ('vendedor', 'pedido_item', 'quantidade_unidades'),
      ('integracao', 'pedido_retorno_erro', 'quantidade')
    ) as t(esquema, tabela, coluna)
  loop
    execute format('select count(*) from %I.%I where %I <> trunc(%I)', alvo.esquema, alvo.tabela, alvo.coluna, alvo.coluna)
      into qtd;
    if qtd > 0 then
      raise exception '0104 down recusado: %.%.% tem % linha(s) com fração; a volta para integer perderia a fração',
        alvo.esquema, alvo.tabela, alvo.coluna, qtd;
    end if;
  end loop;
end
$$;

-- integracao.pedido_retorno_erro ----------------------------------------------------------------------------------------
alter table integracao.pedido_retorno_erro drop constraint if exists pedido_retorno_erro_numeros_validos;
alter table integracao.pedido_retorno_erro
  alter column quantidade type integer using quantidade::integer;
alter table integracao.pedido_retorno_erro
  add constraint pedido_retorno_erro_numeros_validos check (indice >= 0 and sequencia >= 1 and quantidade >= 1);

-- vendedor.pedido_item --------------------------------------------------------------------------------------------------
alter table vendedor.pedido_item drop constraint if exists pedido_item_fracao_coerente;
alter table vendedor.pedido_item drop constraint if exists pedido_item_quantidade_base_coerente;
alter table vendedor.pedido_item drop constraint if exists pedido_item_quantidade_unidades_coerente;
alter table vendedor.pedido_item drop constraint if exists pedido_item_faturada_faixa;
alter table vendedor.pedido_item drop constraint if exists pedido_item_fator_positivo;
alter table vendedor.pedido_item drop constraint if exists pedido_item_quantidade_positiva;
alter table vendedor.pedido_item drop constraint if exists pedido_item_quantidade_embalagem_positiva;
alter table vendedor.pedido_item drop constraint if exists pedido_item_embalagem_coerente;

alter table vendedor.pedido_item
  alter column quantidade type integer using quantidade::integer,
  alter column fator type integer using fator::integer,
  alter column fator set default 1,
  alter column quantidade_base type integer using quantidade_base::integer,
  alter column quantidade_base set default 0,
  alter column quantidade_faturada type integer using quantidade_faturada::integer,
  alter column quantidade_faturada set default 0,
  alter column quantidade_embalagem type integer using quantidade_embalagem::integer,
  alter column quantidade_unidades type integer using quantidade_unidades::integer;

create or replace function vendedor.pedido_item_quantidade_base() returns trigger
  language plpgsql
  set search_path = pg_catalog, vendedor, pg_temp
as $$
begin
  new.quantidade_base := new.quantidade * new.fator;
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
  new.quantidade_unidades := new.quantidade * new.fator; -- = quantidade_base (gatilho pedido_item_quantidade_base, mesmo cálculo)
  return new;
end
$$;

alter table vendedor.pedido_item
  add constraint pedido_item_quantidade_base_coerente check (quantidade_base = quantidade * fator);
alter table vendedor.pedido_item
  add constraint pedido_item_quantidade_unidades_coerente check (quantidade_unidades = quantidade * fator);
alter table vendedor.pedido_item
  add constraint pedido_item_faturada_faixa check (quantidade_faturada between 0 and quantidade_base);
alter table vendedor.pedido_item add constraint pedido_item_fator_positivo check (fator > 0);
alter table vendedor.pedido_item add constraint pedido_item_quantidade_positiva check (quantidade > 0);
alter table vendedor.pedido_item add constraint pedido_item_quantidade_embalagem_positiva check (quantidade_embalagem > 0);
alter table vendedor.pedido_item add constraint pedido_item_embalagem_coerente check (quantidade_embalagem = fator);

-- core.produto_unidade --------------------------------------------------------------------------------------------------
alter table core.produto_unidade drop constraint if exists produto_unidade_fator_positivo;
alter table core.produto_unidade
  alter column fator type integer using fator::integer,
  alter column fator set default 1;
alter table core.produto_unidade add constraint produto_unidade_fator_positivo check (fator > 0);
