# Fonte do sistema (R-20261115-110600, v1.0.13) · parecer do corretor-redundancias (3ª passada)

**Veredito: COM ACHADO (não liberado).** Na 3ª passada fecharam RD-0953, RD-0954, RD-0955, RD-0956 e RD-0958. Ficam
**2 em aberto, os 2 de gravidade baixa**: RD-0952 (c), dono design-de-marca, e RD-0957 (resíduo), dono modulo-core. Os 2
seguram o lote, porque estão em doc e em código de produção, e não só em comentário ou título de teste (R-20261111-190159).
Cada um se corrige com 1 linha ou 2.

## 3ª passada (15/11/2026, tarde em Manaus)
- **Combinado (LOCAL, descartável, sem push):** `tmp/fonte-c3-corretor` = `origin/main` 45916068 + os
  `origin/nuvem/fonte-sistema-*` mais novos. Resultado: HEAD e1e6a56a. Os 14 merges entraram sem conflito, então o `-X ours`
  não foi usado. SHAs:
  - design-de-marca 850615bd · designer-ux 57c019fb · engenheiro-software 0a09a546 · engenheiro-apps 85757344;
  - modulo-core 07fdb085 · modulo-vendedor bb5e83f2 · modulo-catalogo 5d3c2ec2 · modulo-gestor 121efa9c;
  - modulo-pesquisa 4cc0ad18 · modulo-treinamento 46f4ad78 · modulo-integracao 67e67bba · modulo-promotor c79e98ff;
  - designer-ux-limpeza 932b349a · testes 9e9a549b.
- **Testes:** não rodei nesta sessão, porque o worktree não tem `node_modules` e o guardião bloqueia o link. O critério é o
  CI do PR. Conferi o código direto:
  - nada em 800/900 nem `font-display` em código de produção;
  - web: `text-[Npx]` só em 12·13·15·17·20·24;
  - app: `fontSize` só em 12·14·16·18·22·28;
  - a varredura do testes (9e9a549) não tem mais `PENDENTES` nem `it.fails`. O encaminhado 1 da 2ª passada está resolvido.
- **Marca:** o total do pedido no BKO (`order-drawer.tsx:124`) está em `font-semibold`. O encaminhado 2 está resolvido.

| ID | Status | Evidência no combinado |
|---|---|---|
| RD-0952 | **aberto em parte (c), baixa** | (a) e (d) fecharam: o §5.3 agora traz a escala por papel (app 18 seção · 22 tela · 28 número grande e entrada; web 17 · 20 · 24) e saiu o "web desce". (c) segue. O §5.2 diz "500 · ênfase leve: **rótulo**, item de menu, chip, botão secundário", e o bullet diz "rótulos dos campos… (500 ou 600)". Todo rótulo do código está em 600: app `ESTILO_CAMPO.rotulo`, `type.label` e `type.rotulo`; web `ui.tsx:65,80,116` e `campo-senha.tsx:44`. |
| RD-0953 | corrigido | `ListaSuspensa` (`suspensa.tsx:196`) e `Desconto` (`desconto-rn.tsx:74`) usam `RotuloCampo`. `endereco-pedido.tsx:172,187` usa `RotuloCampo` + `ESTILO_CAMPO.entrada`. `novo-pedido-abas.tsx:223-224` e `tela-loja.tsx:111,114,206,271` usam o `CampoTexto` do kit. Não sobra `Campo`/`CampoTexto` local. |
| RD-0954 | corrigido | `textTransform: 'uppercase'` só existe em `theme.ts:70` (`type.rotulo`). Os outros usam `...t.rotulo` ou `t.rotulo` (`formulario.tsx:596`, `valores.tsx:363`, `cartoes-pedido.tsx:36`, `navegacao.tsx:226`, `login.tsx:424,457`). Não há mais espaçamento 0.4. |
| RD-0955 | corrigido | `apps/mobile/src/components/servidor.ts`: `ENTRADA_SERVIDOR = [ESTILO_CAMPO.entrada, fonte.mono, …]` e `ENDERECO_SERVIDOR`, usados em `login.tsx:330,350` e no `profile.tsx`. |
| RD-0956 | corrigido | Não há `font-display` em `apps/web`, `modules/*/web` nem `packages`. O único que sobra está no próprio teste-guarda do kit, que proíbe a classe. |
| RD-0957 | **aberto em parte, baixa** | O visível fechou: `type.saudacao = h1Small` (22/700) no Gestão e 22 no Campo. Sobra uma duplicidade no código. `escala-inicio.ts:61` mantém `saudacao: 22` literal no `BASE`, e a tela não lê o kit, porque `FONTES_DO_KIT` (`tela-inicio-campo.tsx:19`) só passa `h2/label/sub/ultima`. O teste `escala-inicio.test.ts:53` só confere que o valor é 22. Com isso, o comentário do `theme.ts:58` ("o Início do Campo lê o `fontSize` daqui") fica falso, e o 22 mora em 2 lugares: se o kit mudar, o Campo e o Gestão voltam a divergir. |
| RD-0958 | corrigido | `componentes.md` não cita mais os apelidos. `catalogo-aplicacao.md`, `inicio.md`, `pdf-pedido.md`, `emails/*`, `pedido-v4.md` e `entrada-sync.md` não citam mais Archivo, Plex, `smallStrong`, `title16`, 10,5 nem 800. `pedido-v3.md`, `revisoes/T-0141.md`, `catalogo-por-linha.md`, `clientes-lista.md` e `telas/inicio-cabecalho.md` têm a linha "Tipografia substituída…" no topo. A menção no `portal-config-enxuto.md:404,412` é log histórico de MC aceito (`manter`). Os mockups `.html` antigos são histórico. |

