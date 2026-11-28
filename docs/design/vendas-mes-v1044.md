# Vendas do mês pelas RN-CORE-20 e 21: antes e depois (T-0210, v1.0.44)

As telas são as que já existem, sem layout novo. Os números vêm da simulação do testes (`docs/testes/T-0210.md`, base demo de 28/11/2026), com nomes fictícios e no formato da tela (real inteiro, percentual arredondado). Em amarelo, o que muda. Gerador: `vendas-mes-v1044/gerar.mjs`.

## O que muda e por quê
1. A base vem do tipo da meta, e não do parâmetro `gestor.base_apuracao` (RN-CORE-21).
2. "Notas faturadas" soma só o que foi faturado, também no faturamento parcial (RN-CORE-21).
3. Os positivados contam sempre pelo pedido aprovado (RN-CORE-20).

Na demo nada muda. Em produção, muda para quem tem meta de faturamento ou o parâmetro "faturado".

## S5: parâmetro "faturado", meta de faturamento (mexe nos 3 pontos)
| Tela | Antes | Depois | O que muda |
|---|---|---|---|
| Gestão, ficha › Mês | `s5-gestao-ficha-antes-390.png` | `s5-gestao-ficha-depois-390.png` | A: R$ 1.604 → R$ 1.572 (o parcial conta só o faturado) |
| Gestão, Ranking › Vendas | `s5-gestao-ranking-vendas-antes-390.png` | `s5-gestao-ranking-vendas-depois-390.png` | B: R$ 721 → R$ 652 |
| Gestão, Ranking › Positivados | `s5-gestao-ranking-positivados-antes-390.png` | `s5-gestao-ranking-positivados-depois-390.png` | A: 2 → 5 (por aprovado) |
| BKO, Ranking da equipe | `s5-bko-ranking-vendas-antes-1366.png` | `s5-bko-ranking-vendas-depois-1366.png` | A e B como no app |

## S2: meta de faturamento, parâmetro ausente
| Tela | Antes | Depois | O que muda |
|---|---|---|---|
| Gestão, ficha › Mês | `s2-gestao-ficha-antes-390.png` | `s2-gestao-ficha-depois-390.png` | A: R$ 3.223 → R$ 1.572; atingido 2% → 1% |
| BKO, Ranking da equipe | `s2-bko-ranking-vendas-antes-1366.png` | `s2-bko-ranking-vendas-depois-1366.png` | A e B passam ao faturado; base "pedidos aprovados" → "notas faturadas" |

## Não muda na tela
O atingimento da equipe ("Meta do mês: 1% atingido" no Gestão e "Atingimento do mês" no BKO) continua 1% nos três cenários, porque a tela arredonda: 1,31% → 0,74% em S2, 0,78% → 1,31% em S4 e 0,78% → 0,74% em S5.

## Ponto de atenção (modulo-gestor)
No Ranking com "Positivados", a linha "Base: notas faturadas" fica junto de um número que passa a ser sempre por pedido aprovado. O rótulo da base só deveria aparecer nos indicadores em dinheiro (Vendas e Ticket médio).

## Premissas
- Meta do Vendedor A: R$ 180.000 (demo).
- "Precisa por dia" com 1 dia útil restante: 28/11 é sábado, semana de segunda a sexta.
- Vendedor B com 1 positivado, antes e depois.
- O rótulo da base acompanha o tipo da meta.
- Os cartões do dia aparecem apagados porque não mudam (valores fictícios).
