# Parecer de marca · fonte do sistema (R-20261115-110600, v1.0.13)

> 2026-11-15 · design-de-marca · validação da troca para a fonte do sistema, contra `manual.md` §5 (branch `nuvem/fonte-sistema-design-de-marca`).
> **Base:** combinado local descartável (sem push) de `origin/main` + os 11 branches `nuvem/fonte-sistema-*` (design-de-marca `be4ca2a`, designer-ux `310919e`, engenheiro-apps `b57dea2`, engenheiro-software `9346eed`, modulo-core `83b8ce1`, modulo-vendedor `7e3559d`, modulo-catalogo `3f394f7`, modulo-gestor `988d36b`, modulo-pesquisa `b5ddfc3`, modulo-treinamento `dd422d1`, modulo-integracao `14965f9`).
> **Prints:** BKO 1366×768 (antes e depois do engenheiro-apps; combinado: login, portal, auditoria), app Campo (combinado v3) e prancha do designer-ux.
> **Recados:** a CLI dá HTTP 403; os recados vão pelo gerente-projetos (lista no fim).

## Parecer: **segura** até fechar as médias (MC-0057 a MC-0060 e MC-0064). As baixas podem ir no mesmo lote.

| Superfície | Situação |
|---|---|
| Logo (app, BKO, portal, PDF) | **Aprovado.** Desenho e arquivos sem mudança; no app só sai o `role`/`aria-*` da raiz do SVG antes de desenhar (`apps/mobile/src/lib/logo-marca.ts`), sem mexer na geometria. |
| App Campo e Gestão (código) | **Aprovado no código:** só 400/500/600/700, nenhum `fontFamily: fonts.x`, nada de `sans-serif-black`, tamanhos só em 12·14·16·18·22·28, mono só em código e endereço. **Print a refazer** (MC-0064). |
| BKO | **Ressalvas:** títulos em 800 e 28 px (MC-0057, MC-0059) e 131 tamanhos fora da escala web (MC-0058); mono em CNPJ e na palavra "Pedido" (MC-0063). |
| Portal `config.` | **Ressalvas:** mesmos títulos em 800 e 28 px (MC-0057) e tamanhos fora da escala (MC-0058). No print da lista de empresas, a hierarquia e o mono do código estão corretos. |
| PDF do pedido | **Ressalvas:** fonte do sistema e mínimo 12 ok; três textos em 800 (MC-0060). |
| PDF do catálogo | **Aprovado com ajuste baixo** (MC-0062). |
| E-mails | **Aprovado com ajuste baixo** (MC-0061); fonte do sistema, senha em mono, mínimo 15. |

## Ajustes no manual §5 (esclarecem a aplicação; **o Alexandre confirma**)
1. §5.1: no **e-mail**, e só lá, a pilha termina em `Arial, Helvetica` (texto) e `Consolas, "Courier New"` (código), porque nem todo leitor de e-mail conhece `system-ui`.
2. §5.1: o que é **código** (mono) e o que não é: CNPJ, CPF, datas e valores ficam na fonte de texto com `tabular-nums`; a palavra em volta do código também.
3. §5.2: nada em 800/900 (o único 800 é a escrita do logo, em contorno); mesmo papel, mesmo peso (rótulos de um formulário); valor em destaque = 600.
4. §5.3: regra de arredondamento da troca (app sobe; web desce; acima de 24 vira 24) e PDF/e-mail com os quatro pesos e mínimo 12 px; o total do PDF do pedido pode passar de 24 px.

