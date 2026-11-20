# T-0188 — Troca de prazo mantém o preço final (RN-VEN-44): desenho

Engenheiro-software, 20/11/2026. Regra: doc 03, RN-VEN-44 (com a ressalva da RN-VEN-43). Decisões do dono do produto: R-20261120-051003 e R-20261120-055501.

## 1. Contrato e banco: nada muda
- **Item do push (`ItemPush`, `vendedor` contracts):** já leva o ajuste do item em R$ por unidade da medida vendida (`desconto_unitario_cents` / `acrescimo_unitario_cents`, T-0071). O preço final de cada item cabe nesses campos, centavo por centavo: `final = tabela − desconto_unitario` ou `tabela + acrescimo_unitario`.
- **Banco (`vendedor.pedido_item`):** já guarda `preco_unitario_cents` (o preço final), `preco_tabela_cents` e o R$ por unidade (migração 0020). O retrato do % do prazo está em `vendedor.pedido.prazo_percentual_ajuste` (0082).
- **Conclusão:** sem campo novo, sem versão nova de contrato, sem ADR e sem coluna nova (não precisa do banco-dados).

## 2. Funções puras (domain do Vendedor, `domain/troca-prazo.ts`)
1. `precoDoItemNoPrazo`: a tabela de UM item no prazo do documento. O preço congelado do orçamento (RN-VEN-18) só vale no prazo em que foi gravado. Em outro prazo, o item volta à tabela original do produto, ajustada pelo % novo (RN-VEN-43). Voltar ao prazo do orçamento devolve a tabela congelada.
2. `ajusteMantendoPrecoFinal`: dado o preço final e a tabela nova, o desconto (ou acréscimo) do item em R$ por unidade que mantém o final.
3. `ajustesNaTrocaDePrazo`: aplica a regra 2 a cada linha, com o final no prazo anterior e a tabela no prazo novo.

## 3. Onde roda
- **App (Campo e Gestão, pedido em nome):** a mesma tela Novo pedido. Ao trocar forma ou prazo com itens, o rascunho passa a guardar o ajuste do item em R$. O mínimo (RN-VEN-11), a alçada (RN-VEN-10, pelo valor nominal) e os Alertas (RN-VEN-42) já leem esse ajuste.
- **BKO:** não edita pedido nem orçamento; nada a mudar.
- **API (envio, edição de orçamento e Transformar):** `calcularDocumento` usa `precoDoItemNoPrazo` com o % do documento de origem. Assim o servidor chega à mesma tabela do aparelho e recalcula alçada, mínimo e totais.

## 4. Premissas
- Desconto e acréscimo do pedido (legado, antes da v1.0.5) seguem a regra anterior, com o % mantido.
- A regra vale para a troca feita pelo vendedor na aba Venda. O prazo padrão que entra sozinho no rascunho novo não refaz nada.
