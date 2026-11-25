-- 0102_plataforma_dados_da_empresa (down) — volta ao catálogo da migração anterior: apaga as 4 funções do portal e as 10
-- colunas do cadastro em plataforma.tenant (os CHECKs e o SELECT por coluna do macuxi_leitura saem junto com elas).
-- PERDE o cadastro das empresas (endereço, contato e inscrição estadual): anote antes com a consulta do cabeçalho do up. A razão
-- social gravada fica (é a coluna nome) e a senha trocada do super-admin também (coluna senha_hash da 0035). As linhas
-- 'sa.empresa.cadastro' e 'sa.senha.trocada' da auditoria ficam (append-only). Antes do down, volte a API sem as rotas novas.

drop function if exists plataforma.sa_gravar_senha_super_admin(uuid, text, text);
drop function if exists plataforma.sa_quem_sou(uuid);
drop function if exists plataforma.sa_gravar_dados_da_empresa(uuid, uuid, jsonb);
drop function if exists plataforma.sa_dados_da_empresa(uuid, uuid);
alter table plataforma.tenant drop column if exists inscricao_estadual;
alter table plataforma.tenant drop column if exists email;
alter table plataforma.tenant drop column if exists telefone;
alter table plataforma.tenant drop column if exists cep;
alter table plataforma.tenant drop column if exists uf;
alter table plataforma.tenant drop column if exists municipio;
alter table plataforma.tenant drop column if exists bairro;
alter table plataforma.tenant drop column if exists complemento;
alter table plataforma.tenant drop column if exists numero;
alter table plataforma.tenant drop column if exists logradouro;
