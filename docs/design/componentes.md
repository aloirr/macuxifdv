# Guia do visual do app — Campo e Gestão (T-0072)

> 2026-11-03 · designer-ux · referência aprovada: `docs/design/referencia-2026-11-03/Componentes.dc.html`
> Código: `packages/ui/src/mobile` (`tokens.ts`, `movimento.ts` puros; `base.tsx`, `movimento-rn.tsx`, `folha.tsx`, `valores.tsx`, `ui.tsx`).
> Importe sempre de `@macuxi/ui/mobile` (tela) ou `@macuxi/ui/mobile/puro` (lib pura, testes).

## 1. Identidade: marca v1 (T-0172; aprovada pelo dono do produto em 12/11/2026; manual `docs/marca/manual.md` §3 e §4)
| Token | Valor | Uso |
|---|---|---|
| `colors.accent` | `#1E3350` Azul noite | **ação**: botão principal, aba ativa (ícone e borda), seleção, foco, ícone de ação. Nunca encostado no grafite |
| `colors.accentInk` | `#1E3350` | texto de ação sobre claro: link, rótulo de ação, chip, aba ativa |
| `colors.onAccent` | `#FFFFFF` | texto e ícone sobre o Azul noite |
| `colors.accentSoft` / `accentTint` | `#DFE2E6` Azul suave | fundo do chip, do cartão em destaque e da opção marcada |
| `colors.grafico` | `#C2540A` | **só gráfico**: barra de meta e de share, contador, selo, marcador. Nunca texto sobre claro |
| `colors.graficoEscuro` / `accentLight` | `#F59A52` | gráfico e ação sobre o escuro (grafite e Azul noite) |
| `colors.faixa` / `faixaTitulo` / `faixaSub` | `#1E3350` / `#FFFFFF` / `#C9CED5` | cabeçalho da tela (§5.2) |
| `colors.ink` | `#16202A` | texto, botão secundário (borda), cartão escuro (recado), aviso no rodapé |
| `colors.ground` | `#F8F6F1` Pérola | fundo das telas |
| `colors.surface` | `#FFFFFF` | cartões, folha, barra de abas |
| `colors.ink2` / `ink3` | `#4A5562` / `#5B6673` | texto secundário / terciário (≥ 4,5:1 no branco e no Pérola) |

**Fonte do sistema** (R-20261115-110600, 15/11/2026, v1.0.13; saem Archivo, IBM Plex Sans e IBM Plex Mono, em todas as
superfícies). O logo não muda.

- **App (Campo e Gestão):** sem `fontFamily` — vale a fonte padrão do aparelho (Roboto na maioria dos Android). A hierarquia
  vem só do peso: `fonte.body` 400 · `medium` 500 · `semibold` 600 · `bold`/`display`/`displayBold` 700. Uso:
  `{ ...fonte.semibold, fontSize: 14 }`. Códigos (pedido, EAN, SKU): `fonte.mono` = `monospace` + `tabular-nums`.
  O `fonts.x` antigo (nomes de família) ficou só para a transição das telas dos módulos; troque `fontFamily: fonts.x` por
  `...fonte.x`.
- **Escala do app** (`ESCALA_FONTE`): **12 · 14 · 16 (base) · 18 · 22 · 28**; nada abaixo de 12. Estilos (`type`):
  `saudacao`/`h1` 28/700 · `h1Small` e cabeçalho da faixa 22/28 · `titulo` 18/700 (folha, diálogo) · `secao` 18/700 ·
  `numeroGrande` 18/700 tabular · `body` 16 · `sub` 14 · `small` 12 · `rotulo` 12/600 maiúsculas · `mono` 12. Botão de 52:
  16; de 44: 14. Os nomes antigos (`h1`, `h2`, `number`…) continuam.
- **Web (BKO e portal `config.`):** texto e títulos em `system-ui, "Segoe UI", Roboto, -apple-system, sans-serif`
  (`font-sans` e `font-display` apontam para a mesma pilha; as variáveis ficam no `apps/web`); códigos em
  `ui-monospace, "Cascadia Mono", "Roboto Mono", monospace` com `tabular-nums`. Pesos 400 · 500 · 600 · 700 (sem
  `font-extrabold`). **Escala web: 12 (mínimo) · 13 · 15 (base) · 17 · 20 · 24**, pensada para 1366×768: título da página
  24/700, KPI 24/700, título de cartão e de diálogo 17/700, botão e campo 15, tabela 13, rótulo, ajuda e selo 12.
- O teste `packages/ui/src/mobile/fonte-sistema.test.ts` segura a regra no kit (sem Archivo/Plex, só tamanhos da escala).
- Specs e pranchas de tela anteriores a 15/11/2026 que citam Archivo ou Plex (e os tamanhos 11, 13, 15, 17, 19, 24 e 26 do
  app): vale esta seção.

### 1.1 Contraste da marca (vale para o app e para o BKO/portal)
Código: `packages/ui/src/comum/contraste.ts` (`MARCA`, `DESTAQUE`, `GRAFICO`, `FAIXA`, `FUNDOS`, `PARES_DA_MARCA`,
`PARES_DO_DESTAQUE`), testado em `contraste.test.ts`. Web: as classes em `packages/ui/src/web/cores.ts` (`CLASSES_DESTAQUE`); os
valores moram em `apps/web/app/globals.css` (`--color-accent*`, `--color-grafico*`, `--color-faixa*`) e o teste confere que são
os mesmos. Não há tema escuro; o "escuro" é o grafite dos cartões, do aviso no rodapé e do menu do BKO, e a faixa Azul noite.

