-- 0022_plataforma_geracao_base (down) — T-0079
-- Desfaz a 0022 na ordem inversa. APAGA o marcador plataforma.tenant.geracao_base (os dados do tenant ficam intactos; o
-- /me e o pull voltam sem o campo, e o aparelho segue como app antigo, sem limpar a cópia local) e a função que o gira.
-- Idempotente (if exists em tudo).
-- Pré-condição: 0023+ desfeitas.

drop function if exists plataforma.girar_geracao_base(uuid);
alter table plataforma.tenant drop column if exists geracao_base;
