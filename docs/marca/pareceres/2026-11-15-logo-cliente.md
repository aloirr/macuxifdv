# Parecer da marca · Logo do cliente, simulação (designer-ux)

> 2026-11-15 (Manaus) · design-de-marca · branch `nuvem/logo-cliente-designer-ux`, head `d832bc4a`.
> Spec `docs/design/telas/logo-cliente.md` e simulações em `docs/design/telas/logo-cliente/` (8 PNG, 6 HTML, CSS e a logo fictícia).
> Decisões do Alexandre: carga com a variação A e login sem logo (R-20261114-234500); nome fantasia no Mais (R-20261114-223500).
> Parecer anterior: `pareceres/2026-11-15-lote-noite.md` (branch `nuvem/reteste-lotes-b-design-de-marca`), parte 2, lote 13 (MC-0066, MC-0067 e MC-0068).

## Veredito
**Liberado com ajustes.** A convivência das duas marcas está certa em todas as superfícies. As MC-0066 e MC-0067 fecham. Abre a **MC-0088** (baixa): a linha "Etapa n de N · nome" saiu da carga, o que diverge da entrada aprovada (manual §4). Essa MC precisa de uma decisão antes da implementação, que só vem depois do build da v1.0.9. Ela não segura a simulação.

## Como conferi
- Abri os 8 PNG e li os HTML e o CSS.
- Medi os pixels nos PNG de 2×, com Python/PIL, e converti para dp.
- Calculei as razões de contraste pela fórmula WCAG.

## Princípio da convivência (manual §2.4 e §7)
- **PDF:** a marca é a do cliente. A Macuxi não aparece.
- **App e portal:** a marca é a Macuxi. A logo do cliente entra como assinatura de quem licenciou: sempre menor, numa placa branca e fora da área de proteção.
- **Login:** sem a logo do cliente, por decisão do Alexandre. Assim a disputa da MC-0067 no login deixa de existir.

## Conferência por superfície

| Superfície | O que medi ou vi | Resultado |
|---|---|---|
| **Carga, Campo, com logo** (`carga-campo.png`) | Logo empilhado negativo com 124 × 116 dp e o "M" com 24,5 dp. O filete fica a 24 dp do logo e a 24 dp da placa, em `#3A4D68` (o trilho, §4). A placa mede 112 × 64 dp, é branca, sem borda e tem raio 12. A logo ocupa até 96 × 48 dp, em `contain`. Barra `#F59A52` sobre `#3A4D68` e ✓ `#7FD1A8`, como na §4 | **conforme** (variação A). A Macuxi fica com 116 dp de altura contra 64 da placa, então a hierarquia está clara. O filete encosta no limite da área de proteção (24 contra 24,5 dp, abaixo de 1 px no print). Na implementação, use 24 dp fixos com o logo a 124 dp |
| **Carga, Gestão, com logo** (`carga-gestao.png`) | Mesmas medidas, sobre o Pérola. Logo empilhado positivo, filete `#DFE2E6` e placa com borda `#DFE2E6`. Barra `#C2540A` sobre `#DFE2E6` (gráfico: 4,26:1 no Pérola) e ✓ `#1D6B4F` com texto ao lado | **conforme** |
| **Carga, sem logo** | Igual à entrada de hoje, menos a linha "Etapa 2 de 5 · Clientes e rota", que virou só `aria-label` (RD-0451) | **MC-0088** |
| **Login e telas de senha** | Sem a logo do cliente (spec §4) | **conforme**. A MC-0067 fecha no login |
| **Mais** (`mais.png`) | "Licenciado para Exemplo Norte" em 13/18, `#4A5562` (7,03:1 no Pérola). Placa de 52 × até 176 dp com borda `#DFE2E6` e logo de 36 dp. Faixa "Mais" em Azul noite e aba ativa em Azul noite. Sem logo, fica só a frase | **conforme**. A MC-0067 fecha no Mais. A frase é curta e diz o que é. O nome fantasia vem da decisão R-20261114-223500 |
| **Portal `config.`** (`portal-tela.png`, `portal-estados.png`) | Barra Azul noite com o logo negativo de 104 px (≈22 px de altura, acima do mínimo de 20, §2.3). Cartão "Logo" com caixa branca de 240 × 96, borda `#DFE2E6` e raio 12. Vazio tracejado em `#C9CED5` sobre o Pérola. "Salvar" em Azul noite. "Remover" secundário com texto `#A8261B` (7,10:1). O diálogo usa o botão de perigo `#A8261B` com texto branco. O erro vai em `#A8261B` com ícone e texto. Os limites vão em `#4A5562` | **conforme**. Ali a logo do cliente é o conteúdo que se edita, e não disputa com a Macuxi da barra |
| **PDF de pedido e de orçamento com logo** | A logo do cliente vai no cabeçalho, sem a Macuxi. Caixa de 16 mm de altura e até 48 mm de largura, em `contain`, à esquerda, sem raio. "PEDIDO" e "ORÇAMENTO" saem em Azul noite. O cabeçalho da tabela é `#00843D`, como foi aprovado (§7) | **conforme** |
| **PDF sem logo** | Volta a `logo-padrao-pdf-256.png` com 16 × 16 mm (§7) | **conforme** |
| **Regras gerais (spec §1)** | Placa branca única, `contain`, sem recolorir, sem sombra, sem texto de explicação, rótulo "Logo da <nome fantasia>" e logo decorativa no Mais | **conforme** |

