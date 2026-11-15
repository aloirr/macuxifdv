# Fonte do sistema (R-20261115-110600, v1.0.13) · parecer do corretor-redundancias

**Veredito: COM ACHADO (não liberado).** 13 achados (RD-0940 a RD-0952): 0 alta · 8 média · 5 baixa. Todos seguram o lote.
Só o RD-0941 é código de teste; ele não é comentário nem título de teste, por isso também segura.

- **Escopo:** só excessos, duplicidades e redundâncias da troca para a fonte do sistema: tokens e código de fonte, testes,
  docs e a escala em cada módulo. Os prints foram olhados.
- **Combinado (LOCAL, descartável, sem push):** `tmp/fonte-combinado-corretor` = `origin/main` 2e554c4a + os 11 branches
  `nuvem/fonte-sistema-*` da receita (`design-de-marca` be4ca2a … `modulo-integracao` 14965f9). HEAD local b9a4ee3e,
  157 arquivos. O único conflito foi em `.coord/diario/engenheiro-software.md`. O `-X union` da receita não existe no
  `git merge`, e o guardião barra editar o diário alheio, então usei `-X ours`. Só as linhas do diário do
  engenheiro-software ficaram de fora do combinado; o código entrou inteiro. Não houve conflito em código.
- **Prints:** `combinado/depois-combinado-app-campo-v2.png` e `-v3.png` (login do Campo), `depois-combinado-login.png`
  (BKO), `depois-combinado-auditoria.png` e `depois-combinado-portal.png`, além dos `engenheiro-apps/*`.
- **Regras aplicadas** (`combinado-fonte.md`):
  - app 12 · 14 · 16 · 18 · 22 · 28; no empate, sobe;
  - web 12 · 13 · 15 · 17 · 20 · 24; no empate, desce (14→13, 16→15, 22→20); acima de 24 vira 24, menos o logo;
  - nenhum peso 800/900 e nenhum `fontFamily: fonts.x`.
- **O que está em ordem:**
  - **app:** nenhum `fontSize` fora da escala em `apps/mobile`, `modules/*/app` e `packages/ui/src/mobile`;
  - **mapeamento do app, igual em todos os módulos:** 10/11→12 · 13→14 · 15→16 · 17→18 · 19→18 · 20→22 · 24→22 · 26/30/34→28;
  - **base do app:** o único 14→16 é o `type.body`/`bodyStrong`, que é a base nova e é intencional;
  - **uso de `fonts.x`:** zero em todo o repositório.

## Achados

