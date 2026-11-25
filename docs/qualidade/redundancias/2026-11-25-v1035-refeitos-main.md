# Parecer do corretor-redundancias: v1.0.35, branches refeitos a partir do main (3ee9539, com a 0103)

Data: 25/11/2026 (horário de Manaus). Sessão S11. Escopo: só excessos, duplicidades e redundâncias.
Base: `origin/main` @ 3ee9539c32a1cf18668a1aa8a37d94913230103e.

## A) `nuvem/v1035-web-modulo-core-2` @ 6531293604a391ccebb487a532bb7e1b3a149875
- 3 commits (e17a549, bc24b5c, 6531293); os 2 últimos tiram os `.js` emitidos por engano. Diff líquido contra o main: 4 arquivos
  (`modules/core/api/super-admin-repositorio.ts`, `super-admin.test.ts`, `super-admin.ts`, `modules/core/contracts/plataforma.ts`), nenhum `.js`.
- `git diff 0017f74 6531293` (e contra a9d9a6e) nesses 4 arquivos: 9 linhas, todas `0107` → `0103` em comentário JSDoc, comentário de código e título de teste. Nenhuma linha adicionada cita 0107.
- Resultado: **LIBERADO no SHA 6531293604a391ccebb487a532bb7e1b3a149875**.

## B) `nuvem/v1035-web-engenheiro-apps-senha-2` @ a6a67dd4283bce10494c7290b31eb82c8fbff4ee
- 1 commit; 10 arquivos em `apps/web`. `git diff e716ec5 a6a67dd` nos 10 arquivos: vazio (conteúdo idêntico ao liberado).
- Resultado: **LIBERADO no SHA a6a67dd4283bce10494c7290b31eb82c8fbff4ee**.

## C) `nuvem/v1035-web-testes-senha-2` @ 4f8be9f24576e1e648437350dd9f8627a07a72b3
- 1 commit; 2 arquivos (`tests/integracao/api/troca-senha-portal-v1034.test.ts`, `tests/e2e/web/portal-01b-04-api.spec.ts`).
- `git diff 726816e 4f8be9f`: o spec e2e é idêntico; no teste de integração, 6 linhas, todas `0107` → `0103` em comentário e título de `describe`.
- Resultado: **LIBERADO no SHA 4f8be9f24576e1e648437350dd9f8627a07a72b3**.

## D) `nuvem/v1035-web-engenheiro-apps-senha-2` @ 368b1945008924a06fb008e743514f7821d4e217 (depois do B)
- 2 commits sobre a6a67dd: 2fa901f (merge do `origin/main` @ 7f1f7a190, #798) e 368b194 (engenheiro-apps).
- Merge sem conteúdo próprio: `git merge-tree --write-tree a6a67dd 7f1f7a190` dá a mesma árvore de 2fa901f (`git diff` vazio).
- `git diff a6a67dd 368b194` nos 10 arquivos do B: só `portal-api.ts` (import de `PROXY_BASE`, `fetch(\`${PROXY_BASE}${caminho}\`)` e uma linha em branco) e `portal-falso.ts` (`responderMonitorFalso(..., e.conectores[tenant] ?? [])`); os dois trechos são idênticos a `git diff 3ee9539 7f1f7a190` (vieram do main: #794 e #796).
- 368b194: só `apps/web/lib/cabecalho-app.test.ts` (+3 −2). O teste do portal deixa a opção `cabecalhos` (tirada de `chamarPortal`) e forja `x-macuxi-app: campo/9.9.9` na requisição que chega ao proxy; confere `web/<VERSAO_WEB>`. Sem código de produção.
- Achado RD-3574 (baixa, só teste): não segura o lote (R-20261111-190159); entra no lote seguinte.
- Resultado: **LIBERADO no SHA 368b1945008924a06fb008e743514f7821d4e217**.

## Achados
| ID | Onde | Tipo | O que se repete | Impacto | Severidade | Proposta | Dono |
|---|---|---|---|---|---|---|---|
| RD-3574 | `apps/web/lib/cabecalho-app.test.ts:91,97-98` (368b194) | teste | o título "(o do chamador é trocado)" contradiz o comentário novo "o chamador não tem opção de cabeçalho"; e o valor forjado `campo/9.9.9` trocado pelo proxy repete o que o teste `chamada à API` (`:54-60`) já confere com o mesmo valor | manutenção | baixa (só teste; não segura) | título → `portal (chamarPortal): vai ao /api-proxy e o proxy põe o x-macuxi-app`; tirar o comentário `:97` e passar `proxy(pedido(url, init.headers as Record<string, string>))` | engenheiro-apps |

