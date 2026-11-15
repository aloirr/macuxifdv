# Módulos e dependências

| Módulo | Depende | Opcionais | Apps | Perfis |
|---|---|---|---|---|
| core | — | — | campo, gestao, web | todos |
| catalogo | core | — | campo, gestao, web | vendedor, promotor, supervisor, gerente, analista, assistente, admin (o Vendedor depende dele; ADR 0005; admin cadastra conteúdo — RN-CAT-04) |
| vendedor | core, catalogo | — | campo, gestao (T-0029), web | vendedor, supervisor, gerente, analista, assistente, admin (alvo T-0029 §7; hoje no manifesto: vendedor, analista, assistente). Promotor nunca (RN-PRO-01) |
| promotor | core | catalogo, pesquisa, vendedor | campo, gestao, web | promotor, supervisor, gerente, analista, admin (cadastros de trade, T-0010) |
| gestor | core | vendedor, promotor, pesquisa, treinamento | gestao, web | supervisor, gerente |
| pesquisa | core | — | campo, gestao, web | vendedor, promotor, supervisor, gerente, analista, admin |
| treinamento | core | vendedor | campo, gestao, web | vendedor, promotor, supervisor, gerente, analista, admin |
| integracao | core | — | web, conector | admin, analista |

> Fonte da verdade: `modules/<m>/manifest.ts`. Espelho com teste de consistência: `packages/platform-sdk/src/manifestos-referencia.test.ts`.
> ADR 0005 (T-0007): o cadastro base de produto é do Core; o Catálogo é dono de preço, estoque, conteúdo e busca. O Vendedor
> **depende** do Catálogo: desativar o Catálogo desativa o Vendedor (RN-CORE-03; teste `tests/modulos/produto-dono.test.ts`).
> Ordem de instalação nos shells: core → catalogo → vendedor (`ordenarPorDependencia`).
> Nomes de ação são GLOBAIS (um nome, um dono): prefixe com a entidade do módulo (ex.: Gestor `ranking_equipe.ver`, Treinamento
> `ranking.ver`). Catálogo (T-0021): `produto.consultar` e `produto.perguntar` (todos), `produto.ver_preco_estoque` (todos menos o
> promotor; o domínio libera o promotor com `promotor_ve_preco_estoque`, RN-CAT-05), `produto.enriquecer`, `sinonimo.gerenciar`,
> `destaque.gerenciar`, `busca.ver_sem_resultado` (analista e admin, RN-CAT-04).

## Consultas entre módulos (ADR 0012)

Leitura síncrona com contrato versionado no `contracts` do dono (`definirConsulta`), oferecida em `ofereceConsultas` e usada por
quem a lista em `usaConsultas` (dono em `depende` ou `opcionais`). Na API: `tx.consultar(def, entrada)` dentro do `comTenant` de
quem consulta (mesma transação e RLS) ou `ctx.consultar(def, entrada)` no consumidor de evento (T-0060: transação do consumo,
usuário de sistema `USUARIO_SISTEMA_ID` com perfil admin e os módulos efetivos do tenant); no aparelho: `ambiente.consultar(def, entrada)` sobre as linhas locais do dono e dos módulos de `depende` dele (só leitura; `ctx.linhas`, `linhasPorIds`, `linhasPorCampo` e `versaoLinhas`; T-0084, complemento da ADR 0012; fora disso = erro de programação, dependência inativa = `ConsultaIndisponivel`). Dono inativo
ou sem implementação no canal → `ConsultaIndisponivel` (503 `CONSULTA_INDISPONIVEL` se ninguém tratar). Mudança incompatível = `@vN+1`.
A montagem (`defineModule`, `definirModuloApi`, `validarConjunto`, `criarShell`) recusa o que estiver fora destas regras.

**Consulta opcional sem aresta (ADR 0019)**: `usaConsultasOpcionais` no manifesto do consumidor, com o dono FORA de `depende`/`opcionais`
(não entra em `ordenarPorDependencia`, então não fecha ciclo). Dono ausente, inativo ou sem implementação → `ConsultaIndisponivel`;
o consumidor sempre tem plano B. Dono em `depende` → use `usaConsultas`.

**Licença do tenant (ADR 0025)**: `tx.consultar(def, entrada, { licenca: 'tenant' })` decide o dono pelos módulos efetivos do TENANT, não
pelos de quem consulta; o usuário, o escopo, o tenant e a RLS são os mesmos (sem elevação). Só em leitura agregada de indicador com fonte
decidida pela licença do tenant (RN-CORE-27: Início, painel de metas, RV, Farol); em rota de escrita = erro de programação.

