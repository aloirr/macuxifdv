# Parecer de marca · Catálogo onda 1 (v2) e Catálogo Campo v8 · meta v1.0.13

> 2026-11-15, ~12h (Manaus) · design-de-marca · pedido do gerente-projetos, validação de cor e layout antes do lote (corte 15h30).
> **Base:** `origin/main` `2e554c4a`, contra `docs/marca/manual.md` v1 (com MC-0004 B, MC-0014 A e MC-0054 a MC-0056) e `decisoes.md`.
> **Branches revistos** (`git diff origin/main...<branch>`, só leitura):
> 1. `nuvem/catalogo-onda1-designer-ux` `87943b16` (spec `docs/design/carga-em-segundo-plano.md`, kit `carga-fundo*.ts(x)`, `EstadoVazio` sem título, simulações `2026-11-15-catalogo-carregando*.png`);
> 2. `nuvem/catalogo-onda1-engenheiro-apps` `541522ce` (`apps/mobile/src/components/carga-fundo.tsx`, `(tabs)/_layout.tsx`, `lib/carga-fundo.ts`, `tela-carga.tsx`);
> 3. `nuvem/catalogo-campo-modulo-catalogo-v8` `c9bfdff0` (head na hora da leitura; recebe correções de redundância), comparado com a spec liberada `nuvem/catalogo-campo-designer-ux` (`docs/design/catalogo-campo-v2/spec.md`, `catalogo-grade.md`; liberação de marca `5b4114ea`).
>
> **Continua:** `2026-11-15-catalogo-onda1.md` (MC-0120 a MC-0122, branch `nuvem/catalogo-onda1-design-de-marca`) e `2026-11-15-T-0176-catalogo-v2-codigo.md` (MC-0130 a MC-0133, branch `nuvem/catalogo-v2-codigo-design-de-marca`). Sem número novo: nada novo fere o manual.
> **Como:** leitura do diff e dos tokens (`packages/ui/src/mobile/tokens.ts`) e conferência visual da simulação 3 (360 × 800). As telas React Native não rodam nesta sessão: o reteste fecha no print do aparelho.
> **Recados:** a CLI de recados responde HTTP 403 nesta sessão; os recados ficam com o gerente (texto no fim).

## Veredito por item
| Item | Veredito |
|---|---|
| 1 · designer-ux (indicador e `CatalogoCarregando`) | **liberado** |
| 2 · engenheiro-apps (shell) | **liberado**; a MC-0121 (baixa) segue aberta e pode ir no lote seguinte |
| 3 · modulo-catalogo v8 | **liberado com ajustes**: cores conformes; MC-0130 a MC-0133 seguem abertas. A MC-0131 e a MC-0132 (médias) são corrigidas antes do build |

## 1. `nuvem/catalogo-onda1-designer-ux` (`87943b16`): liberado
O que mudou desde `b63e1e3b` (já conferido no parecer anterior) é só o vazio da aba Catálogo, agora sem ícone e sem título (RD-0671), e o título do `EstadoVazio` passa a ser opcional.

| Item | Conferido |
|---|---|
| Lugar do indicador | Colado em cima da barra de abas, fora da faixa Azul noite. Preserva o cabeçalho Azul noite que começa na barra de status (manual §4). Correto não pôr no topo |
| Cor da linha | Fundo `ground` = Pérola `#F8F6F1`; ícone 14 e texto em `ink2` `#4A5562` (7,03:1 no Pérola). Tudo por token, sem hex solto (`carga-fundo-rn.tsx:87-93`) |
| Barra de 2 dp | Preenchimento `grafico` = Sol laranja `#C2540A` (papel de gráfico, §3; 4,26:1 no Pérola, acima de 3:1) e trilho `lineSoft` = Névoa `#ECEEF1`. Laranja não vira texto |
| Não é aviso | Sem âmbar, sem "!" e sem verde: "Catálogo 63%" e "· parado" são informação. O único âmbar da tela 3 é o selo "Sem sinal" do cabeçalho, que já existia (`warningBg` e `warningInk` do kit) |
| Tipografia | `fonts.semibold` 12, números tabulares, pelo token. Fica dentro da escala do app tanto na regra de hoje como na fonte do sistema aprovada (R-20261115-110600: mínimo 12, peso 600 de ênfase) |
| `CatalogoCarregando` | Na aba, só "Busque quando tiver sinal." em `ink2` no Pérola; na ficha e no Novo pedido, `wifiOff`, "Catálogo ainda carregando" e o texto (`comTitulo`). É o `EstadoVazio` do kit, sem cor nem forma nova. A voz é de campo ("sinal") |
| Simulação 3 | Faixa Azul noite com o título branco, selo "Sem sinal", busca, o texto e a linha "Catálogo 63% · parado" sobre as abas, com a barra laranja a 63%. Só cores da paleta |