**Redundância nova criada pelas correções:** nenhuma além do resíduo do RD-0957. `servidor.ts`, `RotuloCampo` e
`t.rotulo` concentram o que estava copiado. Nada foi recriado em outro lugar.

### Em aberto (3ª passada)
| ID | Onde | Tipo | O que se repete | Impacto | Sev. | Proposta (antes → depois) | Dono |
|---|---|---|---|---|---|---|---|
| RD-0952 (c) | `docs/marca/manual.md` §5.2: tabela de pesos (linha 500) e o bullet "Mesmo papel, mesmo peso" | doc | O peso do rótulo de campo aparece de 2 formas. O manual dá 500 (e "500 ou 600" no bullet), e o código, nas 2 plataformas, usa 600. | decisão: quem seguir o manual monta o rótulo em 500, fora do resto | baixa | Linha 500: "ênfase leve: rótulo, item de menu, chip, botão secundário" → "ênfase leve: item de menu, chip, botão secundário". Linha 600: "ênfase: botão principal, …" → "ênfase: rótulo de campo e rótulo pequeno, botão principal, número de card, cabeçalho de tabela, aba ativa". No bullet, "(500 ou 600, nunca um em 400 e outro em 600)" → "(600)". O Alexandre confirma junto com os outros alinhamentos do §5. | design-de-marca |
| RD-0957 (resíduo) | `modules/core/app/telas/inicio/escala-inicio.ts:42,61` e `tela-inicio-campo.tsx:19` | código | O tamanho-base da saudação está em 2 lugares: `type.saudacao` (kit, 22) e `BASE.fonte.saudacao: 22` (Core). | manutenção: se o kit mudar, as boas-vindas do Campo e do Gestão voltam a divergir. O comentário do `theme.ts:58` fica falso. | baixa | `FontesDoKit` passa a ser `{ h2; label; sub; ultima; saudacao }`. No `BASE.fonte`, sai `saudacao: 22`. Em `tela-inicio-campo.tsx:19`, entra `saudacao: t.saudacao.fontSize` no `FONTES_DO_KIT`, e o `KIT` do teste ganha `saudacao: 22`. | modulo-core |

**Recados (via gerente-projetos, a CLI dá 403):** design-de-marca, RD-0952 (c); modulo-core, RD-0957 (resíduo).

---

# 2ª passada (histórico)

**Veredito: COM ACHADO (não liberado).** 12 dos 13 achados da primeira passada fecharam. O RD-0952 foi reaberto em parte e
há 6 achados novos (RD-0953 a RD-0958). Ficam **7 em aberto: 3 média · 4 baixa**. Todos seguram o lote, porque nenhum está
só em comentário ou em título de teste (R-20261111-190159).

- **Escopo:** só excessos, duplicidades, código morto e a mesma escala ou o mesmo peso para o mesmo papel, na troca para a
  fonte do sistema. O defeito funcional que achei foi encaminhado ao testes, no fim deste parecer.