| Consulta | Dono | API | Aparelho | Usada por | Situação |
|---|---|---|---|---|---|
| `catalogo.precos_cliente@1` | catalogo | sim | sim (linhas de preço locais, `precoVisivel`, RN-CAT-06) | vendedor | aprovada (T-0029), implementação na onda 2. **T-0071 (aditivo, mesma versão)**: item ganha `embalagens?: {unidade, preco_cents}[]` (preço próprio por medida, `tabela_preco_item.unidade` não nula vigente em `em`; ausente = UN × fator, RN-VEN-15); `preco_cents` passa a vir só da linha sem unidade (correção RN-VEN-15). Schema não strict; teste do consumidor antigo em `modules/catalogo/domain/precos-cliente.test.ts`. **T-0061 (aditivo, mesma versão, revisado 2026-11-05)**: saída ganha `tabela_preco_nome?: string \| null` (nome de `catalogo.tabela_preco`); só sai junto com `tabela_preco_id` não nulo (perfil vê preço e cliente tem tabela ativa); ausente para promotor sem `promotor_ve_preco_estoque` (RN-CAT-05) e para cliente sem tabela. Consumidor deve tratar ausente como "sem nome" (`priceTableLabel` do Vendedor) |
| `catalogo.sugestoes_pedido@1` | catalogo | sim (`api/sugestoes.ts`) | sim (`app/sugestoes.ts`: `produto_relacao`, `cliente_tabela_preco`, `tabela_preco`, `tabela_preco_item`, `estoque_saldo` locais) | vendedor (aba Detalhes do novo pedido; declarada em `usaConsultas` no 6a66f32, espelho em `manifestos-referencia.test.ts` em 2026-11-04) | T-0071 (desenho §4.2). Entrada `{cliente_id, produto_ids[1..200], em (ISO), limite 1..5 = 5}` strict; saída `{complementares[≤5], superiores[≤5]}` de `{produto_id, tipo: complementar\|superior, origem_produto_id, preco_cents}`. Mesmo domain (`sugestoesDoPedido`) nos dois canais; perfil sem preço (RN-CAT-05) = vazia; sem preço (RN-CAT-06) ou saldo ≤ 0 (RN-CAT-07) não sai. Na API depende da 0020 |
| `catalogo.textos_produto@1` | catalogo | sim | sim (`produto_conteudo` local; referências vazias no aparelho até o retrato `marca_nome` da ADR 0027) | vendedor (lista do seletor, item, retrato RN-VEN-19 e PDFs) | **T-0084/T-0085, desenho** ([T-0084 C8](../../docs/desenho/T-0084.md), [T-0085 K13](../../docs/desenho/T-0085.md)). Entrada `{produto_ids[1..500]}` strict; saída `{itens: [{produto_id, aplicacao: string | null, referencias: [{marca_id, marca_nome, codigo}] ≤ 3}]}`; marca inativa fica de fora. Promotor recebe (ficha é dele; RN-CAT-05 só esconde preço/estoque) |
| `catalogo.busca_produtos@1` | catalogo | sim | sim (FTS5 + `rankear` locais) | vendedor (busca do seletor do Novo pedido; plano B = `searchProducts`) | **T-0084, desenho** (C9). Entrada `{q 1..200, produto_ids? ≤ 5000, limite 1..200 = 100}`; saída `{itens: [{produto_id, nota, so_aplicacao, serve_em: TrechoBusca | null, equivale_a: EquivaleA | null}]}` na ordem do ranking; sem preço |
| `core.cadastro_resumo@1` | core | sim | não (o Vendedor lê `cliente`/`produto` locais com os tipos de `@macuxi/core/contracts`) | vendedor, catalogo (consumidores de preço/estoque do ERP, T-0066) | implementada; `produto_external_ids` opcional (padrão []) acrescentado em 2026-11-02 (d5ba7f2), compatível, mesma versão (ADR 0012). **T-0071 (aditivo, mesma versão)**: produto ganha `preco_venda_cents?` (int ≥ 0, null = sem preço) e `desconto_maximo_pct?` (0–100, EFETIVO: próprio ?? parâmetro `core.desconto_maximo_produto_pct` do tenant ?? 15; RN-VEN-11), para o preço mínimo no `receber` do Vendedor (consumo ainda pendente: C6 da T-0071 em `it.fails`); emissor antigo sem os campos continua válido (`modules/core/api/consultas-bloqueado.test.ts`). O cliente já trazia `bloqueado` (RN-VEN-13), agora usado no `receber.ts` · **T-0120/T-0115 (aditivo, mesma versão, 2026-11-09, aviso R-20261109-010120)**: entrada ganha `cliente_external_ids?` (padrão []); saída `clientes[].canal?` (ausente = sem canal); `ClienteSyncSchema.canal?` no pull. O canal depende da migração do banco-dados e do `ClientePayload.canal` da Integração; consumidor antigo ignora o campo |
| `promotor.concorrentes@1` | promotor | sim (`modules/promotor/api/consultas.ts`, SQL em `promotor.concorrente` na transação de quem consulta; registrada com ou sem repositório) | não (o aparelho não lê `concorrente`: o nome vai no retrato `produto_referencia.marca_nome`, 0034, ADR 0027) | catalogo em `usaConsultasOpcionais` (ADR 0019): `MARCAS_DO_PROMOTOR` (marcas-concorrentes, exportação, enriquecer), PUT `cadastro-catalogo` (422 RN-CAT-09) e consumidor do produto do ERP (`ctx.consultar`, licença do tenant) | **publicada (T-0085, ADR 0027; revisão 2026-11-06)**. Entrada `{ids?: UUID[] ≤ 500, busca?: trecho do nome ≤ 120 (ilike, curingas escapados), incluir_inativos = false}` strict; saída `{concorrentes: [{id, nome, ativo, external_id}]}` por `lower(nome), id`, no máximo 2000 linhas; apagados nunca saem; id inexistente some (não é erro). Responde só a quem tem o Promotor efetivo (ADR 0012): o vendedor recebe `ConsultaIndisponivel`, por isso o Catálogo grava o retrato `marca_nome` (risco 2 da ADR 0027). Nenhum contrato de marca concorrente no Core · **T-0113 (ADR 0034): DEPRECADA** — o Catálogo deixa de chamá-la no lote da T-0113; até a fase 2 o Promotor a mantém registrada respondendo sempre `ConsultaIndisponivel` (aponta `catalogo.marcas@1`; sem delegação, ADR 0034 §5 revista em 08/11); remoção não antes de 2026-12-08 (sem pull de `concorrente` há 7 dias e todo APK em uso posterior ao lote) |
| `catalogo.marcas@1` | catalogo | sim (SQL em `catalogo.marca_concorrente` na transação de quem consulta) | **ainda não** (a entidade `marca_concorrente` já sincroniza; a consulta local sobre ela fica pendente para quando a 1ª tela do app precisar, T-0113 K5) | promotor em `usaConsultas` (Catálogo já em `opcionais`): validar `concorrente_id` do produto do concorrente, seletor e nomes do BKO de trade, telas de concorrente do app | **implementada T-0113 (ADR 0034 §2; lote de 08/11)**, `modules/catalogo/api/consulta-marcas.ts`. Entrada `{ids?: UUID[] ≤ 500, busca?: trecho do nome ≤ 120 (ilike, curingas escapados), incluir_inativas = false}` strict; saída `{marcas: [{id, nome, ativo, external_id}]}` por `lower(nome), id`, no máximo 2000; apagadas nunca saem; id inexistente some. Responde a quem tem o Catálogo efetivo (os 7 perfis). Substitui `promotor.concorrentes@1` |
| `core.cadastro_cliente@1` | core | sim | não | integracao (consumidor A7 de `integracao.lote.recebido@1`, aviso `cadastro_incompleto`, RN-INT-14) | implementada (T-0060); `ctx.consultar` no consumidor (SDK, 2026-11-02) |
| `core.medidas@1` | core | sim | não (o app lê a entidade `medida` do pull) | integracao (A7: sigla não cadastrada ou inativa = `referencia_ausente`, RN-CORE-19; `usaConsultas` em `modules/integracao/manifest.ts:37`) | **implementada (T-0063, `70b69992`; idempotência `1ef97f04`)**: contrato `CONSULTA_MEDIDAS` em `modules/core/contracts/consultas.ts:138`, implementação `consultaMedidas` em `modules/core/api/medidas.ts:183`, `ofereceConsultas` do Core. Desenho original: T-0061 §4.1 (2026-11-02). Conferência T-0110 N7 / T-0122 (2026-11-09) |
| `pesquisa.etapas_checkout@1` | pesquisa | sim | não (o Campo usa a extensão `visita.etapas_checkout`) | core (`visita_checkout`, baixa por `pesquisa.resposta.registrada@1` e alerta, T-0039 §2) em `usaConsultasOpcionais` (ADR 0019); sem a Pesquisa = sem etapa | ligada no Core em 2026-11-05 (`modules/core/api/etapas-checkout.ts`) |
| `vendedor.pedidos_da_meta@1` | vendedor | sim | não | core (painel de metas, RN-CORE-21) em `usaConsultasOpcionais` (ADR 0019); sem o Vendedor, cai no `indicador_diario` | oferecida pelo Vendedor; Core religa pelo campo novo (2026-11-03) |

