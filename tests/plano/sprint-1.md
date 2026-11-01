# Plano e relatório de testes — Sprint 1 · critério → teste → resultado

> Dono: agente `testes`. Fontes: `.coord/tarefas/T-0017.md`, `T-0018.md`, `T-0019.md`, `docs/desenho/T-0016.md` §2 a §5
> (critérios de teste §3.5, §4.7 e §5.5), `docs/produto/03-regras-de-negocio.md` (RN-CORE-01, 04, 05, 10 a 15).
> Mesmo formato do `relatorio-sprint-0.md`.
> Legenda: `✅` passou · `❌` falhou (ver Defeitos) · `pendente` · `manual` (roteiro abaixo) · `parcial` (ver nota).
> IDs `S1-nnn` estáveis: o nome do `it` cita o ID. Os testes deste agente são de integração pelo `createApp` REAL
> (apps/api, 8 módulos, JWT de verdade, licenças lidas a cada requisição) com o Postgres como `macuxi_app` (RLS), num
> banco efêmero por arquivo com a fixture dois-tenants. Os unitários do domínio e o `carteira.db.test.ts` (32 casos)
> são do modulo-core; aqui não se repetem, se confirmam de fora, pela API montada como em produção.

## Veredito por tarefa — rodada 3 (2026-10-31, fechamento de D-3 e D-4)

| Tarefa | Veredito | Resumo |
|---|---|---|
| T-0018 | ✅ critérios demonstrados (1 defeito menor aberto, D-5) | D-4 fechado: o "Sincronizar" do vendedor com as etapas do shell termina sem erro na API real (S1-043, agora `it`), e 401, 403, 423 e 5xx nas etapas da Fase M do Vendedor derrubam o sync sem apagar nada (S1-043c). D-3 fechado: o check-in aceito segue na tela até o pull trazer a linha e o app continua barrando o 2º atendimento (S1-042, agora `it`; `estado.aceitos` esvazia depois do horizonte). Aberto D-5 (Core): as cargas do Core ainda engolem 401/423 (S1-043d, `it.fails`); não bloqueia o critério 2 porque o shell trata o 423 no `ApiClient` (`aoErroHttp`) |
| T-0019 | ✅ critérios 1 e 2 demonstrados | D-3 fechado: a leitura aceita continua lida na caixa até o pull (S1-065, agora `it`; helper `caixa` lê `motor.sobreposicao(['notificacao_leitura'])`, como `usar-notificacoes.ts`). Critério 3 (push real) segue com a T-0022 e o build EAS |

### Rodada 2 (2026-10-31)

| Tarefa | Veredito | Resumo |
|---|---|---|
| T-0017 (+ RN-CORE-15 e O-5) | ✅ critérios demonstrados | O-5 provado por HTTP (S1-035): o bloqueio corta o MESMO token na requisição seguinte em toda superfície (Core, me/modulos, pull, push, arquivos), sem gravar nada; sessão sem aparelho e tenant B normais; desbloqueio devolve o acesso. Faltam só telas (sem e2e) e o roteiro manual |
| T-0018 | ❌ 2 defeitos (D-3, D-4) | Critérios 1, 3 e 4 ✅ e RN-CORE-11, escopo e tenant ✅. Critério 2 ❌ no app de verdade: com as etapas do shell o "Sincronizar" do vendedor termina com erro (D-4, 404 nas etapas da Fase M do Vendedor); sem elas o pull de visita e pedido está certo (S1-043b). D-3: check-in aceito some do aparelho até o pull seguinte |
| T-0019 | ❌ 1 defeito (D-3) | Critérios 1 e 2 ✅ (recado chega no próximo sync, leitura offline sobe, escopo por usuário e tenant, 403 fora da equipe, idempotência). D-3: a leitura aceita volta a "não lida" no aparelho até o sync seguinte. Critério 3 (push real) fica para a T-0022 e o build EAS |

Rodada 3: S1-042, S1-043 e S1-065 viraram `it` (cada um ficou vermelho como `it.fails` antes da troca); resta `it.fails` só o
S1-043d (D-5). Os casos dos defeitos estão como `it.fails` (passam enquanto o defeito existir; quando corrigirem, ficam vermelhos e o testes
troca por `it`), para a suíte seguir verde e o defeito visível.

## T-0017 — Carteira e Cliente 360 (RF-CORE-02, RF-CORE-04; RN-CORE-04/05) + RN-CORE-15

### Rodada 1 (2026-10-31) — validação com o Postgres real

**Veredito: os 3 critérios de aceite da T-0017 e a RN-CORE-15 estão demonstrados na API e no motor de sync (✅).
A T-0017 ainda NÃO está pronta como um todo**: faltam as telas do BKO (Cliente 360 web e Carteira, modulo-core, em
andamento) e a ligação do 423 no shell do app (engenheiro, R-20261031-182211). Detalhe em "Pendências".

Escopo da fixture (RN-CORE-04): vendedor-1 {c1,c3} · vendedor-2 {c2} · promotor {c1} · supervisor = equipe 1 {c1,c3} ·
gerente = regional, equipes 1 e 2 abaixo {c1,c2,c3} · analista/assistente/admin = tenant A · B = só o c1 de B.

