# Parecer de marca · Catálogo v2 no Campo (T-0176), código

> 2026-11-15, 09h49 (Manaus) · design-de-marca · pedido do gerente-projetos (sessão de revisão).
> **Base:** branch `nuvem/catalogo-campo-modulo-catalogo-v7`, commit `cbb926bb` (modulo-catalogo, "estoque por filial no Campo", RN-CORE-39), diff contra `origin/main`. Telas: `modules/catalogo/app/telas/catalogo.tsx`, `comum.tsx`, `produto.tsx` e `estoque-filial.tsx` (nova), com `app/lib/grade.ts`, `app/lib/estoque-folha.ts` e `domain/estoque-campo.ts`.
> **Comparado com:** a spec aprovada `docs/design/catalogo-campo-v2/spec.md` e `simulacao.css` (branch `nuvem/catalogo-campo-designer-ux`, `a9f471b1`), o kit do `main` (`packages/ui/src/mobile/tokens.ts`, `theme.ts`, `filtro.tsx`, `folha.tsx`, `base.tsx`) e `docs/marca/manual.md` v1 (§3 paleta, §5 tipografia).
> **Não repete:** a simulação já liberada nos pareceres `2026-11-15-catalogo-filtro-campo.md` (MC-0086 fechada), `2026-11-15-catalogo-v2-estoque.md` (rótulo `Estoque: N` e ícone `pacote`) e `2026-11-15-catalogo-filial-sync.md` (telas 01 a 08; MC-0089 é do BKO, fora daqui).
> **Como:** leitura do código e dos tokens. Não renderizei: as telas são React Native (Expo) e não há prancha web do código; o reteste fecha no print do aparelho.
> **Recados:** `node scripts/coord.mjs caixa design-de-marca` respondeu HTTP 403 (sem acesso ao repositório de recados nesta sessão). Os recados aos donos ficam com o gerente.
> **Numeração:** MC-0130 a MC-0133.

## Veredito: liberado com ajustes
Nada no código fere o manual: não há hex solto nem cor nova, todas as cores saem pelo token e as famílias são as aprovadas. O que falta é **fidelidade à spec aprovada pelo Alexandre** em quatro pontos visíveis ao vendedor (MC-0130 a MC-0133), todos do `modulo-catalogo`, com a correção pronta.

## O que está conforme
| Item | Conferido |
|---|---|
| Cor por token, sem hex | O diff não traz nenhum `#hex` nem `rgb` em `modules/`. Chip: `ChipEstado` com `sucesso`/`erro` (`#1D6B4F` no `#E2F1EA`, 5,51:1; `#A8261B` no `#FDE8E6`, 6,04:1). Folha: `colors.success` e `colors.danger` no branco (6,43:1 e 7,10:1). Cabeçalho da tabela `ink2` na `neutralBg` (6,53:1), linhas `lineSoft` |
| Duas cores só | `corDoEstoque` (`domain/estoque-campo.ts`): verde acima de 0, vermelho em 0, negativo ou sem saldo. Saiu o âmbar `warning` e o `Estoque sem informação` cinza, como aprovado |
| `999+` no cartão | `numeroDoEstoque` aplica `999+` e `−999+` só no cartão; a ficha e a folha trazem o exato. Atende a condição do parecer do ícone (cabe a 360 dp) |
| Botão do cartão | Ícone `pacote` 18 em `ink`, quadro de 32 dp, borda `lineStrong` `#C9CED5`, raio 10, `hitSlop` 8 (`estoque-filial.tsx`, `BotaoEstoquePorFilial`) |
| Botão da ficha | `Button variant="outline" height={48} icon="pacote"`, "Por filial", à direita do chip (13/600) |
| Folha "Estoque por filial" | `Folha` do kit com ✕, `rolavel`, cabeçalho 13/600 `ink2` em 36 dp, linha de 48 dp, nome Plex 15 `ink`, número Archivo 700 16 tabular, apoio 13 `ink2`. Igual à prancha 07 |
| Filtro no topo | `CampoBusca` + `BotaoFiltro` (selo laranja de contagem) e `EtiquetaFiltro` do kit: `Suas filiais (3)` sem ✕, `Filial Manaus ✕`, `Só com estoque ✕` |
| Tom de voz | "Estoque: N", "Por filial", "Estoque por filial", "Filtrar", "Itens sem estoque", "Mostrar/Ocultar": curtos e de quem conhece o campo |

## Achados
### MC-0130 · código do produto no cartão em Archivo, a spec pede Plex · baixa
| Campo | Conteúdo |
|---|---|
| Onde | `modules/catalogo/app/telas/comum.tsx:173` (`g.codigo`) |
| Tipo | tipografia |
| Fere | spec §1.3 aprovada (`PAF.1434` em 13/700 `ink`, IBM Plex Sans; `simulacao.css:62`, `.cods .c`) e manual §5 (Plex no texto; Archivo em título, preço e número) |
| Correção | `codigo: { fontFamily: fonts.displayBold, fontSize: 13, color: colors.ink }` → `codigo: { fontFamily: fonts.bold, fontSize: 13, lineHeight: 18, color: colors.ink, fontVariant: ['tabular-nums'] }` |
| Dono | modulo-catalogo |

