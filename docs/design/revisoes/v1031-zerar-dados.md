# Revisão de UX — "Zerar dados" no portal `config.` (v1.0.31)

> Lote renumerado de v1.0.30 para **v1.0.31**. A rodada 2 (seção "Monitor" e "Zerar dados" por entidade) vem primeiro; a rodada 1 (menu e diálogo da empresa inteira) segue abaixo, como registro.

# Rodada 2 — seção "Monitor" da aba Integração e "Zerar dados" por entidade

**Revisado:** SHA `ad16c5a86` (branch `nuvem/v1030-zerar-engenheiro-apps`), diff `2ae1e3d2b..ad16c5a86`: `apps/web/components/portal/secao-monitor.tsx`, `apps/web/lib/portal-monitor.ts`, `apps/web/components/portal/dialogo-zerar.tsx`, `apps/web/lib/portal-empresa-zerar.ts`, `modules/integracao/web/components/{monitor-painel,entidades-panel}.tsx`; prints `apps/web/docs/prints/zerar-dados/` 01 a 07, desktop e `-celular`.
**Pedido:** "a tela do config deve ter a mesma aba Integração FDV que o BKO tem, mas com mais detalhes e também a opção de reprocessar e zerar dados" + "Zerar dados" ao lado de cada entidade (Alexandre, v1.0.31).
**Data:** 23/11/2026 · designer-ux.

## Veredito (rodada 2)

**Aprovado com ajustes.** R2-1 a R2-6 seguram o lote; R2-7 é recomendação.

## Rodada 1: os 4 ajustes continuam aplicados (🟢)

| # | Onde (SHA ad16c5a86) | Situação |
|---|---|---|
| 1 | `dialogo-zerar.tsx:40-43`, `:69`, `:133`; `portal-empresa-zerar.ts:26-30` | 🟢 O "?" fica só na confirmação. Andamento, concluído e falha usam `tituloAndamento` / `tituloAndamentoEntidades`. |
| 2 | `portal-empresa-zerar.ts:33`, `:35` | 🟢 `Apaga:` / `Mantém: empresa, plano, usuários, perfis, parâmetros e conectores.` |
| 3 | `portal-empresa-zerar.ts:41`, `:42` | 🟢 `Em andamento…` / `5.030 linhas apagadas.` (print 07). |
| 4 | `dialogo-zerar.tsx:138`, `:152`, `:173-176` | 🟢 `Fechar` quando não há o que confirmar; prévia só sem bloqueio; bloqueio em `Notice tone="warning"`. |

## O que está bom (🟢)

- **Mesmo painel do BKO:** o portal monta o `MonitorPainel` do módulo, sem cópia. Reprocessar e Histórico se comportam igual nos dois lugares.
- **Conector:** situação com selo e texto ("Em dia", "Sem sinal", "Parado pela versão"), versão, último sinal e fila. É o detalhe a mais que o pedido cobra.
- **Diálogo por entidade:** título "Zerar Clientes de {empresa}?", prévia por grupo, código e senha, um só botão de perigo (print 06). Sem "Mantém" quando o pedido é por entidade.
- **Concluído:** "5.030 linhas apagadas.", o lote (chave para restaurar) e "Rode no servidor do Conector:" com um comando por entidade. É o próximo passo de quem zerou, e só isso (print 07).

## Achados (rodada 2)

