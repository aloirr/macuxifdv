-- 0034_catalogo_referencia_marca_nome (up) — T-0085 (Catálogo do cadastro: RF-CAT-09, RN-CAT-09). ADR 0027 reescrita,
-- seção "Caminho para fechar o risco 2"; aviso R-20261105-225102-engenheiro-software. Dicionário: docs/banco/catalogo.md.
-- Migração ADITIVA: uma coluna nula, sem padrão, sem índice; nenhuma coluna existente muda.
--
-- catalogo.produto_referencia.marca_nome (text, null): RETRATO do nome da marca concorrente (cadastro `concorrente` do
--   Promotor) no momento da gravação, para o vendedor ver "Equivale a: <marca> <código>" sem ter o Promotor no perfil e
--   para o aparelho deixar de ler a entidade `concorrente`. Quem grava: a rota do BKO do Catálogo e o consumidor do ERP,
--   depois de validar a marca por `promotor.concorrentes@1`; o consumidor de `promotor.concorrente.alterado@1` mantém o
--   nome em dia. marca_id continua a chave (sem FK); o nome é só o retrato.
--   CHECK produto_referencia_marca_nome_preenchida: nulo, ou `btrim` não vazio e até 120 caracteres (o nome do concorrente
--   no contrato do Promotor é 1..120).
--   NULO, e não `not null` como no aviso: o preenchimento das linhas existentes pelo nome atual exigiria ler
--   promotor.concorrente numa migração do Catálogo — proibido (regra 1, ADR 0005). As linhas anteriores à 0034 ficam
--   nulas até a próxima gravação: na base demo, a recarga do seed (upsert por id) grava o nome; nas fixtures, idem; em
--   base de cliente, a rota do BKO, o Hub ou o consumidor do evento reescrevem. Leitor com marca_nome nulo cai no
--   fallback (consulta do Promotor ou "marca não informada"). O `not null` pode vir numa migração futura, depois que
--   todos os escritores gravarem e as nulas forem zero (conferir antes; sem isso o ALTER falha).
--   Sem índice: a busca pelo código usa produto_referencia_codigo_compacto_ix (0033) e o nome da marca não entra no
--   documento de busca (desenho T-0085 §7: `referencias` = códigos crus + compactos, peso A). Pull: a entidade
--   `produto_referencia` passa a levar `marca_nome` (aditivo, no provedor e no contrato do Catálogo); no aparelho os dados
--   ficam no JSON de `ent_produto_referencia`, então NÃO há versão nova do esquema local.
--
-- RLS: a tabela já tem enable/force e as políticas isolamento_tenant e manutencao (0033); nenhuma política nova, grants
-- iguais. Volume: o da tabela (até 60 mil linhas num catálogo de 20 mil produtos).
-- Caminho de volta: 0034_catalogo_referencia_marca_nome.down.sql (APAGA a coluna e o CHECK com os retratos; marca_id fica,
-- e o nome volta a ser lido pela consulta do Promotor).

alter table catalogo.produto_referencia add column marca_nome text;
alter table catalogo.produto_referencia add constraint produto_referencia_marca_nome_preenchida
  check (marca_nome is null or (btrim(marca_nome) <> '' and char_length(marca_nome) <= 120));