## T-0089 (desenho 06/11): pagamento por forma e prazo, escalonada e crédito no Novo pedido

Tudo aditivo na mesma versão. Detalhes em `docs/desenho/T-0089.md`.

**Consultas:**

| Consulta | Dono | API | Aparelho | Usada por | Situação |
|---|---|---|---|---|---|
| `core.financeiro_cliente@1` (nova; era a "próxima prevista" abaixo) | core | sim (RN-VEN-13 no receber) | sim (linhas locais `cliente_financeiro` e `titulo`, `resumoFinanceiro`) | vendedor (`usaConsultas`) | implementada no Core em 06/11 (C1/C2: `modules/core/api/consultas.ts` e `modules/core/app/consultas.ts`); espelho atualizado. Ação nova do Core: `cliente.pagamento_editar` (analista, admin), `PUT /v1/core/clientes/:id/pagamento`, auditada; o Core lista `vendedor.formas_pagamento@1` em `usaConsultasOpcionais` |
| `vendedor.formas_pagamento@1` (nova) | vendedor | sim (`modules/vendedor/api/formas-pagamento.ts`) | não | core (`usaConsultasOpcionais`, ADR 0019; ficha do cliente no BKO) | **implementada em 06/11** (V1/V3). Entrada `{}` strict; saída `{formas: [{codigo, nome, ativo}] ≤ 200}` por `ordem, codigo`, sem as apagadas. Vendedor ausente = `ConsultaIndisponivel` (a ficha esconde as formas) |
| `catalogo.precos_cliente@1` | catalogo | sim | sim | vendedor | **aditivo:** o item ganha `faixas?: { medida \| null, quantidade_minima, preco_unidade_cents }[]` (vigentes em `em`, a faixa da tabela do cliente vence a geral, sem faixas quando o preço não é visível pela RN-CAT-05). `embalagens` deixa de ser preenchido (RN-VEN-15 nova) |
| `core.cadastro_resumo@1` | core | sim | não | vendedor, catalogo | **aditivo:** o cliente ganha `prazo_medio_max_dias?: int \| null` e `formas_pagamento?: string[] \| null` |
| `core.calendario_metas@1` (nova, T-0124, 08/11) | core | sim (`modules/core/api/consultas.ts`; lida de `ctx.parametros()` com `calendarioDoTenant`, `configuracaoDoTenant: true`) | não | gestor (`usaConsultas`, `carregarContexto` em `api/rotas.ts`, licença do tenant; substitui a chave `dias_uteis_semana` dos parâmetros do Gestor) | **implementada (v1.0.1)**, `modules/core/contracts/inicio-parametros.ts`. Entrada `{}` strict; saída `{ dias_uteis_semana, feriados: [] }` (RN-CORE-26: semana do tenant; os nacionais de `@macuxi/comum` contam junto com os do tenant em `diasUteisDoPeriodo`/`ehDiaUtilDoTenant`). Doc `docs/modulos/core/calendario-metas.md`; teste `api/consultas.calendario.test.ts` |
| `core.cadastro_resumo@1` (T-0119, 08/11) | core | sim | não | catalogo (busca) | **aditivo, mesma versão (ADR 0012):** o produto ganha `marca?`, `categoria?` e `ean?` (string, nullable, opcionais; select de `core.produto`). Emissor antigo sem os campos continua válido. `modules/core/contracts/consultas.ts`, `api/consultas.ts`; testes `contracts/cadastro.test.ts` e `api/consultas-bloqueado.test.ts` (R-20261108-144846) |

