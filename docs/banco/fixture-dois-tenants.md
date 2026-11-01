# Fixture "dois-tenants" e seed da Fase M

Código: `db/seeds/fixtures/dois-tenants.ts` e `db/seeds/fase-m/fase-m.ts`. Ambos são **idempotentes**
(upsert por id fixo; `senha_hash` existente é preservado) e carregados com a conexão **admin**, numa transação.

## Fixture dois-tenants (testes de RLS, licenças e perfis — pedido R-20261030-235502-testes)
UUID: `<prefixo>-<grupo>-4000-8000-<seq>`; prefixo `aaaaaaaa` (A) / `bbbbbbbb` (B). Grupos:
`0000` tenant · `0001` usuario · `0002` equipe · `0003` produto · `0004` cliente · `0005` carteira · `0006` dispositivo · `0007` sessao (famílias: seq 101+) ·
`0010` tenant_modulo · `0011` perfil_modulo · `0012` usuario_modulo · `0013` evento · `0014` parametro · `0015` auditoria ·
`0016` evento_consumo. Linhas novas entram **no fim** das listas (ids sequenciais estáveis; upsert por id + índices únicos).
Constantes em `DOIS_TENANTS` (`@macuxi/db/teste`).

| | Tenant A — Distribuidora Alfa | Tenant B — Comercial Beta |
|---|---|---|
| id / código / fuso | `aaaaaaaa-0000-4000-8000-000000000001` / `alfa` / America/Manaus | `bbbbbbbb-0000-4000-8000-000000000001` / `beta` / America/Sao_Paulo |
| tenant_modulo (ativos) | core, vendedor, promotor, teste, teste-dependente, catalogo | core, vendedor, catalogo |
| usuários (seq) | 1 admin, 2 analista, 3 assistente, 4 gerente, 5 supervisor, 6 vendedor-1, 7 vendedor-2, 8 promotor | 1 admin-B, 2 vendedor-B |
| equipes | 1 Regional Alfa (resp. gerente) → 2 Equipe 1 (resp. supervisor), 3 Equipe 2 (sem resp.) | 1 Equipe Beta (resp. admin-B) |
| equipe do usuário | gerente→Regional; supervisor, vendedor-1, promotor→Equipe 1; vendedor-2→Equipe 2 | vendedor-B→Equipe Beta |
| perfil_modulo | vendedor: core, catalogo, vendedor, teste · promotor: core, promotor, teste · supervisor e gerente: core, catalogo, vendedor, promotor · admin: core · analista: core, catalogo, vendedor, promotor · assistente: core, catalogo, vendedor | vendedor: core, catalogo, vendedor · admin: core, catalogo, vendedor |
| usuario_modulo | vendedor-2 **remove** `teste` | admin-B remove `vendedor` (só para B ter linha) |
| clientes / carteira | c1 (vendedor-1 + promotor), c2 (vendedor-2), c3 (vendedor-1) | c1 (vendedor-B) |
| produto | ALFA-001, ALFA-002 | BETA-001 |
| evento / evento_consumo / parametro / auditoria | 1 / 1 / 2 / 1 | 1 / 1 / 1 / 1 |
| dispositivo (0004) | 1 vendedor-1 (liberado), 2 promotor (**bloqueado** remotamente) | 1 vendedor-B |
| sessao (0004) | 1 vendedor-1, aparelho 1, família `…-0007-…-000000000101`, expira 2099 | 1 vendedor-B, aparelho 1, expira 2099 |

- **Vendedor depende do Catálogo** (ADR 0005, T-0007; RN-CORE-03): todo perfil com `vendedor` tem `catalogo`, senão o
  Vendedor some dos módulos efetivos (o teste estático confere).
