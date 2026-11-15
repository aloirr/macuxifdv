# Vendedor — "Desc./Acrésc. (%)" do prazo de pagamento (proposta, modelo revisado)

Pedido: R-20261115-111000, alvo **v1.0.13**. Revisado após as decisões do Alexandre em R-20261115-121000, que **mudaram o modelo**: o percentual deixa de ser uma linha de total e passa a **alterar o valor de tabela de cada produto**. **Só proposta, nenhum código.** Recados inacessíveis (403): nada enviado; esta página é o conteúdo deles.

Referências: doc 03 RN-VEN-02, 03, 10, 11, 12, 18, 24, 40, 42; RN-INT-09; `pedido-e-aprovacao.md`.

## 0. O que existe hoje
- Prazo é do Vendedor: `vendedor.prazo_pagamento` (migração 0037), `domain/pagamento.ts` (`PrazoDePagamento`), contratos `formas-pagamento.ts` e `PrazoPagamentoSyncSchema` (`sync.ts`, **`.strict()`**).
- Hub: `PrazoPagamentoPayload` (`entidades.ts`) e `PagamentoErp` (`pedido.ts`); kit `tha_prazo_pagamento` / `vw_macuxi_prazo_pagamento`; Conector `apps/conector/src/pedidos.ts`.
- Preço: `domain/preco-pedido.ts` (`precoDoItem`, `totaisDoPedido`, `precoMinimoBaseCents` = preço de venda × (1 − desconto máximo), `itemRespeitaPrecoMinimo`). **Não há promoção nem preço negociado no domínio** (levantado por busca).

