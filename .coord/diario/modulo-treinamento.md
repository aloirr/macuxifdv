# Diário — modulo-treinamento

2026-10-31 — T-0001 — Fase C: esqueleto de modules/treinamento (manifesto, pastas, teste) criado e verde
2026-10-31 — T-0011 — domínio do Treinamento (trilha/pré-requisitos, quiz, XP com teto e idempotência, streak, níveis, medalhas, ranking, adesão, desafio de vendas), contracts Zod, manifesto com acoes e regras.md; 186 testes verdes
2026-10-31 — T-0011 (ajustes) — decisões do Alexandre aplicadas: teto por desafio (xp_max_por_desafio=500), streak só com lição/quiz concluído, desafio paga no faturamento (evento pendente, consome provisório), tempo mínimo max(30 s, 50% da duração); 215 testes verdes.
2026-10-31 — T-0011 (v2) — faturamento parcial no desafio (candidatosDoDesafio, chave por pedido/produto, PARCIAL_SEM_ITENS), manifesto consome só vendedor.pedido.faturado@1, regras.md sem premissas em aberto; 229 testes verdes
