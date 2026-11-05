# Guia do visual do app — Campo e Gestão (T-0072)

> 2026-11-03 · designer-ux · referência aprovada: `docs/design/referencia-2026-11-03/Componentes.dc.html`
> Código: `packages/ui/src/mobile` (`tokens.ts`, `movimento.ts` puros; `base.tsx`, `movimento-rn.tsx`, `folha.tsx`, `valores.tsx`, `ui.tsx`).
> Importe sempre de `@macuxi/ui/mobile` (tela) ou `@macuxi/ui/mobile/puro` (lib pura, testes).

## 1. Identidade (não muda sem pedido do Alexandre)
| Token | Valor | Uso |
|---|---|---|
| `colors.accent` | `#C2540A` | botão principal, aba ativa (ícone), barra de progresso, contador |
| `colors.ink` | `#16202A` | texto, botão secundário (borda), cartão escuro (recado), aviso no rodapé |
| `colors.ground` | `#F3F4F1` | fundo das telas |
| `colors.surface` | `#FFFFFF` | cartões, folha, barra de abas |
| `colors.ink2` / `ink3` | `#4A5562` / `#5B6673` | texto secundário / terciário (≥ 4,5:1 no branco) |
| `colors.accentInk` | `#8F3D06` | texto laranja sobre claro (aba ativa, link, cartão em destaque) |

Fontes (já carregadas no shell por `@expo-google-fonts/*`; nenhuma dependência nova): **Archivo** nos títulos e números
(`fonts.display` 800, `displayBold` 700), **IBM Plex Sans** no texto (`body` 400, `medium` 500, `semibold` 600, `bold` 700).
Uma família por peso: não use `fontWeight`.

Tipografia (`type`): `saudacao` 26/800 · `titulo` 19/800 (folha, diálogo) · `secao` 17/700 · `numeroGrande` 19/700 tabular ·
`body` 14 · `sub` 13 · `small` 12 · `rotulo` 12/600 maiúsculas. Os nomes antigos (`h1`, `h2`, `number`…) continuam.

## 2. Espaço, raio, sombra
- `space`: 2 · 4 · 8 · 12 · 16 · 20 · 24 · 32 (`xxs`…`xxxl`).
- `layout`: lateral da tela 20 · topo 28 · **entre blocos 14** · entre cartões 8 · dentro do cartão 12 · dentro da seção 18.
- `radius`: botão 52 → **14**; botão 44 → **12**; cartão **14**; seção (recado) **18**; folha **22**; chip de estado **pílula**.
- `shadow`: o app separa por **borda** (`colors.line`), não por sombra. Sombra só no que flutua: `shadow.folha`, `shadow.aviso`.
- Alvo de toque mínimo **48 dp** (`TOUCH`, `ALTURA.toque`). Visual menor (chip 36, passo 40, Desfazer 36) ganha `hitSlop`.

## 3. Botões em níveis — **um só principal por tela**
| Nível | Componente | Altura | Visual | Quando |
|---|---|---|---|---|
| principal | `<Botao nivel="principal">` · `Button variant="accent"` · `RodapeTotal` | 52 | laranja cheio, texto branco 16 | a ação que fecha a tarefa da tela: Enviar pedido, Começar a rota, Registrar check-in |
| secundário | `<Botao>` (padrão) · `Button variant="outlineDark"` | 44 (`alto` → 52 ao lado do principal) | branco, borda grafite 1,5 | alternativa real: Salvar orçamento, Ver rota |
| neutro | `<Botao nivel="neutro">` · `Button variant="ghost"` | 44 | cinza claro `#ECEEE9` | Cancelar, Voltar, Fechar |
| perigo | `<Botao nivel="perigo">` · `Button variant="danger"` | 44 | rosa `#FDE8E6`, texto vermelho | Rejeitar, Excluir, Descartar |
| desabilitado | `desligado` / `disabled` | do nível | cinza `#E6E9E2`, texto `#5B6673` (sem transparência) | falta dado; diga o motivo perto ("Escolha a forma de pagamento") |
| ocupado | `ocupado` / `loading` | do nível | indicador no lugar do ícone, toque bloqueado | enviando; o texto muda ("Sincronizando…") |

