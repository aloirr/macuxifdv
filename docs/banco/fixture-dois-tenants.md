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

**Um relógio só entre a fixture e os testes** (T-0042, B3): o `globalSetup` lê `agoraDosTestes()` **uma vez**, carrega a
fixture com ele e o entrega aos testes no estado (`agora`, ISO). Nos testes use `agoraDaFixture()` (o instante) e
`hojeDaFixture(fuso = 'America/Manaus')` (a data civil que a fixture usou para rotas, visitas, títulos e metas daquele fuso),
de `@macuxi/db/teste` (ou `@macuxi/db/teste/estado`), em vez de `new Date()`: a execução que cruza a meia-noite de Manaus
(04:00Z) ou roda com `MACUXI_AGORA` continua no mesmo dia da fixture. Para comparar com colunas gravadas por `now()`
(`created_at`/`updated_at`), o relógio certo é o do banco (`select now()`), não o da fixture.

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
(`@macuxi/db/teste` via `dois-tenants`). Instantes **operacionais relativos à carga** (T-0042, B2): sinal do Conector,
sessões, lotes, decisões, fila, retorno e reconciliação no **dia de operação = hoje de A − 2** (horas UTC fixas desse dia);
pendências decididas expiram em hoje + 5. Ficam fixos só o `alterado_em` do ERP (`2026-10-30T09:00:00.123Z`, relógio do
ERP, comparado só com outros `alterado_em`/cursores) e o 2099 da pendência aguardando de A. Recarregar no mesmo dia não
muda nada. Teste que avalie "sem sinal há X", "lote antigo" ou retenção ainda deve trazer o dado para `now()` antes
(como o `t0032.test.ts` faz nos expurgos).

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

### T-0056 (migração 0015; schema `promotor`)
Arquivo próprio `db/seeds/fixtures/promotor.ts` (`dadosPromotorFixture`, `ORDEM_PROMOTOR`, `COLETAS_PROMOTOR`,
`PROMOTOR_FIXTURE`); o `dois-tenants.ts` só importa, põe as 20 tabelas no fim de `ORDEM_TABELAS` e junta os dados.
Grupos (0x84–0x97; o Gestor da 0014 usa 0x70–0x73 em `db/seeds/fixtures/gestor.ts`): `0084` categoria_gondola · `0085` checklist_loja (itens `…0101`/`…0102`) · `0086` mix_obrigatorio · `0087` meta_share ·
`0088` concorrente · `0089` produto_concorrente · `008a` foto_referencia · `008b` tarefa_trade · `008c` ponto_extra_negociado ·
`008d` visita_loja · `008e` foto_coleta · `008f` checklist_resposta · `0090` gondola_registro · `0091` medicao_share ·
`0092` coleta_preco · `0093` ruptura_item · `0094` validade_item · `0095` ponto_extra · `0096` acao_concorrencia · `0097` tarefa_execucao.
Instantes derivados do "hoje" de cada tenant, na janela da visita do Core da fixture. Payloads = contratos de
`modules/promotor/contracts/coletas.ts` com todos os defaults explícitos (conferido em `db/testes/promotor.test.ts`).

| Tabela | Tenant A (promotor, c1) | Tenant B (sem licença do Promotor; só isolamento) |
|---|---|---|
| visita_loja | da visita do Core `promotorC1Hoje` (hoje 15:00Z–15:30Z), `realizada`, 30 min, checklist de A | da visita `c1Hoje` de B (12:00Z–12:30Z); `promotor_id` = vendedor-B (sem FK; o banco não confere perfil) |
| cadastros | Freios e Filtros; checklist (1 etapa obrigatória); mix do produto 1; meta 40% em Freios; concorrente + produto; foto de referência; tarefa em c1; ponto extra negociado em c1 | Lubrificantes; checklist; mix; meta 30% em c1; concorrente + produto; foto de referência por segmento; tarefa; display negociado |
| coletas | 4 fotos (antes, depois, ponto extra, tarefa), checklist, gôndola conforme, share 4/10 = 40% (100%), preço nosso + concorrente em promoção (índice 108), ruptura de gôndola, validade, ponto extra cumprido, ação da concorrência, tarefa | 3 fotos, checklist, gôndola parcial, share 3/12 = 25% (83,33%), preço com anterior, ruptura total, avaria, ponto não encontrado, ação de PDV, tarefa |

### T-0084/T-0085 (migração 0033; aplicação e referência cruzada)
- **`catalogo.produto_conteudo`:**
  - A: aplicação "Motos 150 cc" e as etiquetas "Dianteira" e "Novo";
  - B: aplicação **diferente**, "Carros flex 1.0 a 2.0 2015–2020", sem etiquetas. Serve ao teste de isolamento.
- **`catalogo.produto_busca`:**
  - A: `aplicacao` "Motos 150 cc" e `referencias` com "CB 3401", "FR-77.2" e os compactos;
  - B: `aplicacao` expandida e "LB 0099".
- **`catalogo.produto_referencia`** (grupo **0x4f**, ids em `REFERENCIAS_FIXTURE`):
  - A: p1 com "CB 3401" (ordem 1) e "FR-77.2" (ordem 2) vivas, mais "CB-3400" **apagada** na ordem 1;
  - B: p1 com "LB 0099";
  - a marca é o concorrente do Promotor do mesmo tenant (`PROMOTOR_FIXTURE.X.concorrente`); desde a 0045 essa é a marca ativa
    de `catalogo.marca_concorrente` (mesmo id), com FK `produto_referencia_marca_fk`;
  - 0034: as vivas levam `marca_nome` = o nome desse concorrente (`MARCA_NOME_FIXTURE`: A "Freios Rivais", B "Lubri Rival");
    a apagada fica com `marca_nome` nulo (como uma linha anterior à 0034);
  - `codigo_compacto` segue a regra do `codigoCompacto`.