**Regra:**
1. Ação é Azul noite: `accent` no preenchimento, `accentInk` no texto (`bg-accent text-white`, `text-accent-ink` no web).
2. O laranja é só gráfico (`colors.grafico`, `bg-grafico`). Texto laranja sobre claro é proibido; se for inevitável, `#8F3D06`.
3. Sobre o escuro, o laranja é o `#F59A52`.
4. Azul noite nunca encosta no grafite (1,29:1): sobre o grafite, o botão principal é branco com texto Azul noite (§3.1), e o
   foco do menu grafite do BKO não é `outline-accent`.
5. Nenhuma tela escreve `#1E3350`, `#C2540A` ou `text-accent` / `text-grafico` à mão: é 🟡 na revisão.

Mínimos WCAG 2.1 AA: texto normal **4,5:1**; texto grande (≥ 24 px, ou ≥ 18,66 px em negrito) **3:1**; ícone, borda e foco **3:1**.

Pares do manual §3 (`PARES_DA_MARCA`, razão conferida no teste):

| Par | Razão |
|---|---|
| branco no Azul noite | 12,77:1 |
| `#C9CED5` no Azul noite | 8,07:1 |
| Azul noite no Pérola | 11,82:1 |
| Azul noite no Azul suave | 9,83:1 |
| grafite no Pérola | 15,26:1 |
| `#4A5562` no Pérola | 7,03:1 |
| `#5B6673` no Pérola | 5,41:1 |
| `#9AA3B0` no grafite | 6,47:1 |
| laranja no Pérola (gráfico) | 4,26:1 |
| `#F59A52` no Azul noite (gráfico) | 5,85:1 |

Usos do kit além desses (`PARES_DO_DESTAQUE`): branco no laranja do contador 4,60:1; Azul noite no branco 12,77:1; `#4A5562` no
Azul suave 5,84:1; laranja no branco 4,60:1 (gráfico); `#F59A52` no grafite 7,56:1; `#F59A52` no trilho `#3A4D68` 3,94:1 (gráfico);
✓ `#7FD1A8` e erro `#F7A59C` na faixa 7,05:1 e 6,58:1.

**Proibidos** (o teste garante que continuam abaixo): texto laranja no Pérola (4,26:1), no grafite (3,58:1) e no Azul suave;
Azul noite no grafite (1,29:1).

BKO: o farol do meio (positivação 55 a 70%, integração até 10 p.p. abaixo da meta) tem o número em `text-warning` (6,60:1 no
Pérola) e a barra em `bg-grafico`; o botão principal passou de grafite a `bg-accent` (Azul noite).

## 2. Espaço, raio, sombra
- `space`: 2 · 4 · 8 · 12 · 16 · 20 · 24 · 32 (`xxs`…`xxxl`).
- `layout`: lateral da tela 20 · topo 28 · **entre blocos 14** · entre cartões 8 · dentro do cartão 12 · dentro da seção 18.
- `radius`: botão 52 → **14**; botão 44 → **12**; cartão **14**; seção (recado) **18**; folha **22**; chip de estado **pílula**.
- `shadow`: o app separa por **borda** (`colors.line`), não por sombra. Sombra só no que flutua: `shadow.folha`, `shadow.aviso`.
- Alvo de toque mínimo **48 dp** (`TOUCH`, `ALTURA.toque`). Visual menor (chip 36, passo 40, Desfazer 36) ganha `hitSlop`.
- **Linha densa (T-0089):** no Android o toque fora da borda do **pai** não chega ao filho, então `hitSlop` não vale quando o
  contêiner tem a altura do visual. Nas peças compactas (`Passo compacto`, `Segmentado compacto`, `CampoAjuste`, `EtiquetaFiltro`)
  o alvo é o próprio botão (≥ 44 × 44 dp) e o visual (30–32 dp) fica desenhado dentro. Peça nova nunca depende de folga.

## 3. Botões em níveis — **um só principal por tela**
| Nível | Componente | Altura | Visual | Quando |
|---|---|---|---|---|
| principal | `<Botao nivel="principal">` · `Button variant="accent"` · `RodapeTotal` | 52 | Azul noite cheio, texto branco 16 | a ação que fecha a tarefa da tela: Enviar pedido, Começar a rota, Registrar check-in |
| secundário | `<Botao>` (padrão) · `Button variant="outlineDark"` | 44 (`alto` → 52 ao lado do principal) | branco, borda grafite 1,5 | alternativa real: Salvar orçamento, Ver rota |
| neutro | `<Botao nivel="neutro">` · `Button variant="ghost"` | 44 | Névoa `#ECEEF1` | Cancelar, Voltar, Fechar |
| perigo | `<Botao nivel="perigo">` · `Button variant="danger"` | 44 | rosa `#FDE8E6`, texto vermelho | Rejeitar, Excluir, Descartar |
| desabilitado | `desligado` / `disabled` | do nível | Névoa `#ECEEF1`, texto `#5B6673` (5,03:1) (sem transparência) | falta dado; diga o motivo perto ("Escolha a forma de pagamento") |
| ocupado | `ocupado` / `loading` | do nível | indicador no lugar do ícone, toque bloqueado | enviando; o texto muda ("Sincronizando…") |