## Achados
| ID | Gravidade | Onde | Fere | Correção | Dono |
|---|---|---|---|---|---|
| MC-0057 | média | títulos em `font-display text-[28px] font-extrabold` (800, 28 px): `apps/web/components/login-screen.tsx:229,318`; `ciclo-senha.tsx:106,209,225`; `aviso-link-antigo.tsx:28`; `portal/tela-entrar.tsx:116`; `portal/tela-escolher-empresa.tsx:165`; e `apps/web/app/globals.css:139` (`.fv-start`, `font: 800 12px`) | §5.2 (título 700; nada em 800) e §5.3 (título de página 24 px) | `text-[28px] font-extrabold` → `text-2xl font-bold` (24 px, 700); `.fv-start`: `800` → `700` | engenheiro-apps |
| MC-0058 | média | 131 tamanhos fora da escala web 12·13·15·17·20·24: `text-[14px]` (110), `[16px]` (7), `[18px]` (5), `[19px]` (1), `[28px]` (8). Por dono: `apps/web` 35; `modules/core/web` 76; `modules/vendedor/web` 14; `modules/catalogo/web` 4; `modules/promotor/web` 2 | §5.3 (nenhum tamanho solto) | 14 → `text-sm` (13); 16 → `text-base` (15); 18 e 19 → `text-lg` (17); 28 → `text-2xl` (24). Para listar: `grep -rnoE "text-\[[0-9]+px\]" <pasta> \| grep -vE "\[(12\|13\|15\|17\|20\|24)px\]"` | engenheiro-apps · modulo-core · modulo-vendedor · modulo-catalogo · modulo-promotor |
| MC-0059 | média | 800 no BKO: `modules/vendedor/web/components/orders/order-drawer.tsx:124` (total do pedido) e `modules/core/web/components/routes/routes-page.tsx:110` (selo "CD") | §5.2 | total: `font-extrabold` → `font-semibold` (600, valor em destaque); selo "CD": `font-extrabold` → `font-bold` | modulo-vendedor · modulo-core |
| MC-0060 | média | PDF do pedido em 800: `modules/vendedor/domain/pdf-pedido.ts:201` (`.empresa`), `:204` (`.doc .t`), `:244` (`.totalbox .lin .vt`) | §5.2 (os quatro pesos valem no PDF) | `.empresa` e `.doc .t`: `800` → `700`; `.vt`: `800` → `600` | modulo-vendedor |
| MC-0061 | baixa | e-mail: valor em `<strong>` (700) e texto em `#1f2933`, fora da paleta (`packages/platform-sdk/src/email/modelos.ts:136,144`) | §5.2 (ênfase 600) e §3 (só cores da paleta) | `<strong>` → `<span style="font-weight:600">`; `color:#1f2933` → `color:#16202A` | engenheiro-software |
| MC-0062 | baixa | PDF do catálogo: `th` no negrito padrão (700) e cinzas fora da paleta `#111`, `#bbb`, `#eee` (`modules/catalogo/web/exportacao/pdf.ts:34`) | §5.2 (cabeçalho de tabela 600) e §3 | `th{font-weight:600}`; `#111` → `#16202A`; `#bbb` → `#C9CED5`; `#eee` → `#F3F4F1` | modulo-catalogo |
| MC-0063 | baixa | mono fora de código: `order-drawer.tsx:68` (título "Pedido 1234" inteiro em mono); `modules/vendedor/web/pages/transportadoras-page.tsx:106,120` (CNPJ em mono; no portal o CNPJ já está em texto) | §5.1 (o que é código) | só o número em `font-mono`; CNPJ em `tabular-nums` sem `font-mono` | modulo-vendedor |
| MC-0064 | média | print `depois-combinado-app-campo-v3.png`: no login do Campo, "Código da empresa", "E-mail" e "Esqueci a senha" saem em 400 e "Senha" em 600 | §5.2 (mesmo papel, mesmo peso) | o código combinado já está certo (`modules/core/app/components/estilos-de-acesso.ts:7,20`: rótulo e link em `fonte.semibold`, 14; `CampoSenha` em 600, 14). O print é anterior ao `83b8ce1` (o `fonts.semibold` antigo no Expo web não tinha peso). Refazer o print sobre o combinado completo; fecha no print | engenheiro-apps (print) · modulo-core |

