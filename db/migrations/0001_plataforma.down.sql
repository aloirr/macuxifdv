-- 0001_plataforma (down) — T-0002
-- Remove o schema plataforma inteiro (tabelas, funções, políticas e grants). APAGA OS DADOS.
-- Pré-condição: 0002_core já desfeita (o executor desfaz na ordem inversa).
-- O papel macuxi_app é do cluster (compartilhado por outros bancos, ex.: bancos de teste) e fica.
drop schema if exists plataforma cascade;