Regras:
- Revisão conta os principais da tela: `nivel="principal"`, `variant="accent"`, `RodapeTotal` e o confirmar do `Dialogo`
  (este só vale dentro do diálogo). Mais de um = 🔴.
- Rótulo = verbo + objeto, até 3 palavras ("Enviar pedido", não "OK"). Sem ponto final. Sem caixa alta.
- Ação destrutiva pede `Dialogo` com `perigo` ("Descartar este pedido?" · Voltar | Descartar), ou `AvisoRodape` com Desfazer
  quando dá para voltar atrás. Prefira o Desfazer: é 1 toque a menos.
- `Button` mantém todas as props antigas; as variantes viraram níveis (accent = principal, outlineDark = secundário, ghost =
  neutro, danger = perigo). `outline` (borda cinza), `dark`, `success`, `locked` e `muted` continuam para os casos que já existem.

### 3.1 Botão sobre fundo escuro (`<Botao sobreEscuro>`; T-0072, marca v1 na T-0172)
Sobre o grafite (faixa "Em atendimento", `Cartao tom="escuro"`) e sobre a faixa Azul noite (tela de entrada), o mesmo nível muda só
de cor (altura, raio, fonte e regras iguais). O Azul noite some no grafite (1,29:1), por isso o principal fica branco:
| Nível | Visual sobre o escuro | Contraste do texto | Exemplo |
|---|---|---|---|
| principal | branco cheio, texto Azul noite | 12,77:1 | "Tentar de novo" (entrada) |
| secundário | só contorno `#C9CED5` 1,5, fundo transparente, texto branco | 16,48:1 no grafite | "Fazer checkout", "Continuar sem sincronizar" |
| neutro | só o texto branco, sem fundo nem contorno | 16,48:1 no grafite | "Ver cliente" |
| perigo | rosa com texto vermelho (igual ao claro) | ≥ 4,5:1 | "Rejeitar", "Excluir" |
| desabilitado | cinza-grafite `#34404D`, texto `#C9CED5` | 6,68:1 | falta dado |
- Um só principal por tela, como no claro.
- Tokens `NIVEIS_BOTAO_ESCURO`, `BOTAO_DESABILITADO_ESCURO`, `FUNDO_ESCURO` e `estiloDoNivel(nivel, { sobreEscuro })`;
  contraste testado em `tokens.test.ts`. Sem a prop, nada muda.

### 3.2 Texto sobre o grafite (cartão escuro, aviso no rodapé)
| Token | Valor | Contraste | Uso |
|---|---|---|---|
| `colors.surface` | `#FFFFFF` | 16,48:1 | texto principal e valor |
| `colors.darkMuted` | `#C9CED5` | 10,42:1 | rótulo, data, assinatura do recado |
| `colors.accentLight` | `#F59A52` | 7,56:1 | ação ("Desfazer") |
| `colors.successOnDark` | `#7FD1A8` | 9,1:1 | ícone e texto de ok |
| `colors.dangerOnDark` | `#F7A59C` | 8,5:1 (5,4:1 sobre `darkTrack`) | alerta: aviso do gatilho no cartão Minha RV (T-0082) |
- Nunca use `colors.danger` (`#A8261B`) nem `colors.success` sobre o grafite: ficam abaixo de 4,5:1. Nenhuma cor escrita à mão.
- O alerta vermelho sempre vem com a palavra ("Gatilho de Positivação ainda não atingido…"), nunca só a cor.

## 4. Cartões, chips e listas
- `Cartao` (`tom`): `padrao` (branco, borda), `destaque` (Azul suave com borda `#9AA3B0`: "Pedidos para aprovar"), `sucesso` (meta batida),
  `escuro` (recado do dia, raio 18), `suave` (dentro de outro cartão). `onPress` deixa o cartão inteiro tocável (afunda ao toque).
  `Card` antigo continua (raio 14).
- `ChipEstado`: **sempre com texto** (o componente não desenha nada sem texto). 28 dp; `pequeno` 24 dp dentro de cartão de lista.
  Tons e textos do pedido: `sucesso` Aprovado · `aviso` Aguardando aprovação (curto: "Aguardando") · `erro` Rejeitado ·
  `neutro` Na fila · `destaque` Orçamento (o tom `roxo` saiu do kit, RD-0235). `Badge` antigo virou pílula de 24 dp.
- Linha de lista: título 16/600, linha de apoio 14 `ink2`, valor 16/700 tabular à direita, chip no alto à direita.
- `LinhaAtalho` (T-0085): linha tocável que leva a **outra vista da mesma aba** ("Rascunhos (2)" em Pedidos, T-0141). Fundo
  `accentSoft` sem borda, raio 12, ícone e seta `accentInk`, rótulo 15/600 (até 24 caracteres), apoio 13 `ink2` (até 36);
  48 dp, 56 com apoio. Não é botão (não conta como principal) nem chip (não filtra). Uso e regra em `docs/design/pedido-v3.md`
  §F.1. O atalho "Ver por linha" do Catálogo e o ícone `arvore` saíram (T-0142: o Catálogo é a hierarquia, sem tela "Por linha").