Regras:
- Revisão conta os principais da tela: `nivel="principal"`, `variant="accent"`, `RodapeTotal` e o confirmar do `Dialogo`
  (este só vale dentro do diálogo). Mais de um = 🔴.
- Rótulo = verbo + objeto, até 3 palavras ("Enviar pedido", não "OK"). Sem ponto final. Sem caixa alta.
- Ação destrutiva pede `Dialogo` com `perigo` ("Descartar este pedido?" · Voltar | Descartar), ou `AvisoRodape` com Desfazer
  quando dá para voltar atrás. Prefira o Desfazer: é 1 toque a menos.
- `Button` mantém todas as props antigas; as variantes viraram níveis (accent = principal, outlineDark = secundário, ghost =
  neutro, danger = perigo). `outline` (borda cinza), `dark`, `success`, `locked` e `muted` continuam para os casos que já existem.

### 3.1 Botão sobre fundo escuro (`<Botao sobreEscuro>`; T-0072, revisão do #94)
Sobre o grafite (faixa "Em atendimento", `Cartao tom="escuro"`), o secundário claro (branco, borda grafite que some no fundo) e o
neutro (cinza claro) ficam quase iguais. Com `sobreEscuro`, o mesmo nível muda só de cor (altura, raio, fonte e regras iguais):
| Nível | Visual sobre o grafite | Contraste do texto | Exemplo |
|---|---|---|---|
| principal | laranja `#C2540A` cheio, texto branco (igual ao claro) | 4,6:1 | raro: só se a faixa for a tarefa da tela |
| secundário | laranja-claro `#F59A52` cheio, texto grafite | 7,5:1 | "Fazer checkout" |
| neutro | só contorno claro `#C9D0D8` 1,5, fundo transparente, texto branco | 16:1 (sobre o grafite) | "Ver cliente" |
| perigo | rosa com texto vermelho (igual ao claro) | ≥ 4,5:1 | "Rejeitar", "Excluir" |
| desabilitado | cinza-grafite `#34404D`, texto `#C9D0D8` | 6,8:1 | falta dado |
- O laranja cheio (`#C2540A`) continua só no principal: a contagem de "um só principal por tela" não muda.
- Tokens `NIVEIS_BOTAO_ESCURO`, `BOTAO_DESABILITADO_ESCURO`, `FUNDO_ESCURO` e `estiloDoNivel(nivel, { sobreEscuro })`;
  contraste testado em `tokens.test.ts`. Sem a prop, nada muda.
- Faixa "Em atendimento": `<Botao rotulo="Fazer checkout" sobreEscuro />` e `<Botao rotulo="Ver cliente" nivel="neutro" sobreEscuro />`.

### 3.2 Texto sobre o grafite (cartão escuro, aviso no rodapé)
| Token | Valor | Contraste | Uso |
|---|---|---|---|
| `colors.surface` | `#FFFFFF` | 16:1 | texto principal e valor |
| `colors.darkMuted` | `#C9D0D8` | 10,6:1 | rótulo, data, assinatura do recado |
| `colors.accentLight` | `#F59A52` | 7,6:1 | ação ("Desfazer") |
| `colors.successOnDark` | `#7FD1A8` | 9,1:1 | ícone e texto de ok |
| `colors.dangerOnDark` | `#F7A59C` | 8,5:1 (5,4:1 sobre `darkTrack`) | alerta: aviso do gatilho no cartão Minha RV (T-0082) |
- Nunca use `colors.danger` (`#A8261B`) nem `colors.success` sobre o grafite: ficam abaixo de 4,5:1. Nenhuma cor escrita à mão.
- O alerta vermelho sempre vem com a palavra ("Gatilho de Positivação ainda não atingido…"), nunca só a cor.

## 4. Cartões, chips e listas
- `Cartao` (`tom`): `padrao` (branco, borda), `destaque` (laranja claro: "Pedidos para aprovar"), `sucesso` (meta batida),
  `escuro` (recado do dia, raio 18), `suave` (dentro de outro cartão). `onPress` deixa o cartão inteiro tocável (afunda ao toque).
  `Card` antigo continua (raio 14).
