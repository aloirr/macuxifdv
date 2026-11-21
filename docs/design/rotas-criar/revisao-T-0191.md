# Revisão de UX — T-0191 (BKO → Rotas: criar por proximidade, endereço base e Gerar coordenada)

Revisor: designer-ux, 21/11/2026 (Manaus). Base: `docs/design/rotas-criar/spec.md` (aprovada, R-20261120-191213), as simulações em
`docs/design/rotas-criar/simulacoes/` e as regras RN-CORE-75, 76 e 77 da `.coord/tarefas/T-0191.md`.
Prints: 1366×768, menu aberto, tiles do mapa cinza (OSM fora da rede da sessão), em `prints/01` a `prints/11` da sessão de revisão.
Código: `modules/core/web/components/{routes,endereco,coordenadas,usuarios}` e `modules/core/web/lib/rotas-criar.ts`.

Fora deste parecer (defeitos já conhecidos, em correção pelo modulo-core): km do cabeçalho × linhas; semana seg–sex × sábado na prévia;
Coordenadas sugeridas quebrando; atribuição do Leaflet sobre o botão da gaveta (print 09); `Dialog` em 460 px (passa a `largura` `'media'`/`'media-larga'`).

Gravidade: 🔴 segura o lote · 🟡 corrigir neste lote · 🟢 sugestão (pode ir no lote seguinte).

## Achados

