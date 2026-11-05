-- 0024_plataforma_resumo_outbox_lgpd (down) — T-0078
-- Desfaz a 0024 na ordem inversa. APAGA as cinco funções (resumo da outbox e LGPD); nenhuma tabela muda. O /v1/saude volta a
-- responder outbox nula (a API tolera 42883). O que já foi anonimizado ou excluído com as funções NÃO volta (só pelo backup).
-- Idempotente (if exists em tudo).
-- Pré-condição: 0025+ desfeitas.

drop function if exists plataforma.excluir_tenant(uuid, text);
drop function if exists plataforma.anonimizar_contato(uuid, uuid);
drop function if exists plataforma.anonimizar_cliente(uuid, uuid);
drop function if exists plataforma.anonimizar_usuario(uuid, uuid);
drop function if exists plataforma.resumo_outbox(text[], integer);
