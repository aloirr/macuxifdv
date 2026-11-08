# Diário — modulo-pesquisa

2026-10-31 — T-0001 — Fase C: esqueleto modules/pesquisa (manifest + pastas), verde
2026-10-31 — T-0012 — domínio da Pesquisa (versões, 9 tipos, condicionais, público/vigência/frequência, checkout, idempotência, resultados), contratos Zod, manifesto com acoes e docs/modulos/pesquisa/regras.md; 200 testes verdes
2026-10-31 — T-0012 — revisão do domínio/contracts/manifesto vindos da nuvem: sem 🔴; 200 testes, lint, typecheck e fronteiras verdes; 1 🟡 (ContextoCheckout sem cliente_fechado, pedido ao core)
2026-10-31 — T-0012 — ajuste às decisões do Alexandre: suspeita em vez de recusa (RN-PES-04), GS1 como aviso e foto 1600/80 (RN-PES-06), sem canal (RN-PES-05), consolidação por id estável (RN-PES-01), cliente fechado do Core (RN-CORE-14); regras.md atualizado; 215 testes
2026-11-05 — T-0072 — Pesquisa: 🟡 do #93 corrigidos (chip Registrada, Obrigatória neutra, ícone camera, texto Fora do público); plano da etapas_checkout@1 enviado
2026-11-05 — T-0072 — chip 'Não se aplica' curto na aba do cliente, explicação abaixo do título e no rótulo acessível
2026-11-05 — T-0024 — teste conferirEventosPublicados + exemplo válido do pesquisa.resposta.registrada@1; contrato intacto
2026-11-05 — T-0039 — consulta pesquisa.etapas_checkout@1 (domain, api, contracts, manifesto, testes sem banco); recado ao modulo-core para ligar no checkout
2026-11-05 — T-0039 — etapas_checkout@1: respostasParaCheckout filtrado (memória/Postgres) e ctx.fuso() no lugar do fuso fixo; testes verdes
2026-11-05 — T-0039 — complemento: fuso por ctx.fuso(); teste de virada não demonstrável porque o domain filtra por visita
2026-11-05 — T-0039 — consulta etapas_checkout usa ctx.fuso(); teste de virada de semana/mês em 3 fusos; método filtrado confirmado
2026-11-08 — contraste do laranja (text-accent-ink em 4 pontos da web) e encerramento do pedido do #56