- `ChipEstado`: **sempre com texto** (o componente não desenha nada sem texto). 28 dp; `pequeno` 24 dp dentro de cartão de lista.
  Tons e textos do pedido: `sucesso` Aprovado · `aviso` Aguardando aprovação (curto: "Aguardando") · `erro` Rejeitado ·
  `neutro` Na fila · `destaque` Orçamento · `roxo` (selo de orçamento do novo pedido). `Badge` antigo virou pílula de 24 dp.
- Linha de lista: título 15/600, linha de apoio 13 `ink2`, valor em Archivo 16 tabular à direita, chip no alto à direita.

## 5. Folha, diálogo, aviso, abas, estados
- **Folha** (`Folha`, `OpcaoFolha`): sobe de baixo, fundo escurece (`colors.scrim`), alça no topo, raio 22. Toque fora ou Voltar do
  Android fecha. Use para filtros, quantidade, desconto, escolha entre 2–5 opções. Mesmas props da T-0071.
  Opções novas (T-0072; sem elas, a folha é a mesma de antes):
  - `rolavel`: altura máxima = tela − área segura do topo − 24 dp (sempre sobra uma faixa do fundo para tocar fora); o
    conteúdo rola, e alça, título e `rodape` ficam fixos. Use quando o conteúdo pode passar da tela (checkout com muitas
    etapas, lista de opções longa).
  - `evitarTeclado`: para folha com campo de texto (justificativa, quantidade, desconto). A folha sobe junto com o teclado, a
    altura máxima desconta o teclado e o campo com foco rola até ficar inteiro à vista (8 dp de folga). Liga `rolavel`. Um toque
    num botão da folha com o teclado aberto já vale (não precisa fechar o teclado antes).
  - Partes puras testadas: `alturaMaximaDaFolha`, `coberturaDoTeclado`, `rolagemAteCampo` (`voltar.test.ts`).
- **Diálogo** (`Dialogo`): só para confirmar o que não tem volta. Cancelar = neutro; confirmar = laranja ou vermelho (`perigo`).
- **Aviso no rodapé** (`AvisoRodape` + `useAvisoRodape`): grafite, ícone verde de ok, texto branco, ação laranja-clara à direita.
  Some em **2,5 s** (8 s com TalkBack). Texto no passado e com o objeto: "Pedido 000013 enviado para aprovação", "Item removido".
  Ação: "Desfazer". Fica acima da barra de abas (`respiroInferior`). Uso:
  ```tsx
  const aviso = useAvisoRodape();
  aviso.mostrar({ texto: 'Item removido', acao: { rotulo: 'Desfazer', onPress: desfazer } });
  return (<View style={{ flex: 1 }}><Screen>…</Screen><AvisoRodape {...aviso.props} respiroInferior={0} /></View>);
  ```
- **Barra de abas** (`BarraAbas`): 64 dp + área segura, até 5 abas, ícone 22, rótulo 11. Ativa: ícone laranja e rótulo `accentInk`
  em negrito; inativa: `ink2`. Contador no canto do ícone (`destaque` para não lidas, `aviso` para fila). O shell decide as abas.
