-- 0082_plataforma_frase_carga (down) — desfaz a 0082 (T-0181) e volta ao catálogo e às ACLs anteriores.
-- APAGA plataforma.frase_carga: as 30 iniciais e as frases incluídas, editadas, ativadas ou desativadas no portal (reaplicar a
-- 0082 recarrega só as 30 iniciais, todas ativas, com os mesmos ids). A auditoria (plataforma.auditoria_plataforma,
-- sa.frase_carga.*) FICA. O app continua sorteando a lista guardada no aparelho (ou as 30 do bundle). Pré-condição: a API sem
-- as rotas /v1/plataforma/frases-carga e /v1/sync/frases-carga (senão 42883). Idempotente.

drop function if exists plataforma.frases_carga_ativas();
drop function if exists plataforma.sa_editar_frase_carga(uuid, uuid, text, boolean);
drop function if exists plataforma.sa_incluir_frase_carga(uuid, uuid, text);
drop function if exists plataforma.sa_listar_frases_carga(uuid);
-- a tabela leva junto índices, gatilho e política
drop table if exists plataforma.frase_carga;