### 4.1 Escolha e valores do Novo pedido (T-0089; spec `docs/design/novo-pedido-itens.md`)
- `ListaSuspensa`: rótulo 11/700 em maiúsculas em cima, campo de 48 dp (borda `lineStrong`, texto 15/600, seta ⌄), menu ancorado
  logo abaixo (acima se faltar espaço), opções de 48 dp, ✓ na marcada, rola acima de 5. **Opção desabilitada**: fundo
  `ground`, rótulo `inkDisabled` com cadeado, sem toque, e o `motivo` **na própria opção**, numa linha secundária abaixo do
  rótulo (T-0129): 12/16 em `ink2` (6,87:1 sobre `ground`, AA; o motivo não fica apagado, porque é o que a pessoa lê para
  resolver), até 2 linhas, 8 dp de respiro em cima e embaixo (opção de até 70 dp; `alturaDoMenu` reserva a altura e o menu rola
  se precisar). O rótulo continua só o valor ("30/60/90 dias", RN-VEN-25); o TalkBack lê "30/60/90 dias. Acima do prazo médio
  do cliente" com o estado desabilitado. A tela **não** repete o motivo em texto solto abaixo da lista. `falta` (§4.9) =
  borda `danger` e o texto curto embaixo; `desligado` = fundo `lineSoft`. Para Forma de pagamento, Prazo e filtros de 3 a 12 opções; 2 opções = `Segmentado`.
- `CampoAjuste`: desconto ou acréscimo **sempre aberto**, com o tipo ao lado (`TIPOS_AJUSTE`: Desc %, Desc R$, Acrésc %,
  Acrésc R$) num menu do mesmo tipo e o valor digitável à direita. Moldura de 30 dp, alvo de 44 dp.
- `Passo compacto`: caixa "− n +" de 100 × 30 dp num contêiner de 124 × 44 dp (− e + com 44 × 44 dp). Cada toque lê o número
  do momento (o "+" com o teclado aberto, bug do R-20261106-064754). `desligadoAumentar` tira só o "+".
- `Segmentado compacto`: 30 dp de visual (o visual não estica até o alvo), 44 × 44 dp de alvo por opção e 6 dp entre elas; largura mínima
  `larguraSegmentadoCompacto(n)` (2 → 94, 3 → 144). UN | CX da linha 3 do item; Dia | Mês | Ano da folha. Num pai com `flex: 1`,
  a linha passa a ter 44 dp de altura de layout (o alvo entra no layout, não é folga).
- Crédito do cliente: a tabela do `pedido-v3.md` §A. `CartaoLeveMais`: uma linha tocável (≥ 56 dp) por item com
  a próxima faixa (`textosLeveMais`); sem item, não aparece.
- Token novo: `colors.inkDisabled` `#8A949C` (3:1 no branco) só para texto de opção desabilitada, **sempre** com outro sinal
  (cadeado, sem toque); nunca para texto que precisa ser lido.

### 4.2 Filtro da lista (T-0090; spec `docs/design/pedidos-filtro-periodo.md`)
- `BotaoFiltro`: funil de 48 dp ao lado da busca, com selo laranja do número de filtros fora do padrão.
- `EtiquetaFiltro`: pílula `accentSoft` de 32 dp ("Ontem ✕") num alvo de 44 dp; tocar remove o filtro.
- `FolhaPeriodo`: atalhos (aplica e fecha), "Escolher dia, mês ou ano ›" com Dia/Mês/Ano e "Limpar" (volta ao padrão).
  Comportamento puro em `eventoDaFolha` (`periodo.ts`). Ícones novos: `filtro`, `abaixo` (seta do campo), `subir` (Leve mais).

### 4.3 Regras da senha (T-0093, RN-CORE-32; spec `docs/design/portal-entrar.md` §5)
- `RegrasDaSenha` (web e mobile, mesma API): "A senha precisa ter" + 8 caracteres ou mais · Uma letra · Um número · Um caractere
  especial, ao vivo pelas `faltas` do Core (`faltasNaSenha`); ✓ verde cumprida, círculo vazio neutro faltando, ✕ vermelho com
  `destacar` (depois de tentar salvar). Leitor de tela: "ok"/"falta" por regra (web) e resumo em região viva ("Falta um número.").
  Nunca no login; o kit não recebe a senha. Textos e frases em `comum/senha.ts`.
- Olho do campo de senha (web): `IconEye` no botão "Mostrar senha" (senha escondida) e `IconEyeOff` no "Esconder senha"
  (`MOSTRAR_SENHA`/`ESCONDER_SENHA`), 18 px, `text-ink-2`, botão de 44 × 44 dentro do campo, à direita. Vale no login (o olho
  ajuda a conferir o que digitou; a lista de regras é que não entra no login).

### 4.4 Permissões e perfis (BKO; T-0111; spec `docs/design/perfis-de-acesso.md` §12)
- `LinhaDePermissao`: rótulo, ajuda, "Padrão: X" e o controle à direita; com `trava`, o `Cadeado` logo depois do rótulo.
- `Interruptor`: liga/desliga com "Sim"/"Não"/"Em parte" escrito, `role="switch"`, alvo de 44 px; trilho desligado em `disabled`
  (3:1 sobre branco), ligado em `ink`. Em toda página de permissões, liga/desliga é sempre interruptor; caixa fica para listas.
  O ligado é grafite (`ink`) de propósito: é estado, não ação; o Azul noite (`accent`) fica para o botão principal (MC-0018).
