-- 0082_plataforma_tenant_logo (down) — desfaz a 0082 e volta exatamente ao catálogo e às ACLs da migração anterior.
-- PERDE o nome fantasia e os metadados das logos (anote antes: select id, nome_fantasia, logo_chave from plataforma.tenant
-- where nome_fantasia is not null or logo_chave is not null). Os objetos das logos ficam órfãos no armazenamento (apagáveis
-- pela chave <tenant_id>/plataforma/...). As linhas 'sa.empresa.*' da plataforma.auditoria_plataforma ficam (append-only).
-- Pré-condição: a API sem as rotas da marca e sem as colunas novas no lerTenant.

drop function if exists plataforma.sa_remover_logo(uuid, uuid);
drop function if exists plataforma.sa_gravar_logo(uuid, uuid, jsonb);
drop function if exists plataforma.sa_gravar_nome_fantasia(uuid, uuid, text);
drop function if exists plataforma.sa_marca_da_empresa(uuid, uuid);
drop function if exists plataforma.marca_da_empresa_json(uuid);
-- as colunas levam junto os CHECKs da 0082
alter table plataforma.tenant drop column if exists logo_atualizada_em;
alter table plataforma.tenant drop column if exists logo_chave;
alter table plataforma.tenant drop column if exists logo_altura_px;
alter table plataforma.tenant drop column if exists logo_largura_px;
alter table plataforma.tenant drop column if exists logo_tamanho_bytes;
alter table plataforma.tenant drop column if exists logo_sha256;
alter table plataforma.tenant drop column if exists logo_tipo;
alter table plataforma.tenant drop column if exists logo_id;
alter table plataforma.tenant drop column if exists nome_fantasia;
