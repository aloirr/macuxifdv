# 05 — Roadmap

O **gerente-projetos** abre as tarefas no quadro, distribui aos agentes e fecha cada sprint com `/entrega`. As "2 semanas por sprint" foram substituídas pelas datas-alvo abaixo.

## Cronograma até a v1.0.5 oficial e a produção (decisão do Alexandre, R-20261109-125750; ajustado pelo gerente em 09/11 à noite)
Regras: um build por dia, todos com o CI verde; correção do reteste do Alexandre tem vaga fixa; o que não couber no dia vira recado ao Alexandre com proposta de corte no mesmo dia; **recado diário às 18h** com o percentual de cada dia e o risco para sexta e sábado. Telegram (aviso, resumo e resposta) está no **backlog sem data** (autorizado no mesmo recado). A busca de 20 mil (T-0119) não bloqueia, desde que o app não trave.

| Dia | Entrega | O que o gerente precisa do Alexandre |
|---|---|---|
| **Seg 09/11** | Lote 03 (T-0140) + T-0141 + T-0142 + **T-0117 e T-0098 adiantadas** no main (7c9dafe8, c127335f); T-0143 recados direto no GitHub → **build v1.0.2** (espera a demo publicar: GHCR recusou com 403) | Liberar o espaço/acesso de pacotes do GitHub (GHCR) para a demo publicar |
| **Ter 10/11** | Reteste da v1.0.2 feito às 06h (11 recados; tudo na esteira já, R-20261110-062242). Entram:<br>• queda na 1ª abertura (T-0144, bloqueia a v1.0.5);<br>• regras do pedido: sem reprecificar, alçada só na pergunta ao salvar, desconto acima do máximo bloqueia o envio, defeitos de UN e de % (T-0151);<br>• ficha sem repetição (T-0146);<br>• auditoria de repetição e texto (T-0152);<br>• demo com faturados (T-0155);<br>• novas tentativas no 403 do GHCR (T-0154);<br>• aviso F.4, data do preço no PDF do BKO e RD do lote 03.<br>Imagens para aprovação: Resumo e detalhe em tabela (T-0150), aba Itens com popup (T-0148), permissões (T-0145) e fotos do PDV (T-0147). Desenho da filial (T-0149) e das fotos do PDV (T-0147).<br>→ **v1.0.3** | Aprovar as imagens no mesmo dia |
| **Qua 11/11** | Entram:<br>• Resumo e detalhe em tabela (T-0150) e aba Itens com popup (T-0148);<br>• permissões obrigatórias (T-0145);<br>• **fotos do PDV (T-0147) e filial (T-0149)**, com banco, Hub, Catálogo, Vendedor e BKO;<br>• robustez: T-0078 (segurança e LGPD), T-0107 (carga de 20 mil e onboarding), T-0119 ("lento, nunca travado", no aparelho) e conferência de T-0095/T-0118.<br>→ **v1.0.4** | Criar até **qua 18h** os recursos da produção para o ensaio: VM/banco na Magalu, Brevo (e-mail), domínio/DNS e os secrets do ambiente de produção no GitHub |
| **Qui 12/11** | **Congelamento: só correção** (a filial e as fotos do PDV terminam aqui só se tiverem ficado de fora da v1.0.4; decisão pedida ao Alexandre). Ensaio da produção nos recursos criados: publicar, com as novas tentativas no GHCR; criar tenant; carga inicial; restaurar o backup | Reteste da v1.0.4 |
| **Sex 13/11** | **v1.0.5 oficial** (Campo-Oficial / Gestao-Oficial, perfil de produção) e início da migração para a produção | Ok da v1.0.5 |
| **Sáb 14/11** | **Produção finalizada:** deploy, tenant, carga inicial, conferência de ponta a ponta e APKs oficiais distribuídos | Dados do tenant real (empresa, usuários iniciais) e acesso ao ERP/Conector do cliente |

**Riscos para sexta e sábado** (10/11):
1. A queda na 1ª abertura (T-0144) bloqueia a v1.0.5 até ter a causa.
2. A filial (T-0149) toca 6 donos e o contrato do ERP. É a maior frente da semana.
3. As fotos do PDV (T-0147) dependem de banco, API, BKO e app.
4. As imagens novas precisam de aprovação no mesmo dia.
5. O 403 do GHCR na publicação (T-0154) foi registrado como risco da produção de sábado e é conferido no ensaio de quinta.

T-0112 (multiperfil), T-0091 (super-admin) e a revisão das telas fora do fluxo de venda (T-0153) seguem na esteira depois do fluxo de venda.

**Ajustes do dono do produto em 10/11:**
- **Correções do corretor:** **todas** entram na v1.0.3 (R-20261110-101344), corrigidas na tela atual sem esperar as imagens novas.
- **Diagnóstico na nuvem (T-0158, R-20261110-101345):**
  - v1.0.4: botão "Enviar diagnóstico" e BKO › Diagnósticos;
  - v1.0.5: envio automático da queda e recado automático.
- **Área "Alertas" e situação só no Histórico (RN-VEN-42):** entram na T-0150 e na T-0148.

## Prazo final (histórico): app completo em sex 06/11/2026 (decisão do Alexandre, R-20261101-214812)
| Data | Fecha |
|---|---|
| seg 02/11 | **Sprint 2 — Integração**: T-0032 (rotas e banco do Hub), monitor básico no BKO, carga por arquivo mínima; ciclo com ERP simulado (carga inicial + delta + reconciliação) |
| ter 03/11 | **Sprint 3 — Catálogo** (T-0047: busca de ponta a ponta, catálogo offline, ficha, BKO de conteúdo básico) e **Sprint 4 — Vendedor parte 1** (pré-venda, pedido offline → aprovação → envio ao ERP pelo Hub) |
| qua 04/11 | **Sprint 5 — Vendedor parte 2** (retorno/faturado visível no app, devolução) e **Sprint 6 — Gestor** (painéis, ranking, aprovações, pedido em nome) |
| qui 05/11 | **Sprint 7 — Promotor + Pesquisa** e **Sprint 8 — Treinamento** (banco, rotas e telas sobre os domínios prontos) |
| sex 06/11 | **Sprint 9 — Robustez ESSENCIAL** (checklist de segurança e LGPD, teste de carga básico, observabilidade mínima) + APKs finais (campo e gestão) + roteiro de demonstração completo |

**"Completo" em 06/11** (premissa do Alexandre): todos os módulos funcionam de ponta a ponta na demo, com testes verdes. O teste de carga com 20 mil SKUs, o onboarding de tenant e o resto da Sprint 9 que não couber vão para antes do piloto real (backlog).

**Fila de corte do novo pedido (T-0061)** aprovada pelo Alexandre (R-20261102-110803): o que não estiver pronto até 04/11 18h vai para o backlog, com aviso a ele. Não há congelamento de escopo (corrigido em R-20261102-115114). **Correções do teste de campo têm vaga fixa** (doc 07, "Vaga de correção").

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
`gerente-projetos` abre a tarefa → `engenheiro-software` valida o desenho e os contratos → `banco-dados` cria schema/migração → agente(s) do módulo implementam → `testes` validam e `corretor-redundancias` dá o parecer (qualquer achado em aberto segura, R-20261110-062506) → `engenheiro-software` revisa → `gerente-projetos` fecha e informa o Alexandre.
