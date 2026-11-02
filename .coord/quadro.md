# Quadro — Sprint 0 (Fundação modular)

> Dono: gerente-projetos. Status: aberta → em_andamento → em_teste → em_revisao → concluida (ou bloqueada).

| Tarefa | Título | Responsável | Onde | Status |
|---|---|---|---|---|
| [T-0001](tarefas/T-0001.md) | Reestruturar o monorepo em modules/ + platform-sdk | engenheiro-software | local | concluida (277/277 da Fase M · Fase M intacta · fronteiras ✅ · revisão sem 🔴) |
| [T-0002](tarefas/T-0002.md) | Banco: schemas plataforma e core, RLS e migrações | banco-dados | local | concluida (94 testes de banco no Docker · vazamento verde · revisão sem 🔴 · 🟡 corrigidos) |
| [T-0003](tarefas/T-0003.md) | Auth, perfis e licenças de módulos | modulo-core | local | concluida (3 critérios ✅ no Postgres real · 245 testes no core, 51 na API) |
| [T-0004](tarefas/T-0004.md) | Shells mobile (campo/gestao), web e api montando módulos pelo manifesto | engenheiro-software | local | concluida (APKs de desenvolvimento campo e gestao gerados no EAS · previews na sequência) |
| [T-0005](tarefas/T-0005.md) | CI e verificação de donos | engenheiro-software | local | concluida (verificar --base e casos A–B · CI do main verde · run 41207939579 foi cancelamento por concorrência) |
| [T-0006](tarefas/T-0006.md) | Plano de testes da fundação | testes | local | concluida (relatório final da Sprint 0 · 230 casos em tests/ com banco real) |

## Travado pela nuvem
| Caminho | Tarefa | Branch | Desde |
|---|---|---|---|
| `modules/integracao/web/**`, `docs/modulos/integracao/monitor-bko.md` | T-0051 | nuvem/T-0051-monitor-bko (entregue na branch, PR pendente) | 2026-11-02 |