## 2. `nuvem/catalogo-onda1-engenheiro-apps` (`541522ce`): liberado
| Item | Conferido |
|---|---|
| Montagem | `(tabs)/_layout.tsx`: `<CargaEmFundo />` logo acima do `<TabBar>`, no mesmo `tabBar`. Uma linha só, em todas as abas, fora das telas empilhadas. É o lugar da spec |
| Componente | `carga-fundo.tsx` usa o `IndicadorCargaFundo` do kit, sem estilo próprio, sem cor nem hex |
| Detalhe da carga | O toque abre `/sync?detalhe=1`, a tela de entrada aprovada em 12/11 (Azul noite, logo empilhado negativo, barra no Sol claro). Sem desenho novo |
| Gestão | O mesmo indicador ("Aprovações n%") no Pérola. Não mexe no ícone nem na splash |

**Segue aberta, MC-0121 (baixa, engenheiro-apps, cc designer-ux):** `apps/mobile/src/lib/carga-fundo.ts:71` passa `percentualDaCarga(estado, 'carregando')` (a carga inteira) com o nome de uma etapa ("Catálogo 63%"), e a spec §1 diz "percentual da etapa". Ou o shell passa o percentual da etapa nomeada, ou o designer-ux troca a spec e o comentário do kit para "percentual da carga". Coerência de rótulo e número; não muda cor nem layout e pode ir no lote seguinte.

## 3. `nuvem/catalogo-campo-modulo-catalogo-v8` (`c9bfdff0`): liberado com ajustes
### Conforme
| Item | Conferido |
|---|---|
| Sem hex solto | O diff de `modules/catalogo/app` não traz `#hex` nem `rgb` |
| "Estoque: N" em duas cores | `ChipEstado` `sucesso` (> 0, `#1D6B4F` no `#E2F1EA`, 5,51:1) e `erro` (≤ 0, `#A8261B` no `#FDE8E6`, 6,04:1). Sem âmbar, como aprovado |
| "999+" | `tagDeEstoque` aplica `999+` só no cartão (`noCartao`); a ficha e a folha trazem o exato. Atende a condição de cabimento do parecer `5b4114ea` |
| Botão `pacote` do cartão | Quadro de 32 dp, borda `lineStrong` `#C9CED5`, ícone 18 em `ink`, `hitSlop` 8, à direita do chip (`estoque-filial.tsx:11-16`) |
| Folha "Estoque por filial" | `Folha` do kit; cabeçalho Filial \| Estoque `ink2` 13/600 na `neutralBg` (6,53:1), linha de 48 dp com divisória `lineSoft`, número 16 tabular em `success`/`danger` no branco (6,43:1 e 7,10:1) |
| Ficha | `ChipEstado` "Estoque: N" e o botão `outline` 48 dp "Por filial" com o `pacote`, lado a lado |
| Faixa | Faixa Azul noite do `Screen` com a filial de cadastro no subtítulo ("Boa Vista · 40 produtos") em `#C9CED5`, sem cor nova |
| Chip "Suas filiais (N)" | `EtiquetaFiltro` do kit (Azul noite na pílula `#DFE2E6`, 9,83:1), sem ✕ no padrão e com ✕ na filial escolhida; só aparece com mais de uma filial de venda, como na prancha `01` e `02` |
| Botão Filtrar | `BotaoFiltro` do kit com o selo de contagem, ao lado da busca |