**Cores dos HTML:** só a paleta. O `#E4E6E9`, o `#BFC4CC` e as sombras são da prancha e da moldura do celular, e não vão para o produto. A logo "Exemplo Norte" é fictícia, então não há marca de terceiros.

**Neutros do PDF:** `#F1F2F0`, `#F3F4F1` e `#ECEEEA` continuam em `modules/vendedor/domain/pdf-pedido.ts:207/229/239` no `main`. É a **MC-0068** (baixa, modulo-vendedor), que segue aberta, fora deste lote e com a correção já dada no parecer do lote 13.

## MC-0088 (baixa): a linha "Etapa n de N · nome" saiu da carga

| Campo | Conteúdo |
|---|---|
| ID | MC-0088 |
| Onde | `docs/design/telas/logo-cliente/carga.html`, função `carga()`: `<span aria-label="Etapa 2 de 5 · ${T.etapas[1]}"></span>`. Prints `carga-campo.png` e `carga-gestao.png`, nas telas sem logo e com logo |
| Tipo | aplicação |
| Fere | manual §4, "Entrada no app (aprovada em 12/11/2026)": "'Etapa n de N · nome' e o percentual em branco". Também contradiz a spec §3, que diz que a tela sem logo é "igual a hoje" (no `main`, `docs/design/entrada-sync.md:24` ainda tem a linha) |
| Gravidade | baixa: cor e logo seguem certos, e é uma simulação |
| Correção | A simulação da logo não muda a entrada aprovada. Volte a linha visível: `<span aria-label="Etapa 2 de 5 · ${T.etapas[1]}"></span>` → `<span>Etapa 2 de 5 · ${T.etapas[1]}</span>`, em branco no Campo e Azul noite no Gestão, e gere de novo os dois PNG. Se o corretor mantiver a RD-0451, isso vira uma proposta à parte para o Alexandre, porque muda a §4 do manual e a tela de produção. Só entra com o "aprovo" dele |
| Dono | designer-ux |

## Para o Alexandre (nada entra no manual sem o "aprovo")
Quando a implementação for aprovada, proponho a **§2.5 "Logo do cliente"** no manual:
1. a logo do cliente vai sempre numa placa branca: 64/48 dp na carga e 52/36 dp no Mais;
2. a logo do cliente é sempre menor que o logo Macuxi da tela e fica fora da área de proteção;
3. no PDF vai só a marca do cliente;
4. no login não vai a logo do cliente.