Nenhum agente local altera caminho listado aqui. Destravar quando o merge chegar no pull do `main`.
Destravados em 2026-11-02: T-0050 (`.claude/hooks/**`, `.claude/settings.json`, `scripts/coord*.mjs`; 7d87a32). Destravados em 2026-11-01: T-0046 (`modules/gestor/**`, PR #33); T-0048 (`apps/conector/**`, `conector.md`; 12e45b3) e T-0049 (`.github/**`, `scripts/ci/**`; 78cce46); T-0044 (`.claude/hooks/**`, `.claude/settings.json`, `scripts/coord*.mjs`; f86f59b) e T-0043 (`packages/config/**`, `packages/comum/**`, `eslint.config.*`; dd9ff94); T-0033 (`.github/**`, `turbo.json`, `package.json` da raiz, `scripts/**`; fa6d5fa) e T-0040 (`modules/promotor/contracts|domain/**`, 3090263); T-0036 (`modules/treinamento/**`, 789a191) e T-0037 (`modules/core/domain|contracts/**`, 4c08b91). Destravados em 2026-10-31 (merges no main): `scripts/coord*.mjs` e `.claude/**` (T-0005, 23b4192); T-0011, T-0008 parte 1 e T-0005 casos A–B (dcc044d, 0d1c8a1, 3215b2f); T-0007, T-0012 e `.claude/hooks/**` (6fba044, f4fdbe5, d277a55); T-0011 v2 (9f06e77); guardião v2 (c2f0005) e v3 (5d7e317); T-0013 (`apps/conector/**`, 588da33 — travado de novo pela T-0023); `.claude/settings.json` (PostToolUse religado). T-0021 ajustes (`modules/catalogo/...`, 7b3bb50). Push liberado (main, nuvem/*, alexandre/*, agente/*; sem force/delete).
Regras: `docs/produto/07-agentes-e-coordenacao.md`, seção "Frentes de trabalho: local e nuvem".

## ✅ Main verde desde 2026-11-01 (CI 41286326232, todas as suítes rodando)
Causas corrigidas: teste de db dependente da hora (banco-dados); S1-043c era tempo do teste, não duplicação (testes, core); CI com --continue (engenheiro); commit de rodada por dono (doc 07).

## Meta: fechar a Sprint 0 até sexta, 06/11 (Alexandre, R-20261031-103502)
1. **T-0004** (shells com os 8 módulos, `createApp`, EAS, pendências da T-0002 §6) → **T-0003 Fase 2** (T-0007 já mergeada) → **execução da T-0006** e relatório da Sprint 0.
2. Ajustes pendentes: só os do backlog.
3. Concluídas: T-0001, T-0002, T-0003, T-0005, T-0006, T-0007, T-0009, T-0010, T-0011, T-0012. **Sprint 0 fechada em 2026-11-01** (APKs de desenvolvimento gerados). T-0004 em teste.

## Sprint 1 — Core (planejada em 2026-10-31; meta do roadmap: modo avião — abrir cliente, rota e fazer check-in; sincroniza depois)
Ordem (ondas do desenho, docs/desenho/T-0016.md §9): onda 1 banco lote A + core contratos/domínio + engenheiro E1–E3 (após T-0015) → onda 2 T-0017 + vendedor pull + E4 → onda 3 T-0018 + T-0008 P3/P5 → onda 4 T-0019 + T-0022 (+ T-0020 fase 1) → onda 5 testes e revisão.

| Tarefa | Título | Responsável | Onde | Status |
|---|---|---|---|---|
| [T-0028](tarefas/T-0028.md) | Matriz de testes ponta a ponta da demo | testes | local | concluida (tests/plano/demo-matriz.md) |
| [T-0030](tarefas/T-0030.md) | BKO: páginas da Fase M na API nova (Rotas, Clientes, Metas, RV, Auditoria) | modulo-core | local | concluida (Rotas migrada · 3 páginas "em construção" · Auditoria e F5 · Playwright na raiz) |
| [T-0029](tarefas/T-0029.md) | Fatia vertical do pedido para a demo (com PDF) | engenheiro-software | local | concluida (8cf1021 · CI verde · APKs preview campo 6490e5e6 e gestão c0bf3d91) |
| [T-0026](tarefas/T-0026.md) | Demonstração com o gestor externo (prioridade) | engenheiro-software | local | concluida (APKs de preview + scripts + túnel · docs/status/demo.md) |
| [T-0015](tarefas/T-0015.md) | Ajustes pós-Sprint 0: O-3 (promotor lê pedidos da carteira) e D-1 | engenheiro-software | local | concluida (O-3 e D-1 provados com Postgres) |
| [T-0016](tarefas/T-0016.md) | Desenho técnico e contratos da Sprint 1 | engenheiro-software | local | concluida (aprovado; ADRs 0009/0010) |
| [T-0017](tarefas/T-0017.md) | Carteira e Cliente 360 | modulo-core | local | concluida (critérios ✅ · revisão final sem 🔴) |
| [T-0018](tarefas/T-0018.md) | Rotas e visitas reais, sync de visita e pedido (D-2) | modulo-core | local | concluida (🔴 da revisão corrigido · D-2..D-5 fechados · meta da sprint demonstrada) |
| [T-0019](tarefas/T-0019.md) | Central de notificações | modulo-core | local | concluida (revisão sem 🔴 · push real depende do EAS) |
| [T-0020](tarefas/T-0020.md) | Metas e indicadores básicos — só fase 1 | modulo-core | local | concluida (fase 1 · revisão sem 🔴 · realizado de venda nas Sprints 4–5) |
| [T-0022](tarefas/T-0022.md) | Despachante da outbox (onda 4) | engenheiro-software | local | concluida (revisão sem 🔴) |
| [T-0008](tarefas/T-0008.md) | Adaptador SQLite no aparelho — parte 2 | engenheiro-software | local | bloqueada (parte 2 aprovada · P4/P7 dependem do build EAS) |

## Adiantadas (domínio sem banco/telas) e backlog de outras sprints
| Tarefa | Título | Responsável | Onde | Status |
|---|---|---|---|---|
| [T-0007](tarefas/T-0007.md) | Produto no dono definitivo (ADR-0005) | engenheiro-software | nuvem → local (merge 6fba044) | concluida (🔴 da fixture corrigido · 🟡 aplicados · API 37/37 com banco) |
| [T-0011](tarefas/T-0011.md) | Treinamento — domínio (trilhas, XP, níveis, medalhas, ranking) | modulo-treinamento | nuvem → local (merge 9f06e77) | concluida (230 testes · revisão sem 🔴 · RN-TRE-01..08 aplicadas) |
| [T-0012](tarefas/T-0012.md) | Pesquisa — domínio | modulo-pesquisa | nuvem → local (merge f4fdbe5) | concluida (215 testes · revisão sem 🔴 · decisões do Alexandre aplicadas · cliente fechado via RN-CORE-14) |
| [T-0013](tarefas/T-0013.md) | Conector v1 (lado do cliente) — Sprint 2 | modulo-integracao | nuvem → local (merges a7cd2fe, 588da33) | concluida (revisões do dono e do engenheiro sem 🔴 · correções na T-0023) |
| [T-0014](tarefas/T-0014.md) | Gestor — domínio — Sprint 6 | modulo-gestor | nuvem → local (merges b379fe6, f29ad65) | em_revisao (revisada na T-0045: 3🔴 nos espelhos de eventos → Gestor na nuvem, core.cliente.atualizado@1 com o core) |
| [T-0021](tarefas/T-0021.md) | Catálogo — domínio — Sprint 3 | modulo-catalogo | nuvem → local (merges 706a31e, 7b3bb50) | concluida (236 testes · revisões do dono e do engenheiro sem 🔴) |
| [T-0023](tarefas/T-0023.md) | Conector: ajustes v1.1 e adaptador Oracle — Sprint 2 | modulo-integracao | nuvem → local (merges bb308bf, e5cb1b9) | em_revisao (revisada na T-0045: 1🔴 nota faturada 2x → Conector na nuvem, lado do Hub na T-0032) |
| [T-0024](tarefas/T-0024.md) | Payload dos eventos no contracts de cada módulo — Sprint 2 | engenheiro-software | local | aberta |
| [T-0025](tarefas/T-0025.md) | Hub /integracao/v1 — desenho, contratos e domínio — Sprint 2 | modulo-integracao | nuvem → local (merge c77278f) | em_revisao (revisada na T-0045: 1🔴 hash → SHA-256 na T-0032) |
| [T-0027](tarefas/T-0027.md) | Conector ↔ Hub: alinhamento — Sprint 2 | modulo-integracao | nuvem (PR #24, fa837c4) | concluida (falta só a revisão do PR #24 pelo engenheiro, na T-0032) |
| [T-0033](tarefas/T-0033.md) | CI e testes mais rápidos (paralelo, cache Turborepo, banco modelo) — Sprint 2 | engenheiro-software | nuvem (PR #26, fa6d5fa) | concluida |
| [T-0032](tarefas/T-0032.md) | Hub /integracao/v1 — rotas e banco — Sprint 2 | engenheiro-software, banco-dados | local | em_andamento |
| [T-0031](tarefas/T-0031.md) | Hub P-3/P-4 e mensagem do Conector conflitante (P-6) — Sprint 2 | modulo-integracao | nuvem (PR #25, 697ab42) | concluida (rotas na T-0032) |
| [T-0034](tarefas/T-0034.md) | engenheiro-apps: next-env definitivo, abas ⛔ dos shells, revisão das telas da T-0029 — Sprint 2 | engenheiro-apps | local | em_revisao (entregue; revisão do engenheiro-software em andamento) |
| [T-0035](tarefas/T-0035.md) | Vendedor: 🟡 da T-0029 (fronteira do fuso, /alcadas sem promotor) — Sprint 2 | modulo-vendedor | local | em_revisao (3 itens entregues; testes e revisão em andamento) |
| [T-0036](tarefas/T-0036.md) | Treinamento: 🟡 e 🟢 da revisão final — Sprint 2 | modulo-treinamento | nuvem (PR #28, 789a191) | concluida |
| [T-0037](tarefas/T-0037.md) | Core: RN-CORE-12 como função pura no domain — Sprint 2 | modulo-core | nuvem (PR #27, 4c08b91) | concluida |
| [T-0038](tarefas/T-0038.md) | Domínio fixo da demo (api-demo/bko-demo.macuxifdv.com.br) — Sprint 2 | engenheiro-software, engenheiro-apps | local (depois do main verde) | aberta |
| [T-0039](tarefas/T-0039.md) | Checkout validado na API (RN-CORE-12) — Sprint 2 | engenheiro-software, modulo-core | local (destravada; depois da T-0038) | aberta |
| [T-0040](tarefas/T-0040.md) | Promotor: payloads Zod dos eventos promotor.*@1 — Sprint 2 | modulo-promotor | nuvem (PR #30, 3090263) | concluida |
| [T-0041](tarefas/T-0041.md) | Catálogo: timeout real do provedor de IA — Sprint 2 | modulo-catalogo | nuvem (PR #29, b8cae16) | concluida |
| [T-0042](tarefas/T-0042.md) | "Hoje" no fuso do tenant (C6, produção) e testes com hora fixa — Sprint 2 | modulo-core, banco-dados, modulo-vendedor | local | em_revisao (core, banco e vendedor entregaram; falta varredura e revisão) |
| [T-0043](tarefas/T-0043.md) | Prevenção de hora fixa: relógio de teste e lint (sem o job do CI) — Sprint 2 | engenheiro-software | nuvem (PR #34, dd9ff94) | concluida (lint vira erro em 16/11) |
| [T-0044](tarefas/T-0044.md) | Guardião v5: gh pr merge só com trava — Sprint 2 | alexandre | nuvem (PR #31, f86f59b) | concluida |
| [T-0045](tarefas/T-0045.md) | Revisões pendentes do engenheiro (T-0014, T-0023, T-0025) — Sprint 2 | engenheiro-software | nuvem (PR #32, 2903882) | concluida (🔴 encaminhados) |
| [T-0046](tarefas/T-0046.md) | Gestor: espelhos de eventos + 🔴/🟡 da revisão da T-0014 — Sprint 2 | modulo-gestor | nuvem (PR #33) | concluida |
| [T-0047](tarefas/T-0047.md) | Busca do Catálogo de ponta a ponta (próximo APK de demo) — Sprint 2 | modulo-catalogo (+ eng-software, banco, eng-apps, testes) | local (depois da T-0038) | aberta |
| [T-0048](tarefas/T-0048.md) | Conector 1.2.1: nota faturada sem itens repetidos (🔴 da T-0023) — Sprint 2 | modulo-integracao | nuvem (PR #36, 12e45b3) | concluida |
| [T-0049](tarefas/T-0049.md) | Brechas do guardião v5 no CI — Sprint 2 | engenheiro-software | nuvem (78cce46) | concluida |
| [T-0050](tarefas/T-0050.md) | Guardião v6 — Sprint 2 | alexandre | nuvem (PR #37, governança) | concluida |
| [T-0051](tarefas/T-0051.md) | Integração: monitor básico no BKO — Sprint 2 | modulo-integracao | nuvem (nuvem/T-0051-monitor-bko) | em_andamento (entregue na branch 96a025f; PR pendente) |
| [T-0052](tarefas/T-0052.md) | Catálogo de ponta a ponta: rota de busca, ficha, telas do app e BKO de conteúdo — Sprint 3 | modulo-catalogo | nuvem (reservada; o Alexandre abre) | aberta |
| [T-0053](tarefas/T-0053.md) | Vendedor parte 1: pré-venda e envio ao ERP pelo Hub — Sprint 4 | modulo-vendedor | nuvem (reservada; o Alexandre abre) | aberta |
| [T-0054](tarefas/T-0054.md) | Vendedor parte 2: retorno do ERP, faturado no app e devolução — Sprint 5 | modulo-vendedor | nuvem (reservada; o Alexandre abre) | aberta |
| [T-0055](tarefas/T-0055.md) | Gestor: rotas e telas (painéis, ranking, aprovações, pedido em nome) — Sprint 6 | modulo-gestor | nuvem (reservada; o Alexandre abre) | aberta |
| [T-0056](tarefas/T-0056.md) | Promotor: rotas das coletas e telas da Loja — Sprint 7 | modulo-promotor | nuvem (reservada; o Alexandre abre) | aberta |
| [T-0057](tarefas/T-0057.md) | Pesquisa: construtor no BKO, resposta no app e resultados — Sprint 7 | modulo-pesquisa | nuvem (reservada; o Alexandre abre) | aberta |
| [T-0058](tarefas/T-0058.md) | Treinamento: rotas, jornada no app e BKO — Sprint 8 | modulo-treinamento | nuvem (reservada; o Alexandre abre) | aberta |
| [T-0059](tarefas/T-0059.md) | Teste de campo 02/11: sincronização e detalhe do pedido no BKO — Sprint 4 | engenheiro-apps | local | aberta (prioridade: carga presa em 100%) |
| [T-0009](tarefas/T-0009.md) | Integração: domínio e contratos do Hub | modulo-integracao | nuvem → local (merge e20f6ac) | concluida (cancelado do ERP ✅ · revisão sem 🔴 · OrderStatus depois do merge da T-0007) |
| [T-0010](tarefas/T-0010.md) | Promotor: domínio de trade marketing (sem banco, sem telas) | modulo-promotor | local (1ª entrega veio da nuvem, merge 3352d2e) | concluida (155 testes · revisão sem 🔴 · decisões do Alexandre aplicadas) |

## Próximas sprints
Ver `docs/produto/05-roadmap.md`.
