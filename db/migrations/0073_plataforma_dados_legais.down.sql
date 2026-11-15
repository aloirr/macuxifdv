-- 0073_plataforma_dados_legais (down) — desfaz a 0073 e volta exatamente ao catálogo e às ACLs da migração anterior.
-- PERDE a razão social, o CNPJ e o site gravados (anote antes: select razao_social, cnpj, site from plataforma.dados_legais).
-- As linhas 'sa.dados_legais.gravar' da plataforma.auditoria_plataforma ficam (append-only). Pré-condição: a API sem as rotas
-- de dados legais (com elas e sem as funções, a API responde 503 e o rodapé usa o cache do aparelho e o site padrão).

drop function if exists plataforma.sa_gravar_dados_legais(uuid, jsonb);
drop function if exists plataforma.sa_dados_legais(uuid);
drop function if exists plataforma.dados_legais_publicos();
-- a tabela leva junto índices, gatilho, política e a linha
drop table if exists plataforma.dados_legais;
