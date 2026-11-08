# Diário — modulo-promotor

2026-10-31 — T-0001 — Fase C: esqueleto modules/promotor (manifesto, testes, pastas) pronto
2026-10-31 — T-0010 — domain do trade marketing (share, preço, ruptura, conformidade, validade, pontos extras, permanência/checkout, indicador do dia), contratos Zod das coletas, ações no manifesto e regras.md; 143 testes
2026-10-31 — T-0010 — revalida atingimento (RN-PRO-03) e permanência (RN-PRO-07) no contrato; 🟢 4 e 5; regras.md atualizado
2026-10-31 — T-0010 — ajuste das decisões do Alexandre: FotoColeta com sem_gps, indicador de fotos sem GPS e parciais, parâmetros peso_parcial_conformidade/validade via resolverParametros, regras.md sem premissas abertas
2026-10-31 — T-0010 (seguimento) — avaliarCheckout consome ContextoCheckout.clienteFechado (RN-CORE-14); regra própria de loja fechada removida do checklist; regras.md e testes atualizados
2026-11-01 — T-0040 — (registrado pelo gerente; sessão da nuvem) payloads Zod dos eventos promotor.*@1 no main pelo PR #30 (3090263)
2026-11-02 — T-0056 — repositório SQL do Promotor + pull dos cadastros + preço da Loja iniciados no local; interrompido por duplicação com a sessão da nuvem (R-20261102-190636); testes de banco não rodaram (Docker travado)
2026-11-02 — T-0056 — alterações locais de modules/promotor devolvidas ao HEAD (api/index.ts, tela-loja.tsx) e arquivos novos apagados, a pedido do gerente, para não conflitar com a sessão da nuvem
2026-11-05 — T-0072 — Promotor: 9 amarelos do #91 corrigidos em tela-loja.tsx
2026-11-05 — ajuste de UX — ícone camera nos botões Foto antes/depois da gôndola (tela-loja.tsx)
2026-11-05 — T-0024 — teste conferirEventosPublicados do Promotor (contracts/eventos-definicoes.test.ts); schemas já no padrão
2026-11-06 — T-0085 — consulta promotor.concorrentes@1 (contrato, provedor na API, manifest, testes) para o Catálogo ler as marcas; avisos enviados
2026-11-08 — T-0113 — Promotor lê marcas por catalogo.marcas@1 (produto do concorrente valida pela consulta, concorrente só leitura, entidade legada vazia, consulta promotor.concorrentes@1 deprecada, BKO com aviso); lint/tsc/vitest verdes
2026-11-08 — T-0113 — 🟡2 (PUT do produto do concorrente revalida a marca só quando muda) e 🟡4 (comentário da consulta deprecada alinhado ao desenho); testes de rota; lint/typecheck/test verdes
2026-11-08 — T-0094 — contraste do laranja (trade-page.tsx:122 accent-ink); sync-cadastros.db e 🟡2/4 da T-0113 conferidos; lint/typecheck/test verdes
2026-11-08 — T-0056/T-0010/T-0071/T-0085/T-0113 — recados antigos encerrados: preço da Loja sem defeito (teste novo 10,90 -> R$ 10,90), sync-cadastros.db.test isolado e corrigido p/ ADR 0034, link de marcas só com marca.gerenciar (teste), 🟡 3 registrado
2026-11-08 — T-0056/T-0010/T-0071/T-0085/T-0113 — recados antigos encerrados: preço da Loja sem defeito (teste 10,90 -> R$ 10,90), sync-cadastros.db.test isolado e corrigido p/ ADR 0034, link de marcas só com marca.gerenciar (teste), 🟡 3 registrado
2026-11-08 — CI lote 01 — typecheck de sync-cadastros.db.test.ts corrigido (Set<string> nos ids fotografados)
