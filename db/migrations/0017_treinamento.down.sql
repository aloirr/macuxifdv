-- 0017_treinamento (down) — T-0058
-- Desfaz a 0017: APAGA o schema treinamento inteiro (trilhas e árvore de conteúdo, publicação, progresso, tentativas, XP,
-- medalhas e desafios de vendas) e a função treinamento.tocar_trilha. Pré-condição: 0018+ desfeitas.
-- A licença 'treinamento' em plataforma.tenant_modulo/perfil_modulo (seed) fica: sem o schema, a API do Treinamento
-- responde 503 TREINAMENTO_INDISPONIVEL (falha fechada) e o aparelho guarda a fila até um novo up.
drop schema if exists treinamento cascade;
