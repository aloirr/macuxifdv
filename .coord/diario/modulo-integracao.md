# Diário — modulo-integracao

2026-10-31 — T-0001 — Fase C: esqueleto modules/integracao (manifest, testes, pastas); verde
2026-10-31 — T-0009 — desenho do Hub, contracts Zod (8 entidades, lote, pedido/retorno, eventos) e domain RN-INT-01..09 (97 testes); manifesto +6 eventos; manifest.test.ts bloqueado só por platform-sdk/ambiente.ts ausente
2026-10-31 — T-0009 — revisão do dono: 🟢; trava de inativação em massa (RN-INT-06), perguntas do desenho decididas, eventos novos pedidos ao engenheiro
2026-10-31 — T-0009 — estado 'cancelado' vindo do ERP no retorno (RN-INT-08), contrato e desenho atualizados
2026-10-31 — T-0013 — Conector v1 (apps/conector): config Zod JSON/YAML, segredos (env/Credential Manager), delta com cursor leitura/confirmado, lotes+idempotência, fila node:sqlite, retry, retorno de pedidos, CLI, WinSW, logs mascarados; 118 testes (7 com Postgres); doc conector.md
2026-10-31 — T-0013 — revisão pós-merge (somente leitura): aprovada sem 🔴; intermitência = powershell sem timeout + afterAll PG; correções pela T-0023
2026-10-31 — T-0023 — Conector v1.1.0: linhas inválidas com motivo (500/lote), política de versão mínima/recomendada (resposta do sinal), chave por Conector + trocar-chave, itens_faturados e 2ª nota parcial (estados.ts), adaptador Oracle thin; conector 191 testes (+9 pulados), integracao 122.
2026-10-31 — T-0023 — teste de integração PostgreSQL ajustado à chave por Conector
2026-11-01 — T-0023 — achados da revisão da T-0013: máscara de número, bloqueio quando a página só repete o cursor, consulta numeroErp antes de regravar pedido, Retry-After em data HTTP, aviso de ERP sem TLS fora da LAN (sqlite/Node 22 mantido, documentado)
2026-11-01 — T-0013 — Conector: testes sem PowerShell real (dublê injetado via ES/prepararAmbiente), timeout de 10 s no powershell.exe, limpeza do banco de exemplo tolerante (aviso, não falha)
