# Parecer de redundâncias — v1.0.35, item 3: senha do admin do cliente no portal (0107, API, testes, gaveta) e reteste RD-3558 a RD-3561

Data: 25/11/2026 (Manaus). Rodada única, por SHA. Sem envio pela CLI de coordenação (403 no repositório de mensagens); achados
relatados ao gerente-projetos na resposta. Faixa desta rodada: RD-3564 a RD-3599 (usados RD-3564 a RD-3570; RD-3571 a RD-3599 livres).

## A) branch da migração da senha do admin @ cbcae6d (banco-dados a7ed3e0 + testes) — LIBERADO no SHA cbcae6d

- 0107 (`db/migrations/0107_plataforma_senha_admin_portal.up.sql`): 3 funções novas, sem regra repetida entre elas além da checagem
  de sessão (padrão das `sa_*`). O cabeçalho da migração e `docs/banco/plataforma.md` descrevem as funções com o mesmo conteúdo: é a
  convenção do repositório (migração aponta o dicionário; aceita nas rodadas anteriores), sem achado.
- `db/testes/funcoes-sa.ts` (`FUNCOES_SA_0107`, 49), `estatico.test.ts`, `empresa-zerar.db.test.ts`, `conformidade.test.ts`
  (`SA_PORTAL_0107`): só o acréscimo da 0107, sem duplicar listas.
- `db/testes/senha-admin-portal.db.test.ts`: sem achado.
- `tests/integracao/banco/senha-admin-portal-v1035.test.ts`: SA-01 (sessão com 2 empresas e escolha), SA-03 (divergente com
  bloqueio), SA-04 (conta desativada, perfil, senha a trocar) e SA-05 (temporária) acrescentam casos. Dois repetem o teste do banco:

| ID | Grav. | Onde | O que se repete | Proposta | Dono |
|---|---|---|---|---|---|
| RD-3564 | baixa (só teste; não segura) | `tests/integracao/banco/senha-admin-portal-v1035.test.ts:146-166` (SA-02) | 1..4 falhas sem bloqueio, a 5ª = now() + 15 min, `sa.bloqueio` 1 vez, a 6ª com bloqueio vivo não muda, vencido recomeça: tudo já em `db/testes/senha-admin-portal.db.test.ts:140-161` ("falhas") e `:131-132` (reautenticar com bloqueio vencido = 0) | Tirar o SA-02 e a linha dele no cabeçalho (`:6`) | testes |
| RD-3565 | baixa (só teste; não segura) | `senha-admin-portal-v1035.test.ts:230-254` (SA-06) | `macuxi_app`/`macuxi_worker` = 42501 nas 3 funções: já em `db/testes/senha-admin-portal.db.test.ts:217-227` (`has_function_privilege` das 3 para app e worker + chamada como app e worker) e na igualdade exata de `tests/integracao/banco/conformidade.test.ts` (`SA_PORTAL_0107`) | Tirar o SA-06 e a linha dele no cabeçalho (`:10`) | testes |

## B) `nuvem/v1035-web-modulo-core` @ fda8c26 (modulo-core, sobre cbcae6d) — NÃO LIBERADO

