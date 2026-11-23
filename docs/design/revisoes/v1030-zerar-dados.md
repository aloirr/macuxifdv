# Revisão de UX — "Zerar dados" no portal `config.` (v1.0.30)

**Revisado:** SHA `8e29949cc` (branch `nuvem/v1030-zerar-engenheiro-apps`, engenheiro-apps): `apps/web/components/portal/dialogo-zerar.tsx`, `apps/web/lib/portal-empresa-zerar.ts`, `apps/web/components/portal/empresas-acoes.tsx`; prints `apps/web/docs/prints/zerar-dados/` (01 a 04, 1280 e 390 px). Desenho `docs/desenho/empresa-zerar.md`; frases `packages/platform-sdk/src/empresa-zerar.ts`. Spec da tela: `docs/design/telas/portal-empresa-zerar.md`.
**Pedido:** "coloque um botão ao lado do excluir chamado 'zerar dados'" (Alexandre, v1.0.30).
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