- **Primeira passada:** o texto dos RD-0940 a RD-0952 está no commit `be183a3a` deste branch e no `catalogo.md`.
- **Estado julgado:** o estado final, com tudo combinado. A ordem dos PRs é designer-ux → engenheiro-software → módulos →
  designer-ux-limpeza → testes. O `fonts` e os apelidos @deprecated da transição não contam, porque a limpeza os apaga.

## Combinado (LOCAL, descartável, sem push)
- **Base e branches:** `tmp/fonte-final-corretor` = `origin/main` 007289e0 + os `origin/nuvem/fonte-sistema-*` mais novos:
  - design-de-marca 02b68048 · designer-ux e3d72e17 · engenheiro-software 312418ff · engenheiro-apps 153ff74f;
  - modulo-core f10b769f · modulo-vendedor 29d7ec13 · modulo-catalogo 5d3c2ec2 · modulo-gestor 121efa9c;
  - modulo-pesquisa 4cc0ad18 · modulo-treinamento 46f4ad78 · modulo-integracao 67e67bba · modulo-promotor ea7893ef;
  - designer-ux-limpeza 3d8912b1 · testes bc60389a.
- **Resultado:** HEAD 385ccada, 236 arquivos.
- **Conflitos:** o `-X ours` só tocou os diários. Conferi que nenhum código se perdeu:
  - `apps/` do combinado é igual ao branch do engenheiro-apps;
  - `packages/ui` e `docs/design` são iguais aos da designer-ux-limpeza;
  - cada `modules/<m>` é igual ao branch do próprio módulo.
- **Testes:**
  - `packages/ui`: 427/427 verdes;
  - `tests/fundacao/fonte-sistema-varredura.test.ts`: **1 vermelho** (encaminhado ao testes, abaixo).
- **Prints:** os 4 de `rodada3/`:
  - `depois-app-campo.png`: os 3 rótulos do login do Campo saem iguais;
  - `depois-login.png`, `depois-auditoria.png` e `depois-portal.png`: títulos em 24/700 e nada em 800.

## Reteste da primeira passada
| ID | Status | Evidência no combinado |
|---|---|---|
| RD-0940 | corrigido | Não sobra `fonts`, `familiasFonte`, `FAMILIAS_ANDROID` nem `displaySemi` em código. O teste virou um caso só (`fonte-sistema.test.ts:50-55`). |
| RD-0941 | corrigido | Os 2 mocks agora usam `fonte: new Proxy(...)`. |
| RD-0942 | corrigido | `fonte` tem um nome por peso (`body`, `medium`, `semibold`, `bold`, `mono`) e `type` um nome por papel (`theme.ts:19-71`). |
| RD-0943 | corrigido | A pilha fica só em `packages/comum/src/fonte.ts`. O PDF do pedido, o PDF do catálogo e o e-mail importam dali, e o `globals.css` declara a pilha uma vez. |
| RD-0944 | corrigido | `--font-display: var(--font-sans)` e `font-size: var(--text-base)`. O que sobra disso está no RD-0956. |
| RD-0945 | corrigido | Os campos de Integração e de Gestor › Regras estão em `text-[15px]`, como o kit e Pesquisa. |
| RD-0946 · 0947 · 0948 · 0949 · 0950 | corrigido | Contagem de `text-[Npx]` na web: 152×12 · 265×13 · 157×15 · 19×17 · 4×20 · 10×24, todos dentro da escala. Não há `font-extrabold`/`font-black` em produção. |
| RD-0951 | corrigido | Login e Esqueci a senha usam o `CampoTexto` do kit, e o `CampoSenha` usa `RotuloCampo`/`ESTILO_CAMPO`. No print, os 3 rótulos são iguais. |
| RD-0952 | **reaberto** (parte) | O (b), número em 600, fechou, e o `componentes.md` agora remete ao manual. O (a), o (c) e o (d) seguem no `manual.md`, ver abaixo. |

## Em aberto

