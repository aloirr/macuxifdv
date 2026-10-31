# Relatório de testes — Sprint 0 · critério → teste → resultado

> Dono: agente `testes` (T-0006). Plano e detalhes de cada cenário: `tests/plano/sprint-0.md`.
> Legenda do resultado: `pendente` (ainda não rodou) · `✅` passou · `❌` falhou (ver Defeitos) · `bloqueado` (dependência; ver coluna) · `parcial` (provado só em parte; ver nota).
> Atualizar a cada rodada: data, commit, comando e saída resumida.

| Rodada | Data | Commit | Ambiente | Comando |
|---|---|---|---|---|
| 0 | 2026-10-30 | — | plano (sem código) | — |

## Critério → teste → resultado

| Tarefa | Critério | Cenários | Tipo | Resultado | Bloqueado por / nota |
|---|---|---|---|---|---|
| T-0001 | C1.1 Os 277 testes da Fase M passam nos novos locais | S0-001, S0-002, S0-003, S0-004, S0-005 | estático, integ | pendente | T-0001 Fases A+B |
| T-0001 | C1.2 Fase M não alterada e demo funcionando | S0-006, S0-007, S0-008, S0-009 | estático, e2e | pendente | linha de base gerada em 2026-10-30 |
| T-0001 | C1.3 dependency-cruiser falha em import interno entre módulos | S0-010, S0-011, S0-012, S0-013, S0-014 | estático | pendente | T-0001 Fase A |
| T-0002 | C2.1 Migração sobe e desce sem erro | S0-020, S0-021, S0-022, S0-023 | integ | pendente | T-0002; Postgres de teste (R1) |
| T-0002 | C2.2 Tenant A não lê dados do tenant B em nenhuma tabela | S0-024, S0-025, S0-026, S0-027, S0-028, S0-029, S0-030, S0-111 | integ, carga | pendente | T-0002 (+T-0003 para S0-029/030/111) |
| T-0002 | C2.3 Seed carrega os usuários fake da Fase M | S0-031, S0-032, S0-033, S0-034 | integ | pendente | T-0002 |
| T-0003 | C3.1 Ativar/desativar módulo de teste reflete no app no próximo sync | S0-040 a S0-051 | unit, integ, sync, e2e, comp | pendente | T-0003 + T-0004 + motor de sync |
| T-0003 | C3.2 Rota de módulo inativo → 403 `MODULO_INATIVO` | S0-052, S0-053, S0-054, S0-055, S0-056 | integ | pendente | T-0003 |
| T-0003 | C3.3 Promotor não vê nenhuma ação de pedido | S0-060 a S0-066 | unit, comp, integ, sync, e2e | pendente | T-0003 + T-0004; API definitiva na Sprint 4 (R7) |
| T-0003 | (base) Auth, logs sem PII, escopo de carteira | S0-070 a S0-074, S0-110 | integ, carga | pendente | T-0003 |
| T-0004 | C4.1 Dois builds Android do mesmo código | S0-080, S0-081 (manual M-02), S0-082 | unit, manual, comp | pendente | T-0004; Android SDK/EAS (R2) |
| T-0004 | C4.2 Extensão de exemplo só com módulo ativo | S0-083 a S0-087 | comp, e2e, integ | pendente | T-0004 |
| T-0005 | C5.1 PR fora do dono é sinalizado | S0-090, S0-091, S0-092, S0-093 | integ | pendente | T-0005; modo `--base` do verificar (R4) |
| T-0005 | C5.2 Pipeline verde no branch principal | S0-094, S0-095, S0-096 (manual M-04) | estático, integ, manual | pendente | T-0005; nome do branch (R5) |
| transversal | Offline básico | S0-100 a S0-105 (manual M-03) | comp, sync, manual | pendente | T-0001 Fase A + T-0003 + T-0004 |

## Detalhe por cenário (preencher na execução)

| ID | Arquivo de teste | Resultado | Evidência (saída/print/link) |
|---|---|---|---|
| S0-001 | tests/fundacao/fase-m/referencia.json | pendente | |
| S0-002 | tests/fundacao/fase-m-contagem.test.ts | pendente | |
| … | … | … | |

## Defeitos

| # | Cenário | Passos para reproduzir | Esperado × obtido | Arquivo provável | Dono | Recado |
|---|---|---|---|---|---|---|
| — | — | — | — | — | — | — |

## Testes manuais

| Roteiro | Executado por | Data | Resultado | Evidência |
|---|---|---|---|---|
| M-01 (opcional) | | | pendente | |
| M-02 | | | pendente | |
| M-03 | | | pendente | |
| M-04 | | | pendente | |
