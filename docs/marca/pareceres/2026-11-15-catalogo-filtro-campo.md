# Parecer de marca · simulação do Catálogo v2 e do filtro padrão do Campo

> 2026-11-15 · design-de-marca · pedidos R-20261115-071600-alexandre (Catálogo) e R-20261115-072200-alexandre (filtro padrão).
> **Base:** branch `nuvem/catalogo-campo-designer-ux`, commit `4cecf05e94196720e1d3eca9250b5224695fdb1e`. Pastas `docs/design/catalogo-campo-v2/` (spec, `simulacao.css`, HTML e 6 PNGs) e `docs/design/filtro-padrao-campo/` (spec, HTML e 5 PNGs). Conferido contra `docs/marca/manual.md` v1 (§3 paleta e neutros MC-0004 B, §4 layout, §5 tipografia), com o kit atual de referência (`packages/ui/src/mobile/filtro.tsx`, `folha.tsx` e `sincronizacao.tsx` no `main`).
> **Como:** li os 11 PNGs e as duas specs, levantei todos os hex do CSS e dos HTML e calculei o contraste dos pares novos (WCAG).
> **Numeração:** MC-0086 (a última em uso nos branches da marca é MC-0085).

## Veredito: **liberado com ajustes**
Nada fere a identidade nas telas propostas: cor, tipografia, hierarquia e o padrão do filtro estão de acordo. Falta um ajuste baixo **na própria simulação** (MC-0086): o mapa da Rota e o fundo da foto do produto usam neutros esverdeados, que o Alexandre tirou da marca em 14/11. Como os PNGs vão para ele aprovar, a imagem precisa mostrar a cor certa. Basta corrigir o CSS e gerar de novo os PNGs; a spec não muda.

## O que está conforme
- **Cor, por token do kit:** fundo Pérola, cartões brancos, faixa Azul noite com o subtítulo em `#C9CED5`, linhas `#DFE2E6`/`#ECEEF1`/`#C9CED5`, botão principal Azul noite e laranja só no selo do contador e na barra de meta. Nenhuma cor nova e nenhuma "quase igual" dentro das telas, fora a MC-0086.
- **Contraste dos pares novos:**

  | Par | Razão |
  |---|---|
  | `0 em estoque`, `#A8261B` no `#FDE8E6` | 6,04 |
  | `6 em estoque`, `#7A4F00` no `#FFF1D6` | 6,38 |
  | `28 em estoque`, `#1D6B4F` no `#E2F1EA` | 5,51 |
  | etiqueta do filtro e realce da referência, Azul noite no `#DFE2E6` | 9,83 |
  | código `980`, grafite no branco | 16,48 |
  | marca e código do fabricante, `#4A5562` no branco | 7,59 |
  | selo do filtro, branco no Sol laranja | 4,60 |
  | código e copiar na faixa, branco no Azul noite | 12,77 |

- **"0 em estoque" na cor de erro:** está certo para a marca. É situação e vem sempre com texto (§3: "só para situação, sempre com texto"), e a escala verde / âmbar / vermelho é a mesma das outras tags de estoque. Tratar "sem informação" como 0 é decisão de negócio do Alexandre (spec §3), e a marca não se opõe.
- **Copiar na faixa da ficha:** borda em `faixaTrilho` `#3A4D68`, o mesmo token do selo de sincronização da faixa (`sincronizacao.tsx`, `seloFaixa`), com ícone branco (12,77:1). Fica coerente com o que já existe.
- **Tipografia:**
  - Nome do produto em Archivo Bold 16/20, até 3 linhas. É título do cartão, e Archivo serve para títulos e números (§5).
  - Preço em Archivo Bold 18 (cartão) e ExtraBold 24 (ficha), com algarismo tabular.
  - Código em Plex Sans Bold 13; marca e código do fabricante em Plex 13 `ink2`.
  - Título da folha em Archivo ExtraBold 19, igual ao da `Folha` do kit.
- **Hierarquia do cartão:** nome, foto, códigos, preço e estoque. O nome grande, que o Alexandre pediu, lidera a leitura sem brigar com o preço: o nome é mais longo e o preço é maior e isolado embaixo. O espaço mínimo de 3 linhas do nome mantém a grade alinhada (sobra uma linha em branco nos nomes de 2 linhas, o que é aceitável).
- **Filtro igual ao de Pedidos:**
  - `BotaoFiltro` de 48 dp com borda grafite quando ativo e selo laranja com a contagem.
  - `EtiquetaFiltro` em pílula Azul suave com texto Azul noite e ✕.
  - Folha com o título "Filtrar", grupos com rótulo 13/600 `ink2`, opções de 48 dp com ✓, "Limpar" neutro e o principal Azul noite de 52 dp ("Ver 4 visitas").

  O mesmo desenho aparece no Catálogo, na Rota, em Clientes e em Performance. A `FolhaFiltro` proposta não traz nada visual novo, só reúne o que o kit já tem: liberada para a marca.
- **Performance:** o `Segmentado` e o filtro na mesma linha, e a barra de meta no Sol laranja (o papel dele, §3).

## Achado
### MC-0086 · neutros esverdeados no mapa e no fundo da foto da simulação · baixa
| Campo | Conteúdo |
|---|---|
| Onde | `docs/design/filtro-padrao-campo/filtro-padrao-campo.html:11` (`.mapa`: fundo `#E6E9E1`, borda `#D3D8CC`), visível em `01-rota.png` e `02-rota-folha.png`. `docs/design/catalogo-campo-v2/simulacao.css`, `.foto.img` (fundo `#F1F2EE`), visível em `01-grade.png`, `02-grade-filtrada-filial.png` e `04-busca-referencia-cruzada.png` |
| Tipo | cor |
| Fere | §3, neutros de interface (MC-0004 B, aprovado em 14/11): o fundo do mapa é a Névoa `#ECEEF1` e a borda do mapa é `#C9CED5`. Os esverdeados saíram "em tokens, CSS e PDF". `#E6E9E1` é "quase igual" ao `#E6E9E2`, que já foi tirado |
| Correção | `.mapa { background: #E6E9E1; border: 1px solid #D3D8CC }` → `background: var(--neutralBg) /* #ECEEF1 */; border: 1px solid var(--lineStrong) /* #C9CED5 */`. `.foto.img { background: #F1F2EE }` → `background: var(--neutralBg)` (o mesmo da foto vazia). Gerar de novo os 5 PNGs afetados. No app, o mapa já usa `colors.mapBg` (Névoa) e `colors.mapBorder` (`#C9CED5`), em `packages/ui/src/mobile/tokens.ts:73-74`. Na implementação do cartão novo, o fundo da foto sai pelo `colors.neutralBg`, sem hex |
| Dono | designer-ux |

## Fora deste parecer
- **Marcador verde no mapa da Rota:** o círculo verde da parada feita no mapa, sem texto ao lado, já existe no app (`modules/core/app/telas/rota.tsx:113`). Não faz parte desta entrega, e na lista a parada leva "Feita". A marca registra o ponto para a próxima auditoria do Campo, sem segurar esta simulação.
- **As perguntas ao Alexandre** (os dois códigos, o copiar, a ordem do cartão, a filial, os chips de Clientes e a data da Rota) são de produto. Nenhuma das respostas muda cor ou tipografia.
- **O vazio de Clientes atrás da folha** (`04-clientes-folha.png` sem a lista ao fundo) é acabamento da simulação, do corretor ou do próprio designer-ux.

## Para o Alexandre
Depois da MC-0086, as duas simulações seguem para ele sem ressalva de marca. Só ele aprova.