#### Critério 1 — escopo de carteira com teste de vazamento (RN-CORE-04/05)

| ID | Critério / cenário | Teste | Resultado |
|---|---|---|---|
| S1-001 | `GET /v1/core/clientes`: cada perfil vê exatamente o próprio escopo; a busca pelo nome do cliente de B não acha nada em A | tests/integracao/api/carteira-escopo.test.ts "S1-001 ..." (10 perfis × 2 tenants) | ✅ |
| S1-002 | `GET /v1/core/clientes/:id` para os 4 clientes (3 de A, 1 de B) por perfil: 200 só no escopo e tudo na ficha é do próprio cliente; fora do escopo e de outro tenant → 404 **idêntico** ao de id inexistente (não revela que existe, sem nome de cliente/tenant no corpo) | idem "S1-002 ..." (10 perfis) | ✅ |
| S1-003 | Ficha de c1 (vendedor-1): contatos (principal primeiro), financeiro, 3 títulos na janela, 12 meses de histórico, resumos; últimas visitas só dele; o supervisor vê também a do promotor (equipe) | idem "S1-003 ..." | ✅ |
| S1-004 | `GET /v1/core/carteira`: vendedor/promotor 403 `PERFIL_SEM_ACESSO`; supervisor só vínculos da equipe 1; gerente as equipes abaixo; analista o tenant (4); admin B só B; filtros `usuario_id`/`cliente_id` de fora do escopo ou de outro tenant → lista vazia | idem "S1-004 ..." | ✅ |
| S1-005 | `GET /v1/core/equipe/hierarquia`: vendedor/promotor 403; supervisor = ele + equipe 1, `superior_id` dele `null` (não revela o gerente); gerente = regional com o supervisor abaixo dele; admin A só gente de A; admin B só gente de B | idem "S1-005 ..." | ✅ |
| S1-006 | Pull das 7 entidades (`cliente`, `carteira`, `produto`, `cliente_contato`, `cliente_financeiro`, `titulo`, `historico_compra`) por perfil: clientes de cada entidade = escopo ∩ dados da janela; `versao_escopo` presente; `produto` = tenant; nenhum id do outro tenant (conferido contra os ids lidos pelo admin, sem RLS) | idem "S1-006 ..." (10 perfis) + "vendedor-2 (só c2) não recebe..." linha a linha | ✅ |
| S1-007 | `PUT`/`DELETE carteira` (`carteira.editar`): vendedor, promotor, supervisor, gerente e assistente → 403 `PERFIL_SEM_ACESSO` e nada gravado | idem "S1-007 ..." | ✅ |
| S1-008 | `PUT` idempotente pela chave (cliente, usuário, papel): 2 PUTs (analista e admin) = mesmo id, 1 vínculo vivo, 2 auditorias `carteira.vincular` com o autor; papel incompatível → 422 `RN-CORE-04`; `DELETE` 204 + auditoria `carteira.desvincular`, 2º `DELETE` 404; a ficha volta a 404 na hora (escopo lido por requisição) | idem "S1-008 ..." | ✅ |
| S1-009 | RN-CORE-05 na escrita: admin B não vincula cliente de A (404 `CLIENTE_NAO_ENCONTRADO`) nem usuário de A (404 `USUARIO_NAO_ENCONTRADO`) nem apaga vínculo de A (404 `CARTEIRA_NAO_ENCONTRADA`); A intacto | idem "S1-009 ..." | ✅ |

#### Critério 2 — modo avião (ficha com financeiro e histórico já sincronizados)

Motor de sync REAL do platform-sdk com as entidades que o app declara (`modules/core/app/lib/entidades-cliente.ts`),
transporte para o `createApp` real e, sem rede, a ficha montada pela mesma função da tela
(`modules/core/app/lib/cliente360-local.ts`). Rodado com os 3 armazenamentos do motor: chave→JSON (o AsyncStorage do
app), `linhas` sobre chave→JSON e o adaptador SQLite do platform-sdk (`criarArmazenamentoSqlite` sobre `node:sqlite`
em memória, `@macuxi/platform-sdk/sqlite-node`, criado pelo engenheiro durante a rodada).

| ID | Critério / cenário | Teste | Resultado |
|---|---|---|---|
| S1-020 | Depois de 1 sync, em modo avião: o sync falha sem perder nada, a ficha de c1 abre **sem nenhuma chamada de rede** e bate com o Cliente 360 online: mesmos contatos, financeiro, títulos, histórico, `resumo_compras` e `resumo_financeiro`; ligar `tel:+55…` e WhatsApp `wa.me/55…` do contato principal | tests/integracao/api/cliente360-offline.test.ts "S1-020 ..." (3 armazenamentos) | ✅ |
| S1-021 | Sem rede, a lista de Clientes do aparelho = carteira (c1, c3); filtro "vencidos" = c1 (título de c3 vence HOJE no fuso de Manaus e não conta); "bloqueados" vazio; c2 nem existe no aparelho; c3 sem histórico e crédito do ERP | idem "S1-021 ..." (3 armazenamentos) | ✅ |
| S1-022 | §3.5 item 2 / ADR 0009 §4: analista vincula c3 ao vendedor-2 pelo `PUT carteira` → o próximo sync traz contato, financeiro e o título antigo de c3 e a ficha abre offline; `DELETE` → o próximo sync tira c3 do aparelho em todas as entidades; a ficha de c2 continua offline | idem "S1-022 ..." | ✅ |
| S1-023 | Sync seguinte incremental: nada duplicado, ficha igual | idem "S1-023 ..." | ✅ |
| S1-024 | Roteiro manual no APK (aparelho real) | ver "Teste manual" | manual |