## Conferido sem achado
- Nenhuma Archivo, IBM Plex, `sans-serif-black`, `@font-face`, `next/font` nem `fontFamily: fonts.x` em produção (o `expo-font` sai do `apps/mobile/package.json` no branch do engenheiro-apps). As fontes `.ttf` saíram do `apps/web/app/fonts/`.
- Nada abaixo de 12 em nenhuma superfície (app, web, PDFs, e-mails).
- App: escala 12·14·16·18·22·28 e pesos 400/500/600/700 em todo `apps/mobile`, `modules/*/app` e `packages/ui/src/mobile`.
- Mono: códigos, chaves, ids, hash e endereço do servidor; nos prints do portal só o código da empresa está em mono.
- BKO (prints): menu com título de grupo em Sol claro e tela atual em `#2B3743`, rótulos do login todos em 600, título da página em 700 no shell.

## Recados (a CLI dá 403; o gerente-projetos envia, com cópia para ele)
- engenheiro-apps: MC-0057, MC-0058 (`apps/web`, 35), MC-0064 (refazer o print do Campo).
- modulo-core: MC-0058 (76), MC-0059 (selo "CD"), MC-0064 (conferir no print).
- modulo-vendedor: MC-0058 (14), MC-0059 (total), MC-0060, MC-0063.
- modulo-catalogo: MC-0058 (4), MC-0062.
- modulo-promotor: MC-0058 (2; sem branch neste lote).
- engenheiro-software: MC-0061.
- gerente-projetos: levar ao Alexandre os 4 ajustes de aplicação do §5 para confirmar.

---

# Segunda passada (final) · v1.0.13

> 2026-11-15 · design-de-marca · reteste no combinado local descartável (sem push) de `origin/main` `007289e` + os 14 branches `nuvem/fonte-sistema-*`: design-de-marca `02b6804`, designer-ux `e3d72e1`, designer-ux-limpeza `3d8912b`, engenheiro-software `0a09a54`, engenheiro-apps `153ff74`, modulo-core `f10b769`, modulo-vendedor `29d7ec1`, modulo-catalogo `5d3c2ec`, modulo-gestor `121efa9`, modulo-pesquisa `4cc0ad1`, modulo-treinamento `46f4ad7`, modulo-integracao `67e67bb`, modulo-promotor `ea7893e`, testes `bc60389` (diários com `-X ours`).
> **Prints da rodada 3:** BKO 1366×768 (login, portal `config.`, auditoria) e login do app Campo.

## Parecer final: **liberado com ajustes**
As cinco médias fecharam. Ficam três baixas, com a correção de uma linha cada, que podem ir no mesmo lote ou no seguinte; nenhuma mexe no que o cliente reconhece como marca (logo, cor, família).

| ID | Situação no combinado |
|---|---|
| MC-0057 | **fechado.** Títulos de login, senha, link antigo e portal em `text-[24px] font-bold` (24/700); `.fv-start` em 700 (`globals.css:139`). Os prints do login do BKO e do portal conferem. |
| MC-0058 | **fechado.** Nenhum `text-[Npx]` fora de 12·13·15·17·20·24 em `apps/web`, `modules/*/web` e `packages`; tokens `--text-xs..2xl` = 12·13·15·17·20·24. |
| MC-0059 | **aberto em parte (baixa).** Selo "CD" em 700: fechado. O total do pedido saiu de 800, mas foi para 700 (`modules/vendedor/web/components/orders/order-drawer.tsx:124`, `text-[20px] font-bold`), e o §5.2 pede 600 no valor em destaque. Correção: `font-bold` → `font-semibold` (o PDF do pedido já usa 600 no `.vt`). Dono: modulo-vendedor. |
| MC-0060 | **fechado.** PDF do pedido: `.empresa` e `.doc .t` em 700, `.vt` em 600; nada em 800/900; mínimo 12. |
| MC-0061 | **fechado.** E-mail: valor em `font-weight:600`, texto em `#16202A`, pilha do e-mail vinda de `@macuxi/comum/fonte`. |
| MC-0062 | **fechado.** PDF do catálogo: `th` em 600, cinzas da paleta (`#16202A`, `#C9CED5`, `#ECEEF1`). |
| MC-0063 | **fechado.** "Pedido 1234" e o CNPJ das transportadoras em texto com `tabular-nums`. |
| MC-0064 | **fechado no print.** Login do Campo: "Código da empresa", "E-mail", "Senha", "Esqueci a senha" e "Avançado" no mesmo peso (600). |

