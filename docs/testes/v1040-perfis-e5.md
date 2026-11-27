# v1.0.40 · Perfis em tabela (ADR 0073): parecer do testes da E5 e da E6 do core

Data: 27/11/2026, 10h15 (Manaus). Sessão S18 (R-20261127-093805-alexandre). Base: a simulação aprovada `docs/design/simulacoes/2026-11-24/perfis-tabela.md` e a ADR 0073.

| PR | Dono | Branch | Head conferido |
|---|---|---|---|
| #853 (kit) | designer-ux | `nuvem/v1040-designer-ux-perfis` | `75a3813bc7f25ac87795ac95819140486013ab9c` |
| PR novo (tela e rotas V2) | modulo-core | `nuvem/v1040-modulo-core-perfis-2` | `c8bf20834a25ccd6548662a964192a34cd6272e5` |

O c8bf2083 contém o 75a3813b e o `main` (cc78a5fd). Em `modules/`, ele é igual ao 183638eb (liberado no parecer anterior) mais 2 commits:
- 46053bb1 (RD-3734, RD-3741): `usuarioDaRequisicaoVePedidos` passa a usar `podePeloCargo` do SDK, e o Cliente 360 (`api/clientes.ts`) e o pull do histórico (`api/sync.ts`) chamam `usuarioVePedidos` direto. Um TODO aponta a troca por `promotorNaRequisicao`.
- c8bf2083: tira o symlink `modules/core/node_modules`.

`web/` não mudou desde o 183638eb.

Banco: as migrações do `main` (até a 0108) mais a 0109 corrigida da S19 (`nuvem/v1040-banco-dados-perfis-correcao` @ 833d47af), aplicada só na sessão, sem commit.

## Parecer
- **#853 @ 75a3813b: LIBERADO.** Nenhum achado.
- **modulo-core-perfis-2 @ c8bf2083: LIBERADO.** Não há achado no código de produção.

