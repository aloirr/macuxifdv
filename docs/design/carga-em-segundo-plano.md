# Carga em segundo plano: indicador discreto e catálogo sem sinal (onda 1 do catálogo, solução 5)

> **Tipografia substituída** pela fonte do sistema (R-20261115-110600, 15/11/2026): ver o [manual da marca §5](../marca/manual.md#5-tipografia).

> 2026-11-15 · designer-ux · origem: aprovação do dono do produto (R-20261115-070200) e desenho do engenheiro-software
> (`docs/desenho/T-catalogo-pacote.md`, §2.2 "Indicador discreto" e §5 linha F).
> Simulação: `docs/design/simulacoes/2026-11-15-catalogo-carregando.png` (prancha) e `-1.png`, `-2.png`, `-3.png` (cada tela em
> 360 × 800, escala 2); fonte `2026-11-15-catalogo-carregando.html`.
> Código: `packages/ui/src/mobile/carga-fundo.ts` (textos e medidas, puro) e `carga-fundo-rn.tsx` (componentes), testes em
> `carga-fundo.test.ts`. Quem liga: engenheiro-apps (shell) e modulo-catalogo (tela do catálogo, ficha e busca do Novo pedido).

## 1. `IndicadorCargaFundo` (`@macuxi/ui/mobile`)

| Prop | Tipo | O que faz |
|---|---|---|
| `etapa` | `string` | nome curto da etapa em carga: **"Catálogo"** (Campo) ou **"Aprovações"** (Gestão) |
| `percentual` | `number` (0..100) | percentual da etapa; mostrado inteiro, de 0 a 99 (100% = o shell desmonta) |
| `semSinal?` | `boolean` | aparelho sem sinal: a carga está parada |
| `aoTocar?` | `() => void` | abre o detalhe da carga (a tela de carga do shell, `/sync`, sem redirecionar de volta) |
| `testID?` | `string` | padrão `carga-fundo` (`-texto`, `-barra`) |

**Onde:** o shell monta **uma vez**, colado **em cima da barra de abas**, em todas as abas, enquanto `estado.pendentes` não está
vazio; desmonta ao terminar. Não vai no topo da tela porque o cabeçalho Azul noite começa na barra de status (manual da marca
§4) e a linha cortaria a faixa. Não entra em tela empilhada (Novo pedido, ficha), que esconde as abas.

**Desenho:** linha de 32 dp no Pérola (`ground`); ícone de 14 e texto na fonte do sistema, 600, 12 em `ink2` (7,03:1 no Pérola),
centralizados, números tabulares; barra de 2 dp no pé, trilho `lineSoft` e preenchimento `grafico` (é gráfico, manual §3).
Sem animação própria: a largura troca a cada atualização do percentual (nada a reduzir com "reduzir movimento").

| Estado | Ícone | Texto |
|---|---|---|
| com sinal | `sync` | **Catálogo 63%** |
| sem sinal | `wifiOff` | **Catálogo 63% · parado** |

- Sem sinal, a palavra é "parado" e não "sem sinal": a causa já está no botão "Sem sinal" do Início (uma informação, um
  lugar). O ícone e o TalkBack dão a causa.
- **Não é aviso** (RN-VEN-42): sem cor de alerta, sem fundo âmbar, sem "!" e sem entrar nos Alertas.
- **Fora da linha** (R-20261110-192153): "carregando em segundo plano", "baixando", "aguarde", "você já pode usar o app",
  contagem de registros, tamanho do arquivo e hora prevista.

**Toque e acessibilidade:** com `aoTocar`, é botão (`accessibilityRole="button"`), alvo de 48 dp (32 + `hitSlop` de 8 em cima
e embaixo), sem escala ao tocar (é uma linha, não um botão); rótulo "Catálogo carregando, 63%" (sem sinal: "Catálogo
carregando, 63%, parado sem sinal"), dica "Abre o detalhe da carga", `accessibilityValue` 0..100. Sem `aoTocar`, é
`progressbar`, só informa. Sem região viva: o TalkBack não anuncia cada percentual.

## 2. `CatalogoCarregando` (`@macuxi/ui/mobile`) — catálogo sem sinal durante a carga

Quando o Catálogo está pendente e o aparelho está sem sinal (a busca online não tem como ir), a tela do catálogo, a ficha do
produto e a busca da aba Itens do Novo pedido mostram, no lugar da lista ou da ficha, o `EstadoVazio` do kit. A prop
`comTitulo` (padrão `false`) decide o que vai nele:

| Onde | Uso | O que aparece |
|---|---|---|
| Aba Catálogo (lista) | `<CatalogoCarregando />` | só o texto **"Busque quando tiver sinal."** |
| Ficha do produto e busca do Novo pedido | `<CatalogoCarregando comTitulo />` | ícone `wifiOff`, título **"Catálogo ainda carregando"** e o texto |

Na aba, o indicador "Catálogo 63% · parado" (com `wifiOff`) e o selo "Sem sinal" do cabeçalho já dizem que o catálogo está
carregando e sem sinal; o vazio fica só com o que fazer (uma informação, um lugar; RD-0671). A ficha e o Novo pedido não
mostram o indicador, por isso levam o título.

Textos em `TITULO_CATALOGO_CARREGANDO` e `TEXTO_CATALOGO_CARREGANDO`; o desenho puro é `desenhoCatalogoCarregando({ comTitulo })`
(`@macuxi/ui/mobile/puro`). Com sinal, nada disso aparece: a busca vai à
API com o preço do cliente.

## 3. Fora desta spec
Ordem das etapas e liberação da entrada (modulo-core, RN-CORE-48), montagem e rota do detalhe (engenheiro-apps), busca online
e filtros desligados durante a carga (modulo-catalogo). Mudança visual: parecer do design-de-marca e do corretor-redundancias
no print do aparelho antes do lote.
