# v1.0.14 — % do prazo ("Desc./Acrésc. (%)"): matriz de cenários

> 2026-11-15 · testes · RN-VEN-43 a 46 (`docs/modulos/vendedor/prazo-desconto-acrescimo.md`) · revisão
> `docs/desenho/prazo-ajuste-revisao-final.md` · decisões R-20261115-124833 (% divergente aceito com aviso, fora da alçada) e
> R-20261115-155500 (P-6: a API não confere crédito no pedido com prazo). Testes de banco rodam só no CI (sem Docker).

## Fórmulas conferidas (esperado calculado no teste, sem chamar o domain)

| Regra | Fórmula |
|---|---|
| RN-VEN-43 tabela ajustada | `meia-para-cima(tabela × (10 000 + bp) ÷ 10 000)`, por unidade, antes da quantidade; `bp` = % × 100 |
| RN-VEN-02 desconto do item | `meia-para-cima(ajustada × (10 000 − desc×100) ÷ 10 000)`; linha = unitário × quantidade |
| RN-VEN-03/10 alçada | desconto efetivo = (tabela ajustada − total) ÷ tabela ajustada; o % do prazo não entra |
| RN-VEN-11 mínimo | `para-cima(ajustada × (1 − desconto máximo))` |
| RN-VEN-46 R$ na troca | `meia-para-cima(R$ × tabela nova ÷ tabela anterior)` |

## Matriz

Arquivo: `tests/modulos/prazo-ajuste-valor-regra.test.ts` (unitário, sem banco).

| # | Cenário | Resultado esperado |
|---|---|---|
| PZ-01 | Exemplos da proposta e limites da faixa (−99,99 e +99,99); varredura de 1 a 20 000 centavos × bp | domain = fórmula; R$ 100,00 com −1,71% = 98,29; fora da faixa = erro `RN-VEN-43` |
| PZ-02 | Pedido de 3 itens, à vista −1,71%, item A com 5% | unitários, linhas, total de tabela 320,88, total 314,78 e desconto efetivo pela regra; aprovado |
| PZ-03 | Troca −1,71 → +2,50 → −1,71 | recalcula da tabela original, desconto mantido em %, a volta devolve os mesmos centavos |
| PZ-04 | 6% no item C com −1,71% | efetivo 6,00% sobre a ajustada (não 7,61%) → supervisor, motivo `desconto` |
| PZ-05 | Prazo −20% sem desconto e com 5% do vendedor | efetivo 0% e ≤ 5%: aprovado, sem motivo (o % do prazo fica fora da alçada) |
| PZ-06 | Mínimo com −1,71% e +2,50% (máximo 10%) | 88,47 e 92,25; na API, 10% (mínimo exato) passa e 10,5% = 422 `preco_abaixo_minimo` |
| PZ-07 | Preço congelado do orçamento (bp do item = 0) | não ajusta duas vezes; os outros itens seguem o % do pedido |
| PZ-08 | App (`calcularPedido`) × API (`revalidarPedido`) nos mesmos 4 pedidos | tela = API = regra (tabela, total e tabela de cada linha) |
| PZ-09 | R$ digitado na troca de prazo (varredura) | domain = fórmula; R$ 5,00 de −1,71% para +2,50% = R$ 5,21; zero e tabela anterior 0 mantêm o valor |
| PZ-10 | Revalidação do % no envio | igual aceita; mudou depois do `criado_em` aceita o do pedido; mesmo instante ou sem mudança = 422 `RN-VEN-45` "Este prazo de pagamento mudou. Atualize o app e refaça o pedido."; app antigo sem % recusado só se o prazo tiver % |
| PZ-11 | % divergente aceito, desconto dentro da alçada | segue aprovado, sem motivo; aviso "Percentual do prazo mudou" só no recebimento da linha do tempo; valores pelo % do pedido |
| PZ-12 | % divergente aceito, desconto acima da alçada | aprovação só pelo desconto; o aviso aparece uma vez, no recebimento |
| PZ-13 | P-6: total ajustado estoura o crédito (+2,50%); à vista cabe; tabela pura no limite exato | o app mostra "Limite de crédito excedido" como aviso (não impede, não vira só orçamento); a API decide igual nos três (aprovado, sem motivo `credito`) |
| PZ-14 | PDF do cliente e do BKO | valores ajustados (314,78), nenhum "1,71" |

## Cobertura de outros donos

| Cenário | Onde |
|---|---|
| Push com mais de 2 casas recusado, pull grava o %, Catálogo com o prazo padrão | `modules/vendedor/domain/tabela-ajustada-prazo.test.ts`, `modules/vendedor/app/lib/prazo-ajuste.test.ts` (modulo-vendedor) |
| INSERT do retrato com e sem prazo (`prazo_percentual_ajuste` nulo sem prazo) | `modules/vendedor/api/prazo-percentual.db.test.ts` (CI) |
| BKO: coluna só leitura e CSV | `modules/vendedor/web/lib/formas-pagamento.test.ts` |
| Hub e Conector 1.5.0 | `modules/integracao/domain/pagamento-hub.test.ts`, `apps/conector/test/prazo-ajuste.test.ts` |

## Teste manual (aparelho real, PDF)

1. ERP com um prazo à vista de −1,71% e um a prazo de +2,50%; sincronizar o Campo.
2. Novo pedido com 3 itens; escolher à vista → conferir o preço de tabela de cada item com a fórmula; dar 5% num item.
3. Trocar para o prazo de +2,50% → preços sobem, o desconto continua 5%; voltar → mesmos centavos.
4. Dar desconto em R$ num item e trocar de prazo → o R$ muda na proporção da tabela.
5. Com o crédito do cliente perto do limite, o +2,50% estoura: "Limite de crédito excedido" em Alertas, e o pedido envia.
6. Montar o pedido offline, mudar o % no ERP, sincronizar e enviar → pedido aceito; na linha do tempo, "Recebido pelo servidor ·
   Percentual do prazo mudou"; sem ir para aprovação se o desconto couber na alçada.
7. PDF do pedido (cliente e BKO) sem o percentual em lugar nenhum.