## Reteste
No print do aparelho (Campo e Gestão), do portal a 1366 px e do PDF real, quando a implementação vier, depois da v1.0.9.

---

# Parte 2 · Implementação (T-0182, número provisório)

> 2026-11-15 (Manaus) · design-de-marca. Conferido contra a parte 1 (simulação liberada com o ajuste MC-0088) e o manual.
> Branches: `nuvem/logo-cliente-engenheiro-apps` (32849304: portal, carga e Mais), `nuvem/logo-cliente-designer-ux-ui`
> (10d973e3: placa), `nuvem/logo-cliente-modulo-vendedor` (e98fec5e: PDF). Tarefa: `.coord/tarefas/T-0182.md`
> (`nuvem/logo-cliente-gerente-projetos`). **Numeração:** MC-0134 (o maior número em uso nos branches `origin/nuvem/*` era
> MC-0133; há ainda uma "MC-0300" citada só num comentário do `designer-ux` em `docs/design/erp-vinculo/`, sem parecer da
> marca, que não usei como base).

## Veredito
**Segura só o PDF exportado pelo BKO** (MC-0134, alta, modulo-vendedor): com a logo cadastrada, o PDF que sai do BKO continua
com a logo padrão, e o mesmo pedido sai do app com a logo da distribuidora (manual §7). **Liberados:** portal `config.`, placa,
carga, Mais e o PDF gerado no app. A MC-0088 fecha no produto; segue aberta só na simulação (baixa, designer-ux).

## Como conferi
- **Portal:** 12 prints de 1366 px (modo falso), com as cores medidas em pixel (PIL), e o código do `cartao-logo.tsx`.
- **Placa:** o código (`placa-logo.ts` e `placa-logo-rn.tsx`) e os tokens do kit.
- **Carga e Mais:** o código, porque não havia print do aparelho. Não gerei HTML de conferência: o código reproduz as
  medidas da simulação, que eu já tinha medido.
- **PDF:** o CSS da `.logo` do branch (só ele mudou em `pdf-pedido.ts`) aplicado aos HTML da simulação. Renderizei com o
  Playwright a 1× e a 2× e comparei pixel a pixel com a simulação.

## Conferência por superfície