### Seguem abertas (do parecer `2026-11-15-T-0176-catalogo-v2-codigo.md`; conferidas de novo em `c9bfdff0`)
| ID | Onde | Gravidade | Correção | Dono |
|---|---|---|---|---|
| MC-0130 | `modules/catalogo/app/telas/comum.tsx:173` (`g.codigo` em `fonts.displayBold`) | baixa | Código do produto como na spec §1.3: 13/700 `ink`, `lineHeight: 18`, `fontVariant: ['tabular-nums']`, pelo token de texto (`fonts.bold`), não pelo de título. Quando o kit migrar para a fonte do sistema (R-20261115-110600, §5.1: código em monoespaçada), o designer-ux diz o token final | modulo-catalogo |
| MC-0131 | `comum.tsx:130` (`altura={112}`), `:131` (`numberOfLines={2}`), `:165` (`g.nome` 15/600) | média | Spec §1.1 e §1.2 aprovadas: `altura={96}`, `numberOfLines={3}`, `nome: { fontFamily: fonts.displayBold, fontSize: 16, lineHeight: 20, minHeight: 60, color: colors.ink }`. Sem isso, os códigos não ficam alinhados nos dois cartões da linha e o cartão cresce | modulo-catalogo |
| MC-0132 | `estoque-filial.tsx:76` (`rodape` da `Folha`), `:90-91` e `:121-122` (Limpar), `:101-104` e `:120` (`Opcao`) | média | Folha "Filtrar" igual à de Pedidos (spec §4, prancha `06`): sai o `rodape`; no fim, `<Botao nivel="neutro" rotulo="Limpar" …/>` e `<Botao nivel="principal" rotulo={textoVer} …/>` (Azul noite, 52 dp); opção marcada em `fonts.bold`, divisória `colors.line` a partir da 2ª opção, `<Icon name="check" size={18} color={colors.accent} strokeWidth={2.6} />` | modulo-catalogo |
| MC-0133 | `produto.tsx:93` (subtítulo da faixa) e `:130` (`<BotaoCopiarCodigo codigo={item.erp_code} />`, variante `ficha`) | baixa | Spec §2, prancha `03`: faixa com `980 · Travex · PAF.1434 [copiar]` (copiar `variante="icone"` sobre a faixa, borda `colors.faixaTrilho` `#3A4D68`) e, embaixo, `PC · EAN …`; sai a caixa "Copiar código" da linha 130; divisória `lineSoft` entre o preço e a linha do "Estoque: N" | modulo-catalogo |

### Dependência (sem MC)
O ícone `pacote` ainda não está em `packages/ui/src/mobile/icon.tsx` no `main` nem no v8: está só em `nuvem/catalogo-campo-designer-ux`. O PR do modulo-catalogo entra depois do PR do kit do designer-ux, senão o typecheck falha. Para o gerente ordenar os merges.

## Fora da marca (encaminhar, não catalogado)
- Subtítulo da faixa "Boa Vista · 40 produtos" × spec §4 "Sua filial: Boa Vista · …": texto de interface (designer-ux e corretor-redundancias).
- MC-0120 (média) e MC-0122 (baixa), do parecer anterior: estão nos branches da onda 1 do modulo-catalogo e do modulo-vendedor, fora deste pedido. Seguem abertas até o print.

## Reteste
Print do aparelho, Campo, a 360 dp: Início e Catálogo com o indicador (com e sem sinal); catálogo sem sinal durante a carga; grade com nome de 3 linhas e "Estoque: 999+"; ficha; folhas "Filtrar" e "Estoque por filial". Só o Alexandre aprova a marca.

## Recados (texto pronto; CLI com HTTP 403)
- **design-de-marca → modulo-catalogo** (cc gerente-projetos): "Catálogo Campo v8 (`c9bfdff0`): cores conformes. MC-0131 e MC-0132 (médias) antes do build; MC-0130 e MC-0133 (baixas) com a correção pronta. Detalhe em docs/marca/pareceres/2026-11-15-catalogo-onda1-v2.md."
- **design-de-marca → engenheiro-apps** (cc designer-ux, gerente-projetos): "Onda 1: shell liberado. MC-0121 (baixa) segue: percentual da carga inteira com o nome da etapa; alinhe com o designer-ux no lote seguinte."

