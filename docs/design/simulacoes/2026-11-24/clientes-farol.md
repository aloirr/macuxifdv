# BKO → Clientes, aba Farol: visual executivo (simulação)

> designer-ux · 24/11/2026, noite (Manaus) · pedido do Alexandre R-20261124-091113, item 1 (item 05 de 24/11). Só simulação:
> o código vem depois do "aprovado".
> Prints em 1366 px (DPR 2) do BKO local com o seed de demonstração ("Distribuidora Exemplo", perfil admin). As propostas
> trocam só os cartões, a legenda e o tom do selo Verde na tela real, com os mesmos dados.

| Print | O que é |
|---|---|
| [clientes-farol-atual-1366.png](clientes-farol-atual-1366.png) | hoje |
| [clientes-farol-proposta-1366.png](clientes-farol-proposta-1366.png) | **proposta A (recomendada)** |
| [clientes-farol-proposta-b-1366.png](clientes-farol-proposta-b-1366.png) | proposta B, com a dica (i) aberta |

## O que está errado hoje
- 6 cartões em duas linhas, e o 6º fica sozinho na segunda linha.
- Selo colorido em todo cartão, mesmo quando o número é 0 ou está bom. "Clientes verdes 30" ganha verde, sem pedir ação.
  É o achado do design-de-marca (auditoria de 24/11, leitura rápida e pergunta do padrão executivo: "selo colorido só onde a
  pessoa precisa agir", com o farol de Clientes citado nominalmente).
- "Clientes na carteira" repete no subtítulo a positivação do cartão vizinho ("0 de 30 clientes positivados no mês (0%)"). Isso
  fere a regra "uma informação, um lugar" (R-20261110-093124).
- A legenda ocupa duas linhas, com 6 selos coloridos a mais.
- A nota da fonte ("Positivação pelos pedidos do Vendedor." ou "Sem dados de positivação…") explica o funcionamento e não
  ajuda a agir (R-20261110-192153). O corretor já tinha o Farol na fila (revisão geral de 24/11, §4).

## Proposta A (recomendada): 2 cartões
1. **Positivação do mês**: número grande. A cor de alerta da paleta (`#A8261B` erro, ou `#7A4F00` aviso) entra só quando a
   positivação fica abaixo do limite, sempre acompanhada de texto ("abaixo de 50%"). Quando o mês está bom, número e texto
   ficam em grafite. A dica (i) traz os limites do vendedor.
   - **Estado vazio** (`fonte_positivacao` nula): o cartão mostra "—" e "Sem pedidos nem notas no mês". Isso substitui a nota
     solta.
2. **Clientes na carteira**: total e quatro contadores na ordem de ação (Vermelhos, Amarelos, Sem compra, Verdes). Cada
   contador filtra a lista (alvo de 44 px, como o "ver na lista" de hoje). Ganham cor só Vermelhos > 0 (erro) e Amarelos > 0
   (aviso). Sem compra e Verdes ficam sempre em grafite.
- A legenda fica numa linha só: a regra do cliente, que explica a coluna Farol da lista. A regra do vendedor vai para a dica (i).
- Nas tabelas, o selo **Verde** vira neutro (`#34404D` em `#ECEEF1`, os tons neutros do Badge). Vermelho e Amarelo continuam
  com cor e com texto.
- Nenhuma informação usada para decidir sai da tela. Os 6 cartões viram 2, os 9 selos dos cartões e da legenda viram zero, e a
  nota da fonte vira o estado vazio do cartão.

## Proposta B: 4 cartões, legenda só na dica
Os cartões são Positivação, Vermelhos, Amarelos e Sem compra, cada um clicável e com a regra no subtítulo ("mais de 45 dias sem
compra"). Saem o total da carteira (já aparece em "Clientes (30)") e os Verdes (dá para filtrar pelo campo Farol). Não há
linha de legenda. A tela fica mais limpa, mas some o "quantos estão bem", que o gerente usa como referência. Por isso a
recomendada é a A.

## Cores e componentes
Só a paleta do manual (§3) e os tokens de `apps/web/app/globals.css`: grafite `#16202A`, texto secundário `#4A5562`, linha
`#DFE2E6`, erro `#A8261B`, aviso `#7A4F00` e neutro `#34404D`/`#ECEEF1`. Nenhuma cor nova. O cartão de dois blocos e a dica (i)
pedem uma variação do `KpiCard`, ou um `KpiCardGrupo` em `packages/ui/src/web` (designer-ux). A tela continua sendo do
modulo-core (`modules/core/web/components/farol/farol-page.tsx`, `modules/core/web/lib/farol.ts`).

Depende do "aprovo" do Alexandre e da validação do design-de-marca, porque muda cor e layout.
