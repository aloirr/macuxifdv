# 05 — Roadmap

O **gerente-projetos** abre as tarefas no quadro, distribui aos agentes e fecha cada sprint com `/entrega`. As "2 semanas por sprint" foram substituídas pelas datas-alvo abaixo.

## Prazo final: app completo em sex 06/11/2026 (decisão do Alexandre, R-20261101-214812)
| Data | Fecha |
|---|---|
| seg 02/11 | **Sprint 2 — Integração**: T-0032 (rotas e banco do Hub), monitor básico no BKO, carga por arquivo mínima; ciclo com ERP simulado (carga inicial + delta + reconciliação) |
| ter 03/11 | **Sprint 3 — Catálogo** (T-0047: busca de ponta a ponta, catálogo offline, ficha, BKO de conteúdo básico) e **Sprint 4 — Vendedor parte 1** (pré-venda, pedido offline → aprovação → envio ao ERP pelo Hub) |
| qua 04/11 | **Sprint 5 — Vendedor parte 2** (retorno/faturado visível no app, devolução) e **Sprint 6 — Gestor** (painéis, ranking, aprovações, pedido em nome) |
| qui 05/11 | **Sprint 7 — Promotor + Pesquisa** e **Sprint 8 — Treinamento** (banco, rotas e telas sobre os domínios prontos) |
| sex 06/11 | **Sprint 9 — Robustez ESSENCIAL** (checklist de segurança e LGPD, teste de carga básico, observabilidade mínima) + APKs finais (campo e gestão) + roteiro de demonstração completo |

**"Completo" em 06/11** (premissa do Alexandre): todos os módulos funcionam de ponta a ponta na demo, com testes verdes. O teste de carga com 20 mil SKUs, o onboarding de tenant e o resto da Sprint 9 que não couber vão para antes do piloto real (backlog).

**Escopo congelado até qua 04/11** (Alexandre, R-20261102-110803): pedido novo do Alexandre que não for bug entra no backlog, a não ser que ele diga explicitamente "entra no prazo". Bugs do teste de campo continuam com prioridade. Fila de corte do novo pedido (T-0061) aprovada: o que não estiver pronto até 04/11 18h vai para o backlog, com aviso a ele.

**Regras que não mudam**: CI verde, revisão do engenheiro sem 🔴 antes de fechar a sprint, main nunca vermelho. Se algo não couber no dia, o gerente avisa o Alexandre na hora com a proposta de corte. No fim de cada dia, o gerente manda um recado com o % de cada sprint e o que ficou para o dia seguinte.

### Plano de paralelismo
- **Nuvem** (crédito até 05/11 03:59): **uma sessão por módulo**, com `modules/<m>/**` (menos `db`) e `docs/modulos/<m>/**` travados. A sessão começa pelas telas (app/web), pelos contratos e pelo domain, e liga as rotas assim que a migração do módulo chegar ao `main`; ela faz pull do main para pegar a migração. Tarefas T-0051 a T-0058.
- **Local** (3 agentes): **banco-dados**, com as migrações em sequência e sempre no local, nesta ordem, porque é o que destrava a nuvem:
  1. 0013 Catálogo (cota de IA, conteúdo) e Vendedor (pré-venda, devolução);
  2. 0014 Gestor;
  3. 0015 Promotor;
  4. 0016 Pesquisa;
  5. 0017 Treinamento.

  Todas até 03/11, porque as sessões da nuvem do Promotor, da Pesquisa e do Treinamento precisam terminar antes do crédito vencer.
- **engenheiro-software**: plataforma, integrações (T-0032, T-0039) e revisões.
- **engenheiro-apps**: shells e abas.
- **testes**: e2e por sprint.
- **Ordem**: primeiro o que destrava os outros, ou seja, o schema de cada módulo, as rotas de plataforma e os contratos.
- **Builds EAS**: 2 por dia a partir de 03/11 (autorização do Alexandre).

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