| # | Grav. | Dono | Onde (SHA ad16c5a86) | Achado | Ajuste |
|---|---|---|---|---|---|
| R2-1 | 🔴 | modulo-integracao + engenheiro-apps | `entidades-panel.tsx:65` (`acoesDaEntidade ? '380px' : '260px'`); `secao-monitor.tsx:78` | **Nomes cortados** ("Endereço…", "Vendedor…", print 05): a coluna Entidade não tem largura e fica só com o que sobra depois de 300 + 120 + 150 + 380 px. **No celular**, a coluna Entidade some e a tabela passa da tela, com botões sem dizer de qual linha são (05-celular, 07-celular). **"Zerar dados" em dois lugares** (painel e "Dados no Hub"), com uma regra (`zerarNoDetalhe`) decidindo onde: quem procura "Produtos" na "Dados no Hub" não acha o botão. | **"Zerar dados" num lugar só: a tabela "Dados no Hub"** (R2-2). O painel volta a ser o do BKO, e o `secao-monitor.tsx:78` deixa de passar `acoesDaEntidade`. O modulo-integracao tira a prop `acoesDaEntidade` de `monitor-painel.tsx:21-22`, `:37` e `:51` e de `entidades-panel.tsx:19-20`, `:35` e `:73`; a largura condicional some (R2-3). O corte acaba sem mexer na largura do nome. |
| R2-2 | 🔴 | engenheiro-apps | `secao-monitor.tsx:44-48`, `:57-63`; `portal-monitor.ts:39-42` | Na "Dados no Hub", "Zerar dados" é um botão neutro de 130 px, igual ao "Histórico", mas a ação é de perigo. As colunas somam 200 + 210 + 150 + 130 px e passam da tela no celular. | As ações da linha vão para o menu "⋯" do `TabelaDados` (prop `acoes`, coluna de 52 px, guia `docs/design/telas/bko-revisao.md` §P3), com o mesmo item vermelho do menu de Empresas: `` acoes={(x) => temDadosNoHub(x) && ehEntidadeZerar(x.entidade) ? [{ id: 'zerar', rotulo: TEXTOS_ZERAR.zerar, perigo: true, aoEscolher: () => setZerar(x.entidade), testId: `integracao.entidade.zerar.${x.entidade}` }] : []} ``. Com a lista vazia, o `MenuAcoes` não aparece. Saem a coluna `acoes` (`:62`), o `botaoZerar` (`:44-48`) e o `zerarNoDetalhe` (`portal-monitor.ts:39-42`), que dá lugar ao `temDadosNoHub`. Colunas: Entidade `200px`; Registros `200px` e `prioridade: 2`; Última alteração `150px` e `prioridade: 2`; a coluna de erros fica no R2-4, com `prioridade: 3`. No celular ficam Entidade e "⋯". |
| R2-3 | 🟡 obrig. | modulo-integracao | `entidades-panel.tsx:57-79` | Sem o "Zerar dados", ainda são 300 + 120 + 150 + 260 px: no celular, a coluna Entidade some (no BKO também). E cada linha com falha tem um "Reprocessar" principal, então a tela fica com vários principais. | As ações vão para o menu "⋯" do `TabelaDados` (prop `acoes`): `Reprocessar` (só com `comFalha`; `desligada: reprocessar.isPending`) e `Histórico (${n})`, com os `testId` de hoje. Sai a coluna `acoes` (`:62-79`). "Última carga" fica com `prioridade: 3` e "Linhas integradas" com `prioridade: 2`. No celular: Entidade, Situação e "⋯"; o selo "Com falha" mostra a linha que pede ação. Vale também para o BKO e passa pelo design-de-marca. |
| R2-4 | 🟡 obrig. | engenheiro-apps | `secao-monitor.tsx:61`; `portal-monitor.ts:56-64` | **Uma informação, um lugar:** "12 a reprocessar", na "Dados no Hub", repete o que o painel já mostra ("Com falha" + Reprocessar). Os dois falam dos mesmos lotes recentes (`ErroPorCodigo`: "linhas com erro… nos lotes recentes"). Os números também não batem: o painel mostra "0 de 860" (o último lote) e a tabela, "12 a reprocessar" (a soma dos lotes), no print 05. O que só a tabela traz, e serve para agir, é o que corrigir no ERP e o código do erro. | A coluna passa a se chamar **`Corrigir no ERP`**. A célula mostra só a classe `corrigir_no_erp`: **`${formatInt(n)} · ${codigos}`** (ex.: `3 · campo_obrigatorio`); sem erro dessa classe, `—`. A parte "a reprocessar" sai de `textoErros`, que passa a se chamar `textoCorrigirNoErp`. |
| R2-5 | 🟡 obrig. | engenheiro-apps | `dialogo-zerar.tsx:103-104`, `:165-169`; `portal-empresa-zerar.ts:31` | "Entidades: Clientes, Endereços de clientes" repete "Clientes", que já está no título "Zerar Clientes de …?" (print 06). O comentário da L103 diz que as pedidas já estão no título, mas o código lista todas as afetadas. | Mostrar só as que vão junto pela cascata: `const extras = entidades?.length && p ? p.entidades_afetadas.filter((e) => !entidades.includes(e)) : []`, e a linha aparece só com `extras.length > 0`. Rótulo `T.entidades`: **`Leva junto:`**. Fica "Leva junto: Endereços de clientes". |
| R2-6 | 🟡 obrig. | engenheiro-apps | `secao-monitor.tsx:52-55` | No celular, a coluna Conector some: ficam só "Situação" e "Último sinal" (05-celular). | "Último sinal" com `prioridade: 2`. No celular ficam Conector e Situação; o selo ("Atrasado", "Sem sinal") já diz quando o sinal está velho. |
| R2-7 | 🟡 rec. | modulo-integracao | `monitor-painel.tsx:51` / `entidades-panel.tsx:84` | O quadro do painel não tem título visível, entre "Conector" e "Dados no Hub" (print 05). | Lote seguinte: prop `titulo?` no `MonitorPainel`, e o portal passa **`Cargas recentes`**. No BKO, o título da página já situa o quadro. |