**Entidades de sync:**

| Entidade | Dono | Direção e escopo | O que entra |
|---|---|---|---|
| `forma_pagamento` (nova) | vendedor | pull, tenant, servidor vence | `codigo`, `nome`, `ativo`, `ordem` |
| `prazo_pagamento` (nova) | vendedor | pull, tenant, servidor vence | `forma_pagamento_id`, `codigo` (único no tenant), `descricao`, `parcelas_dias int[]`, `prazo_medio_dias` (média arredondada para cima), `ativo`, `ordem` |
| `tabela_escalonada` (nova) | catalogo | pull, tenant, servidor vence | `produto_id`, `medida \| null`, `quantidade_minima`, `preco_unidade_cents` (unidade base), vigência, `tabela_preco_id \| null`, `ativo` |
| `cliente` | core | pull, carteira | `prazo_medio_max_dias?`, `formas_pagamento?` (códigos; nulo ou vazio = todas) |
| `PedidoPush`, `PedidoSyncSchema`, `Order` | vendedor | push e pull | `forma_pagamento_id?` e `prazo_pagamento_id?` (os dois juntos) e o retrato (`forma_pagamento_nome`, `prazo_descricao`, `prazo_parcelas_dias`, `prazo_medio_dias`). Recusas novas: `RN-VEN-24` e `RN-VEN-25`. Sem os dois, vale o caminho legado da `condicao_pagamento` (APK antigo) |
| `condicao_pagamento` e `cliente_condicao` | vendedor | pull | **legado**: só para leitura, para o APK antigo; saem numa limpeza futura, com ADR |

**Manifestos (espelho `packages/platform-sdk/src/manifestos-referencia.test.ts` em dia em 06/11):**
- `vendedor` v0.5.0: `sync += forma_pagamento, prazo_pagamento`; `consome += integracao.forma_pagamento.atualizado@1, integracao.prazo_pagamento.atualizado@1` (`api/formas-erp.ts`, adota a `AVISTA` semeada pelo código, P7); `ofereceConsultas += vendedor.formas_pagamento@1`; `usaConsultas += core.financeiro_cliente@1`; ações `forma_pagamento.ver` e `forma_pagamento.gerenciar` (admin, analista, gerente; promotor nunca, regra 7); menu web `Formas de pagamento e prazos`. Rotas `GET /v1/vendedor/formas-pagamento`, `PUT /v1/vendedor/formas-pagamento/:id` e `PUT /v1/vendedor/prazos-pagamento/:id` (idempotentes pelo `id`, auditadas).
- `core`: `ofereceConsultas += core.financeiro_cliente@1`; `usaConsultasOpcionais += vendedor.formas_pagamento@1`; ação `cliente.pagamento_editar`.
- `catalogo`: `sync += tabela_escalonada`; `consome += integracao.tabela_escalonada.atualizado@1`; ação `tabela_preco.gerenciar` (analista, admin); menu web `Tabelas de preço` (grupo cadastros). Rotas `GET /v1/catalogo/tabelas-preco`, `GET /v1/catalogo/tabelas-preco/:id/precos` (só o preço da UN), `GET /v1/catalogo/escalonada`, `PUT` e `DELETE /v1/catalogo/escalonada/:id` (idempotentes pelo `id`, auditadas; faixa do ERP = 409 `FAIXA_DO_ERP`, chave repetida = 409 `FAIXA_EM_CONFLITO`, regra = 422 `RN-VEN-23`). Preço do ERP com `unidade` diferente da base: aviso no log e a linha deixa de valer (RN-VEN-15 nova). Revisado em 06/11 (espelho em dia).
- `integracao` v0.7.0: `publica += integracao.forma_pagamento|prazo_pagamento|tabela_escalonada.atualizado@1`.
- RN-VEN-13 no `receber`: título vencido há mais de `titulo_vencido_dias` [5] com prazo médio > 0 → aprovação no nível supervisor com o motivo `credito` (o texto diz "título vencido"; nenhum motivo novo na coluna `motivos_aprovacao`). Decisão do engenheiro-software em 06/11.

**Hub v1:**
- O `ENTIDADES` ganha `forma_pagamento`, `prazo_pagamento` e `tabela_escalonada` (eventos em `eventos.md`).
- O `ClientePayload` ganha `prazo_medio_max_dias` e `formas_pagamento`.
- O `PedidoParaErp` e o `PedidoAprovadoParaFila` ganham `pagamento?`.

## Entidades de sync e campos aditivos (T-0071)

Mudança só aditiva no @1: o aparelho não valida a linha do pull com `schemaLinha` em tempo de execução (só o teste do provedor), então
o APK instalado ignora colunas novas. Schema `.strict()` (Vendedor): campos e provedor no MESMO PR.