#### Critério 3 — multi-tenant e licença do módulo em toda rota nova

| ID | Critério / cenário | Teste | Resultado |
|---|---|---|---|
| S1-010 | As 13 rotas novas (`clientes`, `clientes/:id`, `carteira` GET/PUT/DELETE, `equipe/hierarquia`, `dispositivos` GET, `dispositivos/:id/bloqueio` PUT/DELETE e o pull das 4 entidades novas): sem token, token malformado e JWT de outro segredo → 401 | carteira-escopo.test.ts "S1-010 ..." (13 rotas × 3 tokens) | ✅ |
| S1-011 | RN-CORE-01: o Core não desliga — API 422 nos 3 níveis (tenant, perfil, usuário) e o banco recusa por CHECK (`tenant_modulo_core_sempre_ativo`, 23514); as rotas novas seguem 200 | idem "S1-011 ..." | ✅ |
| S1-012 | Licença por requisição: com o Vendedor desligado no tenant, ficha e pull do Core seguem 200 e o pull de `pedido` vira 403 `MODULO_INATIVO`; religado volta 200 | idem "S1-012 ..." | ✅ |
| — | Multi-tenant em cada rota | S1-001, S1-002, S1-004, S1-005, S1-006, S1-009, S1-032 | ✅ |
| — | Aba Pedidos some sem o Vendedor efetivo (RN-CORE-03, slot `cliente.abas`) | componente do app (modulo-core/modulo-vendedor) + roteiro manual | manual |

#### RN-CORE-15 — aparelho bloqueado vale para o tenant inteiro (incluída na T-0017)

| ID | Critério / cenário | Teste | Resultado |
|---|---|---|---|
| S1-030 | Só admin e analista listam e bloqueiam; vendedor, promotor, supervisor, gerente e assistente → 403 `PERFIL_SEM_ACESSO`, nada muda | tests/integracao/api/aparelho-bloqueado.test.ts "S1-030 ..." | ✅ |
| S1-031 | Aparelho novo (registrado pelo login do vendedor-1) bloqueado pelo analista no BKO (auditoria `dispositivo.bloquear` com o autor): refresh → 423 `DISPOSITIVO_BLOQUEADO` e a família cai (mesmo refresh → 401); login de vendedor, supervisor, admin e promotor por ele → 423; senha errada → 401 `CREDENCIAIS_INVALIDAS` (423 só para quem acertou); por outro aparelho → 200 | idem "S1-031 ..." | ✅ |
| S1-032 | Tenant B não é afetado: vendedor B entra e renova pelos próprios aparelhos; admin B não vê o aparelho de A na lista e recebe 404 ao bloquear/desbloquear aparelho de A; estado de A intacto; o id do aparelho bloqueado de A no login de B nunca dá 423 nem 500 e não vaza nome/id de A | idem "S1-032 ..." | ✅ |
| S1-033 | Desbloquear (auditoria `dispositivo.desbloquear`) devolve o acesso a qualquer usuário de A | idem "S1-033 ..." | ✅ |
| S1-034 | App: 423 do refresh real → `tratarAparelhoBloqueado` (Core) com `motor.limparAparelho()` real apaga linhas, cursores, chaves do módulo e a fila não enviada; aviso `AVISO_APARELHO_LIMPO`, sessão encerrada, volta ao login; outro erro não toca em nada | idem "S1-034 ..." | ✅ (lib + motor; a ligação no shell é do engenheiro) |
| — | Já coberto antes: aparelho bloqueado da fixture e aparelho de outro tenant (403 `DISPOSITIVO_INVALIDO`) | tests/integracao/api/auth.test.ts | ✅ |

#### Defeitos

Nenhum defeito encontrado nesta rodada (nenhum recado `pedido` aberto).

#### Observações (para decisão, não são defeito)

- **O-5 — acesso já emitido continua até expirar.** *(Resolvida na rodada 2: decisão do gerente pelo corte imediato, entregue pelo core e provada no S1-035.)* Por decisão registrada em `modules/core/api/dispositivos.ts`, o
  bloqueio não revoga as sessões: o token de acesso já emitido vale até expirar (15 min, `ACESSO_MINUTOS`) e só o
  refresh/login devolve 423. Num aparelho roubado com sinal, o pull continua por até 15 min. Se a RN-CORE-15 precisar
  de corte imediato, o `autenticar` teria de checar o aparelho (o JWT não carrega o id do aparelho). Decisão do
  gerente/Alexandre.
- **O-1 (Sprint 0) segue valendo:** o pull de `carteira` do vendedor traz também o vínculo do promotor no mesmo
  cliente ("quem mais atende o meu cliente"). Coerente com o escopo por cliente, só registro.