| ID | Onde | Tipo | O que se repete | Impacto | Sev. | Proposta (antes → depois) | Dono |
|---|---|---|---|---|---|---|---|
| RD-0940 | `packages/ui/src/mobile/theme.ts:28-34` (`fonts` @deprecated); `tokens.ts:91-125` (`FAMILIAS_ANDROID`, `FamiliasFonte`, `familiasFonte`, os 7 `PILHA_SISTEMA` repetidos); `fonte-sistema.test.ts:50-74` | código morto · teste | O `fonts` tem **0 usos** em `apps/`, `modules/` e `packages/` (grep `fonts\.` e `{ fonts }`). Ele só existe para a "transição", que já acabou no combinado. Dois testes (`:50-66` e `:68-74`) garantem o formato desse código morto, um deles pelo texto-fonte do `theme.ts` (regex). O `fonte.displaySemi` também tem **0 usos**. | manutenção: 3 nomes de família para um objeto que ninguém lê | média | Apagar o `fonts` e a sua JSDoc em `theme.ts`. Em `tokens.ts`, `familiasFonte`/`FAMILIAS_ANDROID`/`FamiliasFonte` viram uma constante só: `export const FAMILIA_MONO = Platform.OS === 'android' ? 'monospace' : PILHA_MONO` (ou `familiaMono(os)`, para o teste puro). O `fonte.mono` passa a usar essa constante. Apagar `fonte.displaySemi`. No teste, trocar `:50-74` por um caso só: "mono: Android `monospace`, web `PILHA_MONO`; nenhum `sans-serif-black`". | designer-ux |
| RD-0941 | `tests/modulos/t0140-faixa-pdf.test.ts:28`, `tests/modulos/meta-de-hoje-rd0001-t0124.test.ts:41` | teste | Mock `fonts: new Proxy(...)` de um export que nenhum componente lê mais (2 cópias). | manutenção | baixa | Apagar as 2 linhas. Se o mock precisar de algo, usar `fonte: new Proxy({}, { get: () => ({}) })`. | testes |
| RD-0942 | `packages/ui/src/mobile/theme.ts:19-25` e `:53-77` | código | Há 3 apelidos para o mesmo peso 700: `display` (29 usos), `displayBold` (29) e `bold` (42). Os estilos ficaram idênticos depois da troca: `h2` = `titulo` = `secao` = 18/700 e `number` = `numeroGrande` = 18/700 tabular. Antes eram 17/700 e 19/800. | leitura do kit: o nome promete uma hierarquia que não existe mais | baixa | Manter só `bold` (700) e marcar `display`/`displayBold` como apelidos com data para sair. Em `type`, deixar `secao` como fonte e `h2: type.secao`/`titulo` apontando para ele, ou separar de verdade (título de folha 22, conforme RD-0952). `number` → `numeroGrande`. | designer-ux |
| RD-0943 | pilha da fonte copiada em 5 lugares: `packages/ui/src/mobile/tokens.ts:87-89`, `apps/web/app/globals.css:44-46`, `modules/vendedor/domain/pdf-pedido.ts:197` e `:232`, `modules/catalogo/web/exportacao/pdf.ts:34`, `packages/platform-sdk/src/email/modelos.ts:122-123` (com Arial, `manter?` para o e-mail) | código | A string `system-ui, "Segoe UI", Roboto, -apple-system, sans-serif` aparece 5 vezes, e a mono 4 vezes. | manutenção: quem trocar a pilha num lugar esquece os outros | média | Criar `packages/comum/src/fonte.ts` com `PILHA_SISTEMA` e `PILHA_MONO`, exportados no `index.ts` (engenheiro-software). O `tokens.ts` reexporta. `pdf-pedido.ts` e `catalogo/.../pdf.ts` passam a usar `font-family:${PILHA_SISTEMA}`. O e-mail fica `${PILHA_SISTEMA}` com Arial/Helvetica antes do `sans-serif`, montado a partir da constante. O `globals.css` não importa TS: fica com um comentário `/* mesma pilha de @macuxi/comum fonte.ts */`. | engenheiro-software · designer-ux · modulo-vendedor · modulo-catalogo · engenheiro-apps |
| RD-0944 | `apps/web/app/globals.css:44-45` e `:71` | código | `--font-display` é a cópia literal de `--font-sans`. O `font-size: 15px` do `body` repete o `--text-base`. | manutenção | baixa | `--font-display: var(--font-sans);` e `font-size: var(--text-base);` | engenheiro-apps |
| RD-0945 | mesmo papel ("campo de formulário") em degraus diferentes na web: `modules/integracao/web/components/mapeamento-panel.tsx:20` e `inativacoes-panel.tsx:127` (14→**13**), `modules/gestor/web/pages/regras-page.tsx:31` (`text-sm` = 13) × `packages/ui/src/web/ui.tsx:59` e `:138`, `modules/pesquisa/web/components/editor-pergunta.tsx:11` (14→**15**) | layout · código | O mesmo 14 px antigo foi levado a 13 por uns e a 15 por outros. O empate da receita manda 13, e o `componentes.md` manda "campo 15". No BKO, o campo de Integração e de Regras fica menor que o de Pesquisa e o do kit. | leitura: o mesmo controle com 2 tamanhos | média | Campo, botão e aba seguem o papel do `componentes.md` (15), e tabela e apoio ficam em 13. Em Integração, `mapeamento-panel.tsx:20` e `inativacoes-panel.tsx:127` passam de `text-[13px]` para `text-[15px]` (ou usar `CLASSE_CAMPO_BASE` do kit, como o gestor). Em Gestor, `regras-page.tsx:31` passa de `text-sm` para `text-[15px]`. Antes, a decisão do empate × papel (RD-0952). | modulo-integracao · modulo-gestor |
| RD-0946 | `modules/core/web/**`: **73× `text-[14px]`**, `routes-page.tsx:84` 16, `:457` 18, `:110` `font-extrabold`, `route-editor.tsx:158` 19 | layout · código | O Core web não passou pela escala. O mesmo papel fica em 14 no Core e em 13 ou 15 nos outros módulos. Há peso 800 junto do 700 do kit. | leitura: o BKO com 3 tamanhos para o mesmo texto | média | Cada `text-[14px]` vai para o degrau do papel (campo e botão 15, apoio e tabela 13). 16→15, 18/19→17, `font-extrabold`→`font-bold`. Melhor ainda: as classes `text-sm`/`text-base`/`text-lg` dos tokens, sem px solto. | modulo-core |
| RD-0947 | `apps/web/components/**`: **25× `text-[14px]`**; títulos `text-[28px] font-extrabold` em `login-screen.tsx:229,318`, `ciclo-senha.tsx:106,209,225`, `aviso-link-antigo.tsx:28`, `portal/tela-entrar.tsx:116`, `portal/tela-escolher-empresa.tsx:165`; `login-screen.tsx:342` e `later-page.tsx:15` 18 | layout · código | Título de página em 28/800 no login, no portal e no ciclo de senha, contra 24/700 no `PageHeader` do kit (`ui.tsx:40`). São 2 tamanhos e 2 pesos para o mesmo papel (print `depois-combinado-login.png`: o "Entrar" ficou maior e mais pesado que o título das telas internas). | leitura | média | `text-[28px] font-extrabold` → `text-[24px] font-bold` (8 lugares). 18→17. Cada 14 vai ao degrau do papel. | engenheiro-apps |
| RD-0948 | `modules/vendedor/web/components/orders/`: `order-drawer.tsx` 16 ×5 (`:92,132,154,203,240`), `:124` 18 + `font-extrabold`, `orders-page.tsx:101` 18, 14 ×7 | layout · código | Mesma divergência da RD-0946 no módulo Pedidos do BKO. | leitura | média | 16→15, 18→17, `font-extrabold`→`font-bold`, cada 14 ao degrau do papel. | modulo-vendedor |
| RD-0949 | `modules/catalogo/web/pages/catalogo-page.tsx:294,689`, `tabelas-preco-page.tsx:335,394` | layout | 14 px mantido (4×), enquanto o próprio kit foi para 15 ou 13. | leitura | baixa | Cada um ao degrau do papel (13 ou 15). | modulo-catalogo |
| RD-0950 | `modules/promotor/web/pages/cadastros-page.tsx:162` (14), `:256` (16) | layout | Mesma divergência; não há branch `fonte-sistema-modulo-promotor` no combinado. | leitura | baixa | 14 → degrau do papel, 16→15. | modulo-promotor |
| RD-0951 | Campo › Login: rótulos "Código da empresa" e "E-mail" (`modules/core/app/components/tela-login.tsx:133-150`, `Campo` local + `estilos-de-acesso.ts:7`) × "Senha" (`packages/ui/src/mobile/campo-senha-rn.tsx:58` e `:88`); o mesmo em `tela-esqueci-senha.tsx:87,98` | código · layout | O rótulo do campo está implementado **duas vezes**: um `Campo` local no Core e o `CampoSenha` do kit, cada um com o seu estilo. No print (`depois-combinado-app-campo-v2/v3.png`), "Código da empresa" e "E-mail" saem em peso regular e "Senha" em semibold, na mesma tela. "Esqueci a senha" (`linkTexto`) também sai regular. | leitura: 3 rótulos iguais com 2 pesos | média | O kit expõe um `CampoTexto` (rótulo, entrada, erro) com o mesmo `s.rotulo` do `CampoSenha` (designer-ux), e o Core apaga o `Campo` local e o `rotulo`/`entrada` do `estilos-de-acesso.ts`, usando o do kit no login, no Esqueci a senha e no Crie sua senha (modulo-core). O porquê de o semibold do código sair regular no print vai ao testes (abaixo). | modulo-core · designer-ux |
| RD-0952 | a mesma regra descrita em 2 docs com valores diferentes: `docs/marca/manual.md` §5.2–5.3 × `docs/design/componentes.md` (seção Fonte do sistema) × receita do combinado (empate) | doc | (a) Título de seção do app: **22** no manual, **18** no `componentes.md` e no `theme.ts` (`secao`). (b) Número de cartão: peso **600** no manual, **700** no `componentes.md` e no código (`numeroGrande`, KPI do `ui.tsx:158`). (c) Rótulo: **500** no manual, **600** no código (`label`, `rotulo`, `ui.tsx:116`). (d) Web 14 px: "empate desce → 13" na receita, "campo e botão 15" no `componentes.md`. As pilhas e a escala estão copiadas por inteiro nos 2 docs. | decisão: cada agente seguiu um texto (é a origem das RD-0945 a RD-0950) | média | A fonte da verdade é o **manual §5** (aprovado pelo dono do produto). O design-de-marca fecha (a), (b), (c) e (d) no manual. O `componentes.md` apaga as pilhas, os pesos e a tabela de escala e fica só com o mapeamento de tokens (`type.x` → papel do manual §5.3), com o link "§5 do manual". O `decisoes.md` é histórico (`manter`). | design-de-marca · designer-ux |