| ID | Grav. | Onde | O que se repete | Proposta | Dono |
|---|---|---|---|---|---|
| RD-3566 | média | `modules/core/api/super-admin.ts:256-282` (`trocarSenhaAdmin`) × `:228-251` (`trocarSenha`, ramo super-admin) | O mesmo fluxo duas vezes: `barrarSeBloqueado` com a mesma auditoria 423 (`:237` e `:267`), `conferir` + `contarFalhaDeSenha` com o literal "Senha atual incorreta. Confira e tente de novo." (`:239` e `:269`), `validarSenhaNova` + auditoria + 422 com `faltas` (`:244-248` e `:273-277`), gravação + auditoria 409 com o literal "A senha mudou enquanto você a trocava…" (`:249-251` e `:278-280`). `trocarSenhaAdmin` ainda relê `ctx.corpo` e `ctx.agora()`, que `trocarSenha` já leu (`:229-230` × `:257-258`). Os 3 testes novos do admin em `super-admin.test.ts` (401/423, 422, 409) repetem os do super-admin pelo mesmo motivo | Um fluxo só em `trocarSenha`, com uma "porta" por tipo: `{ conta(): Promise<{ email, senha_hash, bloqueado_ate } \| null>, falha(): Promise<EstadoTentativa>, sucesso?(): Promise<void>, gravar(atual, novo): Promise<boolean> }`. Super-admin: `reautenticar` + `tentativaEstado(chave)`, `tentativaFalha(chave)`, `tentativaSucesso(chave)`, `gravarSenhaSuperAdmin`; admin: `reautenticarAdmin`, `falhaSenhaAdmin`, sem `sucesso`, `gravarSenhaAdmin`, com `.catch(sqlParaHttp)`. Testes do admin: ficam só os que exercitam o `sqlParaHttp` (42501 = 403) e o 204; os de 401/423, 422 e 409 viram `it.each` sobre os dois tipos | modulo-core |

- `super-admin-repositorio.ts`: 3 métodos novos, um por função; sem achado.
- `contracts/plataforma.ts`: ver RD-3569 (export morto depois de C e D).

## C) `nuvem/v1035-web-testes-senha` @ e3099dc (testes, sobre fda8c26) — LIBERADO no SHA e3099dc

- `troca-senha-portal-v1034.test.ts` (rota, API real) não repete `senha-admin-portal-v1035` (banco direto) nem `super-admin.test.ts`
  (memória): TS-04 a TS-07 provam a rota, o BKO e o log. Dois achados baixos, só de teste:

| ID | Grav. | Onde | O que se repete | Proposta | Dono |
|---|---|---|---|---|---|
| RD-3567 | baixa (só teste; não segura) | `tests/integracao/api/troca-senha-portal-v1034.test.ts:148-154`, `:305`, `:318` (`revogadasDoUsuario`) | "As sessões do portal caíram" provado 3 vezes no TS-04: o 401 de s1 e s2 (`:315-316`), `vivasDaConta` = `{ portal: 0, app: 0 }` (`:317`) e `revogadasDoUsuario >= antes + 2` (`:318`) | Tirar `revogadasDoUsuario`, `revogadasAntes` e o expect de `:318` | testes |
| RD-3568 | baixa (só teste; não segura) | `tests/e2e/web/portal-01b-04-api.spec.ts:343-417` | A sequência inteira 401 → recarregar → 423 → 409 → 422 → 204 roda para `time` e `admin`, em cada host, com a mesma gaveta e a mesma rota (D unificou o código do web); só o token e o nome mudam | Sequência completa só no `admin` (o caso novo); no `time`, só o 401 (corpo e `authorization`) e o 204 | testes |

## D) `nuvem/v1035-web-engenheiro-apps-senha` @ e716ec5 (engenheiro-apps, sobre origin/main) — LIBERADO no SHA e716ec5

- Gaveta: no portal, só Senha atual, Senha nova, Repita, regras, Cancelar e Salvar senha; sem e-mail e sem código. Avisos: a tabela
  do Core mais 423 e 409. Nenhum texto sobre o que o sistema faz por trás. Sem achado de texto.
- Saíram `trocarSenhaAdminFalsa`, `corpoDaTrocaNoPortal`, `pedirEmail`, `cabecalhos` do `chamarPortal`, `trocarSenhaSuperAdmin` e a
  rota pública da lista: nenhum resto no `apps/web`.
- `TROCA_SO_SUPER_ADMIN`: o `apps/web` de e716ec5 não usa mais. Com C (sem uso em `tests/`) e D no `main`,
  `CODIGOS_PORTAL.trocaSoSuperAdmin` só aparece na lista de chaves de `modules/core/api/super-admin.test.ts:446`: o `@deprecated` vira
  export morto (RD-3569).

