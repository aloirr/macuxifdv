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
| `core.cadastro_resumo@1` | core | sim | não (o Vendedor lê `cliente`/`produto` locais com os tipos de `@macuxi/core/contracts`) | vendedor, catalogo (consumidores de preço/estoque do ERP, T-0066) | implementada; `produto_external_ids` opcional (padrão []) acrescentado em 2026-11-02 (d5ba7f2), compatível, mesma versão (ADR 0012). **T-0071 (aditivo, mesma versão)**: produto ganha `preco_venda_cents?` (int ≥ 0, null = sem preço) e `desconto_maximo_pct?` (0–100, EFETIVO: próprio ?? parâmetro `core.desconto_maximo_produto_pct` do tenant ?? 15; RN-VEN-11), para o preço mínimo no `receber` do Vendedor (consumo ainda pendente: C6 da T-0071 em `it.fails`); emissor antigo sem os campos continua válido (`modules/core/api/consultas-bloqueado.test.ts`). O cliente já trazia `bloqueado` (RN-VEN-13), agora usado no `receber.ts` |
| `promotor.concorrentes@1` | promotor | sim (`modules/promotor/api/consultas.ts`, SQL em `promotor.concorrente` na transação de quem consulta; registrada com ou sem repositório) | não (o aparelho não lê `concorrente`: o nome vai no retrato `produto_referencia.marca_nome`, 0034, ADR 0027) | catalogo em `usaConsultasOpcionais` (ADR 0019): `MARCAS_DO_PROMOTOR` (marcas-concorrentes, exportação, enriquecer), PUT `cadastro-catalogo` (422 RN-CAT-09) e consumidor do produto do ERP (`ctx.consultar`, licença do tenant) | **publicada (T-0085, ADR 0027; revisão 2026-11-06)**. Entrada `{ids?: UUID[] ≤ 500, busca?: trecho do nome ≤ 120 (ilike, curingas escapados), incluir_inativos = false}` strict; saída `{concorrentes: [{id, nome, ativo, external_id}]}` por `lower(nome), id`, no máximo 2000 linhas; apagados nunca saem; id inexistente some (não é erro). Responde só a quem tem o Promotor efetivo (ADR 0012): o vendedor recebe `ConsultaIndisponivel`, por isso o Catálogo grava o retrato `marca_nome` (risco 2 da ADR 0027). Nenhum contrato de marca concorrente no Core |
| `core.cadastro_cliente@1` | core | sim | não | integracao (consumidor A7 de `integracao.lote.recebido@1`, aviso `cadastro_incompleto`, RN-INT-14) | implementada (T-0060); `ctx.consultar` no consumidor (SDK, 2026-11-02) |
| `core.medidas@1` | core | sim | não (o app lê a entidade `medida` do pull) | integracao (A7: sigla não cadastrada ou inativa = `referencia_ausente`, RN-CORE-19) | proposta (desenho T-0061 §4.1, 2026-11-02) |
| `pesquisa.etapas_checkout@1` | pesquisa | sim | não (o Campo usa a extensão `visita.etapas_checkout`) | core (`visita_checkout`, baixa por `pesquisa.resposta.registrada@1` e alerta, T-0039 §2) em `usaConsultasOpcionais` (ADR 0019); sem a Pesquisa = sem etapa | ligada no Core em 2026-11-05 (`modules/core/api/etapas-checkout.ts`) |
| `vendedor.pedidos_da_meta@1` | vendedor | sim | não | core (painel de metas, RN-CORE-21) em `usaConsultasOpcionais` (ADR 0019); sem o Vendedor, cai no `indicador_diario` | oferecida pelo Vendedor; Core religa pelo campo novo (2026-11-03) |

## T-0089 (desenho 06/11): pagamento por forma e prazo, escalonada e crédito no Novo pedido

Tudo aditivo na mesma versão. Detalhes em `docs/desenho/T-0089.md`.

**Consultas:**

| Consulta | Dono | API | Aparelho | Usada por | Situação |
|---|---|---|---|---|---|
| `core.financeiro_cliente@1` (nova; era a "próxima prevista" abaixo) | core | sim (RN-VEN-13 no receber) | sim (linhas locais `cliente_financeiro` e `titulo`, `resumoFinanceiro`) | vendedor (`usaConsultas`) | desenho 06/11 (C1/C2) |
| `vendedor.formas_pagamento@1` (nova) | vendedor | sim | não | core (`usaConsultasOpcionais`, ADR 0019; ficha do cliente no BKO) | desenho 06/11 (V1/V3) |
| `catalogo.precos_cliente@1` | catalogo | sim | sim | vendedor | **aditivo:** o item ganha `faixas?: { medida \| null, quantidade_minima, preco_unidade_cents }[]` (vigentes em `em`, a faixa da tabela do cliente vence a geral, sem faixas quando o preço não é visível pela RN-CAT-05). `embalagens` deixa de ser preenchido (RN-VEN-15 nova) |
| `core.cadastro_resumo@1` | core | sim | não | vendedor, catalogo | **aditivo:** o cliente ganha `prazo_medio_max_dias?: int \| null` e `formas_pagamento?: string[] \| null` |

**Entidades de sync:**

| Entidade | Dono | Direção e escopo | O que entra |
|---|---|---|---|
| `forma_pagamento` (nova) | vendedor | pull, tenant, servidor vence | `codigo`, `nome`, `ativo`, `ordem` |
| `prazo_pagamento` (nova) | vendedor | pull, tenant, servidor vence | `forma_pagamento_id`, `codigo` (único no tenant), `descricao`, `parcelas_dias int[]`, `prazo_medio_dias` (média arredondada para cima), `ativo`, `ordem` |
| `tabela_escalonada` (nova) | catalogo | pull, tenant, servidor vence | `produto_id`, `medida \| null`, `quantidade_minima`, `preco_unidade_cents` (unidade base), vigência, `tabela_preco_id \| null`, `ativo` |
| `cliente` | core | pull, carteira | `prazo_medio_max_dias?`, `formas_pagamento?` (códigos; nulo ou vazio = todas) |
| `PedidoPush`, `PedidoSyncSchema`, `Order` | vendedor | push e pull | `forma_pagamento_id?` e `prazo_pagamento_id?` (os dois juntos) e o retrato (`forma_pagamento_nome`, `prazo_descricao`, `prazo_parcelas_dias`, `prazo_medio_dias`). Recusas novas: `RN-VEN-24` e `RN-VEN-25`. Sem os dois, vale o caminho legado da `condicao_pagamento` (APK antigo) |
| `condicao_pagamento` e `cliente_condicao` | vendedor | pull | **legado**: só para leitura, para o APK antigo; saem numa limpeza futura, com ADR |

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
| `produto_referencia` (`ProdutoReferenciaSyncSchema`) | catalogo | pull · tenant · servidor vence | **T-0085 (nova)**: `produto_id`, `marca_id` (id do `concorrente` do Promotor, sem FK; ADR 0027), `codigo` 1..30, `ordem` 1..3 (o compacto é recalculado no aparelho). Próximo lote: `marca_nome` (retrato, aditivo) | 0033 + lote AB (05/11) |
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
