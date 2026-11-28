# Parecer de redundâncias — v1.0.35, portal (aba Dados) e SDK (`web/X.Y.Z`)

Data: 25/11/2026 (Manaus). Rodada única, por SHA. Recados não enviados (repositório de recados com 403); achados relatados ao gerente.

## A) `nuvem/v1035-web-engenheiro-apps-dados` @ 8c2f39a — NÃO LIBERADO

| ID | Grav. | Onde | O que se repete | Proposta | Dono |
|---|---|---|---|---|---|
| RD-3550 | média | aba Integração: `secao-monitor.tsx:41-50` × tabela "Conectores" de `aba-integracao.tsx:418-452` | O mesmo Conector (`erp`) aparece em duas tabelas na mesma aba, as duas com "Identificador" e "Situação" (saúde "Em dia" × "Ativo"/"Desativado"); e a tabela do Monitor tem dois títulos (h2 "Monitor" + painel "Conector") | Uma tabela só: no topo, "Conectores" com Identificador · Situação (saúde; "Desativado" quando inativo) · Versão · Último sinal · Fila (estas três só para o time da Macuxi) · Pedidos e o ⋯ (Bases, Gerar nova chave, Desativar); some o painel "Conector" do Monitor. Mínimo, se o desenho §6.4 mantiver as duas: um título só (tirar o painel "Conector" e deixar o h2 "Monitor") | engenheiro-apps |
| RD-3551 | média | `apps/web/lib/portal-monitor.ts:94` × `modules/integracao/web/lib/queries.ts:211` | A chamada `POST /integracao/lotes/:id/reprocessar` + `ReprocessarLoteResposta.parse` reimplementada no portal | O módulo exporta uma função pura `reprocessarLote(cliente, loteId, corpo?)` (usada pelo `useReprocessarLote`) e o `reprocessarEntidade` do portal a chama | modulo-integracao (export) + engenheiro-apps (uso) |
| RD-3552 | baixa (só comentário, não segura) | `aba-integracao.tsx:5` (linha de 235 colunas) e `aba-dados.tsx:22-25` (comentário do `SELO` explicando px) | Comentário além do necessário | Quebrar a linha; `SELO`: "o selo usa o respiro direito da célula" | engenheiro-apps |

Encaminhado ao testes (não catalogado): no modo falso, o Monitor mostra o Conector `erp` "Em dia" e a tabela "Conectores" da mesma aba diz "Nenhum Conector." (print aba-integracao.png).

## B) `nuvem/v1035-web-engenheiro-software` @ 144160c — NÃO LIBERADO

| ID | Grav. | Onde | O que se repete | Proposta | Dono |
|---|---|---|---|---|---|
| RD-3553 | baixa | `apps/api/src/app-versao.ts:144` | Literal `'web'` repete a regra "web não tem versão publicada", já dada por `VARIANTE_WEB`/`ehAppAndroid` no SDK (`app-versao.ts:234` usa a constante) | `publicada: (v) => (v === VARIANTE_WEB ? Promise.resolve(null) : fonte.publicada(v))` | engenheiro-software |
| RD-3554 | baixa (só teste, não segura) | `apps/api/test/app-versao.test.ts:389` × `packages/platform-sdk/src/app-versao.test.ts` ("VERSAO_WEB ... não é menor que 1.0.34") | Teste copia a condição de `aplicaTetoDoCliente` e repete a checagem de `VERSAO_WEB >= 1.0.34` que o teste do SDK já faz | Deixar só a checagem do SDK; no teste da API, conferir só que `ctx.versaoApp.doCliente.versao` = `VERSAO_WEB` | engenheiro-software |
| manter? | — | `VERSAO_WEB`, `valorCabecalhoWeb`, `VarianteCliente` | Exports sem uso em produção neste SHA | Só ok se o PR do shell web que os consome entrar no mesmo lote; senão viram export morto | engenheiro-software |

**Reteste (25/11/2026):** RD-3553 e RD-3554 corrigidos pelo engenheiro-software no SHA b59f3e6 (`nuvem/v1035-web-engenheiro-software`), conferido com `git diff 144160c b59f3e6`: `app-versao.ts:145` usa `VARIANTE_WEB`; o teste da API confere só `doCliente.versao` = `VERSAO_WEB` e a checagem `>= 1.0.34` fica só no teste do SDK. Sem achado novo. **B) LIBERADO no SHA b59f3e6.**