| Id | Grav. | Print | Arquivo:linha | O que está | O que mudar |
|---|---|---|---|---|---|
| UX-01 | 🔴 | 06, 08 | `routes/routes-page.tsx:494` (`xl:h-[720px]`); `routes/previa-panel.tsx:155` | Em 1366×768 o quadro da prévia tem 720 px a partir do y≈170 e termina abaixo da dobra; o rodapé `sticky bottom-0` gruda no fim do quadro, não da janela. **Salvar rotas** e **Descartar** não aparecem sem rolar a página, e o cabeçalho já não tem principal (o Criar rota some na prévia). A prévia abre sem nenhuma saída visível. Spec §4 item 5: "Rodapé fixo". | Na prévia, o quadro da direita (e o do mapa, para alinhar) ocupa a altura que cabe na janela: ex. `xl:h-[calc(100dvh-190px)] xl:min-h-[520px]` no lugar do `xl:h-[720px]`, com a lista dos dias rolando dentro (`previa-panel.tsx:121` já tem `min-h-0 flex-1 overflow-y-auto`). Critério: em 1366×768, sem rolar, Salvar rotas e Descartar visíveis com a prévia de 5 dias e 2 alertas. |
| UX-02 | 🟡 | 06, 07a, 08 | `lib/rotas-criar.ts:74` | O alerta diz "4 clientes ficaram fora: **endereço não localizado**.", mas com a RN-CORE-77 nada é tentado sozinho: o "Ver clientes" abre "Clientes sem coordenada", com **Gerar coordenada** em cada um (nunca tentados). O alerta afirma uma falha que não aconteceu e não bate com o título da lista. | Texto: **"N clientes ficaram fora: sem coordenada."** (1: "1 cliente ficou fora: sem coordenada."). Mesmo termo do título do diálogo (`clientes-fora-dialog.tsx:19`). |
| UX-03 | 🟡 | 06, 08 | `routes/previa-panel.tsx:95,103` | O link **Ver clientes** quebra em duas linhas ("Ver / clientes") ao lado do texto do alerta. | `className="shrink-0 whitespace-nowrap"` nos dois `Button variant="link"`; o texto do alerta é que quebra. |
| UX-04 | 🟡 | 07a, 07b | `coordenadas/gerar-coordenada.tsx:28-35` | **Gerar coordenada** (`size="sm"`, 38 px) quebra em duas linhas espremidas dentro do botão, cada linha com largura diferente (colunas desalinhadas). Vale também depois do `Dialog` em `'media'`/`'media-larga'`, em linhas de endereço longo. | `className="shrink-0 whitespace-nowrap"` no botão e no contêiner (`:27`); o endereço (`clientes-fora-dialog.tsx:39`) é que quebra. |
| UX-05 | 🟡 | 07b | `coordenadas/gerar-coordenada.tsx:9,20,28-40` | Depois de gerar, o botão continua escrito "Gerar coordenada", apagado, e embaixo vem "Coordenada gerada **no número**." em 12 px. "No número" é termo interno da precisão; o botão apagado parece erro. | Com sucesso, no lugar do botão: `IconCheck` + **"Localizada pelo número"** / **"pela rua"** / **"pelo CEP"** em `text-success`, 13 px, sem o botão. |
| UX-06 | 🟡 | 10b | `coordenadas/gerar-coordenada.tsx:21-25,30,37` | Com `NAO_LOCALIZADO` o botão **volta a ficar ativo** (`jaTentado && !gerar.isError`) e o texto diz "…e **tente de novo**"; o 2º clique só dá `JA_TENTADO` (RN-CORE-77: não se tenta de novo o mesmo endereço). O texto vem em `text-ink-2`, alinhado à direita, longe do botão, e o mesmo estado tem dois textos ("Endereço não localizado. Confira…" e "Já tentado e não localizado. Corrija…"). | Falhou ou já tentado: botão desabilitado e **um** texto só, em `text-danger`: **"Endereço não localizado. Corrija o endereço ou o CEP no cadastro."** O mesmo para `NAO_LOCALIZADO`, `JA_TENTADO` e `jaTentado`; outros erros (rede, 5xx) mantêm o botão ativo e a mensagem do `errorMessage`. |
| UX-07 | 🟡 | 10, 10b | `coordenadas/coordenadas-page.tsx:53,68` | No cartão, **Gerar coordenada** fica no canto de cima (`aside`) e **Aprovar esta posição** (principal) no meio da linha de baixo: as duas ações do mesmo cliente em lugares diferentes, e o aviso do Gerar (10b) cai entre as duas. | As ações do cliente juntas à direita da linha da sugestão: **Aprovar esta posição** (principal) e, ao lado, **Gerar coordenada** (secundário); o resultado do Gerar abaixo das duas, alinhado à esquerda do bloco. Com mais de uma sugestão no cliente, o Gerar fica uma vez só, na 1ª linha. |
| UX-08 | 🟢 | 07a | `routes/clientes-fora-dialog.tsx:41`; `coordenadas/gerar-coordenada.tsx:28` | "Auto Peças Três" só tem "Manacapuru/AM": a RN-CORE-77 dá "não localizado" para resultado só com a cidade, então o botão leva sempre à falha. | Sem logradouro nem CEP: sem o botão, com "Sem rua nem CEP no cadastro." em `text-ink-2`. |
| UX-09 | 🟢 | 01, 11 | `routes/routes-page.tsx:436-440` | Fora da prévia, a legenda do mapa pinta Seg e Sex iguais (Azul noite) sem o traço; na prévia o tracejado já distingue (spec §4, MC-0014 A). | Usar `traceDoDia` também na legenda e nas linhas do mapa fora da prévia, como na prévia (uma regra de cor por dia em toda a tela). |
| UX-10 | 🟢 | — (sem print) | `endereco/endereco-campos.tsx:78` | Sem ponto marcado não há marcador, mas o apoio diz "Arraste o marcador até a porta." | Sem ponto: **"Clique no mapa, na porta."**; com ponto: o texto de hoje. |