- **Estados de tela**:
  - carregando: `Loading` (indicador laranja) na primeira carga; depois, mostre o que já tem e atualize no lugar;
  - vazio: `EstadoVazio` (título que diz o que falta + o que fazer; ação secundária opcional);
  - erro: `Banner tone="danger"` com o que aconteceu e o que fazer ("Não deu para enviar. O pedido está salvo e vai sozinho quando
    houver sinal.");
  - sem sinal: `Banner` âmbar (`wifiOff`) e `SyncStamp`; nada some da tela por falta de sinal.

### 5.1 Banner, Chip e ícones (decisão de 2026-11-04, revisão do #92)
- **`Banner` continua no kit** e não é trocado pelo `AvisoRodape`: o Banner é o aviso **que fica na tela** enquanto a situação
  dura (erro a corrigir, sem sinal, lição bloqueada, fila esperando); o `AvisoRodape` é o retorno **passageiro** de uma ação
  feita (some em 2,5 s, com Desfazer). Regra: se a pessoa precisa ler depois de 3 s, é Banner.
- **`Chip` continua no kit** e não é trocado pelo `ChipEstado`: o Chip é **escolha** (filtro, período, categoria, conformidade;
  tocável, com `selected`), dentro de `LinhaChips` quando há muitos; o `ChipEstado` é **estado** (não tocável, sempre com texto).
  Chip de escolha nunca mostra estado e ChipEstado nunca filtra.
- **Ícones** (`Icon`, traço 2, caixa 24): `camera` para foto (check-in, gôndola, fachada, pergunta com foto; "Tirar foto",
  "Foto antes"), `inbox` para caixa de entrada (Notificações, estado vazio de recebidos). `icon.test.ts` confere que todo nome
  do tipo tem desenho.

## 6. Movimento (sempre com "reduzir movimento")
| Movimento | Token | Duração | Com "reduzir movimento" | Quem liga |
|---|---|---|---|---|
| Avançar (tela nova entra pela direita, ¼ da largura + esmaecer; no voltar, a anterior entra pela esquerda) | `transicaoDeAvancar(reduzir)` · `duracaoMovimento('avancar')` | 240 ms | sem animação | engenheiro-apps (pilha do shell, §6.1) |
| Troca de aba e toque de novo na aba (volta à raiz) | — | sem deslocamento | sem deslocamento | engenheiro-apps |
| Folha (de baixo, fundo escurece) | `Folha` · `transicaoDeFolha(reduzir)` | 280 ms | aparece sem deslocamento | kit / shell (modais de rota) |
| Toque (afunda 0,97) + vibração leve ao confirmar | `Pressionavel` (`Botao`, `Button`, `Cartao`, `RodapeTotal`) | 120 ms | sem escala; opacidade 0,7; sem vibração | kit (vibração: shell) |
| Aviso no rodapé | `AvisoRodape` | entra em 200 ms, fica 2,5 s | aparece sem deslocamento | kit |
| Diálogo | `Dialogo` | esmaece em 200 ms | instantâneo | kit |

- `useReduzirMovimento()` lê `AccessibilityInfo.isReduceMotionEnabled()` e acompanha `reduceMotionChanged`. Tudo passa por
  `duracaoMovimento(tipo, reduzir)` (0 com reduzir); nenhuma duração escrita à mão (teste em `tokens.test.ts`).
- Curva padrão `CURVA_PADRAO` = cubic-bezier(0.2, 0, 0, 1).
- Vibração: `vibrarLeve()` só vibra se o shell registrar `definirVibracao(...)` (expo-haptics, no `_layout` raiz do shell).
  Vibra o principal, o confirmar do diálogo e o Desfazer. Não vibra em navegação nem em rolagem. **Com "reduzir movimento"
  ligado, não vibra** (o shell registra `null`; decisão de 2026-11-04, R-20261104-231036). No Android segue a opção de retorno
  tátil do sistema.

## 6.1 Navegação entre telas: pilha por aba e voltar (T-0071/T-0072, 2026-11-05, sobre R-20261105-124324)
O shell guarda uma pilha de telas de módulo por aba (`apps/mobile/src/lib/historico-telas.ts`). Os módulos não precisam saber
destas regras; elas valem para o voltar do Android e para o `BackLink` do kit (os dois desempilham juntos).
- **Voltar desempilha antes de sair**: o voltar leva à tela anterior da pilha da aba; na raiz da aba, leva à tela de onde se veio
  (Início, Mais); no Início, sai do app. Folha, Diálogo e o voltar interno de uma tela (abas do Novo pedido) fecham antes.
- **Abrir uma tela empilha**; abrir uma tela que já está na pilha volta até ela (sem duplicar) e anima como voltar.
- **`replace` substitui o topo**: o editor sai da pilha (Salvar orçamento → orçamento; o voltar não reabre o editor). Anima como avançar.
- **Aberta de fora das abas** (cartão do Início, Perfil, notificação fora da aba Alertas): a tela recomeça a pilha da aba dela, e o
  voltar na raiz devolve à origem. Ex.: Início › cartão Novo pedido › Salvar orçamento › voltar = Início.
- **Trocar de aba** (barra ou item do Mais) volta ao topo guardado daquela aba, sem animação. Nada que a pessoa digitou se perde:
  o rascunho do pedido mora no aparelho.
- **Tocar de novo na aba em uso** volta à raiz dela, sem animação (regra do Material e do iOS). O rascunho continua guardado.
  Já na raiz, o toque não faz nada por ora (rolar ao topo fica para depois).
- **Aba acesa = aba dona da pilha**, não o caminho da tela: no detalhe do pedido (`/m/pedido`) aberto pela aba Pedidos, Pedidos fica
  acesa; numa pilha aberta por um cartão do Início cuja raiz não é uma aba, o Início fica aceso; numa tela de um item do Mais, o Mais.
  Feito pelo shell em 2026-11-05 (`abaAcesa`, R-20261105-132401).
- **O rótulo do `BackLink` diz para onde o voltar leva**. Na raiz de uma pilha aberta pelo Início, o voltar leva ao Início, e o rótulo
  deve dizer "Início", não o pai fixo da tela ("Pedidos", "Treinar"). Como (combinado em R-20261105-132419):
  - o kit exporta `ProvedorVoltar` (`value: { rotulo: string } | null`) e `useVoltarDaTela()`; o `BackLink` mostra `value.rotulo`
    por cima do `label` e é lido "Voltar para <rotulo>". Sem provedor, `null` ou rótulo em branco, vale o `label` do módulo;
  - o shell envolve a tela de módulo com `<ProvedorVoltar value={useVoltarDoShell(params)}>` já no primeiro quadro (sem piscar
    "Pedidos" → "Início"): `{ rotulo: 'Início' }` na raiz de pilha aberta pelo Início, `{ rotulo: 'Mais' }` na raiz aberta por um
    link do Mais, `null` no resto;
  - os módulos não mudam nada: continuam passando o `label` do pai deles.
- Sair da sessão ou bloquear o aparelho zera as pilhas; a pilha guarda só caminho e ids, nunca dado de cliente.

## 7. Textos curtos (pt-BR)
- Frases curtas, sem jargão de sistema ("sincronizar" sim; "payload", "status 500" não). Sem ponto final em botão, chip e aba.
- Números: dinheiro já formatado de centavos ("R$ 2.310,40"; no Início pode arredondar para reais: "R$ 1.240"); horas no fuso do
  tenant ("8h02"; "ontem").
- Estados no particípio ("Aprovado", "Enviado"); ações no infinitivo ("Enviar pedido").
- Erro diz o que houve e o que fazer; nunca culpa a pessoa.
- Cor nunca fala sozinha: todo verde/âmbar/vermelho vem com palavra.

## 7.1 Padrões do pedido e do orçamento (revisão de UX da T-0071, 2026-11-04)
- **Sinal de menos**: no valor do ajuste, colado ("−R$ 0,89", "−R$ 3,84"); na linha de total, com espaço ("Descontos − R$ 18,51"),
  como na referência. O equivalente do ajuste em R$ é sempre "= 5,3%", no desconto e no acréscimo (o sentido já está no seletor).
- **Cancelar ao lado de Salvar** no Resumo: secundário de borda cinza (`Button variant="outline"`, 52), como na referência; é a
  única exceção ao "Cancelar = neutro".
- **Tela de só leitura** (pedido já enviado, orçamento de outro vendedor): nenhum campo editável na tela. O ajuste do pedido vira
  uma `LinhaValor` ("Desconto do pedido 1,0% · −R$ 3,84").
- **Sugestão com 1 toque** (+ / ⇄): a linha inteira é tocável, com `BotaoIcone` (`plus` ou `swap`; nunca o caractere ⇄ em texto),
  e o toque mostra `AvisoRodape` ("Açúcar cristal 1 kg adicionado" · Desfazer), porque a linha some da lista.
- **Ação que não volta atrás** (Enviar, Transformar em pedido): sempre 2 toques, o segundo numa `Folha` que diz para onde vai
  ("Vai direto ao ERP." / "Vai para o supervisor.").
- **Ação que não se aplica** à situação (orçamento vencido, convertido, cancelado): some. Desabilitado só quando falta um dado que a
  pessoa pode resolver, e com o motivo perto.
- **Chip abreviado** ("28 d", "28/56"): passe `rotuloAcessivel` com o texto completo ("28 dias").
- **Palavras**: orçamento nunca é chamado de pedido na confirmação ("Orçamento 000012 salvo"); sem "servidor", "cache", "BKO" na
  tela do vendedor (use "Macuxi", "aparelho", "escritório").

## 7.2 Decisões da segunda revisão do Novo pedido e do orçamento (T-0071, 2026-11-05, sobre R-20261105-104349)
Referência: `docs/produto/referencias/R-20261103-130003-alexandre-novo-pedido.html` (telas 1 a 5, versão enxuta).
- **Busca antes da trilha** (aba Itens): `CampoBusca` e, logo abaixo, `Trilha compacta atualTocavel` ("Mercearia › **Bebidas**").
  Sem ícone de lupa na trilha (a lupa é da busca). Tocar em qualquer nível abre o catálogo do pedido. Sem item no pedido, a
  trilha é um item só: "Catálogo". A trilha usa `accentInk` (o `accent` sobre o fundo dá 4,17:1). Com `atualTocavel`, o último
  item é um botão como os outros ("Ir para Bebidas") e não é anunciado como selecionado (`selected` segue `desligado`), de
  propósito: na trilha-atalho ele leva ao catálogo, não marca onde a pessoa está.
- **Uma linha por produto**, com o `ChipMedida` no alto à direita ("UN", "CX c/ 20"). Com duas medidas, o chip é tocável e alterna
  a medida da linha (mantém a quantidade; `AvisoRodape` "Medida trocada para CX c/ 20" · Desfazer). Uma segunda linha do mesmo
  produto só aparece quando as duas medidas têm quantidade (ex.: depois do "Leve mais"); aí os chips ficam só leitura.
- **Equivalente do desconto em verde** (`colors.success`, `.eq` da referência): "−R$ 0,89", "= 5,3%", "−R$ 3,84". O "+ desconto"
  (ainda sem ajuste) fica em `accentInk`; o equivalente do acréscimo, em `ink2`.
- **Detalhe do orçamento = tela 5**: selo, um cartão (itens compactos, ajuste do pedido, Total, "CIF · 28 dias"), principal
  "Transformar em pedido", linha Editar | PDF, depois Duplicar (`neutro`) | Cancelar orçamento (`perigo`, abre o `Dialogo`;
  decidido na conferência de 2026-11-05, R-20261105-114721) e o Histórico. Sem frase do frete,
  sem "Desconto efetivo", Filial e Tabela. Vencido: Duplicar vira o principal, com o PDF (secundário) abaixo; nenhuma frase explicando.
- **Situação do orçamento**: "Orçamento · até 10/11" (`roxo`), "Vencido", "Cancelado" (`neutro`), "Virou pedido 000015"
  (`sucesso`), iguais na lista e no detalhe. Nunca "Orçamento expirado".
- **Depois de salvar o orçamento**, abre o orçamento (tela 5); o editor sai da pilha e o voltar leva para onde o pedido começou
  (Pedidos ou o Início; §6.1). O aviso
  "Orçamento 000012 salvo" pode vir de um invólucro local do módulo (ex.: `AvisoRapido` do Vendedor), desde que ele só repasse
  o `AvisoRodape` do kit, sem estilo próprio.
- **Teclado**: o campo focado fica inteiro acima do teclado; o rodapé Total | Avançar não sobe com o teclado. O que foi digitado
  vale no primeiro toque seguinte (Avançar, aba, Salvar, +/−), sem precisar fechar o teclado.

## 8. Checklist da revisão de UX (designer-ux, antes do merge)
1. Um só principal; os demais no nível certo. 2. Alvos ≥ 48 dp. 3. Contraste ≥ 4,5:1 (tokens do kit já passam; cor solta = 🟡).
4. Chips com texto. 5. Tarefa principal em até 3 toques a partir do Início. 6. Estados vazio, erro, carregando e sem sinal desenhados.
7. Textos da §7. 8. Sem animação própria fora dos tokens (ou com `useReduzirMovimento`).
9. Voltar e abas pela §6.1: o voltar nunca sai do app no meio de uma pilha, e o rótulo do `BackLink` diz para onde ele leva.