| ID | Onde | Tipo | O que se repete | Impacto | Sev. | Proposta (antes → depois) | Dono |
|---|---|---|---|---|---|---|---|
| RD-0952 (reaberto) | `docs/marca/manual.md` §5.2-5.3 × código e decisão do gerente (rodada 3, item 1) | doc | O manual, que é a fonte da verdade, ainda traz 3 divergências. (a) **App:** título de seção 22 e título de página 28 no manual; no código, seção 18 (`type.h2`), tela 22 (`h1Small`) e 28 só para número grande e saudação. **Web:** título de seção 20 no manual; no código, seção 17 (`Panel`) e cartão ou diálogo 20. (c) "500: rótulo" no manual, enquanto `type.label`/`rotulo` e o rótulo de campo estão em 600. (d) O manual manda arredondar ("na web, desce: 14 → 13"); o código seguiu o **papel** (14 → 15 em texto, campo e célula). | decisão: quem ler o manual monta a tela fora do resto | média | O §5.3 passa a ter a tabela por papel da rodada 3: web 12 · 13 · 15 · 17 seção · 20 cartão/diálogo · 24 página; app 12 · 14 · 16 · 18 seção · 22 tela/folha/diálogo · 28 número grande e saudação. Trocar o bullet "Arredondamento na troca" por "Na troca, cada tamanho vai ao degrau do seu papel (tabela acima)". No §5.2, ficam "500: meta, item de menu, chip" e "600: rótulo de campo e rótulo pequeno". O Alexandre confirma. | design-de-marca |
| RD-0953 | **Rótulo de campo do app** em 3 formas: kit `RotuloCampo`/`CampoTexto`/`CampoSenha` (`campo-texto-rn.tsx:21`, 14/600 `ink`) × kit `ListaSuspensa` e `CampoAjuste` (`suspensa.tsx:195,333`) e `Desconto` (`desconto-rn.tsx:72,109`), 12/600 **maiúsculas** `ink2` × rótulos locais: `modules/vendedor/app/components/endereco-pedido.tsx:170,263` (12/600 `ink2`), `modules/promotor/app/telas/tela-loja.tsx:32-38` (`Campo` com `t.label`, 12/600) e `modules/vendedor/app/components/novo-pedido-abas.tsx:232` (`CampoTexto` local, com o mesmo nome do kit e o rótulo só no placeholder) | código · layout | No mesmo papel há 3 tamanhos e 2 caixas. Na folha Endereço do Novo pedido, "Cidade" (12, minúsculas) fica ao lado de "UF" (12, MAIÚSCULAS). Isso contradiz o `componentes.md` ("Nenhuma tela monta rótulo de campo próprio") e o manual §5.2 ("mesmo papel, mesmo peso"). | leitura: o formulário muda de cara de um campo para o outro | média | **designer-ux:** `ListaSuspensa`, `CampoAjuste` e `Desconto` passam a usar `<RotuloCampo>{rotulo}</RotuloCampo>` e apagam o `s.rotulo` próprio. Se o campo de escolha precisar de rótulo em maiúsculas, a regra muda no `RotuloCampo` e vale para todos. **modulo-vendedor:** em `endereco-pedido.tsx`, `campo()` usa `<RotuloCampo>` e `ESTILO_CAMPO.entrada` (o foco e o erro continuam por cima), e sai o `s.rotulo:263`. Em `novo-pedido-abas.tsx`, o `CampoTexto` local dá lugar ao `CampoTexto` do kit (`rotulo="Nome"`/`"CNPJ"`, `aoMudar`). **modulo-promotor:** em `tela-loja.tsx`, o `Campo` dá lugar ao `CampoTexto` do kit (`keyboardType` pelo resto das props). | designer-ux · modulo-vendedor · modulo-promotor |
| RD-0954 | `type.rotulo` (12/600, maiúsculas, espaçamento 0.6) refeito à mão 7 vezes, 5 delas com espaçamento **0.4**: `packages/ui/src/mobile/cartoes-pedido.tsx:68`, `desconto-rn.tsx:109`, `formulario.tsx:596`, `suspensa.tsx:333`, `valores.tsx:363` (0.4); `navegacao.tsx:226` e `apps/mobile/src/app/login.tsx:483` (`group`, 0.6) | código | O mesmo papel ("RÓTULO EM MAIÚSCULAS") aparece com 2 espaçamentos e 7 cópias literais. | manutenção: mudar o rótulo exige 8 edições | baixa | Cada um vira `{ ...t.rotulo, <só o que muda: flex, lineHeight, numberOfLines> }`. O espaçamento fica um só (o 0.6 do `type`). Os 2 de `desconto-rn` e `suspensa` já saem pelo RD-0953. | designer-ux · engenheiro-apps (`login.tsx:483`) |
| RD-0955 | Campo "Servidor" do app: o estilo `input` (46 dp, `fonte.mono` 14) está copiado em `apps/mobile/src/app/login.tsx:493` e `profile.tsx:374`, e o endereço `[t.body, { ...fonte.mono, fontSize: 14 }]` em `login.tsx:349` e `profile.tsx:261` | código · layout | São 2 cópias de 2 estilos, e a entrada fica em 14, enquanto todo campo do app usa 16 (`ESTILO_CAMPO.entrada` e os módulos). | manutenção; leitura | baixa | Um estilo só, `ENTRADA_SERVIDOR = [ESTILO_CAMPO.entrada, fonte.mono]` (16, mono, a mesma altura do kit), e um `ENDERECO_SERVIDOR = { ...fonte.mono, fontSize: 14, color: colors.ink }`, num arquivo do shell (por exemplo `src/components/servidor.ts`), usados no login e no perfil. | engenheiro-apps |
| RD-0956 | Classe `font-display` em 22 lugares: `apps/web/components/**` 13 (`login-screen.tsx:229,318,342`, `ciclo-senha.tsx:106,209,225`, `aviso-link-antigo.tsx:28`, `later-page.tsx:15`, `marca-faixa.tsx:22`, `portal/cartao-base.tsx:214`, `portal/cartao-equipe.tsx:114`, `portal/tela-entrar.tsx:116`, `portal/tela-escolher-empresa.tsx:165`), `modules/core/web/**` 3 (`novo-perfil.tsx:74`, `route-editor.tsx:158`, `routes-page.tsx:457`) e `modules/vendedor/web/components/orders/order-drawer.tsx` 6 (`:92,124,132,154,203,240`); token `--font-display` em `globals.css:45` | código | A classe é a mesma `--font-sans` que o `body` já usa, então não tem efeito. O kit já tirou a classe (`fonte-sistema.test.ts:64-67`: "web sem `font-display`"), e os títulos do kit (`PageHeader`, `Panel`) saem iguais sem ela. São 2 nomes para a mesma fonte. | manutenção: sugere uma fonte de título que não existe mais | baixa | Apagar `font-display ` das 22 classes, por exemplo `m-0 font-display text-[24px] font-bold` → `m-0 text-[24px] font-bold`. Depois, a linha `--font-display: var(--font-sans);` do `globals.css`. Este achado substitui a proposta do RD-0944, que mantinha o apelido. | engenheiro-apps · modulo-core · modulo-vendedor |
| RD-0957 | Saudação "Bom dia, Lucas": no Início do Gestão, `type.saudacao` = `h1` **28**/700 (`apps/mobile/src/components/inicio.tsx:34`); no Início do Campo, **22**/700 (`modules/core/app/telas/inicio/escala-inicio.ts:61`, `tela-inicio-campo.tsx:193`), que é o valor-base próprio da escala do Início | layout | O mesmo papel sai em 2 tamanhos em telas equivalentes. O `theme.ts` (tabela do `type`) diz que é 28. | leitura entre Campo e Gestão | baixa | Um valor só, decidido pela designer-ux. A sugestão é 22/700, que já está aprovado na faixa do Campo: `saudacao: estilosDeTexto.h1Small` no `theme.ts`, com a tabela corrigida. O Core lê a base do kit (`FontesDoKit` + `saudacao: t.saudacao.fontSize`) em vez do `22` literal do `BASE`. | designer-ux · modulo-core |
| RD-0958 | Docs com a regra antiga, em conflito com o manual §5 | doc | (1) `docs/design/componentes.md:26-30` ainda cita `display`/`displayBold` ("saem na v1.0.14"), `title16` e `smallStrong`, que a limpeza apagou. (2) `catalogo-aplicacao.md:19,26` usa `t.smallStrong`, e `inicio.md:79` usa `title16`/"Archivo 22". (3) 19 specs de `docs/design` ainda receitam Archivo e IBM Plex, entre elas `pdf-pedido.md:116,138-149` (rótulos de **10,5 px** e Archivo **800**, contra "nada abaixo de 12, nada em 800"), `emails/redefinir-senha.md`, `pedido-v4.md` (11×) e `entrada-sync.md` (8×). | decisão: a spec ensina o contrário do manual | média | (1) Em `componentes.md`, apagar "`display`/`displayBold` são apelidos de `bold` e saem na v1.0.14.", "(`title16` é o mesmo)" e "(`smallStrong` é o mesmo)". (2) `t.smallStrong` → `t.label`; `title16`/Archivo 22 → `t.number`. (3) Nas specs vivas (`pdf-pedido.md`, `emails/*`, `pedido-v4.md`, `entrada-sync.md`, `telas/bko-revisao.md`, `telas/portal-config-enxuto.md`), a família sai e o peso e o tamanho vão para o §5. Em `pdf-pedido.md`, 10,5 → 12 e 800 → 700 (o total → 600). Nas antigas (`pedido-v3.md`, `revisoes/*`), basta uma linha no topo: "Tipografia substituída pela fonte do sistema (manual §5, 15/11/2026)". Os roteiros de `docs/testes` são histórico (`manter`). | designer-ux |