| Entidade / contrato | Dono | Direção · escopo | O que entra | Situação |
|---|---|---|---|---|
| `produto_conteudo` (`ProdutoConteudoSyncSchema`) | catalogo | pull · tenant · servidor vence | **T-0084/T-0085 (aditivo, desenho)**: `aplicacao?: string ≤ 2000 \| null` (coluna `aplicacoes`), `etiquetas?: string[] ≤ 4` | desenho 05/11 |
| `produto_referencia` (`ProdutoReferenciaSyncSchema`) | catalogo | pull · tenant · servidor vence | **T-0085 (nova)**: `produto_id`, `marca_id` (id do `concorrente` do Promotor, sem FK; ADR 0027), `codigo` 1..30, `ordem` 1..3 (o compacto é recalculado no aparelho). Próximo lote: `marca_nome` (retrato, aditivo) | 0033 + lote AB (05/11) · **T-0113 (ADR 0034)**: `marca_id` passa a ser id de `catalogo.marca_concorrente` (mesmos ids, com FK no mesmo schema); referência de marca inativa ou apagada vai como lápide e volta ao reativar; renomear a marca atualiza `marca_nome` na mesma transação |
| `marca_concorrente` (`MarcaConcorrenteSyncSchema`) | catalogo | pull · tenant · servidor vence | **implementada T-0113 (ADR 0034; lote de 08/11)**: `id`, `nome`, `ativo`, `external_id` + colunas de sync (`modules/catalogo/api/sync.ts`, em `ENTIDADES_CONTEUDO`); base da consulta `catalogo.marcas@1` no aparelho. A entidade `concorrente` do Promotor fica como legado (página vazia) até a fase 2 | — |
| `ItemPush` / `PedidoItemSyncSchema` | vendedor | push / pull | **T-0084 (aditivo, desenho)**: `aplicacao?: string ≤ 1000 \| null` (retrato RN-VEN-19; ausente = null; a API recorta com `retratoAplicacao`) | desenho 05/11 |
| `produto_relacao` (`entidadeProdutoRelacao`, `ProdutoRelacaoSyncSchema`) | catalogo | pull · tenant · servidor vence | nova: `produto_id`, `relacionado_id`, `tipo` ∈ `TIPOS_RELACAO_PRODUTO` (`complementar`, `superior`, `substituto`), `ordem`, `ativo` + base. Tabela `catalogo.produto_relacao` (0020), sem FK para `core.produto` | T-0071; o provedor exige a 0020 no banco (o `/v1/sync/novidades` chama todos os provedores). Origem: base demo; entidade canônica no Hub e edição no BKO na fila de corte |
| `ItemPush` (`vendedor/contracts/frete.ts`) | vendedor | push | `desconto_unitario_cents?`, `acrescimo_unitario_cents?`: R$ por unidade da MEDIDA VENDIDA; no máximo um dos quatro ajustes do item > 0 (`ajuste_invalido`). `ajuste_em?: pct\|valor` (6084c1b): só memória do que foi digitado; o servidor deriva o modo do campo preenchido e grava o dele; ausente = legado em % | T-0071, aditivo (schema não strict; mesma versão, revisão de 04/11) |
| `PedidoPush` | vendedor | push | `desconto_valor_cents?`, `acrescimo_valor_cents?` (R$ sobre o total dos itens, rateio pelo maior resto; exclusivos com `discount_pct`/`acrescimo_pct`), `ajuste_em?: pct\|valor` | T-0071, aditivo |
| `PedidoSyncSchema` / `PedidoItemSyncSchema` | vendedor | pull | pedido: `validade_data`, `desconto_valor_cents`, `acrescimo_valor_cents`, `ajuste_em`; item: `desconto_unitario_cents`, `acrescimo_unitario_cents`, `ajuste_em` (todos `.nullable().optional()`) | T-0071; o provedor passa a mandar na fatia 5 (0020) |
| REST `Order`/`OrderItem`/`OrderListQuery` | vendedor | API `/v1/vendedor` | `Order`: `validade_data`, `order_adjust_mode`, `order_discount_value_cents`, `order_surcharge_value_cents`; `OrderItem`: `unit_discount_cents`, `unit_surcharge_cents`, `adjust_mode`; `OrderListQuery`: `tipo` (ausente = só pedidos), `situacao` | T-0071, aditivo |
| `EditarOrcamentoRequest` + `PUT /v1/vendedor/orcamentos/:id` | vendedor | API | novo, strict, `atualizado_em` (concorrência otimista → 409 `ORCAMENTO_ALTERADO`); ação `pedido.criar` (promotor 403, RN-PRO-01) | T-0071; rota na fatia 5 |
| `CODIGOS_RECUSA_PEDIDO` | vendedor | push/API | + `RN-VEN-18`, `ajuste_invalido`, `ORCAMENTO_ALTERADO` (`RN-VEN-32` continua para o APK instalado) | T-0071, aditivo |

Eventos: nenhum novo e nenhuma versão nova (orçamento não publica `vendedor.pedido.*`; desenho T-0071 §2.1).

> Próxima prevista: `core.financeiro_cliente@1` (crédito e títulos, RN-VEN-12/13). Espelho com teste:
> `packages/platform-sdk/src/manifestos-referencia.test.ts` (estado-alvo da T-0029).

## Leituras do motor de sync no aparelho (SDK, aditivo, T-0052-B4)

Contrato do `MotorSync` (`@macuxi/platform-sdk`) para os módulos no app. Só acréscimos; nada existente mudou. ADR 0003, adendo de 2026-11-05.

