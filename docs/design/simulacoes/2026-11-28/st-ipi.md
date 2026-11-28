# ST e IPI vindos do ERP: pedido no Campo, no BKO e no PDF (simulação T-0208)

> designer-ux · 28/11/2026, manhã (Manaus) · T-0208, decisão 63 A (R-20261127-235610-alexandre), ADR 0077. É só uma simulação, com
> dados fictícios. O código vem depois do "aprovo" do Alexandre e da validação do design-de-marca.
> Para gerar de novo: `node docs/design/simulacoes/2026-11-28/gerar-st-ipi.mjs`.

## Regra do valor (contrato do ERP)
| Caso | Tela e PDF |
|---|---|
| ST ou IPI = 0 | `R$ 0,00` (`0,00` na tabela de itens) |
| campo ausente no item | `não informado`, nunca zero |
| total ausente (falta regra em algum item) | total `não informado`, sem somar os itens |
| pedido sem resposta do ERP (offline ou na fila) | `calculado pelo ERP` nos totais; sem ST e IPI nos itens |

## Telas
| PNG | O que mostra |
|---|---|
| `st-ipi-campo-1-completo-390.png` | Campo, detalhe: todos os itens com regra; IPI 0 aparece como `0,00` |
| `st-ipi-campo-2-falta-regra-390.png` | Campo: item AGU-1500 sem ST, `não informado` no item e no total |
| `st-ipi-campo-3-offline-390.png` | Campo, pedido na fila: `calculado pelo ERP` |
| `st-ipi-bko-1-completo-1366.png` | BKO, gaveta do pedido: colunas ST e IPI nos itens, linhas no total |
| `st-ipi-bko-2-falta-regra-1366.png` | BKO: falta regra num item |
| `st-ipi-bko-3-aguardando-erp-1366.png` | BKO: pedido enviado, sem resposta do ERP |
| `st-ipi-pdf-1-cliente-falta-regra-1366.png` | PDF do cliente (A4 paisagem): colunas ST R$ e IPI R$, linhas na caixa do Total |
| `st-ipi-pdf-2-escritorio-falta-regra-1366.png` | PDF do escritório |
| `st-ipi-pdf-3-cliente-aguardando-erp-1366.png` | PDF sem resposta do ERP |

## Como fica
- **Campo (390):** a tabela de itens não ganha coluna. Cada item ganha uma linha embaixo, `ST 2,38 · IPI 0,00`. Nos Totais, ST e IPI
  ficam em linhas próprias, abaixo do Valor final.
- **BKO e PDF:** as colunas ST e IPI ficam depois do Total, e as linhas ST e IPI ficam abaixo do Total ou do Valor final.
- `não informado` e `calculado pelo ERP` ficam em texto secundário (`#4A5562` sobre branco, 7,4:1). Não há cor de alerta: não é erro do
  vendedor e ele não tem o que fazer.

## Suposições do PO, para o Alexandre confirmar
1. O valor sem imposto continua como hoje: Valor final ou Total, com o mesmo número e o mesmo rótulo.
2. ST e IPI ficam em linhas próprias, abaixo do valor final. **Não há linha "Total com impostos"**, porque o FDV não soma imposto.
3. No pedido offline ou na fila, aparece `calculado pelo ERP` até a resposta. Os itens não mostram ST e IPI nesse estado.
4. (designer-ux) A nota do PDF do cliente "Valores sem impostos." passa a "Valor final sem ST e IPI.", porque o PDF agora mostra
   imposto.
5. (designer-ux) Rótulos curtos: "ST" e "IPI". A outra opção é "ICMS-ST".
