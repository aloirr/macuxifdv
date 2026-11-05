# Diário — modulo-treinamento

2026-10-31 — T-0001 — Fase C: esqueleto de modules/treinamento (manifesto, pastas, teste) criado e verde
2026-10-31 — T-0011 — domínio do Treinamento (trilha/pré-requisitos, quiz, XP com teto e idempotência, streak, níveis, medalhas, ranking, adesão, desafio de vendas), contracts Zod, manifesto com acoes e regras.md; 186 testes verdes
2026-10-31 — T-0011 — revisão do domínio (sem 🔴, 🟡 nos ajustes RN-TRE que ficam na nuvem por ordem do Alexandre); pedido de tabelas ao banco-dados
2026-10-31 — T-0011 (ajustes) — decisões do Alexandre aplicadas: teto por desafio (xp_max_por_desafio=500), streak só com lição/quiz concluído, desafio paga no faturamento (evento pendente, consome provisório), tempo mínimo max(30 s, 50% da duração); 215 testes verdes.
2026-10-31 — T-0011 (v2) — faturamento parcial no desafio (candidatosDoDesafio, chave por pedido/produto, PARCIAL_SEM_ITENS), manifesto consome só vendedor.pedido.faturado@1, regras.md sem premissas em aberto; 229 testes verdes
2026-10-31 — T-0011 (realinhamento) — desafio realinhado ao desenho T-0011 §2: itens somados por retorno, idempotência por evento_id (chave desafio:pedido:evento_id / desafio:pedido:total), candidatoDoDesafio único, regras.md com RN-TRE-01..08 e sem premissas (aviso R-20261031-172550-modulo-treinamento)
2026-11-02 — T-0065 — licao-screen.tsx: setInterval do tempo mínimo marcado com timer-permitido (RN-TRE-04)
2026-11-02 — T-0065 — licao-screen.tsx: setInterval do tempo mínimo marcado com timer-permitido (RN-TRE-04)
2026-11-03 — T-0058 — adesão com base_parcial (usuários só com atividade) até o Core oferecer core.usuarios_resumo@1; pedido ao modulo-core; fonte completa já preparada
2026-11-03 — T-0058 — pull de trilhas filtra antes do limite (paginarFiltrando); aviso base_parcial na adesão do BKO
2026-11-03 — T-0058 — Treinamento usa core.usuarios_resumo@1 (cursor, base_parcial dinâmico, fallback cadastro_resumo)
2026-11-03 — sync.test instável — causa: lote com t(min)=agora-30+min cruzava a meia-noite de Manaus (04:00Z) quando o relógio caía em 04:10Z-04:30Z (streak e XP mudavam: 86≠82; 'streak' extra). Teste ancorado em 09:00 do dia do tenant; reproduzido com MACUXI_AGORA=04:20Z (2 falhas) e verde depois; só o teste mudou
2026-11-03 — T-0070 — 4 🟡 da revisão de telas: BKO (aviso warning, campos de equipe escondidos) e app (voltar do quiz, catch no Linking)
2026-11-05 — T-0072 — 6 amarelos da revisão de UX do #92 corrigidos nas telas do Treinamento
2026-11-05 — T-0024 — PedidoFaturadoLido passa a ser tolerante(PedidoFaturadoEvento) do Vendedor; teste conferirEventosPublicados