| ID | Grav. | Onde | O que se repete | Proposta | Dono |
|---|---|---|---|---|---|
| RD-3569 | baixa (export morto; não segura B, cujo web ainda usa; segura o 1º PR do modulo-core depois de C e D no `main`) | `modules/core/contracts/plataforma.ts:37-38` (`trocaSoSuperAdmin` @deprecated) e `modules/core/contracts/ciclo-senha.ts:12` (`export` de `ehEmailValido`, sem import fora do arquivo depois que D tirou o de `menu-usuario.tsx:21`) | Chave de contrato que a API não devolve e ninguém lê; export que só o próprio arquivo usa | Tirar a chave e o JSDoc; tirar `'trocaSoSuperAdmin'` de `super-admin.test.ts:446`; `ehEmailValido` sem `export` | modulo-core |
| RD-3570 | baixa (só teste; não segura) | `apps/web/lib/menu-usuario.test.ts:143` | `ROTAS_PUBLICAS_PORTAL` não contém a troca: já garantido pelo `toEqual(['/plataforma/auth/login'])` de `apps/web/lib/portal-escolha.test.ts:237` | Tirar a linha `:143` | engenheiro-apps |

## E) `nuvem/v1035-web-testes` @ 844eee6 (testes) — LIBERADO no SHA 844eee6

Reteste (`git diff 3ed4022 844eee6`, `tests/integracao/api/pagamento-web-v1035.test.ts`):
- **RD-3558 corrigido**: W0 saiu.
- **RD-3559 corrigido**: W4, `PUBLICADA_EM`, `versoesApp`, `tk.gerente` e os imports do 426 saíram.
- **RD-3560 corrigido**: W5 e `PED.semCabecalho` saíram; o "sem cabeçalho" fica no W3.
- **RD-3561 corrigido**: cabeçalho com 8 linhas, sem o parágrafo da fixture; critérios renumerados (W3 = "critérios 2 e 3").
- Sem resto: `erroDe` segue usado (`:138`). Sem achado novo.

## F) Reteste de RD-3566: `nuvem/v1035-web-modulo-core` @ a9d9a6e (modulo-core) — LIBERADO no SHA a9d9a6e

`git diff fda8c26 a9d9a6e` (só `modules/core/api/super-admin.ts` e `super-admin.test.ts`):
- **RD-3566 corrigido**: `trocarSenhaAdmin` saiu; o fluxo fica uma vez em `trocarSenhaDaConta` (`super-admin.ts:256-292`), com a
  "porta" por tipo de conta (super-admin: `tentativaEstado`/`tentativaFalha`/`tentativaSucesso`/`gravarSenhaSuperAdmin`; admin:
  `reautenticarAdmin`/`falhaSenhaAdmin`/`gravarSenhaAdmin` com `.catch(sqlParaHttp)`, sem `sucesso`). Os literais "Senha atual
  incorreta…" e "A senha mudou enquanto você a trocava…", as auditorias 423/422/409 e a leitura de `ctx.corpo`/`ctx.agora()`
  aparecem uma vez cada; `sqlParaHttp` ficou só no ramo do admin.
- Testes: os 3 do super-admin e os 3 do admin (401/423, 422, 409) viraram um `describe.each(['super_admin', 'admin_cliente'])`;
  ficam fora só os casos próprios de cada tipo (204 de cada um, sem token/sem segredo, 42501 = 403). Nenhum caso repetido.
- Sem resto e sem export morto novo: `trocarSenhaAdmin` não aparece no repositório; nenhum export foi criado ou deixou de ter uso
  (`trocarSenhaDaConta` é local). ESLint limpo nos 2 arquivos e `super-admin.test.ts` 39/39 verde na sessão, no SHA a9d9a6e.
- Observação sem achado: `quemDe(claims, viva)` aparece em 3 `return` de ramos exclusivos (só um roda por pedido).
- RD-3569 (export morto, depois de C e D no `main`) segue aberto; não é deste diff.

Sem achado novo (RD-3571 a RD-3599 não usados). Sem defeito funcional para encaminhar ao testes.
