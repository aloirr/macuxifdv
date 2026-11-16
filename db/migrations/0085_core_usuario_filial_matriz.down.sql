-- 0085_core_usuario_filial_matriz (down) — NO-OP DOCUMENTADO. A 0085 só grava dados (filial matriz como cadastro e venda dos
-- usuários vivos que estavam sem filial de cadastro; R-20261116-093600-alexandre); o catálogo não muda, então não há DDL a desfazer.
-- Os dados NÃO voltam: depois da 0085 não se distingue a filial gravada por ela da gravada pelo BKO ou pela carga, e tirar a filial
-- de cadastro bloquearia o usuário de novo (403 USUARIO_SEM_FILIAL, RN-CORE-39). Para corrigir um usuário, troque a filial dele pelo
-- BKO (cadastro e venda). Idempotente. Pré-condição: nenhuma.
select 1;
