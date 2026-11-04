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

## 6. Movimento (sempre com "reduzir movimento")
| Movimento | Token | Duração | Com "reduzir movimento" | Quem liga |
|---|---|---|---|---|
| Avançar (lista → detalhe entra pela direita; voltar sai pela direita) | `transicaoDeAvancar(reduzir)` | 240 ms | sem animação | engenheiro-apps (pilha do shell) |
| Folha (de baixo, fundo escurece) | `Folha` · `transicaoDeFolha(reduzir)` | 280 ms | aparece sem deslocamento | kit / shell (modais de rota) |
| Toque (afunda 0,97) + vibração leve ao confirmar | `Pressionavel` (`Botao`, `Button`, `Cartao`, `RodapeTotal`) | 120 ms | sem escala; opacidade 0,7 | kit |
| Aviso no rodapé | `AvisoRodape` | entra em 200 ms, fica 2,5 s | aparece sem deslocamento | kit |
| Diálogo | `Dialogo` | esmaece em 200 ms | instantâneo | kit |

- `useReduzirMovimento()` lê `AccessibilityInfo.isReduceMotionEnabled()` e acompanha `reduceMotionChanged`. Tudo passa por
  `duracaoMovimento(tipo, reduzir)` (0 com reduzir); nenhuma duração escrita à mão (teste em `tokens.test.ts`).
- Curva padrão `CURVA_PADRAO` = cubic-bezier(0.2, 0, 0, 1).
- Vibração: `vibrarLeve()` só vibra se o shell registrar `definirVibracao(...)` (expo-haptics, pedido ao engenheiro-software).
  Vibra o principal, o confirmar do diálogo e o Desfazer. Não vibra em navegação nem em rolagem.

## 7. Textos curtos (pt-BR)
- Frases curtas, sem jargão de sistema ("sincronizar" sim; "payload", "status 500" não). Sem ponto final em botão, chip e aba.
- Números: dinheiro já formatado de centavos ("R$ 2.310,40"; no Início pode arredondar para reais: "R$ 1.240"); horas no fuso do
  tenant ("8h02"; "ontem").
- Estados no particípio ("Aprovado", "Enviado"); ações no infinitivo ("Enviar pedido").
- Erro diz o que houve e o que fazer; nunca culpa a pessoa.
- Cor nunca fala sozinha: todo verde/âmbar/vermelho vem com palavra.

## 8. Checklist da revisão de UX (designer-ux, antes do merge)
1. Um só principal; os demais no nível certo. 2. Alvos ≥ 48 dp. 3. Contraste ≥ 4,5:1 (tokens do kit já passam; cor solta = 🟡).
4. Chips com texto. 5. Tarefa principal em até 3 toques a partir do Início. 6. Estados vazio, erro, carregando e sem sinal desenhados.
7. Textos da §7. 8. Sem animação própria fora dos tokens (ou com `useReduzirMovimento`).
