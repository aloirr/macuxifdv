-- 0005_plataforma_arquivo (down) — T-0018
-- Desfaz a 0005. APAGA os metadados de arquivo (plataforma.arquivo); os bytes no armazenamento (disco/S3) NÃO são
-- apagados aqui e ficam órfãos (remover pela chave <tenant_id>/<modulo>/...). Pré-condição: 0006+ desfeitas
-- (core.visita referencia plataforma.arquivo e a 0006 usa plataforma.uuid_de_chave).
drop table if exists plataforma.arquivo;
drop function if exists plataforma.uuid_de_chave(text);