| Função | O que devolve | Observações |
|---|---|---|
| `motor.linhasPorIds(e, ids)` | linhas pelos ids, na ordem pedida | já existia (T-0008 P1) |
| `motor.linhasPorCampo(e, campo, valores)` | linhas com `<campo>` (1º nível) ∈ `valores` | texto ou número, tipo estrito, sem ordem; rápido no SQLite só com índice `<m>__*` em `json_extract(dados, '$.<campo>')` sobre `ent_<e>` do próprio módulo |
| `motor.contarLinhas(e)` | quantidade de linhas locais | sem ler as linhas |
| `motor.versaoLinhas(e)` | número opaco (compare com `===`) | muda a cada gravação do pull na entidade e quando o motor apaga linhas; leia ANTES das linhas; não inclui a fila |
| `LinhasSync.porCampo?` | extensão opcional do armazenamento | SQLite implementa; sem ela o motor filtra `listar` em JS |
| `motor.buscarComDesfecho(indice, consulta)` (T-0052, 2026-11-05) | `DesfechoBusca`: `{ buscou: true, resultados }` ou `{ buscou: false, motivo }` | Separa "busquei e não achei" (`buscou: true`, `resultados: []`) de "não consegui buscar". `MotivoSemBusca`: `consulta_vazia` (vazia, só símbolos, 1 letra no prefixo), `modulo_indisponivel`, `indice_invalido`, `erro_busca` (FTS recusou), `sem_busca` (armazenamento sem `busca`), `indeterminado` (busca de fora do SDK só com `buscar` e lista vazia). Só `buscou: true` autoriza concluir "nenhum resultado"; `buscou: false` = caminho de reserva (varredura). `resultados` = mesmo conteúdo e ordem de `motor.buscar` |
| `BuscaTextoSync.buscarComDesfecho?` | extensão opcional da `busca` do armazenamento | SQLite (`BuscaSqlite`, obrigatória) e `comBuscaEmJs` implementam. `buscar`/`motor.buscar` NÃO mudaram (`[]` nos dois casos; `null` sem a capacidade). Testes: `packages/platform-sdk/src/busca.test.ts` (desfecho nos 3 armazenamentos + falhas do SQLite) |
| `ContextoConsultaAparelho.buscarComDesfecho(indice, consulta)` (T-0084, 2026-11-06) | `DesfechoBusca`, o mesmo do `motor.buscarComDesfecho` | Só nos índices do **próprio** módulo dono da consulta (`<dono>.*`); índice de outro módulo, inclusive de `depende` = `Error` (programação). Até `consulta.limite` (padrão 200, teto 500). `FontesConsultaAparelho.buscarComDesfecho?` ausente = `{ buscou: false, motivo: 'sem_busca' }`: o módulo varre como a aba. Testes: `packages/platform-sdk/src/consultas-busca.test.ts` |
| `IndiceBusca.versaoDocumentos?(ctx)` e `documento(chave, ler, ctx?)` (T-0084, 2026-11-06) | versão opaca (`string`) calculada só de `ctx = { agora, fuso }` | Versão diferente da guardada (virada de ano no fuso do tenant, formato novo do documento) = o SQLite marca o índice e o reindexa das linhas locais **em segundo plano**: a busca responde com os documentos antigos; o fim do sync espera. App atualizado com índice cheio e sem versão = reindexa uma vez. A marca do L-1 (índice vazio) continua bloqueando a busca. `BuscaTextoSync.conferirVersoes?({ fuso })` é chamado pelo motor antes de cada busca, de cada pull de entidade e do `finalizar`; nunca lança. O SDK sempre passa o `ctx` ao `documento` (opcional só para testes diretos). Testes: `consultas-busca.test.ts` (virada de ano no fuso, segundo plano, app atualizado, marca L-1, motor, busca em JS) |

## Fila do aparelho: memória segue o disco (SDK, D-T0039d, 2026-11-05)

Comportamento do `MotorSync` para quem enfileira (assinaturas sem mudança). Testes: `packages/platform-sdk/src/motor-sync.gravacao.test.ts` (3 armazenamentos).

| Função | Comportamento |
|---|---|
| `enfileirar`, `alterar`, `descartar`, `enfileirarArquivo`, `descartarArquivo`, `aplicarModulosAtivos` | Gravam no disco ANTES de mudar `estado()`/ouvintes. Falha de gravação (disco cheio) = a promessa rejeita e memória e disco ficam como estavam (sem item "fantasma"). Quem chama trata o erro (ex.: `tentarCheckin` do Core). |
| Ordem e concorrência | As mudanças da fila rodam uma por vez, cada uma sobre o estado da sua vez: chamadas simultâneas mantêm a ordem de chamada (FIFO) e o mesmo UUID entra uma vez só. A rede do push fica FORA da vez (não trava `enfileirar`); `confirmarLimpeza` e `limparAparelho` seguram a vez enquanto apagam. |
| `alterar` com o push em voo | O servidor recebe a versão anterior; a versão alterada fica `pendente` na fila e vai no próximo push (upsert idempotente pelo mesmo id). `descartar` com o push em voo: o servidor já recebeu; o item não volta à sobreposição. |

## API pública do Hub (Conector → `/integracao/v1/*`), campos aditivos

| Contrato | Dono | Campo | Compatibilidade | Situação |
|---|---|---|---|---|
| `SinalConector` (`POST /integracao/v1/sinal`, `modules/integracao/contracts/conector.ts`) | integracao | `atualizacao?: AtualizacaoConector \| null` = `{resultado: 'atualizado'\|'mantido'\|'revertido', codigo?: string ≤ 40, versao_de?: string ≤ 40, versao_para?: string ≤ 40, em: DataHoraUtc, mensagem: string 1..300}` (resultado da atualização automática do Conector, T-0116/T-0100 item 3) | aditivo, mesma versão: o schema do Hub é `z.object` não estrito (Hub antigo descarta o campo); Conector antigo não envia = "Sem informação" no monitor. Sinal sem o campo = sem atualização (não preserva a anterior; o Conector reenvia o último resultado relevante em todo sinal). Persistência em `integracao.conector.sinal_resumo.atualizacao` (jsonb existente, sem migração). `mensagem` sem URL, caminho, usuário nem exceção crua | **aprovado** pelo engenheiro-software em 2026-11-09 (R-20261109-002930); OpenAPI do Hub regerado pelo modulo-integracao no mesmo lote |

## T-0168 (12/11, desenho `docs/desenho/T-0168.md`): limite de desconto do usuário (RN-VEN-11a), tudo aditivo

