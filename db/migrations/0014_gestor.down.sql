-- 0014_gestor (down) — T-0055
-- Desfaz a 0014. APAGA a projeção do Gestor, a idempotência do consumidor, os alertas (inclusive o histórico de
-- encerrados e dispensados) e os ajustes das regras (schema gestor inteiro, com a função de expurgo).
-- Pré-condição: 0015+ desfeitas. As linhas de licença do Gestor (plataforma.tenant_modulo / perfil_modulo, gravadas pelo
-- seed) NÃO são apagadas: sem o schema, as rotas /v1/gestor falham até a 0014 voltar (refazer o up recria tudo vazio;
-- a projeção se refaz com os eventos novos e o seed da demo — db/seeds/demo/gestor.ts — recarrega a base de demo).
drop function if exists gestor.expurgar_eventos_aplicados(timestamptz, integer, integer);
drop schema if exists gestor cascade;