- **Toda tabela com `tenant_id` tem pelo menos 1 linha em cada tenant** (o teste estático e o de vazamento conferem).
- **E-mail repetido de propósito** (S0-072): vendedor-1 (A) e vendedor-B (B) = `vendedor@exemplo.com.br`.
- Senha de todos: `MACUXI_SENHA_TESTE` (padrão `Teste@1234`, só teste), hash argon2id PHC. Login: código `alfa`/`beta` + e-mail + senha.
- Refresh da fixture: `DOIS_TENANTS.A.refresh.token` / `DOIS_TENANTS.B.refresh.token` (`<tenant_id>.<segredo>`; o banco guarda `refresh.hash`).
- Recarregar a fixture **zera** o estado de login: `tentativas_falhas = 0`, `bloqueio_ate` nulo, sessões não usadas/revogadas, aparelhos como acima (teste `db/testes/sessao.test.ts`).
- admin/analista/assistente em `perfil_modulo` e a exceção de B são complemento do banco (o plano não fixava).

### Sprint 1 (migrações 0005–0007; desenho T-0016 §7)
Grupos novos: `0020` cliente_contato · `0021` cliente_financeiro · `0022` titulo · `0023` historico_compra · `0024` motivo ·
`0025` rota · `0026` rota_parada · `0027` visita (checkout_id: seq 101+) · `0028` visita_etapa · `0029` notificacao (envio_id: seq 109) ·
`002a` meta · `002b` indicador_diario · `002c` arquivo · `0030` pedido · `0031` pedido_item. Constantes em `DOIS_TENANTS.X.{motivos,
rotas, paradas, visitas, checkouts, arquivos, pedidos}`.

**Datas relativas a "hoje"** no fuso de cada tenant (A Manaus, B São Paulo). Para teste determinístico:
`carregarDoisTenants(admin, { hoje: 'AAAA-MM-DD' })` (vale para os dois tenants). Recarregar no mesmo dia não muda nada;
em outro dia só move as datas (mesmos ids). Instantes: A 13:00Z = 09:00 local; B 12:00Z = 09:00 local.

**Nada de hora do relógio nos testes.** Os instantes "de hoje" são horas UTC fixas da data civil (ex.: v2/c2 aberta
com check-in às 14:00Z): dependendo da hora em que o teste roda, ficam no passado ou no futuro. Portanto nenhum teste
compara instante da fixture com `now()`/`current_date`: checkout = `checkin_em + interval`, check-in novo = instante
fixo do passado ou relativo ao da fixture. `carregarDoisTenants(admin, { agora })` / `dadosDoisTenants(h, { agora })`
calculam o "hoje" de cada fuso a partir de um instante dado; o `globalSetup` usa `agoraDosTestes()` (variável
`MACUXI_AGORA=<instante ISO>`, senão o relógio). `db/testes/sprint1.test.ts` roda a RN-CORE-11 com o relógio simulado
(`vi.setSystemTime`) às 08:00, 13:59, 14:01 e 23:59 de Manaus (a última já é o dia seguinte em UTC).

| | Tenant A | Tenant B |
|---|---|---|
| coordenada do cliente | c1 e c2 com; **c3 sem** (RN-CORE-10: 1º check-in sugere) | c1 com |
| contatos | c1 (principal + financeiro), c2, c3 | c1 |
| financeiro | c1 (limite 50 mil, saldo 10 mil); **c2 bloqueado** (saldo > limite); c3 com crédito informado pelo ERP | c1 |
| títulos | c1: vencido (hoje−10), a vencer (hoje+20), liquidado; c2: vencido há 45 dias; **c3: vencendo HOJE** e um cancelado antigo (fora da janela) | c1: vencido (hoje−3) e a vencer |
| histórico | c1: 12 meses (até o mês corrente); c2: 6 meses (sem compra no mês); c3: nenhum | c1: 12 meses |
| motivos | padrão do gatilho (7, ids `motivos.lojaFechada`/`acessoNegado`/`estoqueAlto`) + `obra_na_via` (fora_do_raio) | padrão + `cliente_inadimplente` (não venda) |
| rota de HOJE | vendedor-1: c1 (seq 1, janela 08–10) e c3 (seq 2); vendedor-2: c2; promotor: c1 | vendedor-B: c1 |
| visitas | v1/c1 hoje fechada com pedido p1; v1/c3 ontem **cliente fechado** (loja_fechada + foto recebida, extra, sugere coordenada); **v2/c2 hoje ABERTA fora do raio** com justificativa; promotor/c1 hoje `atendido` sem GPS; v1/c1 anteontem esquecida, fechada `auto` como `nao_finalizado` | hoje `sem_pedido` (estoque_alto); ontem **cliente fechado** (acesso_negado) com foto **aguardando** |
| etapas | pedido (vendedor), checklist (promotor), pesquisa dispensada (cliente fechado) | motivo de não venda |
| notificações | 1 por usuário (admin já lida) + recado do supervisor ao vendedor-1 (alta, `envio_id`) | 1 por usuário |
| metas (mês corrente) | vendedor-1: venda, visitas, positivação, cobertura; vendedor-2: venda; promotor: visitas | vendedor-B: venda |
| indicador_diario | vendedor-1 ontem | vendedor-B ontem |
| arquivos | fachada da visita v1/c3 (`recebido`) | fachada da visita de ontem (`aguardando`) |
| pedidos | p1 v1/c1 `received` (2 itens, desconto 5%); p2 v2/c2 `pending_approval` **em nome** (autor = supervisor); p3 v1/c3 `invoiced` | p1 `approved` |