| Contrato | Dono | O que entra | Compatibilidade |
|---|---|---|---|
| `LimiteDescontoSchema`, `LIMITE_DESCONTO_PADRAO` (`modules/core/contracts/usuarios.ts`) | core | `desconto_limita_item` (padrão true), `desconto_limita_pedido` (padrão false), `desconto_maximo_pedido_permil` (int 0..1000, ‰; null) | novo; usuários BKO: item obrigatório, criar com padrão, editar opcional |
| entidade de sync `usuario` (`UsuarioSyncSchema`) | core | pull · escopo `usuarios` · servidor vence; só os 3 campos + base | nova; APK antigo não pede |
| `core.cadastro_resumo@1` | core | `usuarios[]` ganha os 3 campos opcionais | aditivo, mesma versão; ausente = padrão |
| `CODIGOS_RECUSA_PEDIDO` | vendedor | `desconto_pedido_acima_limite` (422) | aditivo |
| `permilDoDescontoExibido`, `pedidoAcimaDoLimite`, `mensagemPedidoAcimaDoLimite` (`modules/vendedor/domain/limite-desconto.ts`; v2 em 13/11, R-20261112-183709 item 5) | vendedor | **trava pelo valor exibido**: o ‰ da linha "Desconto (%)" dos Totais (`pctExibicao(total_tabela − total, total_tabela)`, 1 casa, metade para cima, em inteiro) > limite ‰. 8,04% (exibe 8,0%) não trava num limite de 8,0%; 8,05% (exibe 8,1%) trava. A alçada (RN-VEN-10) segue pelo nominal exato. Frase única: "Pedido acima do desconto máximo (8,0%)" (RD-0196), sem autor | interno ao Vendedor (app e API usam a mesma função); sem mudança de payload, do código de recusa nem de versão |

## T-0170 (13/11, desenho `docs/desenho/tarefas-consultor.md`): consultas da tarefa de pesquisa (ADR 0012 / ADR 0019)

| Consulta | Dono | API | Aparelho | Usada por | Situação |
|---|---|---|---|---|---|
| `pesquisa.questionarios_para_tarefa@1` | pesquisa | sim (`modules/pesquisa/api/consulta-questionarios-para-tarefa.ts`, lê só o schema da Pesquisa pelo repositório, RLS do tenant; regra em `domain/tarefa-pesquisa.ts`) | não | core: `GET /v1/core/tarefas/questionarios` e `POST /v1/core/tarefas` do tipo `pesquisa` (`modules/core/api/tarefas.ts`), em `usaConsultasOpcionais` (sem a Pesquisa = lista vazia e tipo `pesquisa` indisponível) | **implementada (T-0170)**, contrato `CONSULTA_QUESTIONARIOS_PARA_TAREFA` em `modules/pesquisa/contracts/consulta-tarefa.ts`. Entrada `{ usuario_ids: UUID[1..500] }` strict; saída `[{ questionario_id, titulo, vigente_ate (nulo), fora_do_publico: UUID[] }]` strict. Sem a licença da Pesquisa = `ConsultaIndisponivel`. Limite conhecido: só o perfil do próprio usuário da requisição é conhecido; atributo desconhecido não põe ninguém fora do público. Pendente na costura: `ofereceConsultas` da Pesquisa, `usaConsultasOpcionais` do Core e reexportar `consulta-tarefa` no `contracts/index.ts` da Pesquisa |
| `pesquisa.resposta_local@1` | pesquisa | não | sim (`modules/pesquisa/app/lib/consulta-resposta-local.ts`, fonte injetada: pull + fila do motor) | core (aparelho: mostrar "Respondida" na tarefa de pesquisa antes de sincronizar) | **implementada (T-0170)**, contrato `CONSULTA_RESPOSTA_LOCAL` no mesmo arquivo. Entrada `{ questionario_id, cliente_id (nulo), desde: instante UTC }` strict; saída `{ resposta_id (nulo) }` strict = a resposta local mais recente desde `desde` (RN-PES-02), inclusive a ainda não sincronizada. Só leitura; a baixa oficial da tarefa continua no servidor (`pesquisa.resposta.registrada@1` → `concluirTarefaPorResposta` do Core) |

## Pacote da primeira carga por módulo (ADR 0054, 15/11, desenho `docs/desenho/T-catalogo-pacote.md`), tudo aditivo

Contrato no SDK (`packages/platform-sdk/src/pacotes-sync.ts` e `api.ts`): o provedor declara `pacote: { particao, permitido?, puxar }`
(só com `puxar` e escopo `tenant`; `definirModuloApi` recusa o resto); partição `filial` exige `ModuloApi.particoesPacote`
(`filiaisDoUsuario`, `filiaisDoTenant`). Nenhum evento novo; o gerador do worker lê `integracao.lote.concluido@1` (já existe).

| Módulo · partição | Entidades | Quem recebe | Tarefa |
|---|---|---|---|
| `core` · `tenant` | `produto`, `produto_unidade`, `medida` | todo usuário com o Core | D (modulo-core) |
| `catalogo` · `tenant` | `catalogo_no`, `produto_no`, `produto_relacao`, `produto_atributo`, `produto_conteudo`, `produto_referencia`, `sinonimo`, `marca_concorrente` | licença do Catálogo | C (modulo-catalogo) |
| `catalogo` · `filial:<uuid>` | `tabela_preco_item`, `tabela_escalonada` (inclui a de filial nula), `deposito`, `estoque_saldo` | licença do Catálogo e `permitido` = direito a preço (RN-CAT-05); filiais de `filiaisDoUsuario` (RN-CORE-39, `core.filiais@1`), no máximo `MAX_PARTICOES_PACOTE` = 8 | C (modulo-catalogo) |

Fora do pacote (pull paginado de sempre): `tabela_preco`, `cliente_tabela_preco` e tudo de escopo `carteira`/`usuarios`/`proprio`.

## Estoque diário e botão "Sincronizar" parcial/completo (ADR 0057, 15/11, desenho `docs/desenho/T-estoque-diario.md`), tudo aditivo