- `SeletorDeNivel`: botões lado a lado sobre rádios nativos (setas do teclado); opção acima do permitido com cadeado e motivo.
- `SeletorDePerfis`: caixas num `fieldset`, opção "todos" opcional, opção travada com motivo. `Cadeado`: regra no hover, foco e
  toque, e como descrição para o leitor de tela. `ResumoDasMudancas`: "Rótulo: antes → depois" por seção, falado sem a seta.

### 4.5 Formulário com abas: pendências, saída e salvar (T-0126; spec `docs/design/formulario-pendencias.md`)
> **T-0166 (12/11):** vale a **falta no campo, só na tentativa** (`formulario-pendencias.md` §0.0; peças no §4.9).
Vale para o app inteiro (Novo pedido; depois visita, pesquisa, cadastro). RN-CORE-36, RN-VEN-38, RN-VEN-30.
- `FolhaSairDoFormulario`: "Sair do pedido?" · Salvar e enviar pedido · Apenas salvar (`apenasSalvar`, T-0133) · Salvar como
  orçamento · Descartar (com `Dialogo perigo`) · Continuar editando, só com os rótulos (RD-0193). Sem `salvar` = variante da
  RN-VEN-13. Toque fora = continuar editando.
- `FolhaRetomarRascunho`: depois que o sistema fecha o app, "Continuar pedido de <cliente>" ou "Descartar"; "Agora não" guarda.
- Parte pura (`pendencias.ts`): `eventoDaSaida`, `tituloDaRetomada`, `apoioDaRetomada`.
- Salvar fecha a tela em < 1 s; o detalhe mostra "Pedido salvo · enviando" e fica só leitura enquanto `na_fila` (spec §4).

### 4.6 Novo pedido v2: abas, Resumo, desconto, detalhe e histórico (T-0133; spec `docs/design/pedido-v2.md`)
RF-VEN-11, RF-VEN-05, RN-VEN-30, RN-VEN-18. Vale no Campo, no Gestão (pedido em nome) e, nas tags, no BKO.
- 4 abas **Venda · Itens (n) · Entrega · Resumo**; Resumo com `LinhaResumo` (rótulo de 64 dp à esquerda) e 4 botões: principal
  "Salvar e enviar pedido" (largura total, destino embaixo), "Apenas salvar" e "Salvar como orçamento" (`Botao alto
  quebrarLinha`, metade cada), Cancelar em texto.
- `DescontoCompacto`: o mesmo no item e no pedido; uma linha de 44 dp com o tipo (Desc %, Desc R$, Acrésc %, Acrésc R$), o
  valor sem − e + e o equivalente ao lado (`equivalenteDoAjuste`: "−R$ 0,20", "−1,0%", "+R$ 1,50/FD").
- `TagHistorico` / `HistoricoEmTags` (mobile e web, mesmos nomes): "Salvo · 08/11 10:35"; Rejeitado e Cancelado com o motivo em
  1 linha; autor só se não for o vendedor; status sem tag não aparece (`tagsDoHistorico`, `../comum/historico.ts`).
- `RodapeAcoes`: 1 principal (52 dp) e até 4 ações de ícone + rótulo curto (`rotuloCurtoOk`) numa linha de 48 dp; `MenuMais`
  (⋮, ícone `mais`) com a ação destrutiva e confirmação (Voltar do diálogo volta à folha).
- `Faixa` ganhou `apoio` (2ª linha); alertas da aba Venda com `alertaInadimplencia` e `TEXTO_CLIENTE_LIBERADO`.

### 4.7 Novo pedido v3: crédito em tabela, Rascunhos, "preço de" (T-0141; spec `docs/design/pedido-v3.md`)
- `TabelaValores`: valor de consulta em tabela (rótulo 14 `ink2` ··· valor 18/700 tabular, linhas de 48 dp com traço);
  sem dado = `VALOR_SEM_DADO` ("—", em `ink3`); `carregando` desenha barras cinza; `rodape` com a atualização. Nunca frase
  corrida para Limite, Disponível ou Prazo médio.
- Entrada **Rascunhos (n)** em Pedidos com o `LinhaAtalho`; selo "Some em 2 h" (aviso) nas últimas 3 h; selo do orçamento
  "Orçamento · preço de 09/11" (`destaque`, não vence).

### 4.8 Catálogo pela hierarquia (T-0142; spec `docs/design/catalogo-por-linha.md`)
- `ListaNiveis`: cabeçalho "Sistemas · Produtos", um cartão com linhas de 56 dp, contagem em negrito (700) à direita
  (`textoDaContagem`, "1.240"), seta; TalkBack `leituraDoNivel` ("Alimentos, 16 produtos").
- `Trilha`: item com `desligado` = nível pulado (um item só), em `ink2` e sem toque.
- Último nível: o `CartaoProduto` do módulo (o mesmo da busca), com "Serve em:" em até 2 linhas, "Equivale a:" e etiquetas em
  `Selo` neutro; não há outra lista de produtos (a tela "Por linha" saiu). "Oferece junto" só na ficha.