### Redundância útil (`manter`)
- `packages/platform-sdk/src/email/modelos.ts:122-123`: a pilha do e-mail tem Arial/Helvetica/Consolas porque os clientes
  de e-mail não têm `system-ui`. A variação é útil; só a parte comum entra na RD-0943.
- `docs/marca/decisoes.md`: repete as pilhas como registro da decisão de 15/11. É histórico, não é a regra viva.
- Os diários (`.coord/diario/*`) citam a R-20261115-110600 em várias entradas: é registro de trabalho, não é RD.

### Encaminhado ao testes (defeito funcional, sem número RD)
1. **Login do Campo (Expo web):** `estilos-de-acesso.ts:7` e `:20` declaram `...fonte.semibold`, mas o print mostra
   "Código da empresa", "E-mail" e "Esqueci a senha" em peso regular, e "Senha" (kit) em semibold. É preciso confirmar no
   aparelho Android se o peso some, por exemplo no `StyleSheet.create({ ...estilosDeAcesso })` de `tela-login.tsx`, que
   cria de novo um estilo já criado.
2. **Fora da regra R-20261115-110600 em produção:**
   - `font-extrabold` (800) em 9 lugares (RD-0947 e RD-0948, `routes-page.tsx:110`);
   - texto web acima de 24 px (28 px) fora do logo;
   - a guarda `fonte-sistema.test.ts` só lê `packages/ui`: proposta de estender a checagem de px e peso a `apps/web` e a
     `modules/*/web`, como teste de `tests/` (testes) ou do lint (engenheiro-software).