Contrato do SDK (`packages/platform-sdk/src/sync.ts` e `motor-sync.ts`). Nenhum evento novo, nenhuma versão nova. Testes: `packages/platform-sdk/src/motor-sync.diaria.test.ts` (3 armazenamentos).

| Contrato | Dono | O que entra | Compatibilidade |
|---|---|---|---|
| `DefinicaoEntidadeSync.cadencia?: CadenciaSync` (`'continua' \| 'diaria'`) | SDK; marcam: catalogo (`deposito`, `estoque_saldo`) | `diaria` = só na carga diária, na carga inicial e na `completa`; novidades, push silencioso, sincronização padrão e parcial pulam | ausente = `continua`; sem `cargaDiariaDevida` no motor, a marca não muda nada |
| `DefinicaoEntidadeSync.parcial?: boolean` | SDK; marcam: core (clientes), vendedor (pedidos) | entra na sincronização `parcial` (toque no botão) | ausente = fora da parcial; nenhuma entidade marcada = o toque faz a de sempre |
| `OpcoesMotorSync.cargaDiariaDevida?(ultima, agora)` | SDK; injeta: shell (engenheiro-apps) com a função pura do Core (RN-CORE-63), fuso do tenant e `catalogo.estoque_carga_hora` | `true` = a próxima sincronização (padrão ou novidades) inclui as diárias; se lançar, vale `true` | ausente = diárias contínuas |
| `EstadoMotorSync.carga_diaria_em?: string \| null` | SDK; leem: catalogo ("Atualizado às", RN-CAT-07; busca online), vendedor (reserva, RN-VEN-20) | ISO UTC do fim da última carga diária (persistido em `sync:carga_diaria_em`); a troca de geração (ADR 0021) zera | nulo = sem carga diária (motor antigo ou sem a função): vale a regra de hoje |
| `motor.sincronizar({ modo?: ModoSincronizacao })` (`'parcial' \| 'completa'`) | SDK; chama: shell (botão) | `parcial` = envio + entidades `parcial`, sem etapas nem novidades; `completa` = tudo do zero (ressincronização forçada e retomável), diárias inclusive, progresso em `estado.carga`/`estado.progresso`, grava `carga_diaria_em`; espera a sincronização em curso | sem modo = a de sempre (todas as chamadas atuais) |
| Limite silencioso do pull: `LIMITES_SYNC` (`parcial` 30 s, `completa` 300 s) e cabeçalho `CABECALHO_MODO_SYNC` (`x-macuxi-sync-modo`) | SDK (motor manda o cabeçalho); servidor: `apps/api/src/sync.ts` | por tenant, usuário, entidade e modo, entre dois inícios de pull; dentro do intervalo o servidor responde 200 com `limitado: true` (página vazia, nada muda no aparelho); continuação de passada não conta; push nunca é limitado (ADR 0057) | cabeçalho ausente, `auto` ou outro valor = automática, sem limite; `limitado` ausente = página normal |
| Parâmetro `catalogo.estoque_carga_hora` | catalogo | `HH:MM` [06:00], fuso do tenant | novo; ausente = 06:00 |

## T-0180 (15/11, ADR 0059, desenho `docs/desenho/T-0180.md`): alertas de produtividade

| Contrato | Dono | Mudança | Compatibilidade / situação |
|---|---|---|---|
| `ModuloApi.contatoDoAparelho?(ctx)` (`packages/platform-sdk/src/api.ts`) | plataforma | gancho novo, só core; a API chama depois de `GET /v1/sync/novidades` e `POST /v1/sync/push` autenticados, melhor esforço (`apps/api/src/sync.ts`; teste `apps/api/test/sync.test.ts`) | aditivo; sem o core declarar, nada muda. **Implementado** (branch `nuvem/T-0180-alertas-engenheiro-software`) |
| `core.produtividade_equipe@1` | core | consulta nova (`CONSULTA_PRODUTIVIDADE_EQUIPE`, `modules/core/contracts/consultas.ts`): entrada `{usuario_ids}` (1..500, estrita); saída estrita `{parado_min, alertas, usuarios:[{id, ultimo_contato_em (UTC ou nulo), almoco_inicio_min, almoco_fim_min}]}`, almoço já resolvido; lê `core.usuario_contato` (0085) | nova; consumidor: gestor (`usaConsultas`), que desconta o almoço do "parado". **Em andamento** (modulo-core, branch `nuvem/T-0180-alertas-modulo-core`) |
| parâmetro `core`/`alertas.produtividade` (`ParametrosAlertasProdutividadeSchema`) | core | JSON validado por Zod, padrão D6; pull `parametro` do Core; `GET\|PUT /v1/core/parametros/alertas-produtividade` e `PUT /v1/core/parametros/parado-min` (só `inicio.parado_min`; o PUT do Início deixa de gravá-lo), ação `parametro.alertas_produtividade` | novo; chave ausente = padrão. **Em andamento** (modulo-core) |
| `TIPOS_ALERTA` += `parado_entre_visitas`, `sem_checkin_inicio` (gestor) | gestor | só nas respostas da API (nenhum evento); `AlertasQuery.produtividade?: '1'` liga os tipos novos na lista; `alertas/regras` e `PUT alertas/regras/:tipo` só com os 6 da equipe | aditivo com filtro: o Gestão até a v1.0.12 não recebe os tipos novos. Chave `produtividade:<usuario_id>` (um vivo por pessoa, `alerta_vivo_uk`) |
| `PUT /v1/gestor/parametros/alertas` sem `permanencia_min_min` | gestor | a permanência mínima (RN-PRO-07) sai do contrato e da tela na v1.0.13 | `promotor.parametros_trade@1` e a migração da cópia `gestor`/`permanencia_min_min` ficam para uma tarefa seguinte da esteira (ADR 0059 §6) |
