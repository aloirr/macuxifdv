# v1.0.40 · Perfis em tabela (ADR 0073, E5) — parecer final do testes

Data: 27/11/2026, 09h35 (Manaus). Base: simulação aprovada `docs/design/simulacoes/2026-11-24/perfis-tabela.md` e ADR 0073.

| PR | Dono | Branch | Head conferido |
|---|---|---|---|
| #853 (kit) | designer-ux | `nuvem/v1040-designer-ux-perfis` | `75a3813bc7f25ac87795ac95819140486013ab9c` |
| #854 (tela, rotas V2 e 0109) | modulo-core | `nuvem/v1040-modulo-core-perfis` | `183638eb8990351d6795a44291002402b7147b77` |

O 183638eb contém o 75a3813b, e o #854 não muda `packages/` além do que o #853 traz.

## Parecer
- **#853 @ 75a3813b: LIBERADO.** Nenhum achado.
- **#854 @ 183638eb: LIBERADO.** Os achados A1 a A5 do parecer anterior (908fc0c1) estão resolvidos. Não há achado novo.

## O que rodou (no head 183638eb)
| Pacote | Comando | Resultado |
|---|---|---|
| @macuxi/ui | `vitest run` | 59 arquivos, 661 testes, verdes |
| @macuxi/ui | `pnpm typecheck` (web e mobile) | limpo |
| @macuxi/core | `pnpm typecheck` (api, web e mobile) | limpo |
| @macuxi/core web e domain | `vitest run web domain` (Node 22) | verdes |
| @macuxi/core api, com Postgres local (`db/scripts/pg-local.sh --env`, Node 24.22 de `/opt/node24`) | `vitest run api` | 105 arquivos, 1123 testes: 1122 verdes. `perfis-v2.db.test.ts` com 36 testes verdes, `perfis-v2.test.ts`, `promotor-pedidos.db.test.ts` e `promotor-historico.db.test.ts` verdes |
| BKO no navegador | `tests/e2e/bko/prints-perfis-v1040.ts` (Chromium de `/opt/pw-browsers`, Next em dev) | sem divergências |

- Com o Node 22 da sessão, 97 testes da API caem só por falta de `crypto.argon2` (autenticação, credencial, senha e usuários). Isso não é achado. Com o Node 24 eles passam.
- Um teste caiu na suíte completa: `api/vinculo-erp.db.test.ts` (RN-CORE-58, linha 197). Rodando só esse arquivo, os 9 testes passam. O #854 não toca o vínculo com o ERP, então isso não é achado deste lote. Fica registrado como teste instável na suíte paralela.

## Critério → teste → resultado
| Critério | Teste | Resultado |
|---|---|---|
| Trava pelo cargo com o motivo, sem código de RN | `perfis-tabela.test.ts` (RN-CORE-33). No navegador aparecem os motivos e não há "RN-" na página | ✅ |
| Cargo travado quando o perfil tem usuários | `perfis-tabela.test.ts`. Nos prints, o cadeado aparece com "Não muda enquanto houver usuários neste perfil.". Na API, o db.test cobre o 422 `CARGO_EM_USO` | ✅ |
| Módulo sem licença desabilitado, guardando o valor | navegador: Treinamento com "Sem licença", a caixa sem efeito e "4 de 12 ligadas". db.test: 422 `PERMISSAO_SEM_LICENCA` e o valor guardado continua guardado (RN-CORE-02) | ✅ |
| Aviso de autogestão uma vez só, no topo | print Admin: um aviso só, e as linhas travadas sem texto repetido. A API marca `autogestao` só no perfil de quem está logado (db.test) | ✅ |
| Caixa do grupo com 3 estados, só nas linhas livres | navegador: Clientes vai de `mixed` 1 de 8 para `true` 8 de 8, com "7 mudanças não salvas". Em Onde entra, só a linha livre muda | ✅ |
| Escopo acima do teto do cargo com cadeado e motivo | print Vendedor: cadeado em Equipe, Equipes abaixo e Toda a empresa, e o motivo escrito "O cargo Vendedor vai até "Carteira própria"." (A3 resolvido). API: 422 `ESCOPO_ACIMA_DO_CARGO` | ✅ |
| RN-PRO-01: o promotor nunca cria nem altera pedido | navegador, perfil Promotor: `pedido.criar`, `editar`, `cancelar`, `excluir`, `aprovar` e `criar_em_nome` travados com "Perfil de promotor nunca cria, edita, cancela, exclui ou aprova pedido.", e `pedido.ver` livre. db.test: a API recusa com 422 `TRAVA_DO_PERFIL` (pelo corpo e pela cópia de outro cargo), e o banco recusa o insert direto (23514). Domain: `usuarioDaRequisicaoVePedidos` muda só a leitura | ✅ |
| Só quem tem `perfil.gerir` edita | db.test: todas as rotas de gestão exigem `perfil.gerir`, e o vendedor não tem essa permissão. `perfis-tabela.test.ts`. A página mostra o aviso quando `usePode('perfil.gerir')` falha e no 403 | ✅ |
| 422 com texto único | `MENSAGEM_PERFIS_NAO_MIGRADOS` existe só em `contracts/perfis.ts`. A API lança esse texto, e a tela o mostra pelo `frasesDaRecusa(details, message)`, sem texto próprio. db.test: POST, PUT e DELETE com o tenant em `legado` dão 422 `PERFIS_NAO_MIGRADOS` | ✅ |
| Busca | navegador: "transportadora" mostra só as 2 linhas de Pedidos, e "zzz" mostra "Nenhuma permissão com esse nome." | ✅ |
| Salvar como único botão principal | navegador: os botões principais são só ["Salvar"], no Vendedor e no Admin | ✅ |
| Sem "Perfil base", "Restaurar padrão" e "Promotor vê pedidos" | busca de texto na página. O cartão saiu (A1 resolvido) | ✅ |