## Re-validação v8 (`e390219f`, antes `c9bfdff0`)
> **Pedido:** gerente-projetos, 15/11/2026, meta v1.0.13. Leitura de `git diff c9bfdff0..e390219f` e dos tokens no próprio v8 (`packages/ui/src/comum/contraste.ts`, `packages/ui/src/mobile/tokens.ts`, `ui.tsx`, `icon.tsx`). O `fe2d0402` no meio (estoque nulo sem filial de venda, RN-CAT-05) não muda cor, forma nem texto de marca. Sem PNG: o reteste final fecha no print do aparelho.

| MC | Conferido em `e390219f` | Situação |
|---|---|---|
| MC-0130 | `comum.tsx` `g.codigo`: `fonts.bold` 13, `lineHeight: 18`, `ink`, `tabular-nums`. Sai o token de título | **fechada** |
| MC-0131 | `altura={96}`, `numberOfLines={3}`, `g.nome`: `fonts.displayBold` 16/20, `minHeight: 60`, `ink`. Igual à spec §1.1 e §1.2 | **fechada** |
| MC-0132 | Sai o `rodape` da `Folha`; no fim, `Botao` do kit `neutro` "Limpar" e `principal` com `textoVer` (Azul noite). Opção marcada em `fonts.bold`; divisória `colors.line` (`#DFE2E6`) a partir da 2ª opção de cada grupo; check 18, traço 2,6, `accent`. Sem `Pressable` nem estilo próprio de botão | **fechada** |
| MC-0133 | Copiar na faixa (`variante="faixa"`, pelo `direita` do `CabecalhoTela`): ícone 20 em `faixaTitulo` (branco no Azul noite), borda 1 `faixaTrilho` `#3A4D68`, toque em `faixaTrilho`. Sai a caixa "Copiar código" do corpo. Divisória `lineSoft` (Névoa `#ECEEF1`) entre o preço e o "Estoque: N". Nenhuma cor fora da faixa aprovada | **fechada neste lote**, com o resíduo abaixo |

### Resíduo da MC-0133 (aceito para este lote)
A faixa segue com `marca · código · un · EAN` numa linha só e o copiar na linha do título, não ao lado do código, porque o `CabecalhoTela` tem um subtítulo só. Para a marca, o que importa está certo: Azul noite, branco, trilho e nada de cor nova. A 2ª linha (`PC · EAN`) e o copiar ao lado do código são arranjo do kit, não do módulo. **Aceito para v1.0.13.** Vira ajuste do kit no lote seguinte, com dono `designer-ux` (`CabecalhoTela` com 2ª linha de subtítulo ou um espaço ao lado do subtítulo). Depois que o kit mudar, o modulo-catalogo aplica na ficha. Não segura o lote e não ganha número novo.

### Veredito
**Catálogo Campo v8 (`e390219f`): liberado.** As MC-0130 a MC-0133 estão fechadas no código. A conferência final é no print do aparelho, a 360 dp: grade com nome de 3 linhas, ficha com o copiar na faixa e as folhas "Filtrar" e "Estoque por filial". A dependência do ícone `pacote` (PR do kit antes do PR do módulo) continua. Só o Alexandre aprova a marca.

### Recados (texto pronto; CLI com HTTP 403)
- **design-de-marca → modulo-catalogo** (cc gerente-projetos): "Catálogo Campo v8 (`e390219f`) liberado. MC-0130 a MC-0133 fechadas no código; a conferência final é no print. A 2ª linha da faixa (`PC · EAN`) fica para o lote seguinte, depois do ajuste no kit."
- **design-de-marca → designer-ux** (cc gerente-projetos): "Lote seguinte: `CabecalhoTela` com uma 2ª linha de subtítulo, ou um espaço para ação ao lado do subtítulo, para a ficha do produto (spec catalogo-campo-v2 §2, prancha 03: `980 · Travex · PAF.1434 [copiar]` / `PC · EAN …`). Resíduo da MC-0133, baixa."