### Redundância útil (`manter`)
- Pilha do e-mail com Arial e Helvetica (`PILHA_SISTEMA_EMAIL`): agora sai da mesma constante, então está certo.
- `ESCALA_FONTE`/`TAMANHOS_FONTE` só são usados pelo teste do kit. Ficam, porque são a referência da escala para quem monta
  tela.
- As guardas `packages/ui/src/mobile/fonte-sistema.test.ts` (kit) e `tests/fundacao/fonte-sistema-varredura.test.ts` (fora
  do kit) se complementam. Não há caso repetido entre as duas.
- `docs/marca/decisoes.md` e os pareceres antigos da marca citam `fonts.x`. São histórico.

### Encaminhado ao testes (defeito funcional, sem número RD)
1. **`tests/fundacao/fonte-sistema-varredura.test.ts` fica vermelho no combinado:**
   - o `it.fails('PENDENTES vazio…')` falha com "Expect test to fail", porque o modulo-core já corrigiu o `font-extrabold`
     de `routes-page.tsx:110`;
   - o mapa `PENDENTES` (linhas 70-73) ficou sem caso;
   - a correção é apagar a entrada do mapa e o `it.fails`, ou só o `it.fails` enquanto o mapa estiver vazio;
   - sem isso, o CI do PR do testes (o último do lote) fica vermelho.