### 4.9 Falta no campo, Balao, CampoEscolha e fim da busca (T-0165, T-0166, T-0167; 12/11)
- **Falta no campo** (`falta.ts`, `falta-rn.tsx`; `formulario-pendencias.md` §0.0): `faltaVisivel(falta, { tentou, saiu })`
  decide se aparece (`vazio` só na tentativa; `invalido` ao sair do campo; `imediata` na hora, ex.: "Máx. 10,0%");
  `TextoDaFalta` (ícone `alert` 14 + 12,5/600 `danger`, 4 dp abaixo do campo) e `bordaDaFalta` (borda `danger` 2 dp).
  Sem fundo vermelho, faixa ou bolinha. `FALTA_OBRIGATORIO` = "Obrigatório".
- **`CampoEscolha`** (`campo-escolha-rn.tsx`; `pedido-v4.md` §5.6): campo 48 dp (borda `lineStrong`, raio 12, seta) que abre
  uma `Folha` com `CampoBusca` (sem acento e sem caixa, `filtrarOpcoes`), linhas de 52 dp (escolhida com ✓ `accentInk` sobre
  `accentSoft`) e a `opcaoFinal` sempre por último ("Outra (digitar)"). Props `falta` e `desligado` (mostra "—").
- **`ListaSuspensa`** (`suspensa.tsx`; Forma e Prazo da aba Venda): prop `falta` como no `CampoEscolha` (borda `danger` 2 e
  `TextoDaFalta` embaixo, "Obrigatório" depois da tentativa; RD-0170).
- **`Balao`** (`balao-rn.tsx`; `pedido-v4.md` §5.3 e §5.4): envolve o texto tocável; o toque abre o balão `ink` (texto branco,
  até 4 linhas, até 300 dp) logo abaixo, com a seta para o alvo (`posicaoDoBalao`; sem espaço embaixo, acima). Fecha com outro
  toque, ao começar a rolar e no Voltar. Sem `texto`, só o filho, sem toque.
- **`MostrarMais`** e **`NadaEncontrado`** (`busca-rn.tsx`; imagem `telas/T-0167-mostrar-mais.png`): "Mostrando 20 de 87" +
  botão secundário "+ Mostrar mais" (some com tudo à vista); "Nenhum produto com “agau”." + "Você quis dizer “água”?".
- **`BotaoEditar`** (`botao-editar-rn.tsx`; `pedido-v4.md` §5.8; R-20261112-082212): o lápis do item já no pedido.
  `tamanho="linha"` 44 dp (aba Itens, no lugar do "+") ou `"tabela"` 32 dp (fim da linha do Resumo), alvo de 48 dp nos dois.
  Prop `item` monta a leitura do TalkBack. Prop `tom` (pedido do dono do produto, 14/11/2026: cor mais viva, verde para dizer
  que o produto já foi adicionado; verde de situação do manual de marca §3):
  - `adicionado`: borda `success` 2, fundo `successBg`, ícone `success` (5,51:1 sobre o fundo; borda 6,43:1 sobre o branco).
    Padrão da `linha`: na aba Itens o lápis verde diz "já no pedido".
  - `padrao`: borda `accent` 1,5, fundo `accentSoft`, ícone `accentInk`. Padrão da `tabela`: no Resumo tudo está no pedido e o
    lápis só quer dizer "editar".
  Sem a prop, o tom sai do tamanho (`tomDoBotaoEditar`); o módulo não precisa passar nada.

## 5. Folha, diálogo, aviso, abas, estados
- **Folha** (`Folha`, `OpcaoFolha`): sobe de baixo, fundo escurece (`colors.scrim`), alça no topo, raio 22. Toque fora ou Voltar do
  Android fecha. Use para filtros, quantidade, desconto, escolha entre 2–5 opções. Mesmas props da T-0071.
  `fechar={{ rotulo: 'Fechar' }}` (T-0141): ✕ de 48 dp à direita do título, fixo fora da rolagem, chama o mesmo `onFechar`. Use em
  folha com título e conteúdo longo ou formulário (endereço, Preços de hoje); nunca desenhe o ✕ dentro do conteúdo.
  Opções novas (T-0072; sem elas, a folha é a mesma de antes):
  - `rolavel`: altura máxima = tela − área segura do topo − 24 dp (sempre sobra uma faixa do fundo para tocar fora); o
    conteúdo rola, e alça, título e `rodape` ficam fixos. Use quando o conteúdo pode passar da tela (checkout com muitas
    etapas, lista de opções longa).
  - `evitarTeclado`: para folha com campo de texto (justificativa, quantidade, desconto). A folha sobe junto com o teclado, a
    altura máxima desconta o teclado e o campo com foco rola até ficar inteiro à vista (8 dp de folga). Liga `rolavel`. Um toque
    num botão da folha com o teclado aberto já vale (não precisa fechar o teclado antes).
  - Partes puras testadas: `alturaMaximaDaFolha`, `coberturaDoTeclado`, `rolagemAteCampo` (`voltar.test.ts`).