- **`catalogo.marca_concorrente`** (0045, T-0113; grupo **0x3c**, ids em `MARCAS_FIXTURE`): por tenant a **ativa** com o mesmo
  id, nome, ativo, `deleted_at` e `external_id` do concorrente do Promotor (o que a cópia da migração faz), uma **inativa**
  (`external_id` `MARCA-INATIVA-ALFA`/`-BETA`) e uma **apagada**. O teste de ids sem repetição aceita só esse id repetido
  (ativa = concorrente do Promotor). `promotor.concorrente` segue na fixture (só de leitura para o `macuxi_app`).
- **`vendedor.pedido_item`:** o item 1 do p1 de A tem o retrato "Motos 150 cc"; os demais ficam nulos.
- **`vendedor.pedido_devolucao`** (0050, T-0054; grupo **0x3d**, ids em `DEVOLUCOES_FIXTURE`): A com a devolução parcial
  **viva** `NFD-1-7001` no p3 (R$ 200,00) e a mesma nota **apagada** (R$ 300,00, soft delete); B com a `NFD-1-7001` viva no p1
  (R$ 50,00): a mesma chave de nota nos dois tenants (o único é por tenant).
- **Literal de `text[]` com texto livre:** use `arrayDeTextoLivre` (`db/src/gravar.ts`). O `arrayDeTexto` só aceita códigos `[a-z0-9_]`.

### T-0087 fatia E (migração 0036; convite de 1º acesso)
- **`core.usuario_convite`** (grupo **0x08**, ids e tokens em `CONVITES_FIXTURE`, exportado por `@macuxi/db/teste`):
  - token `<tenant_id>.<segredo>` (segredo fixo, só de teste); o banco guarda só o sha256 hex do segredo (`.hash`);
  - A: `pendente` do vendedor-2 (válido até 2099, autor = admin de A), `revogado` do vendedor-2 (renovado) e `usado` do
    promotor (sem autor, como uma carga);
  - B: `pendente` do vendedor-B, autor `super_admin` (id sem FK);
  - os usuários da fixture já têm senha: aceitar o pendente troca a senha (teste em transação desfeita).
- `core.usuario.telefone` fica nulo em todos (o upsert da fixture não mexe na coluna).

### T-0089 (migração 0037; formas, prazos, prazo médio do cliente e tabela escalonada)
- **Semeadas pelo gatilho** `tenant_semear_pagamento` (fora das listas, como motivos e medidas): em A e em B a forma `AVISTA`
  "À vista" com o prazo `AVISTA` `{0}` (ids em `PAGAMENTO_FIXTURE.X.semeada`, gêmeos de `uuid_de_chave`).
- **`vendedor.forma_pagamento`** (grupo **0x37**): A `PIX` (ordem 1) e `BOLETO` (ordem 2, `external_id` `FP-BOL`); B `DINHEIRO`.
- **`vendedor.prazo_pagamento`** (grupo **0x3a**): A `PIX-AV` `{0}`; `BOL-28-56` `{28,56}` médio 42 (`external_id` `PZ-2856`);
  `BOL-30-60-90` médio 60; `BOL-28` **inativo**. B `DIN-AV` `{0}`.
- **`catalogo.tabela_escalonada`** (grupo **0x3b**): A no p1: 10 PC a 95.000 (geral), 2 CX a 90.000 por PC (Padrão Alfa) e uma
  vencida ontem (5 PC); B no p1: 12 UN a 4.200. Datas civis relativas ao "hoje" de cada tenant.
- **`core.cliente`**: c1 de A com `prazo_medio_max_dias = 45` e `formas_pagamento = {PIX,BOLETO}`; c1 de B com 30 e nulo; os
  demais nulos. Nenhum pedido da fixture tem forma e prazo (como os do APK antigo).
- Ids em `PAGAMENTO_FIXTURE` (exportado por `@macuxi/db/teste`). Literal de `integer[]`: `arrayDeInteiros` (`db/src/gravar.ts`).

### T-0111/T-0112 (migração 0041; perfis de acesso e multiperfil, ADR 0033)
- **Semeados pelos gatilhos** (fora das listas): os 7 perfis de fábrica em A e em B (`tenant_semear_perfis`, ids
  `idPerfilFabrica(tenant, base)`) e o vínculo de cada usuário com o perfil de fábrica de `core.usuario.perfil`
  (`usuario_perfil_principal`, ids `idUsuarioPerfil`).
- **`plataforma.perfil`** (grupo **0x17**): A `vendedor_externo` (base vendedor); B `vendedor_balcao` (base vendedor, sem usuário).
- **`plataforma.perfil_permissao`** (grupo **0x18**): A `dados.escopo = proprio` no `vendedor_externo`; B `acesso.campo` revogado
  no `vendedor_balcao`.
- **`plataforma.usuario_perfil`** (grupo **0x19**, só os vínculos ALÉM do principal): A vendedor-2 com `vendedor_externo`;
  B **multiperfil** vendedor + promotor de fábrica no vendedor-B (B não tem o módulo promotor: a união dos módulos não muda).
- Constantes em `DOIS_TENANTS.X.{perfis, sobreposicoes, vinculos}`.

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