Conferido e de acordo com a spec (sem achado): tela Rotas com um só principal, sem subtítulo e sem KpiGrid quando não há rota, vazio uma vez só
(prints 01 e 02); KPI "a partir da base, sem volta"; marcador e legenda da Base (01, 06, 11); diálogo Criar rota normal, sem base ("Sem endereço base.
Cadastrar") e com conflito ("Já tem rota em 2 dias.", "Substituir 1 rota" com a linha de apoio só quando há protegida) (03 a 05); prévia sem KPIs e sem
Criar rota, filtros travados, cartão Casa com o lápis de 40 px, Alertas só no `Panel`, linhas Mantida e Feriado sem chevron (06); diálogo Endereço base com
Casa e Outro endereço (08); seção Endereço da gaveta no mesmo padrão das outras seções e com o pino grafite próprio (09); toast "3 rotas salvas." (11).

## Resumo

1 🔴 (UX-01), 6 🟡 (UX-02 a UX-07), 3 🟢 (UX-08 a UX-10). O lote segue depois de UX-01 a UX-07 corrigidos; nova rodada de prints em 1366×768
dos estados 06, 07a/07b e 10b.

## Reconferência — 21/11/2026 (Manaus)

Base: prints novos em 1366×768 (01 a 11, 06b com o rodapé, 07c depois de `NAO_LOCALIZADO`) e o código corrigido pelo modulo-core.
Fora desta reconferência, em correção pelo modulo-core: legenda do mapa fixa em seg–sex fora da prévia (print 11) e o **Gerar coordenada** para
cliente sem rua nem CEP em Coordenadas sugeridas (prints 10 e 10b).

| Id | Situação | Evidência |
|---|---|---|
| UX-01 | Fechado | `routes-page.tsx:419,496` com `xl:h-[calc(100dvh-190px)] xl:min-h-[520px]`; prints 06 e 06b: **Salvar rotas** e **Descartar** visíveis sem rolar, lista dos dias rola dentro. |
| UX-02 | Fechado | `lib/rotas-criar.ts:74` "N clientes ficaram fora: sem coordenada." (1: "1 cliente ficou fora…"); print 06. |
| UX-03 | Fechado | `previa-panel.tsx:95,103` `shrink-0 whitespace-nowrap`; print 06: "Ver clientes" em uma linha, o texto do alerta é que quebra. |
| UX-04 | Fechado | `gerar-coordenada.tsx:33,37`; print 07a: botões em uma linha, colunas alinhadas. |
| UX-05 | Fechado | `gerar-coordenada.tsx:9,22-29`; print 07b: check + "Localizada pelo número" em `text-success`, 13 px, sem o botão. |
| UX-06 | Fechado | `gerar-coordenada.tsx:10,31-46`; print 07c: botão desabilitado e um texto só, em `text-danger`, para `NAO_LOCALIZADO`, `JA_TENTADO` e `jaTentado`; outros erros mantêm o botão ativo. |
| UX-07 | **Aberto (parcial)** 🟡 | Ver abaixo. Print 10: as duas ações juntas à direita (ok). Print 10b: quebra no estado com mensagem. |
| UX-08 | Fechado | `clientes-fora-dialog.tsx:42-48`; print 07a: "Sem rua nem CEP no cadastro." sem o botão (no diálogo; em Coordenadas sugeridas está na correção do modulo-core). |
| UX-09 | Fechado | `routes-page.tsx:443` e `lib/routes.ts:289` (`dashed`) fora da prévia; print 11: Sex tracejada na legenda e Sáb tracejado no mapa, Seg e Ter lisos. |
| UX-10 | Fechado | `endereco-campos.tsx:78`: sem ponto "Clique no mapa, na porta."; com ponto "Arraste o marcador até a porta." |

**UX-07 (resíduo)** — `coordenadas/coordenadas-page.tsx:67` e `coordenadas/gerar-coordenada.tsx:33,44,48`. Quando o Gerar devolve mensagem
(não localizado, já tentado ou erro de rede), a mensagem entra na coluna do botão (`max-w-[260px]`, 2 linhas) e o bloco de ações fica mais largo
que o espaço da linha: **Aprovar esta posição** cai para uma linha própria, longe do Gerar, e o Gerar fica sozinho no canto (print 10b). Vale para
qualquer cliente com endereço que não seja localizado, não só para o caso sem rua nem CEP que o modulo-core já corrige.
O que mudar: as duas ações ficam na mesma linha, lado a lado, também com mensagem; a mensagem vai **abaixo das duas**, na largura do bloco de
ações, alinhada à direita (ex.: a linha da sugestão em duas faixas, ações e, embaixo, `basis-full text-right` para a mensagem; o `GerarCoordenada`
pode receber a mensagem fora da coluna do botão nesta tela). No mesmo bloco, "Sem rua nem CEP no cadastro." em 13 px como no diálogo
(`coordenadas-page.tsx:73` usa 12 px; `clientes-fora-dialog.tsx:45` usa 13 px). Critério: em 1366×768, com a mensagem de não localizado,
**Aprovar esta posição** e **Gerar coordenada** na mesma altura e encostados, e a mensagem logo abaixo deles.

Conferido sem achado novo: prints 01 a 05, 08, 09 e 11 sem regressão; diálogo Clientes sem coordenada a 460 px cabe sem quebrar o botão (07a a 07c).
No mapa, a parada 2 de Sáb fica sob o marcador da Base (06, 11) porque o cliente do seed está a poucos metros da base; com zoom se separa, sem achado.

**Resumo da reconferência:** 9 fechados (UX-01 a UX-06, UX-08 a UX-10), 1 aberto 🟡 (UX-07, resíduo do estado com mensagem em Coordenadas
sugeridas). Fecha com novo print 10b (cliente com endereço e `NAO_LOCALIZADO`) depois da correção.

## Reconferência final — 21/11/2026 (Manaus)

Base: prints da 3ª rodada em 1366×768 (01 a 11, 06b, 07c, 10b com endereço e `NAO_LOCALIZADO`, 10c) e o código atual do modulo-core
(`coordenadas/coordenadas-page.tsx`, `coordenadas/gerar-coordenada.tsx`, `routes/clientes-fora-dialog.tsx`). Depois de "não localizado" o botão
some (decisão do gerente, spec §9). Fora desta reconferência, em correção pelo modulo-core: o D8 (print 10c, o **Gerar coordenada** volta para um
cliente já tentado depois de recarregar).

| Id | Situação | Evidência |
|---|---|---|
| UX-07 | Fechado | `coordenadas-page.tsx:68` (ações em `ml-auto flex flex-wrap justify-end`) e `gerar-coordenada.tsx:40` (mensagem em `w-full text-right`, 13 px). Print 10: **Aprovar esta posição** e **Gerar coordenada** na mesma linha, à direita. Print 10b: mensagem em vermelho, 13 px, logo abaixo do Aprovar, alinhada à direita. "Sem rua nem CEP no cadastro." em 13 px (`:74`, prints 10 e 10b), como no diálogo. |
| UX-11 | Fechado | Novo, regressão da mudança acima; corrigido. Ver abaixo. |

**UX-11** — print 07c; `routes/clientes-fora-dialog.tsx:37,42` com `gerar-coordenada.tsx:40`. No diálogo **Clientes sem coordenada**, a mensagem
de não localizado agora é `w-full` e ocupa os 280 px do `sm:max-w-[280px]` da coluna da direita (que é `shrink-0`). A coluna do cliente fica com
~140 px: o nome é cortado em **"Armazém Sem ..."** (o usuário não sabe qual cliente corrigir) e o endereço quebra em 5 linhas, enquanto as outras
linhas têm 2. Nos estados com botão (07a, 07b) não acontece.
O que mudar: no diálogo, o nome e o endereço têm prioridade sobre a mensagem: coluna do cliente `min-w-0 flex-1` e a da direita sem `shrink-0`,
com `sm:max-w-[200px]` (a mensagem quebra em 3 linhas, à direita), ou a mensagem em linha própria abaixo do endereço (`basis-full`), como em
Coordenadas sugeridas. Critério: no print 07c, "Armazém Sem Rumo" inteiro numa linha e o endereço em até 2 linhas, como nas outras linhas.

Conferido sem regressão: 01 (legenda só com os dias que têm rota, Base, KPI "a partir da base, sem volta"), 02 e 03 (sem rota: linhas "Sem rota"
com Criar rota, sem frase de vazio; legenda com os dias úteis do calendário), 04 (sem base, principal desabilitado), 05 (conflito com a linha de
apoio), 06 e 06b (Salvar rotas e Descartar visíveis sem rolar; alertas sem "N com visitas" e sem o quadro "Nenhum cliente localizado"), 07a e 07b
(botões em uma linha; check "Localizada pelo número"), 08, 09 e 11 (toast "3 rotas salvas.", Sex tracejada na legenda e Sáb no mapa).

**Fechamento do UX-11** (prints finais, 07c, medido pelo testes no navegador): "Armazém Sem Rumo" aparece inteiro numa linha, o endereço
em 2 linhas como nas outras, a coluna da direita tem 200 px e a mensagem é um texto só ("Endereço não localizado. Corrija o endereço ou o CEP
no cadastro."), em 3 linhas, à direita.

**Veredito final:** sem achados em aberto. O D8 segue com o modulo-core, fora deste parecer.
