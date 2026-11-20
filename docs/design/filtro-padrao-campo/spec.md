# Filtro padrão no Campo: Rota, Clientes e Performance (simulação)

> **Tipografia substituída** pela fonte do sistema (R-20261115-110600, 15/11/2026): ver o [manual da marca §5](../../marca/manual.md#5-tipografia).

> 2026-11-15 · designer-ux · origem: R-20261115-072200-alexandre (com R-20261115-071600 e as decisões de R-20261115-074500).
> PNGs 360 × 800 (escala 2). Dados de exemplo fictícios.
> Barra de baixo: a real do Campo, `Início · Rota · Clientes · Pedidos · Performance · Mais` (`apps/mobile/src/lib/abas.ts`;
> a Performance fica na barra, R-20261115-084500); na `05` a aba acesa é a Performance.
> Telas: `modules/core/app/telas/rota.tsx`, `clientes.tsx` e `performance/tela-performance.tsx` (modulo-core).

| PNG | O que mostra |
|---|---|
| `01-rota.png` | Rota com cidade e bairro filtrados: selo 2 e duas etiquetas |
| `02-rota-folha.png` | folha "Filtrar" da Rota: cliente, cidade, bairro e data |
| `03-clientes.png` | Clientes com "Devendo": selo 1 e a etiqueta |
| `04-clientes-folha.png` | folha "Filtrar" de Clientes: situação em chips de marcar |
| `05-performance.png` | o filtro na mesma linha de Resultados e Produtividade; dia que não é útil |
| `06-clientes-carteira-vazia.png` | Clientes com a carteira vazia: "Sua carteira está vazia." |

## 0. Regra geral (v1.0.17, R-20261120-055304 item 7; vale para todas as telas do Campo)
- **Tudo o que é filtro fica dentro do `BotaoFiltro`** (folha "Filtrar"): busca, situação, chips, período, cidade, filial. Fora
  do botão, na tela, só as `EtiquetaFiltro` do que está ativo.
- **Exceções, duas** (`CampoBusca` na tela, ao lado do `BotaoFiltro`; R-20261120-062210):
  1. a busca do Catálogo, com a chave "Só com estoque" logo abaixo dela (R-20261120-055304 item 12);
  2. a busca de Clientes, por código, CNPJ, razão social ou nome fantasia (§3).
- Por isso a busca de Pedidos entra na folha como grupo **Cliente**, e os chips de família e sistema do Catálogo entram na
  folha como grupos. Telas e donos: `docs/design/campo-v1017/spec.md`.
- O `Segmentado` da Performance (Resultados · Produtividade) troca a vista, não filtra: fica na tela.

## 1. O padrão (igual a Pedidos)
- `BotaoFiltro` (48 dp, selo com a contagem) à direita da linha de cima da tela; `EtiquetaFiltro` removível embaixo, uma por
  filtro ativo (`packages/ui/src/mobile/filtro.tsx`, `pedidos-filtro-periodo.md`). O padrão de cada tela não conta e não vira etiqueta,
  exceto a filial do Catálogo (pedido do dono do produto).
- **Uma folha só, "Filtrar"** (componente novo do kit, `FolhaFiltro`): título, ✕ e grupos com rótulo (`t.label`, 12/600 `ink2`). Tipos de grupo:
  opções de 48 dp com ✓ (escolha única), chips de marcar (vários) e campo de escolha de 48 dp que abre a lista (ou a `FolhaPeriodo`, para data).
- **Um grupo só** (Performance): tocar aplica e fecha; embaixo, `Limpar` (neutro). **Vários grupos** (Catálogo, Rota, Clientes):
  rodapé com `Limpar` (neutro) e `Ver 4 visitas` / `Ver 5 clientes` (principal, 52 dp), que fecha; a contagem acompanha a escolha.
- A contagem da lista vai para o subtítulo da faixa, como em Clientes: `4 de 12 visitas`, `5 de 86 na carteira`. O que já está numa
  etiqueta não se repete no subtítulo (RD-0499: `4 de 12 visitas · 38 km`, sem a cidade).

## 2. Rota
- Linha de cima: a tag `2 feitas` à esquerda e o `BotaoFiltro` à direita (a linha já existia, só com a tag). Com filtro, a tag
  conta as visitas filtradas (2 das 4), como o subtítulo.
- Folha: **Cliente** (busca por nome ou código), **Cidade** e **Bairro** (listas tiradas das paradas da rota; o bairro segue a
  cidade escolhida) e **Data** (abre a `FolhaPeriodo` na aba Dia; padrão `Hoje`).
- Etiquetas: `Boa Vista ✕`, `Centro ✕`, `Oficina do Raimundo ✕`, `Ter, 18/11 ✕`. Com outra data, a tela mostra a rota inteira daquele
  dia (R-20261115-074500) e o título vira `Rota`: a data fica só na etiqueta (RD-1235).
- Mapa e lista mostram só as paradas filtradas; a numeração continua a da rota (2, 5, 7, 9).

## 3. Clientes
- A busca fica na tela (exceção do §0), ao lado do `BotaoFiltro`. A linha de situações (Curva A, Sem compra 45+, Devendo, Não positivados) sai da tela e
  vira o grupo **Situação** da folha, em chips de marcar (decidido em R-20261115-074500). Cada chip marcado aparece como `EtiquetaFiltro` (`Devendo ✕`).
- A etiqueta da situação marcada no filtro não se repete nas linhas (RD-0500): com `Devendo`, a linha mostra o nome, "Visitado
  há…" e o ›. Com 2 situações marcadas, a linha mostra a que a distingue.
- **Carteira vazia** (RD-0501, modulo-core): `EstadoVazio` com o ícone `users` e uma frase só, `Sua carteira está vazia.`; o
  subtítulo `0 na carteira` sai, porque diz o mesmo, e a linha de busca e o filtro também saem (RD-0504): não há o que
  buscar nem filtrar. `Nenhum cliente com esses filtros.` fica só quando há filtro ou busca.

## 4. Performance
- A linha própria do filtro sai. `Segmentado` (Resultados · Produtividade, `flex: 1`) e `BotaoFiltro` na mesma linha, `gap: 8`.
- O período continua na linha de baixo (`Novembro de 2026` · `DU 11 de 23 · 12 restantes`); fora do padrão, vira etiqueta (`Outubro de 2026 ✕`).
- Em dia que não é útil (RD-0502, modulo-core): `Não é dia útil · 11 restantes`, no lugar do "DU — de 23".

## 5. Pedidos (`modules/vendedor/app/screens/orders-screen.tsx`, modulo-vendedor)
- A busca "Cliente ou nº" sai da tela e entra na folha "Filtrar" como grupo **Cliente** (`CampoBusca` dentro da `FolhaFiltro`),
  junto da situação e do período; busca ativa vira `EtiquetaFiltro` (`"Raimundo" ✕`). Peças: `BotaoFiltro`, `FolhaFiltro`,
  `CampoBusca`, `EtiquetaFiltro`.