- Premissa do core mantida: a busca da API não ignora acento (a do app ignora). Os testes usam o nome exato.

#### Pendências conhecidas (a T-0017 só fecha com elas)

1. **BKO — páginas Cliente 360 web e Carteira** (modulo-core, em andamento): sem tela, o e2e Playwright (lista do
   escopo, ficha web, vincular/desvincular com vigência e frequência, 403 para quem não tem `carteira.editar`) fica
   para a próxima rodada.
2. **Shell do app: ligação do 423** (`motor.limparAparelho()` + `tratarAparelhoBloqueado` no refresh/login,
   engenheiro, R-20261031-182211; `apps/mobile/src/lib/aparelho-bloqueado.ts` estava sendo criado durante a rodada).
   S1-034 prova a peça do Core com o motor real; falta provar no shell.
3. Roteiro manual no APK (abaixo).

#### Teste manual (aparelho real)

1. **Modo avião (S1-024):** login como vendedor-1 com sinal → Sincronizar → abrir Clientes (c1 e c3) → ativar modo
   avião → fechar e reabrir o app → Clientes → ficha de c1: contatos, financeiro (limite R$ 50.000,00, saldo
   R$ 10.000,00, crédito R$ 40.000,00, 1 vencido e 1 a vencer), 12 meses de compras; tocar "Ligar" (abre o discador
   com +55 92 3222-0001) e "WhatsApp" (abre a conversa) — sem rede o discador abre; o WhatsApp mostra "sem conexão".
   Filtros "vencidos" (só c1) e "bloqueados" (vazio). Desligar o modo avião → Sincronizar sem erro.
2. **Aba Pedidos:** com o Vendedor desligado para o usuário no BKO → Sincronizar → a aba Pedidos some da ficha.
3. **RN-CORE-15:** aparelho logado → BKO (analista) bloqueia o aparelho → no app, forçar a renovação (esperar 15 min
   ou reabrir o app) → aviso de aparelho limpo, volta ao login, Clientes vazio depois do login por outro aparelho;
   desbloquear no BKO → login volta a funcionar.

#### Comandos da rodada 1

Ver "Rodada 1 — comandos" no fim desta seção.

#### Rodada 1 — comandos

Com o modulo-core (T-0018) e o engenheiro alterando `modules/core` e `packages/platform-sdk` em paralelo:
`MACUXI_PG_EXIGIR=1 pnpm test:tests` ✅ **21 arquivos, 304 casos, 0 pulados** (eram 18/239; +3 arquivos
`carteira-escopo`, `cliente360-offline`, `aparelho-bloqueado`) · `pnpm lint:tests` ✅ · `pnpm typecheck:tests` ✅ ·
`node scripts/coord.mjs verificar testes` sem violação. Na primeira execução o `createApp` não subia
("sync visita_checkout: não está em sync do manifesto de core", trabalho do core em andamento); na seguinte já subia.

### Rodada 2 (2026-10-31) — O-5: corte imediato do aparelho bloqueado

A observação O-5 da rodada 1 virou regra (RN-CORE-15, decisão do gerente) e o core entregou: o JWT de acesso leva o
aparelho (`did`) e `autenticar` consulta `core.dispositivo` pela chave primária a cada requisição.

| ID | Critério / cenário | Teste | Resultado |
|---|---|---|---|
| S1-035 | Vendedor-1 e supervisor logados no mesmo aparelho novo e o promotor num segundo aparelho (acesso emitido pelo **refresh**); o analista bloqueia os dois no BKO → a requisição seguinte do MESMO token recebe 423 `DISPOSITIVO_BLOQUEADO` em `GET /v1/core/clientes`, `GET /v1/me/modulos`, `GET /v1/sync/pull`, `POST /v1/sync/push`, `PUT /v1/arquivos/:id` e `GET /v1/core/notificacoes`, sem nome de cliente/tenant no corpo; o check-in e a foto enviados com o token cortado não são gravados; o mesmo vendedor por sessão sem aparelho e o vendedor do tenant B (aparelho próprio) seguem 200; desbloquear devolve o acesso ao MESMO token (sem novo login) e o outro aparelho segue cortado | tests/integracao/api/aparelho-bloqueado.test.ts "S1-035 ..." | ✅ |

Premissa do core mantida: tokens emitidos antes da mudança (sem `did`) valem até expirar (15 min).

---

## T-0018 — Rotas e visitas reais, sync de visita e pedido (RF-CORE-05/06/07; RN-CORE-10..14; D-2)

### Rodada 1 (2026-10-31) — validação com o Postgres real

