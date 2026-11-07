# Pedidos — filtro de período num botão só, modelo A (T-0090)

> 2026-11-06 · designer-ux · referência: `docs/produto/referencias/R-20261106-064752-alexandre-filtro-periodo.png` (alternativa A,
> coluna da esquerda; fonte em `.html`). Substitui o item 2 do R-20261104-164005. Kit: `packages/ui/src/mobile/filtro.tsx`
> (parte pura em `periodo.ts`). Telas: Pedidos do Campo e do Gestão (donos: modulo-vendedor e modulo-gestor).

## 1. A tela, de cima para baixo
1. Título "Pedidos" e a ação principal da tela (como hoje).
2. **Linha de busca:** `CampoBusca` (`flex: 1`) e, à direita, `BotaoFiltro` (48 × 48 dp, funil), `gap: 8`.
   - Com filtro diferente do padrão, o botão ganha borda grafite e o **selo laranja** com o número de filtros (`contagem`).
   - O padrão (Este mês, todos os vendedores) não conta como filtro: sem selo.
3. **Etiquetas** (`EtiquetaFiltro`) logo abaixo, só com filtro ativo, em `LinhaChips` se houver mais de uma:
   "Este mês ✕" não aparece (é o padrão); "Ontem ✕", "Seg, 02/11/2026 ✕", "Setembro de 2026 ✕", "Ana Souza ✕" (Gestão).
   Tocar na etiqueta remove aquele filtro (volta ao padrão dele). Leitura: "Remover filtro Ontem".
4. A linha de situação (chips Todos · Na fila · Aguardando · Aprovados · Rejeitados) e a lista.
5. **O aviso "Só os últimos 90 dias do aparelho" sai da tela.** Ele aparece só quando o período escolhido sai da janela do
   aparelho, como `ajuda` na folha ("Fora dos 90 dias do aparelho: busca no servidor, precisa de sinal") e, na lista, o estado
   carregando/sem sinal de sempre.

## 2. Folha Período (`FolhaPeriodo`)
- Título "Período"; toque fora ou Voltar fecha sem mudar nada.
- **Atalhos** (lista de opções de 48 dp, ✓ no ativo): Hoje · Ontem · Esta semana · **Este mês** (padrão) · Mês passado · Este ano.
  **Tocar aplica e fecha.**
- **"Escolher dia, mês ou ano ›"** (texto laranja escuro, 15/700): abre as abas **Dia · Mês · Ano** (`Segmentado compacto`):
  - **Dia:** calendário do mês com ‹ › (não passa do mês de hoje), iniciais D S T Q Q S S, hoje com contorno laranja, dia
    marcado em grafite, ponto nos dias com pedido (`diasMarcados`), dias depois de hoje sem toque;
  - **Mês:** grade 4 × 3 (Jan … Dez) com ‹ ano › (não passa do ano de hoje);
  - **Ano:** os 5 últimos anos (ou `anos`).
  - Tocar no dia, mês ou ano **aplica e fecha**. "‹ Atalhos" volta à lista.
  - Com um dia, mês ou ano em vigor, a folha já abre na aba dele.
- **"Limpar"** (botão neutro, no fim): volta para Este mês e mostra os atalhos; a folha fica aberta. Sem toque se já está no padrão.
- **Gestão:** a mesma folha, com o filtro de vendedor em `extra` (embaixo dos atalhos; ex.: `ListaSuspensa` "Vendedor").
- O comportamento de cada toque é a função pura `eventoDaFolha` (testada em `periodo.test.ts`); a tela só passa `onAtalho`,
  `onEscolher`, `onLimpar` e `onFechar`.

## 3. Textos aprovados (`TextosFolhaPeriodo`)
| Chave | Texto |
|---|---|
| `titulo` | "Período" |
| `fechar` | "Fechar o filtro" |
| `escolher` | "Escolher dia, mês ou ano" (o "›" é o ícone) |
| `voltar` | "Atalhos" |
| `dia` / `mes` / `ano` | "Dia" / "Mês" / "Ano" |
| `mesAnterior` / `proximoMes` | "Mês anterior" / "Próximo mês" |
| `anoAnterior` / `proximoAno` | "Ano anterior" / "Próximo ano" |
| `limpar` | "Limpar" |
| `diaComPedido` | "tem pedido" |
| Botão (`rotulo`) | "Filtrar" (lido "Filtrar, 1 filtro ativo") |
| Etiqueta | o nome do período; dia: "Seg, 02/11/2026"; mês: "Setembro de 2026"; ano: "2025" |

## 4. Desempenho (critério 4; tela do módulo)
Trocar o período ou a situação filtra o que já está na memória (`useMemo`), sem reler o armazenamento nem sincronizar; a lista é
virtualizada (`FlatList` com `keyExtractor` estável e `getItemLayout`). A folha fecha no mesmo quadro do toque: o filtro não
pode esperar a lista para fechar.

## 5. Medidas
| Peça | Medida |
|---|---|
| `BotaoFiltro` | 48 × 48 dp, raio 11, selo 20 dp no canto (borda da cor do fundo) |
| `EtiquetaFiltro` | pílula de 32 dp (`accentSoft`, texto `accentInk` 13/700, 6,3:1) dentro de alvo de 44 dp, sem folga |
| Atalho / "Escolher…" | 48 dp, divisor entre as opções |
| Dia do calendário | 44 dp de altura, 1/7 da largura |
| Mês / Ano | 48 dp, 4 por linha |
| "‹ Atalhos" e setas ‹ › | 48 dp |