- **Botões das folhas de ação do pedido** (`BotaoFolha`, `LinhaOpcaoFolha`; RD-0039, `botao-folha.ts` e `botao-folha-rn.tsx`):
  - `BotaoFolha tom="perigo"`: vermelho sólido (`danger`) com texto branco (`onAccent`), 50 dp; `tom="contorno"`: branco com borda
    `lineStrong`, 46 dp. Raio `radius.lg`, fonte 15 (≥ 50 dp) ou 14, toque por opacidade 0,8 (sem escala), desligado sem mudar a
    cor. Use só nas folhas de confirmação do pedido (Excluir pedido · Voltar). Em qualquer outra tela ou folha, o botão é
    `Button`/`Botao` do §3 (principal, secundário, neutro, perigo claro).
  - `LinhaOpcaoFolha`: linha de 64 dp com ícone (padrão `file`) num quadrado `accentSoft` de 38 dp, título 15, texto `type.small`
    e seta. Use para escolher o destino de uma ação com texto explicativo (PDF para o cliente / para o BKO). Para escolha simples
    numa `Folha` (2–5 opções de uma linha), continue com `OpcaoFolha`.
- **Diálogo** (`Dialogo`): só para confirmar o que não tem volta. Cancelar = neutro; confirmar = Azul noite ou vermelho (`perigo`).
- **Aviso no rodapé** (`AvisoRodape` + `useAvisoRodape`): grafite, ícone verde de ok, texto branco, ação laranja-clara à direita.
  Some em **2,5 s** (8 s com TalkBack). Texto no passado e com o objeto: "Pedido 000013 enviado para aprovação", "Item removido".
  Ação: "Desfazer". Fica acima da barra de abas (`respiroInferior`). Uso:
  ```tsx
  const aviso = useAvisoRodape();
  aviso.mostrar({ texto: 'Item removido', acao: { rotulo: 'Desfazer', onPress: desfazer } });
  return (<View style={{ flex: 1 }}><Screen>…</Screen><AvisoRodape {...aviso.props} respiroInferior={0} /></View>);
  ```
- **Abas** (`Abas`): padrão com largura igual (cada aba `flex: 1`), sublinhado 3 dp na ativa. Com `rolavel`, faixa horizontal:
  cada aba com a largura do rótulo + 16 dp de cada lado, alvo ≥ 48 dp, e a ativa rola até ficar à vista (destino em
  `rolagemAteAba`, parte pura testada). Use quando os rótulos não cabem em 360 dp (ficha do cliente, 6 abas). Nomes inteiros, nunca abreviar.
- **Barra de abas** (`BarraAbas`): 64 dp + área segura, até 5 abas, ícone 22, rótulo 11. Ativa: ícone Azul noite e rótulo `accentInk`
  em negrito; inativa: `ink2`. Contador no canto do ícone: laranja de gráfico (`destaque`, não lidas) ou âmbar (`aviso`, fila). O shell decide as abas.