Dois testes de `tests/` acompanhavam a forma antiga e foram corrigidos neste lote, no caminho do testes:
- `tests/modulos/pedidos-busca-t0077.test.ts:989`: a asserção de fonte esperava `ctx.usuario.perfil !== 'promotor' || (await lerPromotorVePedidos(db))` no `cliente360-v2.ts`. Agora ela espera `const podeVerHistorico = await usuarioVePedidos(ctx, db);` nas duas rotas do Histórico (forma do #861), que é a regra da ADR 0073 §2.4: `pedido.ver` em `concessao` e `promotor_ve_pedidos` em `legado`. Só a asserção mudou.
- `tests/integracao/demo/demo-matriz.test.ts:516`: a contagem de usuários por perfil lia `GET /v1/core/perfis` com o `PerfilListaRespostaSchema` antigo, que tem `base` e `fabrica`. Agora a rota responde V2, então o teste lê com o `PerfilListaRespostaV2Schema`. A conferência da contagem não mudou.

## O que rodou (no head c8bf2083, Node 24.22 de `/opt/node24`, Postgres 16 local de `db/scripts/pg-local.sh`)
| Pacote | Comando | Resultado |
|---|---|---|
| @macuxi/core | `pnpm typecheck` (api, web e mobile) | limpo |
| @macuxi/core | `pnpm lint` | 0 erros (50 avisos `perfil-fixo` já conhecidos) |
| @macuxi/core | `vitest run` (a suíte inteira, com o banco) | 318 arquivos, 3554 testes: 3553 verdes. `perfis-v2.db.test.ts` (36), `perfis-v2.test.ts`, `promotor-pedidos.db.test.ts`, `promotor-historico.db.test.ts`, `domain/promotor-pedidos.test.ts` e `web/lib/perfis-tabela.test.ts` estão verdes |
| tests/ | `vitest run --config tests/vitest.config.ts` (com o banco) | 187 arquivos, 2860 testes: 2828 verdes, 22 pulados e 8 todo. Caíram 2, os dois corrigidos acima. Com a correção, os 2 arquivos têm 106 de 106 verdes |
| tests/ | `tsc -p tests/tsconfig.json` e `eslint` nos arquivos tocados | limpos |
| BKO no navegador, com a **API real** | `tests/e2e/bko/prints-perfis-v1040-api.ts` | sem divergências |

- Um teste caiu na suíte do core: `api/vinculo-erp.db.test.ts` (RN-CORE-58). Sozinho, o arquivo passa com 9 de 9. É o mesmo teste instável da suíte paralela já registrado no 183638eb, e o lote não toca o vínculo com o ERP. Não é achado.

## E5: os 11 critérios → teste → resultado
| Critério | Teste | Resultado |
|---|---|---|
| 1. Trava pelo cargo com o motivo, sem código de RN | `perfis-tabela.test.ts` (RN-CORE-33). No navegador com a API real, as travas mostram o motivo (por exemplo "Este cargo nunca entra no BKO nem no portal.") e não há "RN-" na página | ✅ |
| 2. Cargo travado quando o perfil tem usuários | prints: o cadeado aparece com "Não muda enquanto houver usuários neste perfil.". db.test: 422 `CARGO_EM_USO` | ✅ |
| 3. Módulo sem licença desabilitado, guardando o valor | db.test: 422 `PERMISSAO_SEM_LICENCA` em `legado` e em `concessao`, e o valor guardado continua guardado (RN-CORE-02). A base de demo tem tudo contratado, por isso o grupo sem licença ficou no print simulado do parecer anterior. A tela não mudou desde então | ✅ |
| 4. Aviso de autogestão uma vez só, no topo | print Admin (API real): um aviso só, "Você usa este perfil…". O script conta 1 no Admin e 0 no Vendedor. db.test: `autogestao` só no perfil de quem está logado | ✅ |
| 5. Caixa do grupo com 3 estados, só nas linhas livres | prints: grupos em `mixed`, `true` e vazio. `perfis-tabela.test.ts`. A tela não mudou desde o 183638eb, conferido no navegador | ✅ |
| 6. Escopo acima do teto do cargo com cadeado e motivo | print Vendedor: cadeado em Equipe, Equipes abaixo e Toda a empresa, com "O cargo Vendedor vai até "Carteira própria".". db.test: 422 `ESCOPO_ACIMA_DO_CARGO` | ✅ |
| 7. RN-PRO-01: o promotor nunca cria nem altera pedido | navegador com a API real, perfil Promotor: `pedido.criar`, `editar`, `cancelar`, `excluir`, `aprovar` e `criar_em_nome` travados com "Perfil de promotor nunca cria, edita, cancela, exclui ou aprova pedido.", e `pedido.ver` livre. db.test: 422 `TRAVA_DO_PERFIL` (pelo corpo e pela cópia) e 23514 no insert direto | ✅ |
| 8. Só quem tem `perfil.gerir` edita | db.test: toda rota de gestão exige `perfil.gerir`, e o vendedor não tem essa permissão | ✅ |
| 9. 422 com texto único | `MENSAGEM_PERFIS_NAO_MIGRADOS` existe só em `contracts/perfis.ts`, e a tela usa `frasesDaRecusa`. db.test: POST, PUT e DELETE em `legado` dão 422 `PERFIS_NAO_MIGRADOS` | ✅ |
| 10. Busca | `perfis-tabela.test.ts`. No navegador (183638eb, com `web/` igual): "transportadora" mostra 2 linhas e "zzz" mostra "Nenhuma permissão com esse nome." | ✅ |
| 11. Salvar como único botão principal, sem "Perfil base", "Restaurar padrão" e "Promotor vê pedidos" | API real: os botões principais são só ["Salvar"] no Vendedor e no Admin. Os textos proibidos não aparecem na página | ✅ |

## E6 do lado do core
| Item | Teste | Resultado |
|---|---|---|
| Um tenant em `concessao` e um em `legado` | `perfis-v2.db.test.ts` 344 a 385: a fixture grava `legado`, liga e desliga por tenant, e o detalhe é igual nos dois. Base de demo com a 0109: o tenant `demo` ficou em `concessao` (`ligar_leitura_por_concessao`), e a tela leu dele | ✅ |
| 422 `PERFIS_NAO_MIGRADOS` | db.test 375: em `legado`, a leitura funciona e a escrita é recusada | ✅ |
| RN-PRO-01 pelo cargo | db.test 115 e 467: a API e o banco (23514), em `concessao` | ✅ |
| O promotor vê pedidos com `pedido.ver` e a trava do cargo (RD-3741) | domain: `usuarioDaRequisicaoVePedidos` com `podePeloCargo`. `vetadaPeloCargo` barra só a escrita de pedido (`ehAcaoDeEscritaDePedido`), então `pedido.ver` passa. db.test 479: em `legado`, vale o parâmetro. Em `concessao`, tirar `pedido.ver` do perfil esconde o histórico, e devolver a chave mostra de novo. `promotor-historico.db.test.ts` (6) cobre o Cliente 360 e o pull. O t0077 corrigido confere o `cliente360-v2.ts` | ✅ |
| Licença | db.test 66, 125 e 406 | ✅ |
| Isolamento entre tenants | db.test 212, 263 e 501 (RN-CORE-05) | ✅ |
| Último admin pela gestão | db.test 189 e 450: 422 `ULTIMO_ADMIN` com `AUTOGESTAO`, e em `concessao` o banco recusa a escrita direta no COMMIT | ✅ |

Observação, que não é achado: o `sync.ts` deixou de conferir `ctx.usuario.cargo !== 'promotor'` antes de `usuarioVePedidos`. Agora quem decide é o `requisicaoDePromotor`, pelo cargo de `perfil_acesso` ou, em `legado`, pelo perfil do token. Em `legado`, cargo promotor implica perfil promotor, então o resultado é o mesmo. O `promotor-historico.db.test.ts` passa.

## Valor × regra: "n de m ligadas" (API real)
A regra: n é o número de chaves concedidas da área (livres, travadas e sem licença), e m é o número de chaves da área no catálogo. O grupo só de escopo (Dados) não tem contagem. O script calcula o esperado a partir das respostas reais de `/core/permissoes/catalogo` e `/core/perfis/:codigo`, compara com a tela em todos os grupos e **não acha divergência**.
- Vendedor: Onde entra 1 de 4, Usuários 0 de 10, Clientes 1 de 8, Pedidos 5 de 12, Catálogo 3 de 10, Trade 0 de 20, Pesquisa 1 de 8, Treinamento 4 de 12, Metas 2 de 6, Gestão 0 de 8, Integração 0 de 6 e Administração 8 de 43.
- Admin: Onde entra 2 de 4, Usuários 9 de 10, Clientes 8 de 8, Pedidos 6 de 12, Catálogo 10 de 10, Trade 10 de 20, Pesquisa 7 de 8, Treinamento 9 de 12, Metas 6 de 6, Gestão 2 de 8, Integração 6 de 6 e Administração 39 de 43.

Rótulo × valor: "ligadas" conta as concessões gravadas. A tela não tem data, fuso nem dinheiro, então dia útil, virada de mês e fuso não se aplicam.

## Prints (1366 px, deviceScaleFactor 2, head c8bf2083, **API real**)
- `docs/testes/prints/v1040-perfis/perfis-vendedor-1366.png`
- `docs/testes/prints/v1040-perfis/perfis-admin-1366.png`

Como foram feitos: a API (`apps/api`, porta 8100) rodou sobre a base `macuxi_prints_v1040`, com as migrações do `main`, a 0109 da S19 e `seed demo`, e o tenant `demo` em `concessao`. O BKO rodou em `next dev`, pelo `/api-proxy`. O formulário de login recusa o código "demo" da base, que não tem UF nem 4 números. Por isso o script entra pelo `POST /auth/login` real e passa o token à sessão do navegador. Todas as leituras da tela vieram da API real.

## Achados anteriores (A1 a A5)
Continuam resolvidos no c8bf2083. Não há achado novo.

## Roteiro manual (API real)
1. Entrar como Admin, abrir o Vendedor, ligar uma caixa livre e salvar. Conferir o toast e o "Nenhuma mudança".
2. Abrir o mesmo perfil em duas abas e salvar nas duas. Deve aparecer "Outra pessoa alterou este perfil…".
3. Entrar com um perfil sem `perfil.gerir` e conferir o aviso no lugar da tela.
4. Com o tenant em `legado`, salvar e conferir que a tela mostra o texto único do 422.
5. No app Campo, como promotor de um tenant em `concessao`: tirar `pedido.ver` do perfil Promotor no BKO, sincronizar e conferir que o histórico some do Cliente 360. Depois, devolver a chave e conferir que o histórico volta.

## Ajuste ao #861 (substitui o #858)
27/11/2026, 13h55 (Manaus). Conferido com `nuvem/v1041-modulo-core-perfis` @ `3c29241ccf1306658ecd6963ea2d215d7ad949e5`, juntado por merge local (sem push) ao branch deste PR, que já traz o `main` @ `9c0857a3`.

| Arquivo | Ajuste |
|---|---|
| `tests/modulos/pedidos-busca-t0077.test.ts` | as 2 rotas do Histórico no `cliente360-v2.ts` usam `const podeVerHistorico = await usuarioVePedidos(ctx, db);`, sem `lerPromotorVePedidos`; o `promotor-pedidos.ts` só lê o parâmetro quando `!u.perfil_acesso && promotorNaRequisicao(u)` |
| `tests/modulos/checkin-fora-de-rota-rncore52.test.ts` | o rótulo `visita.checkin_fora_de_rota` vem de `modules/core/web/lib/acesso.ts` |
| `tests/e2e/bko/menu-parametros.spec.ts` | o mock de `/core/perfis` passa ao `PerfilResumoV2` strict (sem `base` e `fabrica`, com `autogestao`); sai o mock de `parametros/promotor-ve-pedidos`, porque o painel saiu |
| `tests/e2e/bko/prints-perfis-v1040.ts` | sai o mesmo mock de `parametros/promotor-ve-pedidos` |

| tests/ com o #861 (Node 24.22, Postgres 16 local) | Resultado |
|---|---|
| `tsc -p tests/tsconfig.json` e `eslint tests` | limpos |
| `vitest run --config tests/vitest.config.ts` | 186 arquivos (185 verdes, 1 pulado: `fundacao/fonte-sistema-varredura`), 2802 testes: 2772 verdes, 0 falhas, 22 pulados e 8 todo |
| Playwright `tests/e2e/bko/menu-parametros.spec.ts` (BKO em `next dev`, API simulada) | 15 de 15 verdes |

