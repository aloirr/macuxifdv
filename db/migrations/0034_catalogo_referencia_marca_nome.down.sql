-- 0034_catalogo_referencia_marca_nome (down) — T-0085
-- Desfaz a 0034: APAGA catalogo.produto_referencia.marca_nome (os retratos do nome da marca) e o CHECK
-- produto_referencia_marca_nome_preenchida. As referências ficam intactas (marca_id, código, ordem); quem precisa do nome
-- volta a ler pela consulta `promotor.concorrentes@1`, e o provedor do pull anterior não leva a coluna.
-- Idempotente (if exists em tudo). Pré-condição: 0035+ desfeitas.

alter table catalogo.produto_referencia drop constraint if exists produto_referencia_marca_nome_preenchida;
alter table catalogo.produto_referencia drop column if exists marca_nome;