## Delta final v8 (`1e0a2de01`, antes `e390219f`)
> **Pedido:** gerente-projetos, 15/11/2026, meta v1.0.13. Leitura de `git diff e390219fd..1e0a2de01 -- 'modules/catalogo/app/**'` (commits `57d651efd`, `49ed62502` e `1e0a2de01`) e do `domain` que alimenta a folha (`estoque.ts`, `estoque-campo.ts`), contra a spec `catalogo-campo-v2` §2.1 (aprovada, `origin/nuvem/catalogo-campo-designer-ux`) e os tokens do próprio v8 (`packages/ui/src/mobile/tokens.ts`). Sem PNG: o fecho é no print do aparelho.

| Ponto | Conferido em `1e0a2de01` | Situação |
|---|---|---|
| Marca "sua filial" | `estoque-filial.tsx` `e.sua`: `fonts.body` 13, `colors.ink2` (`#4A5562`, cerca de 7,5:1 sobre branco), em linha própria abaixo do nome (15 `ink`), sem chip, sem cor de destaque. É o mesmo estilo do apoio do "Filtrar". Só a filial de cadastro recebe a marca (`propria = branch_id === filialCadastro`) | conforme a spec §2.1 |
| Ordem | cadastro primeiro e as outras por `ordemPorNome` (`localeCompare` pt-BR), no `estoqueVisivel`. A folha não reordena | conforme |
| Linha "0" da filial de venda sem saldo | quantidade 0, `corDoEstoque(0)` = `erro` → `colors.danger` `#A8261B` (7,1:1), Archivo 700 16, tabular, à direita, igual às outras linhas. O número sempre aparece e a cor nunca fica sozinha | conforme a spec §2.1 e §3 |
| Tabela | cabeçalho 13/600 `ink2` sobre `neutralBg`, 36 dp; linha 48 dp com divisória `lineSoft`. Sem mudança | conforme |
| Título da folha | passa a vir direto de `TITULO_FOLHA_ESTOQUE` ("Estoque por filial"). Mesmo texto, nada muda na tela | sem efeito de marca |
| Faixa do Catálogo | `subtituloDaGrade(total, cadastro?.nome)`: mesmo texto, mudou só a origem do dado | sem efeito de marca |
| Testes e comentários | `copiar-codigo.test.ts`, `grade.test.ts`, `estoque-folha.test.ts` | fora da marca |

Nenhum hex solto, nenhuma cor ou peso novo, nenhum componente fora do kit. Nenhum achado MC novo.

### Fora da marca (encaminhar, não catalogado)
- `domain/estoque.ts`: quando a filial de venda sem saldo não tem nome no aparelho, a linha usa o texto reserva `Filial <8 primeiros caracteres do id>`. Isso mostra um pedaço do UUID ao vendedor. É texto de interface: dono `modulo-catalogo`, com cópia ao `designer-ux` e ao `corretor-redundancias`.

### Veredito
**Catálogo Campo v8 (`1e0a2de01`): liberado.** A marca "sua filial" e a linha "Estoque: 0" seguem a spec §2.1 e os tokens aprovados. As outras mudanças são refatoração, sem mudança visual. A conferência final é no print do aparelho, a 360 dp, na folha "Estoque por filial", com a filial de cadastro e uma filial de venda sem saldo. O resíduo da MC-0133 e a dependência do ícone `pacote` continuam como estavam. Só o Alexandre aprova a marca.

### Recado (texto pronto; CLI com HTTP 403)
- **design-de-marca → modulo-catalogo** (cc designer-ux, corretor-redundancias, gerente-projetos): "Catálogo Campo v8 (`1e0a2de01`) liberado pela marca: 'sua filial' em 13 `ink2` e a linha 0 em `danger` conferem com a spec §2.1. Fora da marca: o texto reserva `Filial <id>` (`domain/estoque.ts`) mostra um pedaço do UUID ao vendedor quando falta o nome da filial."