## 1. Modelo (decidido pelo Alexandre)
1. Ao escolher o prazo, o **valor de tabela de cada produto muda** pelo % do prazo: nos itens do pedido e no preço exibido do Catálogo.
2. O % **não aparece em lugar nenhum**: sem linha nos totais, sem % na lista de prazos do app, nada no PDF.
3. Desconto, alçada, preço mínimo e crédito são calculados **sobre a tabela já ajustada**. Nenhuma regra nova de alçada: o ajuste é parte da tabela.
4. O % vem do ERP (entidade prazo de pagamento, coluna "% Acres.Fin." (RN-VEN-46; `SalvarPrazoRequest` não leva o percentual).
5. Ficam como estavam: pedido offline com percentual congelado e revalidado (seção 5) e Conector 1.5.0 (seção 6).

## 2. Cálculo e arredondamento
Função pura no `domain`: `tabelaAjustadaCents(tabela_cents, bp)`, com `bp` = **inteiro em centésimos de ponto percentual** (−1,71 → −171; +2,50 → +250), convertido na entrada, sem ponto flutuante:

`ajustada = arredondarMeiaParaCima(tabela_cents × (10 000 + bp) ÷ 10 000)`

- **Por unidade, antes da quantidade**: o preço unitário ajustado é um valor em centavos inteiro; total do item = unitário × quantidade (igual ao `precoDoItem` de hoje; o preço que o cliente vê na linha multiplica exato). Vale por unidade base (`fator` da embalagem multiplica depois).
- **Desconto % do item incide no unitário, não na linha** (`precoUnitarioFinal`/`precoDoItem` em `modules/vendedor/domain/preco-pedido.ts`, RN-VEN-02 v2): o unitário é arredondado ao centavo. Ex.: tabela ajustada 18,19 com −5% = 17,28 por unidade (1 728,05 → 1 728); × 20 = **345,60** (e não 345,61).
- Faixa −99,99 a +99,99, 2 casas; ausente = 0 (função devolve a tabela intacta).

Exemplos:
| Tabela | % | Conta | Ajustada |
|---|---|---|---|
| R$ 100,00 (10 000) | −1,71 | 10 000 × 9 829 ÷ 10 000 = 9 829 | R$ 98,29 |
| R$ 12,35 (1 235) | −1,71 | 12 138 815 ÷ 10 000 = 1 213,88 | R$ 12,14 |
| R$ 12,35 (1 235) | +2,50 | 12 658 750 ÷ 10 000 = 1 265,88 | R$ 12,66 |
| R$ 0,20 (20) | +2,50 | 205 000 ÷ 10 000 = 20,5 (meia) | R$ 0,21 |
| R$ 0,29 (29) × 10 un | −1,71 | unitário 28,50 → 29; × 10 | R$ 2,90 (e não R$ 2,85) |

O último exemplo é a consequência da regra "por unidade": pequenos preços podem não mudar. É aceito (o PDF e o ERP mostram o mesmo unitário).

## 3. Prazo muda com itens no carrinho
**Recalcula tudo**: preço ajustado de cada item, descontos, total, alçada, preço mínimo e crédito, sempre a partir da **tabela original** do produto (nunca ajustar sobre o já ajustado; trocar −1,71 por +2,50 e voltar devolve os mesmos centavos).

**Desconto digitado pelo vendedor: mantido em %** (item e pedido). Justificativa: a alçada, o desconto máximo e o texto do vendedor ("dei 5%") são em %; o valor em R$ é derivado e se recalcula sobre o novo preço. Manter o R$ faria o % efetivo mudar sozinho e poderia estourar a alçada sem o vendedor ter pedido mais desconto. Se o campo foi digitado em R$, o domain guarda o % equivalente (2 casas) no momento da digitação; a conferência do que o domain já guarda fica para a implementação (pergunta 2).

Depois do recálculo:
- desconto acima da alçada → o pedido passa a exigir aprovação (fluxo existente, RN-VEN-10), com aviso em "Alertas" (RN-VEN-42); **nada é reduzido em silêncio**;
- item abaixo do mínimo → sinalizado como hoje (`itemRespeitaPrecoMinimo`), o vendedor corrige o desconto;
- o crédito é reconferido sobre o novo total.

## 4. Catálogo, preço mínimo, promoções e negociado
- **Catálogo antes de escolher o prazo:** mostra o preço com o **prazo padrão do cliente** em contexto. **Sem cliente em contexto, ou cliente sem prazo padrão: a tabela pura** (sem ajuste). Decisão: o prazo padrão da empresa não é um dado do cliente e geraria um preço que ninguém vai cobrar; tabela pura é o que o cadastro diz. O Catálogo (módulo opcional) chama a função do domain do Vendedor via contrato; se o Catálogo não puder consumir, cada módulo exibe a tabela pura (pergunta 3).
- **Preço mínimo:** `precoMinimoBaseCents` passa a partir da **tabela ajustada** (ajustada × (1 − desconto máximo), arredondado para cima, como hoje). Prazo à vista (−1,71) baixa o mínimo na mesma proporção; prazo com acréscimo sobe.
- **Promoção e preço negociado:** não existem no domínio; nada a tratar. Se surgirem, o ajuste incide sobre a tabela, antes da promoção (nova RN na hora).
- **Preço congelado/orçamento:** não há orçamento antigo a migrar.

## 5. Pedido offline
O pedido guarda o retrato `prazo_percentual_ajuste` (junto do retrato de forma/prazo da 0037). O total não muda depois, mesmo com pull novo. **API revalida**: faixa e 2 casas; o prazo existe/ativo/aceito pelo cliente; **recalcula** os preços ajustados pelo percentual do push e confere os totais; percentual do push = vigente → aceita; diferente e o cadastro do prazo mudou **depois** do `criado_em` → aceita com aviso na linha do tempo; diferente e sem mudança posterior → recusa 422: "O prazo de pagamento mudou de percentual. Atualize o app e refaça o pedido." (RN-VEN-40).

## 6. ERP e Conector
- **Vai ao ERP com os valores já ajustados** (preço unitário e total de cada item e total do pedido), nos campos que já existem.
- **O percentual também vai, só como informação** (`pagamento.percentual_ajuste`, opcional): serve a auditoria e conferência. **Risco:** o ERP da thathyany aplica "% Acres.Fin." ao lançar a condição; se a procedure reaplicar sobre o preço já ajustado, haverá **dupla aplicação**. Mitigação: a procedure grava as linhas como vêm e trata o percentual como informativo (RN-INT-15); a conferência é validar, no ensaio, que o total no ERP = total do app. Alternativa se o ERP não puder ignorar: **não enviar** o percentual (o aceite do ERP decide; pergunta 1).
- **Campos:** `prazo_pagamento.percentual_ajuste`, `prazo_percentual_ajuste` (retrato) e `pagamento.percentual_ajuste` (informativo).
- **Versão:** mesma `v1` (campo opcional, RN-INT-09). **Conector 1.5.0** como versão recomendada (lê "% Acres.Fin." na carga do prazo e leva o informativo). Como os valores enviados já vêm ajustados, o Conector 1.4.x **continua correto** no total; só não leva o informativo. Pull: `.strict()` do `PrazoPagamentoSyncSchema` exige liberar o campo depois do app novo ou passar a `.passthrough()` (decisão do `engenheiro-software`).
- Entrada: ERP (carga/delta/CSV) → `prazo_pagamento.percentual_ajuste`, `numeric(5,2) not null default 0`, `check between -99.99 and 99.99`; ausente = 0.

## 7. BKO — Prazos
Tabela única, sem sub-tópicos por forma, abas Prazos/Formas; percentual: RN-VEN-46 (R-20261115-121500, R-20261115-122000). Visual: `designer-ux`. Permissões inalteradas (`forma_pagamento.gerenciar` para os demais campos).

## 8. RN propostas (numeração a partir de RN-VEN-42 e RN-INT-14)
Emendas: **RN-VEN-02** (trocar "± ajuste financeiro da condição" por "a tabela do item é ajustada pelo % do prazo, RN-VEN-43"); **RN-VEN-03/10/11/12** (calculados sobre a tabela ajustada); **RN-VEN-24** (o prazo tem o percentual, vindo do ERP).
- **RN-VEN-43 Tabela ajustada pelo prazo.** O % do prazo (−99,99 a +99,99, 2 casas; negativo = desconto) altera o valor de tabela de cada produto: `ajustada = meia-para-cima(tabela × (10 000 + bp) ÷ 10 000)`, por unidade antes da quantidade, em centavos, `bp` inteiro. Aplica nos itens do pedido e no preço do Catálogo (prazo padrão do cliente; sem cliente, tabela pura). Desconto, alçada, preço mínimo e crédito usam a tabela ajustada. O % não é exibido em totais, lista de prazos nem PDF.
- **RN-VEN-44 Troca de prazo.** Trocar o prazo recalcula tudo a partir da tabela original; o desconto do vendedor se mantém em %; excesso de alçada ou abaixo do mínimo é sinalizado (Alertas), nunca corrigido em silêncio.
- **RN-VEN-45 Percentual congelado.** O pedido guarda o percentual do momento; a API recalcula e aceita o do push se for o vigente ou se o cadastro mudou depois do `criado_em` (aviso na linha do tempo); senão recusa (RN-VEN-40).
- **RN-VEN-46 Prazo no BKO.** O % do prazo vem do ERP e é somente leitura no BKO e no CSV (Cadastros > Formas de pagamento e prazos); o prazo criado no BKO entra com 0,00.
- **RN-INT-15 Percentual do prazo no Hub.** `prazo_pagamento.percentual_ajuste` vem do ERP ("% Acres.Fin."), opcional e aditivo no `v1`, ausente = 0, fora da faixa ou com mais de 2 casas = erro de linha. Os preços do pedido ao ERP já vão ajustados; `pagamento.percentual_ajuste` é informativo e o ERP **não** o reaplica.
- RN-CORE: nenhuma.

## 9. Agentes e caminhos
| Agente | O que muda |
|---|---|
| `modulo-vendedor` | `tabelaAjustadaCents` e `precoDoItem`/mínimo no domain (testes `RN-VEN-43/44`), API (`pagamento.ts`, `receber.ts`), app (itens, troca de prazo), BKO (tabela única, coluna leitura), consumidor do Hub |
| `modulo-catalogo` | preço exibido com o prazo padrão do cliente, via contrato do Vendedor |
| `modulo-integracao` | `PrazoPagamentoPayload`, `PagamentoErp.percentual_ajuste`, CSV, kit SQL |
| `engenheiro-software` | Conector 1.5.0, `.strict()` do pull |
| `banco-dados` | migração aditiva (`percentual_ajuste` no prazo; `prazo_percentual_ajuste` no pedido), view-modelo |
| `designer-ux` | tabela única e abas Prazos/Formas no BKO |
| `testes`, `corretor-redundancias`, `design-de-marca` | roteiro, parecer, validação |
| `gerente-projetos` | incorporar as RN ao doc 03 após aprovação |

## 10. Riscos
1. **Dupla aplicação no ERP** (maior risco financeiro): ver §6.
2. **Preço diferente entre Catálogo e pedido** se o prazo escolhido não for o padrão do cliente: esperado; o pedido sempre vale.
3. Mínimo mais baixo no prazo à vista: efeito direto da decisão do Alexandre.
4. Pull estrito quebra o app antigo (§6).
5. Relatórios do Gestor comparam descontos sobre a tabela ajustada, não sobre a de cadastro.

## 11. Perguntas em aberto
1. O ERP (procedure) aceita receber os preços já ajustados **mais** o percentual informativo sem reaplicá-lo? Se não, o percentual deixa de ser enviado.
2. Confirma "desconto do vendedor mantido em %" na troca de prazo (e o domain guardar o % equivalente quando o vendedor digita em R$)?
3. Confirma o Catálogo com **tabela pura** quando não há cliente em contexto?
4. Conector 1.5.0 recomendado e o campo do pull depois do app novo cabem na v1.0.13?