### T-0029 (migrações 0008–0009; desenho T-0029 §10)
Grupos novos: `0032` condicao_pagamento · `0033` cliente_condicao · `0034` numeracao_pedido · `0035` pedido_evento ·
`0040` tabela_preco · `0041` tabela_preco_item · `0042` cliente_tabela_preco. Constantes em `DOIS_TENANTS.X.{tabelasPreco, condicoes}`.

| Tabela | Tenant A | Tenant B |
|---|---|---|
| tabela_preco / itens | "Padrão Alfa": produto 1 a 100.000 (desde hoje − 30), produto 2 a 50.000 com vigência que **termina hoje 04:00Z** | "Padrão Beta": produto 1 a 4.500 (sem vigência) |
| cliente_tabela_preco | c1 e c2 na Padrão Alfa; **c3 sem tabela** (todo produto sem preço, RN-CAT-06) | c1 |
| condicao_pagamento | À vista (`AVISTA`, padrão) e 28 dias (`28D`) | À vista (padrão) |
| cliente_condicao | c1: À vista e 28 dias; c2 sem lista (só a padrão) | c1: À vista |
| pedidos (colunas 0009) | p3 `000001`, p2 `000002` (`pending_approval`, nível **gerente**, 12%), p1 `000003` (retrato, hash, condição 28 dias) | p1 `000001` |
| numeracao_pedido | último = 3 (recarregar a fixture **não** volta o contador) | último = 1 |
| pedido_evento | p1: null→received; p2: null→received, received→pending_approval (gerente) | p1: null→received, received→approved |

Carteiras **não mudaram** (testes de sync contam os clientes de cada vendedor): por isso a rota de hoje do vendedor-1 tem
2 paradas (os 2 clientes da carteira dele), e não 3. Motivos padrão e parâmetros `core.checkin.raio_m`/`metas.base_apuracao`
não estão nas listas da fixture: o gatilho `core.semear_tenant` cria no INSERT do tenant.

### T-0032 (migração 0010; schema `integracao`)
Grupos novos: `0050` conector · `0051` credencial · `0052` politica_versao · `0053` sessao_carga · `0054` sessao_carga_recebido ·
`0055` lote · `0056` lote_staging · `0057` lote_linha_erro · `0058` registro_atual · `0059` pendencia_inativacao ·
`005a` inativacao_auditoria · `005b` cursor_entidade · `005c` reconciliacao · `005d` mapeamento · `005e` pedido_fila_erp ·
`005f` pedido_retorno · `0060` pedido_retorno_erro. Constantes em `DOIS_TENANTS.X.integracao` e `PEPPER_HUB_FIXTURE`
(`@macuxi/db/teste` via `dois-tenants`). Instantes **fixos** (2026-10-30): recarregar não muda nada.