## Achados novos (baixa)
| ID | Gravidade | Onde | Fere | Correção | Dono |
|---|---|---|---|---|---|
| MC-0065 | baixa | BKO, Filiais: CNPJ em mono (`modules/core/web/components/filiais/filiais-page.tsx:128`) | §5.1 (CNPJ não é código) | `font-mono` → `tabular-nums` (o código da filial, na linha 122, continua em mono) | modulo-core |
| MC-0066 | baixa | app: número do pedido em mono na lista de pedidos (`modules/vendedor/app/screens/orders-screen.tsx:465`, prop `mono`) e na ficha do cliente (`modules/vendedor/app/components/ficha-cliente.tsx:108`), enquanto o BKO e o PDF já mostram o número em texto | §5.1 (número do pedido em texto com `tabular-nums`, igual em todas as superfícies) | tirar `mono` / `...fonte.mono` e usar `fontVariant: ['tabular-nums']` | modulo-vendedor |

## Conferido sem achado
- Nada em 800/900 em `apps`, `modules` e `packages` (web, app, PDFs e e-mail); nenhuma Archivo, IBM Plex, `@font-face`, `next/font`, `useFonts`, `sans-serif-black` nem `fontFamily: fonts.x`; nenhum apelido `fonte.display`, `displayBold`, `title16` ou `smallStrong`. O `expo-font` fica no `package.json` só como dependência do Expo, sem carregar fonte.
- App: tamanhos só em 12·14·16·18·22·28; mono só em código, endereço do servidor e diagnóstico (fora a MC-0066).
- Web: `--font-display` aponta para `var(--font-sans)`; pilha única em `globals.css` e em `@macuxi/comum/fonte` para PDF e e-mail.
- Prints: menu do BKO com título de grupo em Sol claro e tela atual em `#2B3743`; títulos de página em 24/700; código da empresa em mono e CNPJ em texto no portal.
- Fora deste lote (já catalogado e aberto): MC-0021, botão principal do portal em grafite ("Nova empresa", `apps/web/components/portal/base.tsx:58`), visível no print do portal. Não segura a fonte.

## Manual §5 alinhado às decisões do gerente (rodada 3); quem confirma é o dono do produto
1. §5.3 passa a ser **escala por papel**: web 12 rótulo/chip/legenda/cabeçalho de tabela · 13 secundário · 15 texto/célula/campo/botão/menu · 17 subtítulo e título de seção · 20 título de cartão e diálogo · 24 título de página; app 12 · 14 · 16 · 18 título de seção · 22 título de tela · 28 número grande e telas de entrada. Sai a regra de arredondamento. Concordo com o designer-ux: no app, título de seção 18 e de tela 22 (antes o §5 dizia 22 e 28), porque segue o que o app já mostra e deixa o 28 para o número que a pessoa procura.
2. §5.1: **número do pedido e da nota** saem da lista de códigos e vão para o texto com `tabular-nums` ("Pedido 1234" inteiro), como já estão o BKO e o PDF.

## Encaminhamentos (pelo gerente-projetos)
- modulo-vendedor: MC-0059 (total em 600) e MC-0066.
- modulo-core: MC-0065.
- gerente-projetos: levar ao dono do produto os dois alinhamentos do §5 acima, junto com os quatro da primeira passada.
