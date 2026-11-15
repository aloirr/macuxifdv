# Filtro padrão no Campo: Rota, Clientes e Performance (simulação)

> 2026-11-15 · designer-ux · origem: R-20261115-072200-alexandre (com R-20261115-071600). **Simulação para aprovação**: nada
> muda no código antes do "aprovado" do dono do produto. Fonte: `filtro-padrao-campo.html` (`?v=rota|rota-folha|clientes|clientes-folha|performance`),
> com o CSS de `../catalogo-campo-v2/simulacao.css`. PNGs 360 × 800 (escala 2). Dados de exemplo fictícios.
> Telas: `modules/core/app/telas/rota.tsx`, `clientes.tsx` e `performance/tela-performance.tsx` (modulo-core). O Catálogo está em `../catalogo-campo-v2/spec.md`.

| PNG | O que mostra |
|---|---|
| `01-rota.png` | Rota com cidade e bairro filtrados: selo 2 e dois chips removíveis |
| `02-rota-folha.png` | folha "Filtrar" da Rota: cliente, cidade, bairro e data |
| `03-clientes.png` | Clientes com "Devendo": selo 1 e o chip |
| `04-clientes-folha.png` | folha "Filtrar" de Clientes: situação em chips de marcar |
| `05-performance.png` | o filtro na mesma linha de Resultados e Produtividade |

## 1. O padrão (igual a Pedidos)
- `BotaoFiltro` (48 dp, selo com a contagem) à direita da linha de cima da tela; `EtiquetaFiltro` removível embaixo, uma por
  filtro ativo (`packages/ui/src/mobile/filtro.tsx`, `pedidos-filtro-periodo.md`). O padrão de cada tela não conta e não vira chip,
  exceto a filial do Catálogo (pedido do dono do produto).
- **Uma folha só, "Filtrar"** (componente novo do kit, `FolhaFiltro`): título, ✕ e grupos com rótulo (13/600 `ink2`). Tipos de grupo:
  opções de 48 dp com ✓ (escolha única), chips de marcar (vários) e campo de escolha de 48 dp que abre a lista (ou a `FolhaPeriodo`, para data).
- **Um grupo só** (Catálogo, Performance): tocar aplica e fecha; embaixo, `Limpar` (neutro). **Vários grupos** (Rota, Clientes):
  rodapé com `Limpar` (neutro) e `Ver 4 visitas` / `Ver 5 clientes` (principal, 52 dp), que fecha; a contagem acompanha a escolha.
- A contagem da lista vai para o subtítulo da faixa, como em Clientes: `4 de 12 visitas`, `5 de 86 na carteira`.

## 2. Rota
- Linha de cima: a tag `3 feitas` à esquerda e o `BotaoFiltro` à direita (a linha já existia, só com a tag).
- Folha: **Cliente** (busca por nome ou código), **Cidade** e **Bairro** (listas tiradas das paradas da rota; o bairro segue a
  cidade escolhida) e **Data** (abre a `FolhaPeriodo` na aba Dia; padrão `Hoje`).
- Chips: `Boa Vista ✕`, `Centro ✕`, `Oficina do Raimundo ✕`, `Ter, 18/11 ✕`. Com outra data, o título vira `Rota de ter, 18/11`.
- Mapa e lista mostram só as paradas filtradas; a numeração continua a da rota (2, 5, 7, 9).

## 3. Clientes
- `CampoBusca` + `BotaoFiltro` na mesma linha. A linha de chips (Curva A, Sem compra 45+, Devendo, Não positivados) sai da tela e
  vira o grupo **Situação** da folha (chips de marcar). Cada chip marcado aparece como `EtiquetaFiltro` (`Devendo ✕`).
- Para o modulo-core (achado da ponte): com a carteira vazia, o vazio deve dizer que a carteira está vazia, e não "Nenhum
  cliente com esses filtros".

## 4. Performance
- A linha própria do filtro sai. `Segmentado` (Resultados · Produtividade, `flex: 1`) e `BotaoFiltro` na mesma linha, `gap: 8`.
- O período continua na linha de baixo (`Novembro de 2026 · DU 11 de 23 · 12 restantes`); fora do padrão, vira chip removível (`Outubro de 2026 ✕`).

## 5. Perguntas ao dono do produto
1. **Clientes:** os chips de situação saem da tela e vão para a folha, como na simulação? Ou ficam na tela e o botão filtra outras coisas (cidade, bairro)?
2. **Rota:** a data no filtro mostra a rota de outro dia (passado ou futuro) inteira, como na simulação?