| Tabela | Tenant A | Tenant B |
|---|---|---|
| conector | `erp-alfa`, as 8 entidades, recebe pedidos, sem lista de IP | `erp-beta`, só `cliente` e `produto`, recebe pedidos, IP `203.0.113.0/24` |
| credencial | `atual`, prefixo `alfa0001`; **chave em claro** `DOIS_TENANTS.A.integracao.chave.chave`; `hash_chave` = HMAC-SHA256(`PEPPER_HUB_FIXTURE`, chave) | idem `beta0001` |
| politica_versao | mínima 1.1.0, recomendada 1.2.0 | mínima 1.0.0, recomendada 1.2.0 |
| sessao_carga | produto (completa, 1 inativada) e cliente (completa) | cliente (completa) |
| sessao_carga_recebido | `PRD-INVALIDO-9` na sessão de produto | `CLI-INVALIDO-9` |
| lote | completo de produto (`concluido_com_erros`, 3 recebidas, 1 erro, 1 inativada), delta de produto (`recebido`, com staging), completo de cliente | completo de cliente, delta de cliente (`recebido`, com staging) |
| lote_linha_erro | origem hub, `campo_obrigatorio`, com payload | origem conector, `formato_invalido`, sem payload |
| registro_atual | `PRD-1` ativo e `PRD-2` **inativado** (hash nulo) | `CLI-1` |
| pendencia_inativacao | produto **confirmada** pelo analista; cliente **aguardando** (expira 2099, decidível nos testes) | cliente **recusada** pelo admin-B |
| inativacao_auditoria | confirmar (analista, inativadas 1) | recusar (admin, inativadas nulo) |
| cursor_entidade / reconciliacao / mapeamento | produto `PRD-1` / divergente / À vista `001` e 28 dias `028` | cliente `CLI-1` / sem divergência / À vista `AV` |
| pedido_fila_erp / pedido_retorno / pedido_retorno_erro | p3 `faturado_parcial` (nota 1001) / 1 retorno / 1 descartado `sequencia_inexistente` | p1 `faturado_total` (nota 2001) / 1 retorno / 1 descartado `produto_divergente` |

A licença do módulo `integracao` **não** está em `tenant_modulo` da fixture (os módulos de A e B não mudaram; os testes de
licença contam a lista). Quem precisar das rotas do Hub com licença ativa grava a linha no próprio teste (ou pede ao banco-dados).

## Seed Fase M (demonstração)
Tenant `7d0c2f4e-1a2b-4c3d-8e9f-000000000001` "Distribuidora Exemplo", código `exemplo`, America/Manaus
(mesmo id da Fase M). IDs determinísticos (UUID v5 de `fase-m:<tipo>:<chave>`).

| Perfil na Fase M | Perfil na plataforma | Usuários |
|---|---|---|
| seller | vendedor | Bruna T. (Zona Sul), Rafael S. (Zona Norte), Diego M. (Centro), Carla N. (Interior), Marcos P. (Zona Leste), Lívia R. (Zona Oeste), Thiago A. (Interior), Paula V. (Zona Norte) |
| manager | gerente | Fernando Lima (responsável pela "Gerência Comercial", pai das 6 equipes) |
| analyst | analista | Juliana Melo |
| bko_assistant | assistente | Ana Costa |
| admin | admin | Patrícia Gomes |

E-mail = primeiro nome sem acento `@exemplo.com.br`. A Fase M não tinha supervisor nem promotor.
Também carrega: 60 produtos (cadastro base; preço/estoque vão para o Catálogo), 18 clientes nomeados com
carteira do vendedor, módulos `core, catalogo, vendedor, gestor` e os parâmetros padrão do doc 03.
Senha: `MACUXI_SENHA_DEMO` (padrão `demo-macuxi`, só demonstração local).

**Sprint 1** (datas relativas a hoje em America/Manaus; `carregarFaseM(admin, { hoje })` fixa a data): para cada um dos
18 clientes, 1 contato, financeiro (1 em cada 7 bloqueado), 3 títulos (vencido em 1 a cada 3 clientes, a vencer, liquidado)
e 12 meses de histórico; **rota de hoje** de cada vendedor com carteira (paradas na ordem da carteira — Rafael S. tem 7);
4 pedidos do Rafael S. (`received`, `approved`, `invoiced`, `pending_approval`) com itens dos produtos da Fase M. Rotas e
paradas têm id pela data (cada dia de demonstração ganha a sua; as anteriores ficam como histórico). Motivos e parâmetros
padrão do Core vêm do gatilho do tenant.