### Valor × regra: "n de m ligadas"
Pela regra, n é o número de chaves concedidas da área (livres, travadas e sem licença) e m é o número de chaves da área no catálogo. O grupo Dados não tem contagem. O script calcula o esperado a partir da resposta e compara com a tela em todos os grupos do Vendedor e do Admin, e **não há divergência**. Exemplos: no Vendedor, Onde entra 1 de 4, Pedidos 5 de 12 e Treinamento 4 de 12; no Admin, Onde entra 2 de 4 e Administração 39 de 43. Rótulo × valor: "ligadas" conta as concessões gravadas. A tela não tem data, fuso nem dinheiro, então dia útil, virada de mês e fuso não se aplicam.

## Achados anteriores
| Id | Situação no 183638eb |
|---|---|
| A1 (alta) cartão "Promotor vê pedidos" | resolvido: o painel saiu de `web/index.ts`, e a leitura passou para a chave `pedido.ver` |
| A2 (média) rótulo de `dados.escopo` | resolvido: agora é "Quais clientes e números vê" |
| A3 (média) motivo do teto escondido | resolvido: o motivo aparece escrito sob o nome da linha (print Vendedor) |
| A4 (baixa) títulos dos grupos | resolvido: os títulos estão iguais aos da simulação |
| A5 (baixa) barra sobre o menu | resolvido: `md:left-[240px]` |

Nenhum achado novo.

## Prints (1366 px, deviceScaleFactor 2, head 183638eb)
- `docs/testes/prints/v1040-perfis/perfis-vendedor-1366.png`
- `docs/testes/prints/v1040-perfis/perfis-admin-1366.png`

**A API foi simulada** com `page.route`, porque o prazo não deu para subir a API com a demo. As respostas seguem o formato V2 real e saem das funções do domain no head 183638eb (`montarCatalogoPorArea` com `so_bko`, `montarDetalheV2` com `perfilDoLogado`, e `ehAutogestao` na lista), com o catálogo dos 8 manifestos e os 7 modelos do SDK. O Treinamento fica sem licença, e o usuário logado usa o perfil `admin`. As rotas V2 reais foram conferidas pelos 36 testes de `perfis-v2.db.test.ts`, com Postgres.

## Roteiro manual (API real)
1. Entrar como Admin, abrir o Vendedor, ligar uma caixa livre e salvar. Conferir o toast e o "Nenhuma mudança".
2. Abrir o mesmo perfil em duas abas e salvar nas duas. Deve aparecer "Outra pessoa alterou este perfil…".
3. Entrar com um perfil sem `perfil.gerir` e conferir o aviso no lugar da tela.
4. Com o tenant em `legado`, salvar e conferir que a tela mostra o texto único do 422.