Arquivo: `tests/integracao/api/visitas-campo.test.ts`. O "aparelho" (`tests/integracao/apoio/campo.ts`) é o motor de sync
REAL com as entidades que o Core declara no app (`entidades-cliente`, `entidades-rota`, `entidades-notificacao`) e as do
Vendedor publicadas pelo servidor, transporte igual ao `transporteV1` (push, pull e `PUT /v1/arquivos/:id`), ambiente HTTP
da sessão com base `/v1` e leitor de fotos locais. As ações são as da tela: `fazerCheckin`/`fazerCheckout`
(`modules/core/app/lib/acoes-visita.ts`) e o estado do `ArmazemCore` (linhas ⊕ fila). Só `dispositivo.ts`
(expo-crypto/expo-location) é trocado: UUID do Node e GPS controlado pelo teste. O servidor é o `createApp` real com
`tx.publicar`, `tx.registrarArquivo` e o armazenamento de fotos (memória). Fixture: rota de hoje do vendedor-1 com c1
(já visitado) e c3 (sem coordenada); raio `core.checkin.raio_m` = 200.

| ID | Critério / cenário | Teste | Resultado |
|---|---|---|---|
| S1-040 | **Critério 1 — modo avião**: sincroniza, abre a rota do aparelho (c1 feito, c3 pendente), liga o modo avião, faz check-in em c3 (GPS lido uma vez; c3 sem coordenada → sugere) e checkout `sem_pedido` com motivo: a parada vai a "em atendimento" e "feita" na hora; nada chega ao servidor; o sync sem sinal falha sem perder a fila. Na volta: UMA visita com o UUID do aparelho, `checkout_id` = UUID do comando, parada, motivo, `sugere_coordenada`, coordenada do GPS; 1 evento `core.visita.checkin@1` e 1 `core.visita.checkout@1`. Reenviar o MESMO lote → `aceito` × 2 sem duplicar visita nem evento; o pull seguinte traz a linha uma vez | "S1-040 ..." | ✅ |
| S1-041 | §4.7 item 1 — sobreposição: check-in enviado e a linha ABERTA já no aparelho; checkout com a rede caindo só no envio → o pull continua respondendo "aberta", mas a tela mostra fechada (o item da fila vence); quando o envio passa, o servidor fecha com o checkout do aparelho | "S1-041 ..." | ✅ |
| S1-042 | Depois que o check-in é aceito, o aparelho continua mostrando o atendimento até o pull trazer a linha e barra o 2º check-in (RN-CORE-11); o item fica em `estado.aceitos` e, depois do horizonte, o pull traz a linha aberta e `aceitos` esvazia | "S1-042 D-3 ..." | ✅ (rodada 3; era ❌ D-3) |
| S1-043 | **Critério 2 — "Sincronizar" do Campo** com as etapas de carga que o shell passa no modo v1 (`etapasCore` + `etapasVendedor`) termina sem erro e traz visita, rota e pedido; as etapas do Vendedor foram chamadas e receberam só 404 (pulo tolerado) | "S1-043 ..." | ✅ (rodada 3; era ❌ D-4) |
| S1-043c | D-4, outro lado: com o HTTP das etapas do Vendedor respondendo 401 `NAO_AUTENTICADO`, 403 `PERFIL_SEM_ACESSO`, 403 `MODULO_INATIVO`, 423 `DISPOSITIVO_BLOQUEADO` ou 500, o `sincronizar()` = false com o código no erro e as linhas do aparelho intactas; 404 e 501 `SYNC_NAO_IMPLEMENTADO` seguem pulados (sync ok) | "S1-043c ..." | ✅ |
| S1-043d | O mesmo nas cargas do Core (`metas`, `pedidos-da-visita`): 401 e 423 têm de derrubar o sync | "S1-043d DEFEITO D-5 ..." (`it.fails`) | ❌ D-5 |
| S1-043b | Critério 2 sem as etapas da Fase M: o pull genérico de `visita`, `rota`, `rota_parada`, `motivo`, `parametro`, `pedido`, `pedido_item` e do Cliente 360 termina sem erro e **sem aviso** (o 501 do D-2 acabou para visita e pedido); a visita de hoje vem ligada ao pedido p1 | "S1-043b ..." | ✅ |
| S1-044 | **Critério 3 — RN-CORE-10**: a ~900 m do c1 o app devolve "justificar" com o raio do tenant (200) e nada entra na fila; com a justificativa o servidor grava `fora_do_raio = true`, distância e justificativa, e o supervisor vê no BKO (`GET /v1/core/visitas?fora_do_raio=true`); app adulterado (push direto, sem justificativa) → `rejeitado/RN-CORE-10` e nada gravado | "S1-044 ..." | ✅ |
| S1-045 | RN-CORE-10 — **raio do parâmetro do tenant**: `core.checkin.raio_m` de A → 2000: no próximo sync o aparelho recebe 2000 (pull `parametro`, só essa chave), o check-in a ~900 m sai sem justificativa e o servidor aceita sem sinalizar; → 500: o app volta a pedir justificativa (raio 500) e o servidor rejeita; o tenant B continua com 200 no aparelho e no servidor | "S1-045 ..." | ✅ |
| S1-046 | RN-CORE-11 — um atendimento aberto por vez: no aparelho o 2º check-in em outro cliente é "bloqueado" e no mesmo cliente devolve o aberto (1 item na fila); no servidor um 2º check-in fecha o anterior como `auto/nao_finalizado` com evento; o índice único parcial recusa 2 abertas (23505); o checkout do usuário vence o fechamento automático | "S1-046 ..." | ✅ |
| S1-047 | **Critério 4 — RN-CORE-14** cliente fechado, feito sem sinal: sem foto o contrato do app recusa e nada entra na fila; com a foto (fila de arquivos, "Fotos pendentes: 1") e motivo `loja_fechada`, na volta: visita com resultado, motivo e foto; `plataforma.arquivo` `recebido` (finalidade fachada, cliente c1, autor, tamanho) e bytes gravados em `<tenant>/core/<aaaa-mm>/<id>.jpg` pela `PUT /v1/arquivos/:id`; reenvio da foto → 200 repetido, bytes diferentes → 409 `ARQUIVO_DIVERGENTE`; baixam a foto o vendedor, o supervisor e o analista (mesmos bytes); vendedor-2 (sem c1) recebe 4xx e o admin de B 404; o BKO lista motivo e foto | "S1-047 ..." | ✅ |
| S1-048 | RN-CORE-04/05 — escopo e tenant: check-in do vendedor-1 em c2 (do vendedor-2) e no cliente de B → `FORA_DA_CARTEIRA`, nada gravado; no pull, `visita`/`rota`/`rota_parada` de cada aparelho só do próprio usuário e nenhum id de A no aparelho de B; B não fecha a visita aberta de A (`VISITA_NAO_ENCONTRADA`) e o UUID dela enviado por B não altera a linha de A nem vaza nome; vendedor-1 não fecha a do vendedor-2; no BKO o supervisor não vê o vendedor-2, o vendedor recebe 403 e o admin de B não vê nada de A | "S1-048 ..." | ✅ |
| S1-049 | Push sem token → 401; promotor (sem Vendedor efetivo) fecha como `atendido` sem motivo e `sem_pedido` é rejeitado (RN-CORE-12) | "S1-049 ..." | ✅ |
| — | Domínio puro (`avaliarCheckin`, `resolverCheckin`, `statusDasParadas`, virada do dia em Manaus/São Paulo), editor de rotas, copiar/gerar, coordenada sugerida aprovada, motivos de sistema | modulo-core: `visita.db.test.ts` (32 casos) e unitários do domínio — não repetidos aqui | ✅ (do core) |
| — | Telas do app (Rota, Check-in, Checkout com câmera) e do BKO (Rotas, Visitas, Coordenadas, Motivos) | sem teste de interface nesta rodada | manual |

