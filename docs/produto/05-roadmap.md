# 05 — Roadmap

Sprints de 2 semanas (premissa). O **gerente-projetos** abre as tarefas no quadro, distribui aos agentes e fecha cada sprint com `/entrega`.

| Etapa | Entrega | Agentes principais | Pronto quando |
|---|---|---|---|
| **Fase M** ✅ | Mockup com Excel (web + app), rotas, pedido, PDF | — | Falta: demonstração com gestor externo |
| **Sprint 0 — Fundação modular** | Monorepo em `modules/` + `platform-sdk`; shells mobile (2 variantes), web e api; auth e perfis; licenças de módulos; Postgres + RLS; CI com regras de fronteira; `.coord/` e agentes funcionando | engenheiro, banco, gerente | Login real; ativar/desativar um módulo de teste aparece/some no app; teste de vazamento entre tenants passa |
| **Sprint 1 — Core** | Carteira, Cliente 360, financeiro, rotas/visitas reais, motor de sync, metas básicas, notificações | core, banco, testes | Modo avião: abrir cliente, rota e fazer check-in; sincroniza depois |
| **Sprint 2 — Integração** | Hub `/integracao/v1`, Conector v1 (SQL Server + PostgreSQL), carga por arquivo, monitor | integracao, banco | Ciclo com ERP simulado: carga inicial + delta + reconciliação |
| **Sprint 3 — Catálogo** | Catálogo offline, ficha rica, busca em linguagem natural online, BKO de conteúdo | catalogo, banco | Busca "frase" com relevância aprovada em 20 consultas de teste |
| **Sprints 4–5 — Vendedor** | Pedido/pré-venda ponta a ponta, aprovações, PDF, devolução ao ERP | vendedor, integracao | Pedido offline → aprovação → ERP → faturado visível no app |
| **Sprint 6 — Gestor** | App Gestão, painéis, ranking, aprovações, pedido em nome | gestor, vendedor | Supervisor aprova e faz pedido em nome pelo celular |
| **— Lançamento do pacote Essencial (≈ 14 semanas) —** | | | Piloto com uma equipe real |
| **Sprint 7 — Promotor + Pesquisa** | Trade marketing (checklist da loja, gôndola antes/depois, share, preço, ruptura, validade), cadastros e relatórios de trade; construtor de pesquisas e resultados | promotor, pesquisa | Promotor faz a visita completa offline; gestor vê share × meta e ruptura por loja; pesquisa anexada à visita |
| **Sprint 8 — Treinamento** | Trilhas, quiz, XP, medalhas, ranking, painel de adesão | treinamento | Vendedor conclui trilha offline e sobe no ranking |
| **Sprint 9 — Robustez** | Segurança, LGPD, desempenho (20 mil SKUs), observabilidade, onboarding de tenant | testes, engenheiro, banco | Teste de carga e checklist de segurança aprovados |

## Migração da Fase M
A Fase M continua em `C:\Users\domon\dev\forca-vendas` (somente leitura, para demonstração). O novo repositório `C:\macuxifdv` reaproveita por cópia, na T-0001, as telas e regras já testadas (277 testes): `packages/domain` é dividido entre `modules/core/domain` e `modules/vendedor/domain`; o módulo Rotas da web vai para `modules/core/web`. A pasta antiga não é alterada.

## Fluxo de uma funcionalidade
`gerente-projetos` abre a tarefa → `engenheiro-software` valida o desenho e os contratos → `banco-dados` cria schema/migração → agente(s) do módulo implementam → `testes` validam → `engenheiro-software` revisa → `gerente-projetos` fecha e informa o Alexandre.