**Painel × "Dados no Hub", depois dos ajustes.** O nome da entidade é a chave das duas tabelas. "Última carga" (quando o lote chegou) e "Última alteração" (o cursor do ERP) são fatos diferentes. Cada coisa fica num lugar só:
- **Só no painel:** situação e linhas do lote, Reprocessar e Histórico.
- **Só na "Dados no Hub":** registros, cursor, "Corrigir no ERP" e "Zerar dados".

**Mudam junto:**
- Testes: `secao-monitor.test.tsx`, `portal-monitor.test.ts`, `dialogo-zerar.test.tsx`, `e2e/portal-zerar.spec.ts` ("Zerar dados" passa a abrir pelo "⋯") e os testes do painel em `modules/integracao/web`.
- Prints 05 a 07, desktop e celular.

Os prints refeitos voltam para o corretor-redundancias e para o design-de-marca.

---

# Rodada 1 — menu "⋯" e diálogo da empresa inteira

**Revisado:** SHA `8e29949cc` (branch `nuvem/v1030-zerar-engenheiro-apps`, engenheiro-apps): `apps/web/components/portal/dialogo-zerar.tsx`, `apps/web/lib/portal-empresa-zerar.ts`, `apps/web/components/portal/empresas-acoes.tsx`; prints `apps/web/docs/prints/zerar-dados/` (01 a 04, 1280 e 390 px). Desenho `docs/desenho/empresa-zerar.md`; frases `packages/platform-sdk/src/empresa-zerar.ts`. Spec da tela: `docs/design/telas/portal-empresa-zerar.md`.
**Pedido:** "coloque um botão ao lado do excluir chamado 'zerar dados'" (Alexandre, v1.0.31).
**Data:** 23/11/2026 · designer-ux.

## Veredito

**Aprovado com ajustes.** Os achados 1 a 4 seguram o lote; o 5 e o 6 são recomendações para o lote seguinte.

## O que está bom (🟢)

