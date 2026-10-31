-- 0004_core_sessao (down) — T-0003 Fase 2
-- Desfaz a 0004 na ordem inversa. APAGA todas as sessões (refresh) e aparelhos e a contagem de tentativas
-- de login: depois do down todo usuário precisa logar de novo e bloqueios TEMPORÁRIOS (bloqueio_ate) somem.
-- O bloqueio manual (core.usuario.bloqueado_em, 0002) fica. Pré-condição: nenhuma migração posterior aplicada.
drop index if exists core.equipe_responsavel_ix;

drop table if exists core.sessao;
drop table if exists core.dispositivo;

alter table core.usuario drop constraint if exists usuario_tentativas_nao_negativas;
alter table core.usuario drop column if exists bloqueio_ate;
alter table core.usuario drop column if exists tentativas_falhas;