#### Defeitos

| ID | Defeito | Passos | Arquivo provável | Recado |
|---|---|---|---|---|
| D-3 | **Item aceito sai da fila antes de o pull trazer a linha e o fato "some" do aparelho.** O pull só devolve linhas com `updated_at < now() − 2 s` e a sobreposição (ADR 0009 §3) só cobre itens `pendente`/`falhou`. Com sinal, o `fazerCheckin` dispara o envio e, ~100 ms depois, o atendimento sai da rota (parada volta a "próxima"; RN-CORE-11 no aparelho deixa fazer outro check-in, que o servidor fecha como `nao_finalizado`). O mesmo na leitura de notificação (T-0019). Num "Sincronizar" completo fica escondido só porque, aqui, os pulls anteriores levam mais de 2 s | check-in online → `await motor.enviar()` → `armazem.carregar()` → a visita não está em `obter().visitas` (S1-042; S1-065 para a notificação) | packages/platform-sdk/src/motor-sync.ts (item aceito, ~l. 498); modules/core/app/lib/rota-local.ts `pendentesDaFila`; modules/core/app/lib/notificacoes.ts `montarCaixa`; corrida em acoes-visita.ts (`void motor.enviar()` antes de `armazem.carregar()`) | `pedido` R-20261031-210639-testes → engenheiro-software; cópia R-20261031-210710-testes → modulo-core. **Fechado na rodada 3**: motor com `estado.aceitos` + `motor.sobreposicao()` e API com `horizonte`/`em` (R-20261031-215653, ADR 0009 adendo §3); Core lendo a sobreposição (R-20261031-221100). S1-042 e S1-065 ✅ |
| D-4 | **"Sincronizar" do vendedor termina com erro na API real.** No modo v1 o shell passa todas as `etapasSync` (apps/mobile/src/state/plataforma.tsx:180); as do Vendedor (REST da Fase M: `GET /me`, `/discount-policy`, `/customers`, `/products`, `/orders`) dão 404 e não tratam 4xx → `sincronizar()` = false, erro "404 NAO_ENCONTRADO: Rota não encontrada." (as do Core, `/goals/me` e `/orders`, também dão 404 mas toleram) | aparelho com `etapas: [...etapasCore, ...etapasVendedor]` → `sincronizar()` (S1-043) | modules/vendedor/app/etapas.ts; alternativa no shell (plataforma.tsx:180) | `pedido` R-20261031-210744-testes → modulo-vendedor; cópia R-20261031-210746-testes → engenheiro-software. **Fechado na rodada 3**: `toleraSemRota` em modules/vendedor/app/etapas.ts (R-20261031-213012) só pula 404/501; S1-043 e S1-043c ✅ |
| D-5 | **Cargas da Fase M do Core engolem 401 e 423.** `ou4xxNulo` (`erroDeCliente`: status 400..499) nas etapas `metas` (`/goals/me`) e `pedidos-da-visita` (`/orders`): com a sessão vencida ou o aparelho bloqueado o "Sincronizar" termina "Pronto". Gravidade baixa: o 423 é tratado pelo `ApiClient` do shell (`aoErroHttp`, RN-CORE-15) mesmo assim, e o 401 passa pelo refresh antes de chegar à etapa | aparelho com `etapas: etapasCore`, HTTP das etapas respondendo 401 (`respostaEtapas` do helper) → `sincronizar()` = true (S1-043d) | modules/core/app/lib/cargas.ts (`ou4xxNulo`), modules/core/app/lib/http.ts (`erroDeCliente`) | `pedido` R-20261031-221226-testes → modulo-core |