| Superfície | O que vi ou medi | Resultado |
|---|---|---|
| **Portal, cartão "Logo"** (prints 0 a 5b) | É o primeiro cartão da aba Empresa. A caixa tem 240 × 96, `bg-surface` e borda `line` (#DFE2E6), com raio 12 e folga 12, e a logo em `contain`. Vazia, fica tracejada em `field` (#C9CED5, medido) sobre o `ground` (#F8F6F1, medido). "Salvar" é o principal Azul noite. "Remover" é secundário com o texto #A8261B medido (o `text-danger!` vence o `text-ink`). O erro vem em #A8261B, semibold, com ícone. Os limites vêm em `ink-2` (#4A5562). As frases são as da spec. Não há hex solto: tudo sai pelo token | **conforme** |
| **Portal, diálogo** (print 6, anterior à correção do "Remover") | "Remover a logo?" sem corpo, "Cancelar" e "Remover" no botão de perigo #A8261B com texto branco | **conforme** |
| **Portal, admin do cliente** (print 8) | Vê a logo e o nome fantasia, sem botões. O logo negativo Macuxi fica na barra Azul noite, e a logo do cliente é o conteúdo do cartão | **conforme** |
| **Placa** (`PlacaLogoCliente`) | Tamanhos `carga` (64/48, até 112 × 96, folga 8) e `mais` (52/36, até 176 × 152, folgas 8/12). Fundo `colors.surface`, borda `colors.line` com 1 dp e raio `radius.md` (12). Imagem em `contain`, sem tint, sombra ou filtro. Rótulo "Logo da <nome>"; sem nome, fica decorativa | **conforme** (§1 da spec) |
| **Carga com logo** (`tela-entrada.tsx`, `entrada.ts`) | Macuxi empilhado a 124 dp, filete de 1 × 64 dp com 24 dp de cada lado e cor `tema.trilho` (#3A4D68 no Campo e #DFE2E6 no Gestão), e a placa `carga` sem borda no Campo e com borda no Gestão. A largura vai até 285 dp. A passagem leva 240 ms, e com "reduzir movimento" é direta. A logo entra só na carga (`tela-carga.tsx`), e só a do tenant da sessão | **conforme** (variação A, como medida na parte 1) |
| **Carga, linha "Etapa n de N · nome"** (MC-0088) | O `Barra` mostra o rótulo e o percentual sempre, em `tema.texto` (branco no Campo e Azul noite no Gestão), como no manual §4 | **conforme**: a MC-0088 fecha no produto |
| **Login e telas de senha** | Nenhum outro uso de `PlacaLogoCliente` ou `logoCliente` no `apps/mobile` | **conforme** |
| **Mais** (`mais.tsx`) | A frase "Licenciado para <nome>" usa `t.sub` (13, `ink2` #4A5562) com 18 de entrelinha, centralizada. A placa `mais` vem 10 dp abaixo, com borda. O `marginTop: 'auto'` leva o bloco ao pé. O mínimo acima é 24 dp (o `gap` de 14 do `Screen` mais o `paddingTop` de 10). Sem logo, fica só a frase | **conforme** |
| **PDF no app** (`order-detail-screen.tsx`) | `logo_src` vem da cópia guardada. Com erro ou sem logo, entra a padrão | **conforme** |
| **PDF, caixa da `.logo`** (`pdf-pedido.ts:200`) | É a regra da spec §6, letra por letra. Pedido e orçamento com logo: 181 × 60 px (48 × 16 mm), à esquerda, com raio 0, **idênticos** à simulação (diferença de pixel nula). Sem logo: a padrão em 16 × 16 mm. O raio passou de 2 mm para 0, mas não muda nada na tela, porque o PNG padrão já tem os cantos arredondados | **conforme** |
| **PDF exportado pelo BKO** | `exportar-pdf.ts` aceita `logo_src`, mas os dois pontos que chamam não o passam | **MC-0134** |

Os neutros do PDF (`#F1F2F0`, `#F3F4F1` e `#ECEEEA`) continuam como a **MC-0068** (baixa, modulo-vendedor), que segue aberta e fora deste lote.

## MC-0134 (alta): o PDF exportado pelo BKO sai sem a logo da distribuidora

| Campo | Conteúdo |
|---|---|
| ID | MC-0134 |
| Onde | `modules/vendedor/web/components/orders/order-drawer.tsx:46` e `orders-page.tsx:68` (branch `nuvem/logo-cliente-modulo-vendedor`, e98fec5e): `exportarPdfDoPedido(dados, view, { empresa: sessao.empresa, tz })` |
| Tipo | aplicação |
| Fere | manual §7 ("o cabeçalho leva o logo da distribuidora; sem o logo dela, entra `logo-padrao-pdf-256.png`") e spec §6 ("os dois PDFs (cliente e escritório) e os dois tipos usam o mesmo cabeçalho") |
| Gravidade | alta: a empresa que tem a logo cadastrada recebe, pelo BKO, o PDF com a logo padrão, e o mesmo pedido sai do app com a logo dela |
| Correção | Nos dois pontos que chamam, passe a logo do ambiente web, que já existe: `logoDaEmpresa: logoDaEmpresaWeb` em `apps/web/lib/ambiente.ts:35/64` (branch do engenheiro-apps). Antes: `{ empresa: sessao.empresa, tz }`. Depois: `{ empresa: sessao.empresa, tz, logo_src: await ambiente.logoDaEmpresa?.().catch(() => null) }`. Assim, com erro ou sem logo, continua a padrão. Inclua um teste que confira a logo cadastrada no HTML do BKO |
| Dono | modulo-vendedor (`modules/vendedor/**`) |

## MC-0088 (baixa): fecha no produto e segue aberta na simulação

- **No produto:** fechada. A linha está à vista em `tela-entrada.tsx` (`Barra`).
- **Na simulação:** `docs/design/telas/logo-cliente/carga.html:61` ainda tem `<span aria-label="Etapa 2 de 5 · …"></span>`, e
  `carga-campo.png` e `carga-gestao.png` saem sem a linha. A correção é a mesma da parte 1: passar para
  `<span>Etapa 2 de 5 · ${T.etapas[1]}</span>` e gerar os dois PNG de novo, para a referência bater com o produto.
- **Dono:** designer-ux. Não segura o lote.

## Recados
O `coord.mjs` deu HTTP 403 nesta sessão (sem acesso ao `macuxifdv-recados`), então os recados para o modulo-vendedor
(MC-0134) e para o designer-ux (MC-0088), com cópia ao gerente-projetos, não foram gravados. A coordenação fica no relatório
desta sessão.

## Reteste
- **MC-0134:** no HTML do PDF exportado pelo BKO, com a logo cadastrada no modo falso ou no stack isolado.
- **Carga e Mais:** no print do aparelho (Campo e Gestão), com e sem logo, quando houver build.

---

# Parte 3 · Reteste (T-0182, número provisório)

> 2026-11-15 (Manaus) · design-de-marca. Reteste das partes 1 e 2 sobre: `nuvem/logo-cliente-modulo-vendedor` (d5506130:
> MC-0134), `nuvem/logo-cliente-engenheiro-apps` (f37a62d2: `logoDaEmpresa` no ambiente web; 9cffd4dd: cartão "Nome
> fantasia" só leitura) e `nuvem/logo-cliente-designer-ux` (3510bd4e: MC-0088; c49b7221: spec §2 e erro do lado máximo).

## Veredito
**Liberado.** A MC-0134 e a MC-0088 fecham. Nenhum achado da marca aberto neste lote. A MC-0068 (neutros do PDF, baixa,
modulo-vendedor) segue aberta, fora deste lote, como já estava.

## Achado a achado

| ID | Gravidade | Dono | Situação | Como conferi |
|---|---|---|---|---|
| MC-0134 | alta | modulo-vendedor | **fechada** | `order-drawer.tsx:48` e `orders-page.tsx:71` passam `logo_src: await logoParaPdf(ambiente)` (`modules/vendedor/web/lib/logo-pdf.ts`): com erro, sem a função ou sem logo, devolve `null` e entra a padrão. O ambiente web (`apps/web/lib/ambiente.ts:35/63`) busca a logo pelo `sha256` do cache `qk.modulos` e a entrega como data URI. Gerei o HTML do PDF com o `buildOrderPdfHtml` do branch, com uma logo fictícia "Exemplo Norte", nos dois PDFs (cliente e uso interno): a `<img class="logo">` leva a logo da distribuidora, numa caixa de 181 × 60 px (48 × 16 mm) em `contain`, à esquerda, e a palavra "Macuxi" não aparece no PDF. Sem logo, entra a padrão, com 60 × 60 px (16 × 16 mm). É o mesmo cabeçalho do PDF do app (manual §7, spec §6) |
| MC-0088 | baixa | designer-ux | **fechada** | `carga.html`: `<span>Etapa 2 de 5 · ${T.etapas[1]}</span>`. Nos PNG novos, a linha aparece nas quatro telas: no Campo, em branco sobre o Azul noite; no Gestão, em Azul noite sobre o Pérola, com o percentual em negrito. A referência agora bate com o produto e com o manual §4 |

## Itens novos

| Item | O que vi | Resultado |
|---|---|---|
| **Cartão "Nome fantasia", só leitura** (`cartao-logo.tsx`, 9cffd4dd) | O admin do cliente vê só o nome fantasia em 14 px. Sem nome fantasia, vê o campo vazio (`CLASSE_CAMPO`, token `field`, até 360 px), sem texto. Não aparece mais a razão social sob o rótulo "Nome fantasia". Não há hex solto | **conforme**. Quem fala pela marca do cliente é o nome fantasia, e o cartão não troca isso pela razão social |
| **Spec §2** (c49b7221) | Só o super-admin grava a logo e o nome fantasia. O admin do cliente vê a aba só para leitura, sem botões e sem a linha dos limites. A frase nova: "A imagem passa de 4096 px de largura ou altura. Envie uma menor.", que é uma frase com a ação, no mesmo padrão das outras (`#A8261B` 13 px semibold, com o ícone) | **conforme**. É texto de interface: o conteúdo fica com o designer-ux e o corretor. Na marca, cor e padrão estão certos |

## Fora do escopo da marca (só encaminho)
- `modules/vendedor/web/components/orders/exportar-pdf.ts:9`: o comentário do `logo_src` ainda diz "BKO ainda sem fonte
  da logo", que deixou de ser verdade com a d5506130. Fica para o corretor-redundancias e o modulo-vendedor. Não é achado
  da marca.
- **Ordem do merge:** o PR do modulo-vendedor depende do `logoDaEmpresa` do ambiente web (engenheiro-apps). Se entrar
  antes, o BKO continua a sair com a logo padrão, sem erro. O gerente-projetos deve fazer o merge dos dois no mesmo lote.

## Reteste que falta
- **Carga e Mais:** no print do aparelho (Campo e Gestão), com e sem logo, quando houver build.
- **PDF do BKO:** no navegador, com a logo cadastrada no stack isolado, quando os dois PRs estiverem juntos.

## Recados
O `coord.mjs` segue com HTTP 403 nesta sessão. A coordenação fica no relatório da sessão ao gerente-projetos.

---

# Parte 4 · Reteste final (T-0182, número provisório; corte da v1.0.13)

> 2026-11-15, ~15h10 (Manaus) · design-de-marca. Sobre: `nuvem/logo-cliente-modulo-vendedor` (26f3ca5d e c0d5d7ae:
> `domain/empresa-pdf.ts`, com `logoParaPdf` e `nomeDaEmpresaParaPdf`), `nuvem/logo-cliente-designer-ux-ui` (2d5526e3:
> `proporcao` obrigatória e `nomeEmpresa`) e `nuvem/logo-cliente-engenheiro-apps` (606c61fb e dbc4c56c: a proporção vem do
> SDK na carga e no Mais, e o portal falso usa as frases do SDK). O SDK (`empresaDosParametros` e `proporcaoDaLogo`) vem de
> `nuvem/logo-cliente-engenheiro-software`.

## Veredito
**Liberado.** Nenhum achado da marca aberto neste lote. A MC-0068 (neutros do PDF, baixa, modulo-vendedor) segue aberta, fora
do lote, como já estava.

## PDF: HTML gerado com o código do branch
Gerei o HTML com o `buildOrderPdfHtml`, o `logoParaPdf` e o `nomeDaEmpresaParaPdf` do branch e o SDK do engenheiro-software,
usando a logo fictícia "Exemplo Norte". Foram 5 casos × pedido e orçamento × cliente e uso interno, ou seja, 20 HTML.
Renderizei no Chrome e medi no DOM.

| Caso | Logo no cabeçalho | Nome (`div.empresa`) | "Macuxi" no corpo | Resultado |
|---|---|---|---|---|
| Com logo e com nome | a do cliente, 181 × 60 px (48 × 16 mm), `contain`, à esquerda, raio 0 | "Exemplo Norte", 800/20 px, `#16202A` | 0 | **conforme** (§7, igual à simulação) |
| Com logo e sem nome | a do cliente, 181 × 60 px | sem a div e sem texto no lugar | 0 | **conforme**: o cabeçalho fica só com a marca do cliente |
| Sem logo e com nome | `logo-padrao-pdf-256.png`, 60 × 60 px (16 × 16 mm) | "Exemplo Norte" | 0 | **conforme** (§7) |
| Erro na leitura da logo e nome em branco | a padrão, 16 × 16 mm | sem a div | 0 | **conforme** |
| Ambiente sem `logoDaEmpresa` e sem parâmetros | a padrão | sem a div | 0 | **conforme** |

- "PEDIDO" e "ORÇAMENTO" saem em `#1E3350` (Azul noite) e o cabeçalho da tabela em `#00843D`, como na §7. A altura do bloco da
  marca fica em 60 px nos quatro casos, então o cabeçalho não pula quando falta o nome.
- **O que melhorou para a marca:** antes, sem o nome, o cabeçalho escrevia "Macuxi" (`nomeDaDistribuidora`). Isso punha a
  nossa marca no documento do cliente, contra a §7. Agora o cabeçalho sai vazio. Como app e BKO chamam as mesmas duas funções
  (`order-detail-screen.tsx`, `order-drawer.tsx` e `orders-page.tsx`), o mesmo pedido sai com o mesmo cabeçalho nos dois.
- O nome é o nome fantasia e, se ele estiver vazio, a razão social (`parametrosDaEmpresa` → `nomeDaEmpresa` no SDK). É a mesma
  regra do "Licenciado para" do Mais.

## Placa na carga e no Mais (pelo código)

| Item | O que vi | Resultado |
|---|---|---|
| `PlacaLogoCliente` (2d5526e3) | Medidas iguais: carga 64/48 (até 112 × 96, folga 8) e Mais 52/36 (até 176 × 152, folgas 8/12). Fundo `colors.surface`, borda `colors.line` de 1 dp, raio `radius.md`, imagem em `contain`, sem tint, sombra ou filtro. A `proporcao` agora é obrigatória e vem do SDK (`largura_px ÷ altura_px` gravados pela API, ambos validados como px positivos). Isso tira o primeiro quadro com a largura errada, que o `onLoad` podia causar. A placa nunca fica mais estreita que alta | **conforme** |
| Carga (`tela-entrada.tsx`, `entrada.ts`) | Macuxi com 124 dp, filete de 1 × 64 dp em `tema.trilho`, 24 dp de cada lado, e placa `carga` com `proporcao={cliente.proporcao}`, `nomeEmpresa={cliente.nome}`, sem borda no Campo e com borda no Gestão | **conforme** (variação A) |
| Mais (`mais.tsx`) | "Licenciado para {empresa.nome}" e, abaixo, a placa `mais` com `proporcao={empresa.logo.proporcao}`, com borda e decorativa (sem `nomeEmpresa`, porque a frase acima já diz o nome). Sem logo, fica só a frase | **conforme** |
| Login e telas de senha | Nenhum uso da placa fora da carga e do Mais | **conforme** |
| Portal falso (dbc4c56c) | Só troca o texto do 403 pela constante do SDK. Não muda cor nem logo | fora da marca (texto de interface) |

## Fora do escopo da marca (só encaminho)
- O ID **"MC-0404"** citado em `pdf-pedido.ts:117`, `pdf-pedido.test.ts:420` e `empresa-pdf.test.ts:16/20` não existe no
  catálogo da marca: o maior número é o MC-0134, e eu não abri esse achado. O conteúdo está certo. O ID pode confundir quem
  for procurar no `catalogo.md`, então fica com o corretor-redundancias e o modulo-vendedor. Por estar só em comentário e em
  título de teste, não segura o lote (R-20261111-190159).
- **Ordem do merge:** o `empresa-pdf.ts` importa o `empresaDosParametros` do SDK (engenheiro-software), e o BKO depende do
  `logoDaEmpresa` do ambiente web (engenheiro-apps). O gerente-projetos deve fazer o merge dos três no mesmo lote.

## Reteste que falta (depois do build)
- Carga e Mais no print do aparelho (Campo e Gestão), com e sem logo.
- PDF do BKO no navegador, com a logo cadastrada no stack isolado.

## Recados
O `coord.mjs` segue com HTTP 403. A coordenação fica no relatório ao gerente-projetos.
