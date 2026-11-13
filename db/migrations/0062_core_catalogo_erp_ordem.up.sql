-- 0062_core_catalogo_erp_ordem (up) — T-0095 (RN-INT-02/04/06): guarda de ordem do ERP nos consumidores do Core e do
-- Catálogo e "desligado pelo admin" que a carga não reativa. Migração em cima da 0061. Continua a seção T-0095 da 0039
-- (core.cliente, core.usuario e core.produto já têm erp_alterado_em; core.usuario já tem desligado_no_bko_em).
-- Dicionário: docs/banco/core.md e docs/banco/catalogo.md ("0062"). Teste: db/testes/erp-ordem.test.ts.
--
-- Migração ADITIVA: 9 colunas erp_alterado_em e 2 desligado_no_bko_em, todas NULAS e sem backfill (linhas antigas = "nunca
-- veio do ERP" / "não desligado"; nada muda em updated_at, então nenhum aparelho puxa de novo por causa da 0062); 5 índices
-- parciais (vazios na criação); 2 funções de gatilho em plataforma (como plataforma.definir_updated_at) e 15 gatilhos.
-- Nenhum contrato muda de versão; RLS, políticas e grants não mudam (as colunas herdam os da tabela). Fora do pull do aparelho
-- (o sync lista as colunas; estas não entram).
--
-- erp_alterado_em timestamptz(3): o `alterado_em` do registro do ERP (relógio do ERP, NUNCA o ocorrido_em do Hub) aplicado à
-- linha. O consumidor grava em TODA escrita que vem do ERP, inclusive na inativação e no apagamento (deleted_at), quando o
-- evento traz o registro; sem registro (só o relógio do Hub), não avança a coluna (coalesce).
--   core: cliente_endereco, produto_unidade, titulo, nota_erp, rota (por dia; a rota inteira do ERP compara pelo maior dos
--         dias, starts_with(external_id, '<rota>@')), filial;
--   catalogo: tabela_preco_item, estoque_saldo (o atualizado_erp_em continua sendo o que o app mostra), cliente_tabela_preco
--         (versão do registro do CLIENTE do ERP que trouxe a tabela).
-- desligado_no_bko_em timestamptz(3): a API do BKO grava ao desativar e limpa ao reativar, no MESMO update do `ativo`;
--   preenchida, a carga do ERP não reativa (o consumidor avisa o monitor). Em core.filial (PUT /filiais/:id com ativo) e em
--   catalogo.tabela_preco (desativação da tabela no BKO).
--
-- Gatilhos (rede de segurança do banco; o consumidor decide ANTES e avisa, o banco garante mesmo com corrida ou esquecimento):
--   <tabela>_versao_erp  BEFORE UPDATE, quando new.erp_alterado_em < old.erp_alterado_em (os dois preenchidos):
--     plataforma.manter_versao_erp() devolve OLD, ou seja, a linha fica como estava (o update vira no-op e o `returning` ainda
--     devolve a linha, para o consumidor não cair no "não achei, insere"). Igual = aplica (reentrega idempotente). O nome
--     ordena DEPOIS de <tabela>_updated_at, então o no-op nem sobe o updated_at. Em core.cliente, core.usuario, core.produto
--     (colunas da 0039) e nas 9 tabelas acima.
--   <tabela>_desligado_no_bko  BEFORE UPDATE OF ativo, quando a marca continua preenchida e o update tenta reativar:
--     plataforma.manter_desligado_no_bko() mantém ativo = false (o resto do update vale: nome, endereço, ...). Em core.usuario,
--     core.filial e catalogo.tabela_preco. Reativar no BKO = ativo true E desligado_no_bko_em null no mesmo update.
--   O gatilho só protege a linha VIVA que o update acha. Registro apagado (deleted_at) e reentregue mais antigo nasceria como
--   linha nova pelo insert: o consumidor confere antes a maior versão por external_id, apagadas inclusive, pelos índices abaixo.
--
-- Índices <tabela>_erp_versao_ix (tenant_id, external_id, erp_alterado_em) where external_id is not null and erp_alterado_em
-- is not null, nas 5 tabelas em que o ERP APAGA (deleted_at) e o mesmo external_id volta como linha nova: core.titulo,
-- core.nota_erp, catalogo.tabela_preco_item, catalogo.estoque_saldo, catalogo.cliente_tabela_preco. Consulta-modelo
-- (index-only; o RLS acrescenta tenant_id = plataforma.tenant_atual()):
--     select erp_alterado_em from core.titulo
--      where external_id = $1 and erp_alterado_em is not null
--      order by erp_alterado_em desc limit 1;
--   As outras tabelas inativam (ativo = false) sem apagar: a linha viva é achada pelo único vivo (tenant_id, external_id) de
--   sempre. core.rota é pequena (vendedores × dias) e o consumidor já varre pelo prefixo.
-- Volume: títulos e notas na casa das dezenas de milhares por tenant, preços e saldos até centenas de milhares; os índices
-- nascem vazios e só crescem com a carga do ERP.
--
-- Caminho de volta: 0062_core_catalogo_erp_ordem.down.sql (apaga gatilhos, funções, índices e as 11 colunas; perde só as
-- marcas de ordem e de desligamento; a próxima carga do ERP aplica tudo de novo e a filial ou tabela de preço desligada no
-- BKO pode voltar ativa). Volte antes o código dos consumidores e do BKO que lê ou grava as colunas (senão 42703).

-- ---------------------------------------------------------------------------------------------------------------------
-- Colunas
alter table core.cliente_endereco add column erp_alterado_em timestamptz(3);
alter table core.produto_unidade add column erp_alterado_em timestamptz(3);
alter table core.titulo add column erp_alterado_em timestamptz(3);
alter table core.nota_erp add column erp_alterado_em timestamptz(3);
alter table core.rota add column erp_alterado_em timestamptz(3);
alter table core.filial add column erp_alterado_em timestamptz(3);
alter table core.filial add column desligado_no_bko_em timestamptz(3);
alter table catalogo.tabela_preco_item add column erp_alterado_em timestamptz(3);
alter table catalogo.estoque_saldo add column erp_alterado_em timestamptz(3);
alter table catalogo.cliente_tabela_preco add column erp_alterado_em timestamptz(3);
alter table catalogo.tabela_preco add column desligado_no_bko_em timestamptz(3);

-- ---------------------------------------------------------------------------------------------------------------------
-- Funções de gatilho (sem SECURITY DEFINER: rodam com o papel de quem faz o update, sob o RLS dele)
create function plataforma.manter_versao_erp() returns trigger
  language plpgsql
  set search_path = pg_catalog, plataforma, pg_temp
  as $$
begin
  -- só é chamada pelo WHEN do gatilho (versão recebida mais antiga que a aplicada): a linha fica como estava
  return old;
end
$$;

create function plataforma.manter_desligado_no_bko() returns trigger
  language plpgsql
  set search_path = pg_catalog, plataforma, pg_temp
  as $$
begin
  -- só é chamada pelo WHEN do gatilho (marca do BKO preenchida e o update tenta reativar): segue desligado
  new.ativo := false;
  return new;
end
$$;

-- ---------------------------------------------------------------------------------------------------------------------
-- Gatilhos da guarda de ordem (nome depois de <tabela>_updated_at)
create trigger cliente_versao_erp before update on core.cliente
  for each row when (new.erp_alterado_em < old.erp_alterado_em) execute function plataforma.manter_versao_erp();
create trigger usuario_versao_erp before update on core.usuario
  for each row when (new.erp_alterado_em < old.erp_alterado_em) execute function plataforma.manter_versao_erp();
create trigger produto_versao_erp before update on core.produto
  for each row when (new.erp_alterado_em < old.erp_alterado_em) execute function plataforma.manter_versao_erp();
create trigger cliente_endereco_versao_erp before update on core.cliente_endereco
  for each row when (new.erp_alterado_em < old.erp_alterado_em) execute function plataforma.manter_versao_erp();
create trigger produto_unidade_versao_erp before update on core.produto_unidade
  for each row when (new.erp_alterado_em < old.erp_alterado_em) execute function plataforma.manter_versao_erp();
create trigger titulo_versao_erp before update on core.titulo
  for each row when (new.erp_alterado_em < old.erp_alterado_em) execute function plataforma.manter_versao_erp();
create trigger nota_erp_versao_erp before update on core.nota_erp
  for each row when (new.erp_alterado_em < old.erp_alterado_em) execute function plataforma.manter_versao_erp();
create trigger rota_versao_erp before update on core.rota
  for each row when (new.erp_alterado_em < old.erp_alterado_em) execute function plataforma.manter_versao_erp();
create trigger filial_versao_erp before update on core.filial
  for each row when (new.erp_alterado_em < old.erp_alterado_em) execute function plataforma.manter_versao_erp();
create trigger tabela_preco_item_versao_erp before update on catalogo.tabela_preco_item
  for each row when (new.erp_alterado_em < old.erp_alterado_em) execute function plataforma.manter_versao_erp();
create trigger estoque_saldo_versao_erp before update on catalogo.estoque_saldo
  for each row when (new.erp_alterado_em < old.erp_alterado_em) execute function plataforma.manter_versao_erp();
create trigger cliente_tabela_preco_versao_erp before update on catalogo.cliente_tabela_preco
  for each row when (new.erp_alterado_em < old.erp_alterado_em) execute function plataforma.manter_versao_erp();

-- ---------------------------------------------------------------------------------------------------------------------
-- Gatilhos do "desligado pelo admin"
create trigger usuario_desligado_no_bko before update of ativo on core.usuario
  for each row when (old.desligado_no_bko_em is not null and new.desligado_no_bko_em is not null and new.ativo and not old.ativo)
  execute function plataforma.manter_desligado_no_bko();
create trigger filial_desligado_no_bko before update of ativo on core.filial
  for each row when (old.desligado_no_bko_em is not null and new.desligado_no_bko_em is not null and new.ativo and not old.ativo)
  execute function plataforma.manter_desligado_no_bko();
create trigger tabela_preco_desligado_no_bko before update of ativo on catalogo.tabela_preco
  for each row when (old.desligado_no_bko_em is not null and new.desligado_no_bko_em is not null and new.ativo and not old.ativo)
  execute function plataforma.manter_desligado_no_bko();

-- ---------------------------------------------------------------------------------------------------------------------
-- Índices da maior versão por external_id, apagadas inclusive (tabelas em que o ERP apaga e o external_id volta)
create index titulo_erp_versao_ix on core.titulo (tenant_id, external_id, erp_alterado_em)
  where external_id is not null and erp_alterado_em is not null;
create index nota_erp_erp_versao_ix on core.nota_erp (tenant_id, external_id, erp_alterado_em)
  where external_id is not null and erp_alterado_em is not null;
create index tabela_preco_item_erp_versao_ix on catalogo.tabela_preco_item (tenant_id, external_id, erp_alterado_em)
  where external_id is not null and erp_alterado_em is not null;
create index estoque_saldo_erp_versao_ix on catalogo.estoque_saldo (tenant_id, external_id, erp_alterado_em)
  where external_id is not null and erp_alterado_em is not null;
create index cliente_tabela_preco_erp_versao_ix on catalogo.cliente_tabela_preco (tenant_id, external_id, erp_alterado_em)
  where external_id is not null and erp_alterado_em is not null;
