-- 0059_core_filial_dados_fiscais (up) — T-0159 (PDF do pedido, proposta 2: o cabeçalho mostra CNPJ, endereço e telefone da
-- FILIAL DE FATURAMENTO do pedido; R-20261110-215816-alexandre, R-20261110-220007-alexandre e R-20261110-212608-gerente-projetos).
-- Migração em cima da 0058. Dicionário: docs/banco/core.md ("0059 — dados fiscais da filial") e vendedor.md (retrato).
-- Migração ADITIVA: 7 colunas NULAS em core.filial, 7 CHECKs de formato e 1 único parcial. Sem backfill (o updated_at das filiais
-- não anda; quem preenche é o BKO, a carga do ERP ou a seed, e cada escrita anda o updated_at pelo gatilho filial_updated_at).
-- Nenhum contrato muda de versão; RLS, políticas e grants da 0056 cobrem as colunas novas (grant de tabela inteira).
--
-- core.filial (dono: Core):
--   cnpj         text  só dígitos, 14 (filial_cnpj_formato). O dígito verificador é do domain (validarFilial, Core) e da
--                      carga (Hub). Único vivo no tenant quando preenchido (filial_cnpj_uk): duas filiais vivas com o mesmo CNPJ
--                      = 23505 (cada estabelecimento tem o seu CNPJ; a matriz e as filiais diferem no sufixo /0001, /0002...).
--   logradouro   text  1..160 (filial_logradouro_tamanho)
--   numero       text  1..20  (filial_numero_tamanho; "S/N" cabe)
--   complemento  text  1..80  (filial_complemento_tamanho)
--   bairro       text  1..80  (filial_bairro_tamanho)
--   cep          text  só dígitos, 8 (filial_cep_formato; o mesmo de core.cliente_endereco)
--   telefone     text  1..30  (filial_telefone_tamanho; o mesmo de core.usuario.telefone). Opcional também na regra.
--   cidade e uf já existem (0056).
-- NULOS no banco (premissa do gerente, R-20261110-212608): a padrão nasce SEM esses dados (gatilho tenant_semear_filial, 0056)
--   e as filiais da produção ainda não os têm. A obrigatoriedade de CNPJ e endereço (R-20261110-220007-alexandre: "sem eles a
--   filial não é cadastrada") fica no domain do Core (BKO) e na carga do Hub. O NOT NULL entra numa migração FUTURA, depois de
--   preenchidas as filiais da demo e da produção (a conferência é `select ... where cnpj is null or logradouro is null ...`).
-- Retrato da filial no pedido (vendedor.pedido.filial, jsonb, 0056): é JSON livre com CHECK só de objeto e de id coerente; os
--   campos novos entram no retrato SEM DDL (retratoFilialDoPedido, domain do Vendedor). Pedidos anteriores ficam como estão.
-- Volume: unidades a dezenas por tenant. Consultas: as da 0056 (PK, external_id, lista do BKO) e "CNPJ já usado?" pelo único.
--
-- Caminho de volta: 0059_core_filial_dados_fiscais.down.sql (APAGA as 7 colunas: os CNPJ, endereços e telefones das filiais se
-- perdem; o retrato já gravado nos pedidos FICA, é JSON).

alter table core.filial add column cnpj text;
alter table core.filial add column logradouro text;
alter table core.filial add column numero text;
alter table core.filial add column complemento text;
alter table core.filial add column bairro text;
alter table core.filial add column cep text;
alter table core.filial add column telefone text;

alter table core.filial add constraint filial_cnpj_formato check (cnpj is null or cnpj ~ '^[0-9]{14}$');
alter table core.filial add constraint filial_logradouro_tamanho check (logradouro is null or (btrim(logradouro) <> '' and char_length(logradouro) <= 160));
alter table core.filial add constraint filial_numero_tamanho check (numero is null or (btrim(numero) <> '' and char_length(numero) <= 20));
alter table core.filial add constraint filial_complemento_tamanho check (complemento is null or (btrim(complemento) <> '' and char_length(complemento) <= 80));
alter table core.filial add constraint filial_bairro_tamanho check (bairro is null or (btrim(bairro) <> '' and char_length(bairro) <= 80));
alter table core.filial add constraint filial_cep_formato check (cep is null or cep ~ '^[0-9]{8}$');
alter table core.filial add constraint filial_telefone_tamanho check (telefone is null or (btrim(telefone) <> '' and char_length(telefone) <= 30));

create unique index filial_cnpj_uk on core.filial (tenant_id, cnpj) where cnpj is not null and deleted_at is null;
