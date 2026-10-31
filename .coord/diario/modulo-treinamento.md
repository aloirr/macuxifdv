# Diário — modulo-treinamento

2026-10-31 — T-0001 — Fase C: esqueleto de modules/treinamento (manifesto, pastas, teste) criado e verde
2026-10-31 — T-0011 — domínio do Treinamento (trilha/pré-requisitos, quiz, XP com teto e idempotência, streak, níveis, medalhas, ranking, adesão, desafio de vendas), contracts Zod, manifesto com acoes e regras.md; 186 testes verdes
2026-10-31 — T-0011 — revisão do domínio (sem 🔴, 🟡 nos ajustes RN-TRE que ficam na nuvem por ordem do Alexandre); pedido de tabelas ao banco-dados
2026-10-31 — T-0011 (ajustes) — decisões do Alexandre aplicadas: teto por desafio (xp_max_por_desafio=500), streak só com lição/quiz concluído, desafio paga no faturamento (evento pendente, consome provisório), tempo mínimo max(30 s, 50% da duração); 215 testes verdes.
2026-10-31 — T-0011 (v2) — faturamento parcial no desafio (candidatosDoDesafio, chave por pedido/produto, PARCIAL_SEM_ITENS), manifesto consome só vendedor.pedido.faturado@1, regras.md sem premissas em aberto; 229 testes verdes
2026-10-31 — T-0011 (realinhamento) — desafio realinhado ao desenho T-0011 §2: itens somados por retorno, idempotência por evento_id (chave desafio:pedido:evento_id / desafio:pedido:total), candidatoDoDesafio único, regras.md com RN-TRE-01..08 e sem premissas (aviso R-20261031-172550-modulo-treinamento)