### MC-0131 · cartão sem o nome grande e com a foto antiga · média
| Campo | Conteúdo |
|---|---|
| Onde | `modules/catalogo/app/telas/comum.tsx:130` (`altura={112}`), `:131` (`numberOfLines={2}`) e `g.nome` (`fonts.semibold`, 15) |
| Tipo | tipografia · aplicação |
| Fere | spec §1.1 e §1.2 aprovadas (R-20261115-074500): foto 96 dp e nome em Archivo 700 16/20, até 3 linhas, com altura reservada para os códigos ficarem alinhados nos dois cartões da linha. Sem isso a hierarquia aprovada (nome lidera, código em negrito embaixo) não aparece, e com a foto de 112 o cartão cresce |
| Correção | `altura={112}` → `altura={96}`; `numberOfLines={2}` → `numberOfLines={3}`; `nome: { fontFamily: fonts.semibold, fontSize: 15, color: colors.ink }` → `nome: { fontFamily: fonts.displayBold, fontSize: 16, lineHeight: 20, minHeight: 60, color: colors.ink }` |
| Dono | modulo-catalogo |

### MC-0132 · folha "Filtrar" do Catálogo fora do padrão da de Pedidos · média
| Campo | Conteúdo |
|---|---|
| Onde | `modules/catalogo/app/telas/estoque-filial.tsx:79` (`rodape` da `Folha`), `:93-94` e `:125` (Limpar), `:107` e `:122-123` (`Opcao`) |
| Tipo | aplicação · tipografia |
| Fere | spec §4 e prancha `06-folha-filtro.png` aprovadas (filtro "igual ao de Pedidos", R-20261115-072200) e a consistência entre telas equivalentes (checklist C). Hoje: "Ver 1.284 produtos" sai como texto cinza `ink2` 14 (o `rodape` da `Folha` é a ação de texto do tipo "Voltar"), em vez do principal Azul noite de 52 dp; "Limpar" é texto solto `ink2` 15, em vez do `Botao nivel="neutro"` (Névoa, `ink`); a opção marcada não fica em negrito, não há divisória entre as opções e o ✓ é 20/traço 2, em vez de 18/traço 2,6 |
| Correção | Tirar o `rodape` da `Folha` e terminar o conteúdo com `<Botao nivel="neutro" rotulo="Limpar" onPress={onLimpar} testID="catalogo-filtro-limpar" />` e `<Botao nivel="principal" rotulo={textoVer} onPress={onFechar} testID="catalogo-filtro-ver" />` (o mesmo `Botao` de `filtro.tsx:319`). Na `Opcao`: texto marcado em `fonts.bold`; `borderTopWidth: 1, borderTopColor: colors.line` da segunda opção em diante; `<Icon name="check" size={18} color={colors.accent} strokeWidth={2.6} />` (`filtro.tsx:212`, `413-415`). Apagar `e.limpar` e `e.limparTexto` |
| Dono | modulo-catalogo |

### MC-0133 · ficha sem o código e o copiar na faixa · baixa
| Campo | Conteúdo |
|---|---|
| Onde | `modules/catalogo/app/telas/produto.tsx:93` (subtítulo da faixa) e `:130` (`<BotaoCopiarCodigo codigo={item.erp_code} />`, variante `ficha`) |
| Tipo | aplicação |
| Fere | spec §2 e prancha `03-ficha-referencia-cruzada.png` aprovadas: a faixa traz `980 · Travex · PAF.1434 [copiar]` (código em branco, o resto em `#C9CED5`, o copiar com borda `faixaTrilho` `#3A4D68`, já liberado na MC-0086) e, embaixo, `PC · EAN …`; **sai** a caixa própria "Copiar código". Também falta a divisória `lineSoft` entre o preço e a linha do `Estoque: N` no cartão de preço |
| Correção | Subtítulo da faixa em duas linhas: códigos com o copiar `variante="icone"` sobre a faixa (ícone branco, borda `colors.faixaTrilho`, o mesmo do `seloFaixa`) e `unidade · EAN` abaixo; apagar a linha 130. No `Card` de preço, antes do `estoqueLinha`: `<View style={{ height: 1, backgroundColor: colors.lineSoft }} />` |
| Dono | modulo-catalogo |

## Dependência (sem MC)
O ícone `pacote` (aprovado, R-20261115-084600) **não está** em `packages/ui` no `main` nem no branch v7: está só em `nuvem/catalogo-campo-designer-ux`. O PR do modulo-catalogo tem de entrar depois do PR do kit do designer-ux; sem ele o `typecheck` falha e não pode haver ícone de troca local. Para o gerente ordenar os merges.

## Fora da marca (encaminhar, não catalogado)
- **Texto da faixa:** o código mostra `Boa Vista · 1.284 produtos`; a spec §4 diz `Sua filial: Boa Vista · 1.284 produtos`. Texto de interface: corretor-redundancias e designer-ux.
- **"sua filial" e a ordem:** a folha "Estoque por filial" e o grupo Filial do "Filtrar" saem em ordem alfabética, sem a de cadastro primeiro nem a marca `sua filial` (`marcarPropria: false`, `apoio: null`), contra a spec §2.1 e §4. Conteúdo e regra: modulo-catalogo, com o testes.
- **Placeholder e dica da busca** (spec §5) não mudaram neste commit. Texto: designer-ux e corretor.

## Reteste
Fecha no print do aparelho a 360 dp: grade (cartão com nome de 3 linhas e `Estoque: 999+`), ficha, folha "Filtrar" e folha "Estoque por filial". Só o Alexandre aprova a marca.