- **Menu:** "Zerar dados" fica antes de "Excluir", os dois em vermelho, separados das ações comuns pelo divisor. O menos destrutivo vem primeiro (print 01).
- **Desligado sem motivo:** o item desligado não precisa de "(motivo)". Backup rodando, exclusão e Reativar no ar já aparecem na própria linha (coluna Backup, selo da Situação). É a mesma regra do Excluir (RD-1205).
- **Confirmação igual à do Excluir:** "Digite `CÓDIGO` para confirmar", "Sua senha", "Cancelar" + botão de perigo. A senha errada esvazia o campo, mostra o erro no próprio campo e devolve o foco.
- **Um principal só:** "Zerar dados" (perigo) é o único botão de ação. Some quando não há o que confirmar.
- **Prévia por grupo:** os números ficam alinhados à direita, com `tabular-nums` e `formatInt`. Os seis rótulos (`ROTULO_GRUPO_ZERAR`) ficam como estão.
- **Acessibilidade:** `Dialog` com título ligado. `LoadingBlock` e `Notice` de sucesso com `role="status"`; perigo e aviso com `role="alert"`. Os rótulos ficam ligados aos campos e o alvo de toque é ≥ 44 px (prints em 390 px). A cor vem sempre com texto e ícone.
- **Sem "Não dá para desfazer."** O Excluir traz essa frase. Aqui ela seria falsa: o time desfaz em até 7 dias, pelo banco. Explicar a cópia de 7 dias seria texto do que o sistema faz por trás (R-20261110-192153), por isso a linha de risco fica de fora.
- **Frases das falhas** (`mensagemDoZerar`): cada uma diz o que aconteceu ("nada foi apagado") e o que fazer. Ficam como estão.

## Achados

| # | Grav. | Onde (SHA 8e29949cc) | Achado | Ajuste |
|---|---|---|---|---|
| 1 | 🔴 | `dialogo-zerar.tsx:219` (`T.titulo` no `Andamento`) | O título continua sendo a pergunta "Zerar dados de X?" depois de "Zerar dados" ter sido clicado, tanto em andamento quanto concluído ou com falha. A tela pergunta algo que já foi respondido. | Andamento, concluído e falha usam um título sem "?": **`Zerar dados de ${empresa}`** (chave nova `tituloAndamento`). O "?" fica só na fase de confirmação (L115). |
| 2 | 🟡 | `portal-empresa-zerar.ts:25` e `:27` | "Vão ser apagados:" e "Ficam a empresa, o plano, os usuários, os perfis, os parâmetros e os conectores." formam um par desigual: um é rótulo e o outro é frase, com seis artigos. Na largura do celular, a frase ocupa 2 linhas (print 02-celular). | Par curto e paralelo: **`Apaga:`** / **`Mantém: empresa, plano, usuários, perfis, parâmetros e conectores.`** (texto abaixo). |
| 3 | 🟡 | `portal-empresa-zerar.ts:33`, `:34` | "Zerando os dados…" e "Dados zerados: 20.119 linhas apagadas." repetem "dados", que já está no título (uma informação, um lugar). | **`Em andamento…`** (a mesma palavra da coluna Backup) e **`20.119 linhas apagadas.`** / **`1 linha apagada.`** |
| 4 | 🟡 | `dialogo-zerar.tsx:119-121`, `:133`, `:134`, `:150-153` | (a) Sem nada a confirmar, o único botão diz "Cancelar", mas não há nada para cancelar. Isso acontece nos estados vazio, bloqueado e com erro na prévia. (b) Com bloqueio, a prévia e o "Mantém" continuam na tela, junto do aviso. Nesse estado, o único texto que leva a uma ação é a frase do bloqueio. (c) Bloqueio não é falha: o tom `danger` deve ficar para o que deu errado. | (a) O rótulo do botão passa a ser `pedeConfirmacao ? T.cancelar : T.fechar`. (b) A prévia e o "Mantém" aparecem só com `!bloqueio`. Com `total_linhas === 0`, aparece só o vazio, sem o bloqueio: um texto por estado. (c) Use `Notice tone="warning"` no bloqueio. |
| 5 | 🟡 rec. | `empresas-acoes.tsx` (`DialogoZerar … aoTerminar`) | "Fechar" durante o andamento não cancela, mas o resultado se perde: o `aoTerminar` só dispara com o diálogo aberto. O Excluir acompanha em segundo plano e avisa no topo da lista. | Lote seguinte: acompanhar como no `AcompanharExclusao` e mostrar o aviso no topo: sucesso **`Dados de ${empresa} zerados.`**; falha: a frase de `mensagemDoZerar`. Com isso, o "Fechar" no andamento fica igual ao do Excluir. |
| 6 | 🟡 rec. | `packages/platform-sdk/src/empresa-zerar.ts:75` (engenheiro-software) | "Nenhum zerar pedido para esta empresa." usa "zerar" como substantivo, e a frase soa estranha. A tela quase nunca mostra essa frase. | **`Nenhum pedido de zerar dados para esta empresa.`** |

