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
usuário de sistema `USUARIO_SISTEMA_ID` com perfil admin e os módulos efetivos do tenant); no aparelho: `ambiente.consultar(def, entrada)` sobre as linhas locais do dono. Dono inativo
ou sem implementação no canal → `ConsultaIndisponivel` (503 `CONSULTA_INDISPONIVEL` se ninguém tratar). Mudança incompatível = `@vN+1`.
A montagem (`defineModule`, `definirModuloApi`, `validarConjunto`, `criarShell`) recusa o que estiver fora destas regras.

**Consulta opcional sem aresta (ADR 0019)**: `usaConsultasOpcionais` no manifesto do consumidor, com o dono FORA de `depende`/`opcionais`
(não entra em `ordenarPorDependencia`, então não fecha ciclo). Dono ausente, inativo ou sem implementação → `ConsultaIndisponivel`;
o consumidor sempre tem plano B. Dono em `depende` → use `usaConsultas`.

| Consulta | Dono | API | Aparelho | Usada por | Situação |
|---|---|---|---|---|---|
| `catalogo.precos_cliente@1` | catalogo | sim | sim (linhas de preço locais, `precoVisivel`, RN-CAT-06) | vendedor | aprovada (T-0029), implementação na onda 2. **T-0071 (aditivo, mesma versão)**: item ganha `embalagens?: {unidade, preco_cents}[]` (preço próprio por medida, `tabela_preco_item.unidade` não nula vigente em `em`; ausente = UN × fator, RN-VEN-15); `preco_cents` passa a vir só da linha sem unidade (correção RN-VEN-15). Schema não strict; teste do consumidor antigo em `modules/catalogo/domain/precos-cliente.test.ts` |
| `catalogo.sugestoes_pedido@1` | catalogo | sim (`api/sugestoes.ts`) | sim (`app/sugestoes.ts`: `produto_relacao`, `cliente_tabela_preco`, `tabela_preco`, `tabela_preco_item`, `estoque_saldo` locais) | vendedor (aba Detalhes do novo pedido; declarada em `usaConsultas` no 6a66f32, espelho em `manifestos-referencia.test.ts` em 2026-11-04) | T-0071 (desenho §4.2). Entrada `{cliente_id, produto_ids[1..200], em (ISO), limite 1..5 = 5}` strict; saída `{complementares[≤5], superiores[≤5]}` de `{produto_id, tipo: complementar\|superior, origem_produto_id, preco_cents}`. Mesmo domain (`sugestoesDoPedido`) nos dois canais; perfil sem preço (RN-CAT-05) = vazia; sem preço (RN-CAT-06) ou saldo ≤ 0 (RN-CAT-07) não sai. Na API depende da 0020 |
| `core.cadastro_resumo@1` | core | sim | não (o Vendedor lê `cliente`/`produto` locais com os tipos de `@macuxi/core/contracts`) | vendedor, catalogo (consumidores de preço/estoque do ERP, T-0066) | implementada; `produto_external_ids` opcional (padrão []) acrescentado em 2026-11-02 (d5ba7f2), compatível, mesma versão (ADR 0012) |
| `core.cadastro_cliente@1` | core | sim | não | integracao (consumidor A7 de `integracao.lote.recebido@1`, aviso `cadastro_incompleto`, RN-INT-14) | implementada (T-0060); `ctx.consultar` no consumidor (SDK, 2026-11-02) |
| `core.medidas@1` | core | sim | não (o app lê a entidade `medida` do pull) | integracao (A7: sigla não cadastrada ou inativa = `referencia_ausente`, RN-CORE-19) | proposta (desenho T-0061 §4.1, 2026-11-02) |
| `vendedor.pedidos_da_meta@1` | vendedor | sim | não | core (painel de metas, RN-CORE-21) em `usaConsultasOpcionais` (ADR 0019); sem o Vendedor, cai no `indicador_diario` | oferecida pelo Vendedor; Core religa pelo campo novo (2026-11-03) |

## Entidades de sync e campos aditivos (T-0071)

Mudança só aditiva no @1: o aparelho não valida a linha do pull com `schemaLinha` em tempo de execução (só o teste do provedor), então
o APK instalado ignora colunas novas. Schema `.strict()` (Vendedor): campos e provedor no MESMO PR.

| Entidade / contrato | Dono | Direção · escopo | O que entra | Situação |
|---|---|---|---|---|
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