#### Observações (para decisão, não são defeito)

- **O-6 — parâmetro do tenant sem tela.** Não há rota/BKO para editar `core.checkin.raio_m`; o S1-045 muda o valor no banco
  (como o ERP/BKO fará). Quando houver a tela, o e2e entra.
- **O-7 — fora do raio offline.** `pendentesDaFila` não leva `fora_do_raio` do comando à visita local: até o sync, a visita
  feita fora do raio aparece sem o sinal no aparelho (o servidor grava certo). Só registro para o core.
- As etapas do Core ainda chamam o REST da Fase M (`/goals/me`, `/orders`) e recebem 404 na API real (toleradas): metas e a
  ligação pedido × visita ficam vazias no modo v1 até a T-0020/Sprint 4.

#### Teste manual (aparelho real, APK de teste)

1. **Modo avião (critério 1):** login como vendedor-1 → Sincronizar → Rota de hoje (Auto Peças Um feito, Auto Peças Três
   pendente) → modo avião → Auto Peças Três → Check-in (aceitar a localização; aviso "cliente sem coordenada — vamos
   sugerir") → Checkout "sem pedido" com motivo → a parada fica "feita" → fechar e reabrir o app (continua feita) →
   desligar o modo avião → Sincronizar: tela de sync sem erro e fila vazia; no BKO (supervisor) → Visitas: a visita
   aparece uma vez; Coordenadas sugeridas (analista): Auto Peças Três com a posição do check-in.
2. **Fora do raio (critério 3):** a uns 500 m do cliente com coordenada → Check-in → aviso de distância e justificativa
   obrigatória (sem texto não avança) → com texto → BKO Visitas mostra "fora do raio" e a justificativa.
3. **Cliente fechado (critério 4):** Check-in → Checkout "cliente fechado" → "Loja fechada" → sem foto não conclui →
   tirar a foto da fachada → concluir → tela de sync "Fotos pendentes: 1" até enviar → BKO Visitas abre a foto.
4. **Um atendimento por vez:** com um atendimento aberto, tentar check-in em outro cliente → aviso de atendimento aberto.

---

## T-0019 — Central de notificações e recados ao usuário (RF-CORE-09)

### Rodada 1 (2026-10-31) — validação com o Postgres real

Arquivo: `tests/integracao/api/notificacoes.test.ts`, mesmo aparelho do Campo (motor real + `entidades-notificacao`) e a
caixa montada por `montarCaixa`/`contarNaoLidas` (as funções da tela). O recado nasce em `POST /v1/core/notificacoes`, a
mesma rota da página Recados do BKO.

| ID | Critério / cenário | Teste | Resultado |
|---|---|---|---|
| S1-060 | **Critério 1**: o supervisor envia um recado (alta prioridade, link `/m/rota`) ao vendedor-1 → antes do sync o aparelho não tem; no próximo sync ele aparece no topo da caixa, não lido, linha válida pelo `NotificacaoSyncSchema`, e o total de não lidas sobe 1; lido em modo avião → a caixa mostra lida na hora (leitura pendente) e o servidor ainda não sabe; na volta a leitura sobe com a hora do aparelho e `GET /v1/core/notificacoes` do vendedor mostra `lida_em` | "S1-060 ..." | ✅ |
| S1-060b | No sync seguinte a linha chega lida do servidor (sem depender da fila) | "S1-060b ..." | ✅ |
| S1-065 | Logo depois que a leitura é aceita, a caixa continua mostrando lida (o comando fica em `estado.aceitos`); depois do horizonte o pull traz `lida_em`, `aceitos` esvazia e a caixa segue lida pela linha | "S1-065 D-3 ..." | ✅ (rodada 3; era ❌ D-3) |
| S1-061 | **Critério 2 — escopo por usuário e tenant**: só o destinatário recebe; os aparelhos do promotor, vendedor-2, supervisor (quem enviou) e do vendedor de B só têm as próprias notificações (e B nenhum id de A); a caixa online do supervisor e do admin de B idem; ler a de outro usuário pelo push ou pelo BKO → `NOTIFICACAO_NAO_ENCONTRADA` (404), também do tenant B, e nada muda | "S1-061 ..." | ✅ |
| S1-062 | **Envio fora da equipe → 403**: supervisor → vendedor-2, → lista com um de fora, → equipe 2, → usuário de B, → inexistente, e admin de B → vendedor de A: 403 `FORA_DO_ESCOPO` sem nome no corpo e nada gravado (equipe de B: 4xx); vendedor, promotor e assistente → 403 `PERFIL_SEM_ACESSO`; sem token 401; gerente → equipe 2 e supervisor → equipe 1 gravam só os membros | "S1-062 ..." | ✅ |
| S1-063 | **Idempotência**: reenviar o mesmo envio 2× → `{ criadas: 0, ja_existentes: 2 }`, 2 notificações, 2 eventos `core.notificacao.criada@1` (sem título nem corpo: só `notificacao_id`, `usuario_id`, `tipo`, `prioridade`) e 1 auditoria; a mesma leitura reenviada e uma 2ª leitura mantêm a PRIMEIRA hora | "S1-063 ..." | ✅ |
| S1-064 | Token de push (`PUT /v1/core/dispositivos/atual/push`) só grava no aparelho da própria sessão; aparelho de outro usuário ou do tenant B → 404 sem alterar | "S1-064 ..." | ✅ |
| — | **Critério 3 — push real** (Expo Notifications) | depende do despachante (T-0022) e do build EAS (Alexandre) | pendente / manual |

#### Observações

- **O-8 — quem envia não vê a leitura.** O desenho §5.5 item 1 diz "o BKO vê `lida_em`", mas `GET notificacoes` e a
  página Recados mostram só a caixa do próprio usuário: o supervisor não tem como saber se o vendedor leu o recado.
  Decisão do gerente (aceitar como está na Sprint 1 ou pedir ao core uma visão "enviados").

#### Teste manual (depois do build EAS e da T-0022)

1. BKO (supervisor) → Recados → enviar ao vendedor-1 → no app, Sincronizar → card "1 não lida" no Início → abrir a
   notificação (o link abre a Rota) → modo avião → marcar lida → card zera → voltar o sinal → Sincronizar.
2. Push: com o app em segundo plano, enviar do BKO → chega a notificação do sistema; tocar abre o link.

---

## Pendências conhecidas da Sprint 1 (para fechar T-0017, T-0018 e T-0019)

1. ~~**D-3** e **D-4**~~ fechados na rodada 3. Aberto **D-5** (modulo-core, baixa gravidade: cargas do Core engolem 401/423).
2. **Push real** (T-0019 critério 3): depende do despachante de eventos (T-0022) e do build EAS com `expo-notifications`.
3. **Sem teste de interface do app e do BKO**: Rota, Check-in/Checkout com câmera, Notificações, Cliente 360 no app;
   Cliente 360 web, Carteira, Rotas, Visitas, Coordenadas sugeridas, Motivos, Recados e Aparelhos no BKO. O e2e Playwright do
   BKO entra quando as páginas estabilizarem; o app fica no roteiro manual (APK).
4. Roteiros manuais acima (aparelho real, GPS, câmera, modo avião).

### Comandos da rodada 2

Com o modulo-core (T-0020), o engenheiro (T-0022) e o banco-dados alterando código em paralelo:
`MACUXI_PG_EXIGIR=1 pnpm test:tests` ✅ **23 arquivos, 323 casos, 0 pulados** (eram 21/304; +2 arquivos
`visitas-campo` e `notificacoes`, +1 caso em `aparelho-bloqueado`; 3 casos `it.fails` dos defeitos D-3/D-4) ·
`pnpm lint:tests` ✅ · `pnpm typecheck:tests` ✅ · `node scripts/coord.mjs verificar testes` sem violação.
Na primeira execução da rodada o p95 do pull na carga leve (S0-110, tests/carga/fundacao.test.ts) deu 9,2 s contra o
limite de 8 s, com a máquina carregada pelos testes de outros agentes; nas execuções seguintes passou. Fica em
observação: se repetir com a máquina livre, vira defeito.

### Rodada 3 (2026-10-31) — fechamento de D-3 e D-4

- Helper `caixa` (notificacoes.test.ts) passa `ap.motor.sobreposicao(['notificacao_leitura'])` no lugar de `estado().fila`,
  como pediu o engenheiro (R-20261031-215653) e como a tela faz (`usar-notificacoes.ts`).
- Helper do aparelho (`tests/integracao/apoio/campo.ts`) ganhou `respostaEtapas`: o HTTP das etapas recebe o erro dado sem ir
  ao servidor. Premissa: as rotas REST da Fase M não existem na API real (404 do `setNotFoundHandler` antes de qualquer
  autenticação), então 401/403/423 nas etapas só se provocam assim; é o mesmo erro com `status` do `ApiClient`.
- S1-042 e S1-065 ficaram vermelhos como `it.fails` com as correções do engenheiro e do core e viraram `it`; S1-043
  ficou verde com a correção do Vendedor e virou `it`. Novos: S1-043c (✅) e S1-043d (D-5, `it.fails`).
- Comandos: `MACUXI_PG_EXIGIR=1 pnpm test:tests` ✅ **23 arquivos, 325 casos, 0 pulados** (eram 323; +S1-043c e S1-043d;
  1 caso `it.fails`, o S1-043d do D-5) · `pnpm lint:tests` ✅ · `pnpm typecheck:tests` ✅ ·
  `node scripts/coord.mjs verificar testes` sem violação. Core, engenheiro e banco seguiam alterando código em paralelo.