2. **Para a marca** (MC-0059, não é RD): o total do pedido no BKO (`order-drawer.tsx:124`) ficou em 20/**700**. A proposta
   da marca era 600 (valor em destaque).

### Fora do escopo da fonte (já no `origin/main`, sem RD neste lote; sugiro tarefa para o próximo parecer de telas)
- **BKO › Entrar:** o subtítulo "Use o código da sua empresa, o seu e-mail e a sua senha." repete os 3 rótulos logo abaixo.
- **BKO › Auditoria:** o subtítulo "… · toda gravação do sistema entra aqui" explica como o sistema funciona
  (R-20261110-192153). A coluna "Entidade" mostra "aparelho" em todas as linhas do print.
- **Portal › Empresas:** "Cada empresa cliente é um tenant." explica o funcionamento e usa jargão.
- **Campo › Entrar:** o aviso de servidor fora do ar tem 6 linhas, com uma explicação técnica.

## Recados
A CLI de recados dá 403 nesta sessão, por isso os recados vão pelo gerente-projetos, com cópia para ele e a tarefa da fonte
do sistema v1.0.13:

| Para | Achados |
|---|---|
| design-de-marca | RD-0952 (reaberto) |
| designer-ux | RD-0953 (kit), RD-0954, RD-0957, RD-0958 |
| modulo-vendedor | RD-0953 (`endereco-pedido`, `novo-pedido-abas`), RD-0956 (`order-drawer`) |
| modulo-promotor | RD-0953 (`tela-loja`) |
| modulo-core | RD-0956 (3 classes), RD-0957 (base da saudação) |
| engenheiro-apps | RD-0954 (`login.tsx:483`), RD-0955, RD-0956 (13 classes e o token) |
| testes | encaminhado 1 |
| gerente-projetos | entrega deste parecer; encaminhado 2 para a marca; itens fora do escopo |

A numeração é provisória (RD-0953 a RD-0958): o catálogo renumera no merge se colidir com outros branches do corretor.