## Recados
Recados do GitHub deram **403** nesta sessão (`coord.mjs caixa`: "GitHub access to this repository is not enabled for
this session"). Caixa não lida. Os recados abaixo **não foram gravados** e ficam para o gerente enviar ou repassar
(todos com cc `gerente-projetos`, tarefa = fonte do sistema v1.0.13):

| Para | Tipo | Assunto | Achados |
|---|---|---|---|
| designer-ux | pedido | Fonte do sistema: código morto `fonts`, apelidos de peso, `CampoTexto` no kit, `componentes.md` × manual | RD-0940, RD-0942, RD-0943 (tokens), RD-0951 (kit), RD-0952 |
| engenheiro-software | pedido | `PILHA_SISTEMA`/`PILHA_MONO` em `packages/comum` | RD-0943 |
| engenheiro-apps | pedido | `globals.css` duplicado; títulos 28/800 e 14 px no shell web | RD-0943 (css), RD-0944, RD-0947 |
| modulo-core | pedido | 73× 14 px no BKO; rótulo do login duplicado | RD-0946, RD-0951 |
| modulo-vendedor | pedido | Pedidos no BKO fora da escala; pilha no PDF | RD-0943, RD-0948 |
| modulo-catalogo | pedido | 14 px no BKO; pilha no PDF | RD-0943, RD-0949 |
| modulo-integracao | pedido | Campo em 13 (kit em 15) | RD-0945 |
| modulo-gestor | pedido | Campo de Regras em `text-sm` | RD-0945 |
| modulo-promotor | pedido | Cadastros em 14/16 | RD-0950 |
| testes | pedido | Mock `fonts` morto; defeitos encaminhados 1 e 2 | RD-0941 + encaminhados |
| design-de-marca | pedido | Manual §5 × `componentes.md`: seção 22/18, número de cartão 600/700, rótulo 500/600, 14 px web | RD-0952 |
| gerente-projetos | entrega | Parecer da fonte do sistema: 13 achados, não liberado | todos |

Numeração provisória RD-0940 a RD-0952 (há branches paralelos do corretor ainda sem merge com RD-09xx até RD-0921). No
merge, o catálogo renumera se colidir.