## Textos finais, string por string

`apps/web/lib/portal-empresa-zerar.ts` (`TEXTOS_ZERAR`):

| Linha | Chave | Atual | Final |
|---|---|---|---|
| 22 | `zerar` | `Zerar dados` | sem mudança |
| 23 | `titulo` | `` `Zerar dados de ${empresa}?` `` | sem mudança (só na confirmação) |
| nova | `tituloAndamento` | — | `` (empresa: string) => `Zerar dados de ${empresa}` `` (andamento, concluído e falha) |
| 24 | `contando` | `Contando os dados…` | sem mudança |
| 25 | `sai` | `Vão ser apagados:` | `Apaga:` |
| 26 | `nadaASair` | `Não há dados para zerar.` | sem mudança |
| 27 | `ficam` | `Ficam a empresa, o plano, os usuários, os perfis, os parâmetros e os conectores.` | `Mantém: empresa, plano, usuários, perfis, parâmetros e conectores.` |
| 28 | `sufixoCodigo` | `para confirmar` | sem mudança |
| 29 | `senha` | `Sua senha` | sem mudança |
| 30 | `cancelar` | `Cancelar` | sem mudança (só com confirmação na tela) |
| 31 | `fechar` | `Fechar` | sem mudança (andamento e estados sem confirmação) |
| 32 | `zerando` | `Zerando…` | sem mudança |
| 33 | `emAndamento` | `Zerando os dados…` | `Em andamento…` |
| 34 | `concluido` | `` `Dados zerados: ${n} linha(s) apagada(s).` `` | `` `${formatInt(linhas)} ${linhas === 1 ? 'linha apagada' : 'linhas apagadas'}.` `` |

`apps/web/components/portal/dialogo-zerar.tsx`:

| Linha | Atual | Final |
|---|---|---|
| 120 | `{T.cancelar}` | `{pedeConfirmacao ? T.cancelar : T.fechar}` |
| 133 | vazio com `p && p.total_linhas === 0` | sem mudança (o vazio vence o bloqueio) |
| 134 | prévia com `p && p.total_linhas > 0` | `p && p.total_linhas > 0 && !bloqueio` |
| 150 | `{bloqueio && (` | `{bloqueio && p && p.total_linhas > 0 && (` |
| 152 | `<Notice tone="danger">` | `<Notice tone="warning">` |
| 219 | `title={T.titulo(empresa.razao_social)}` | `title={T.tituloAndamento(empresa.razao_social)}` |

`packages/platform-sdk/src/empresa-zerar.ts` (recomendação, achado 6), linha 75: `Nenhum pedido de zerar dados para esta empresa.`

Os testes que conferem os textos (`dialogo-zerar.test.tsx`, `portal-empresa-zerar.test.ts`, `e2e/portal-zerar.spec.ts`) e os prints 02 a 04 mudam junto. Os prints refeitos voltam para o corretor-redundancias e para o design-de-marca, que valida o layout.
