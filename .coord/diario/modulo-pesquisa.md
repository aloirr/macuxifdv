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
2026-11-09 — T-0115 — canal no público-alvo (domain, contrato, construtor BKO por texto, filtro offline no app); lint/typecheck/test verdes
2026-11-09 — T-0115 (defeito) — publico_alvo do banco passa por PublicoAlvo.parse e publico.ts tolera canais ausente; teste de público legado
2026-11-09 — T-0140 — lote 03: RD-0014 (ROTULO_PERFIL do SDK no construtor) e RD-0042 (datas civis do @macuxi/comum no domain)
2026-11-09 — T-0140 — RD-0044: celulaCsv usa protegerFormula do comum (cobre '-' + dígito, CWE-1236); RD-0045 aguarda o comum
2026-11-09 — T-0140 — RD-0045: arredondar e percentual reexportados do @macuxi/comum (domain/util.ts)
2026-11-09 — T-0117/T-0140 — PAYLOAD_INVALIDO da Pesquisa em português via auxiliares do SDK + teste
2026-11-12 — T-0166 — RD-0184: saem chips de progresso/salvo, faixa repetida e subtítulo da folha Enviar na resposta da pesquisa
2026-11-14 — RD-0051 — exportacao.ts usa BOM_CSV do comum (celulaCsv segue local, comentado); teste fixa a saída byte a byte, idêntica antes e depois.
2026-11-15 — fonte do sistema v1.0.13 — fonts.body→fonte.body; fontes 15→16 (app), 11→12 e 14→15 (web)