- **Estados de tela**:
  - carregando: `Loading` (indicador Azul noite) na primeira carga; depois, mostre o que já tem e atualize no lugar;
  - vazio: `EstadoVazio` (título que diz o que falta + o que fazer; ação secundária opcional);
  - erro: `Banner tone="danger"` com o que aconteceu e o que fazer ("Não deu para enviar. O pedido está salvo e vai sozinho quando
    houver sinal.");
  - sem sinal: `Banner` âmbar (`wifiOff`) e `SyncStamp`; nada some da tela por falta de sinal;
  - **listas** (RD-0076, 10/11; regra "nenhum aviso solto", RN-VEN-42): sinal, servidor e hora da última sincronização ficam
    num só **`SeloAtualizacao`** no cabeçalho, à direita do título ("↻ 06:30", "Atualizando…", "Sem sinal", "Sem resposta"; textos
    em `desenhoSeloAtualizacao`). Sem faixa de sinal ou de fila no meio da lista e sem rodapé "Atualizado às…". A fila é o selo
    "Na fila" da linha. Primeira tela: Pedidos (`docs/design/pedido-v4.md` §4.1);
  - a tela quebrou ao desenhar (erro de render, `ErrorBoundary` do shell): `TelaDeErro` com os textos de `TEXTOS_TELA_DE_ERRO`
    ("Não foi possível mostrar esta tela" · Tentar de novo · Ir para o Início · Enviar o detalhe ao suporte). Nunca
    `EstadoVazio` para erro. Spec: `docs/design/tela-de-erro.md` (T-0140).

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

### 5.2 Cabeçalho na faixa Azul noite (`CabecalhoTela`, `<Screen cabecalho>`; T-0172, manual da marca §4)
- **Faixa:** Azul noite, começa na barra de status (soma a área segura) e fica parada em cima; o corpo rola embaixo, no Pérola,
  com os cartões brancos. Sem logo.
- **Textos:** título branco, 22/28 em 700; subtítulo de uma linha em `#C9CED5`, 14. O subtítulo fica abaixo do título ou
  acima dele (`posicaoSubtitulo="acima"`, como a data acima de "Bom dia, Lucas" no Início).
- **Voltar:** dentro da faixa ("‹ Pedidos"), em `#C9CED5`, com as regras do `BackLink` (§6.1).
- **Direita:** uma ação curta de 48 dp (ícone, `SeloAtualizacao`). O botão principal fica no corpo, nunca na faixa. Nada
  grafite na faixa, nem o botão Sincronizar.
- **Uso:**
  ```tsx
  <Screen cabecalho={{ titulo: 'Clientes', subtitulo: '12 na rota de hoje' }}>…</Screen>
  <Screen cabecalho={{ titulo: 'Bom dia, Lucas', subtitulo: 'Quinta, 12 de novembro', posicaoSubtitulo: 'acima' }}>…</Screen>
  ```
  O título da faixa substitui o título que a tela desenhava dentro do `Screen`: não repita.
- **Barra de status:** ícones claros com a faixa e escuros sem ela (`estiloBarraDeStatus`). O shell aplica.
- **Medidas:** `CABECALHO`, `layoutCabecalho` e `respiroTopoDoConteudo` (`cabecalho.ts`), testados em `cabecalho.test.ts`.
- **Tela de entrada:** é outra peça, com o logo, a barra e as etapas. Spec em `docs/design/entrada-sync.md`; tokens em
  `TEMAS_ENTRADA` (`entrada.ts`).

### 5.3 Cabeçalho do portal `config.` na faixa Azul noite (web; MC-0022 e MC-0023, 14/11/2026)
Spec das telas: `docs/design/telas/portal-config-enxuto.md` §0. Simulação: `telas/portal-config-enxuto/depois-02-empresas.png`.
- **Barra:** o `header` inteiro é a faixa (`bg-faixa`, Azul noite `#1E3350`), largura total, 72 px; sem borda inferior. O corpo
  continua no Pérola, com os cartões brancos.
- **Marca:** variante da `MarcaNaFaixa` **sem** fundo e sem arredondado próprios (`<MarcaNaFaixa solta={false}>` ou
  `MarcaNaBarra`; o nome fica com o engenheiro-apps). Logo negativo a **104 px** de largura (22 px de altura, acima do mínimo
  de 20 px) e **14 px de folga** em volta (`gap-3.5 p-3.5`; área de proteção = altura do "M", manual §2.3). Ao lado, o filete
  (`bg-faixa-texto/40`) e o nome da área em `text-faixa-texto` (`#C9CED5`, 8,07:1), 15/700 na fonte do sistema.
- **Marca solta** (Entrar, Escolha a empresa, login do BKO, sem barra): a mesma peça dentro de uma faixa arredondada
  (`rounded-xl bg-faixa p-3.5`), com o logo a 104 px.
- **Abas do menu:** ativa `text-white border-b-2 border-white`; inativa `text-faixa-texto border-transparent hover:text-white`.
- **Textos da sessão** ("Sessão até 00:56") e o nome da empresa (onde ainda aparecer): `text-faixa-texto`.
- **Botão sobre a faixa** ("Sair", "Trocar de empresa"): secundário com borda `#C9CED5`, fundo transparente e texto branco
  (12,77:1); hover `bg-white/10`; 36 px de altura com alvo de 44 px. Nunca o principal na faixa.
- **Foco de teclado:** `outline-white` (o `outline-accent` some no Azul noite).

**Botão desabilitado no web (escolha pedida pelo design-de-marca, 14/11):** um padrão só, o do app (§3): **Névoa `#ECEEF1`
com texto `#5B6673` (5,03:1)**, sem transparência. Sai o `#8B96A3` com texto branco (3,00:1, abaixo de 4,5:1) do `Button`
web (`--color-disabled`). A troca no kit (`packages/ui/src/web/ui.tsx`) entra no próximo lote do designer-ux, depois do
"aprovo" do Alexandre que o design-de-marca leva.

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
- ~~**Busca antes da trilha** (aba Itens)~~: substituída. A T-0141 (D) tirou o Catálogo da aba Itens, e a trilha-atalho saiu
  com ele; a prop `Trilha.atualTocavel` foi apagada do kit (RD-0050, 10/11). A `Trilha` volta a ser só "onde você está": o
  último item é o lugar atual, sem toque. A trilha usa `accentInk` (o `accent` sobre o fundo dá 4,17:1).
- **Uma linha por produto**, com o `ChipMedida` no alto à direita ("UN", "CX c/ 20"). Com duas medidas, o chip é tocável e alterna
  a medida da linha (mantém a quantidade; `AvisoRodape` "Medida trocada para CX c/ 20" · Desfazer). Uma segunda linha do mesmo
  produto só aparece quando as duas medidas têm quantidade (ex.: depois do "Leve mais"); aí os chips ficam só leitura.
- **Equivalente do desconto em verde** (`colors.success`, `.eq` da referência): "−R$ 0,89", "= 5,3%", "−R$ 3,84". O "+ desconto"
  (ainda sem ajuste) fica em `accentInk`; o equivalente do acréscimo, em `ink2`.
- **Detalhe do orçamento = tela 5**: selo, um cartão (itens compactos, ajuste do pedido, Total, "CIF · 28 dias"), principal
  "Transformar em pedido", linha Editar | PDF, depois Duplicar (`neutro`) | Cancelar orçamento (`perigo`, abre o `Dialogo`;
  decidido na conferência de 2026-11-05, R-20261105-114721) e o Histórico. Sem frase do frete,
  sem "Desconto efetivo", Filial e Tabela. Vencido: Duplicar vira o principal, com o PDF (secundário) abaixo; nenhuma frase explicando.
- **Situação do orçamento**: "Orçamento · até 10/11" (`destaque`), "Vencido", "Cancelado" (`neutro`), "Virou pedido 000015"
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
10. **Fiel à spec e com acabamento** (pedido do dono do produto, R-20261109-054659): a revisão compara o print do aparelho com a
    imagem aprovada em `docs/design/telas/` (ordem, tamanhos, textos). Tela fora da spec ou com cara de rascunho (valores em
    frase corrida, frase explicativa sobrando, alinhamento solto) é 🔴 e não passa.
