# Treinamento — API, sync e telas (T-0058)

Desenho da fatia vertical do módulo sobre o domínio da T-0011 (`regras.md`). Tudo de regra está em `modules/treinamento/domain/`; API, app e BKO só orquestram.

## 1. Uma regra para o app e para o servidor
`domain/atividade.ts` — `aplicarAtividade` / `aplicarAtividades(estado, atividades, conteúdo, { gerarId, params })`:
- **No app** (prévia offline): estado = linhas do pull + itens da fila; o aluno vê na hora XP, nível, sequência e medalha (RN-TRE-01/05/06) e, se o domain recusar (tempo mínimo, limite de tentativas), a mensagem aparece e nada entra na fila.
- **Na API** (revalidação, RN-TRE-04): o push é aplicado de novo pelo mesmo código, na **ordem do instante do fato** (o quiz feito antes libera a lição enviada depois), com a escrita do aluno serializada (`travarAluno` = `pg_advisory_xact_lock`).
- Checagens, em ordem: mesmo `id` já gravado → `duplicado` (aceito sem efeito) → conteúdo conhecido (RF-TRE-01) → público-alvo (RN-TRE-07, `FORA_DO_PUBLICO`) → regras de lição/quiz (`concluirLicao`, `registrarTentativaQuiz`) → medalhas novas (RF-TRE-03, nunca em duplicidade).
- Quiz: resposta a questão de outro quiz ou repetida = `RESPOSTA_INVALIDA` (RN-TRE-02); quiz de lição ainda bloqueada = `LICAO_BLOQUEADA`.
- `resumoDaJornada` monta a tela inicial do "Treinar" (XP, XP de hoje, nível, sequência atual/em risco/maior, medalhas, trilhas: obrigatórias pendentes por prazo, depois em andamento, concluídas por último).
- `domain/bko.ts`: só rascunho é editado; publicar exige estrutura válida, ao menos uma lição, quiz com questão e questão com ≥ 2 alternativas e ≥ 1 correta; rascunho → publicada → arquivada (arquivada não volta).
- `domain/painel.ts`: painel de adesão (RF-TRE-05) e conclusões de trilha para o ranking (instante da lição que fechou a trilha).

## 2. Sync (ADR 0009)
| Entidade | Direção | Escopo | Linha / payload |
|---|---|---|---|
| `trilha` | pull | `proprio` (público do aluno, RN-TRE-07) | `TrilhaSyncLinha`: a árvore inteira (módulos, lições, quiz, questões, alternativas com a correta) |
| `progresso` | **ambos** | `proprio` | push `AtividadeEnvio` = `{ tipo: 'licao', ... }` ou `{ tipo: 'quiz', ... }`; pull `ProgressoSyncLinha` |
| `tentativa` | pull | `proprio` | `TentativaSyncLinha` (+ `finalizada`, RN-TRE-05) |
| `xp_lancamento` | pull | `proprio` | `XpLancamentoSyncLinha` |
| `medalha_usuario` | pull | `proprio` | `MedalhaUsuarioSyncLinha` |

- **Um só push** para lição e quiz: a API agrupa os itens por provedor; com duas entidades, a lição que depende do quiz poderia chegar antes dele e ser recusada para sempre. Com uma, o domain ordena pelo instante.
- `modulo_trilha`, `licao`, `quiz`, `questao`, `alternativa` (manifesto) viajam dentro de `trilha`; `medalha` (catálogo) = `medalhasPadrao(streak_medalha_dias)` até existir cadastro; `ranking_periodo` é calculado na rota (online, com cache no aparelho).
- As alternativas corretas descem ao aparelho para o feedback imediato offline; a API recorrige sempre.
- Push sem perfil de aluno (`licao.concluir`/`quiz.responder`) = `PERFIL_SEM_ACESSO`; `remover` = `SOMENTE_INSERCAO`. Eventos: `treinamento.licao.concluida@1` por lição aceita e `treinamento.medalha.conquistada@1` por medalha, na mesma transação (outbox), agregado = usuário.

## 3. Rotas `/v1/treinamento` (licença + perfil pela ação em toda rota; carteira `nao_se_aplica`)
| Rota | Ação | Escopo |
|---|---|---|
| `GET jornada` | `licao.concluir` | o próprio aluno |
| `GET ranking?periodo&escopo&data` | `ranking.ver` | tenant (RN-TRE-03); `equipe`/`regional` = as do usuário (`SEM_EQUIPE`/`SEM_REGIONAL` 422) |
| `GET adesao?mes&equipe_id` | `adesao.ver` | usuários visíveis (RN-CORE-04) |
| `GET adesao/pessoas?mes&equipe_id` | `notas.ver` | usuários visíveis |
| `GET bko/trilhas?status&busca`, `GET bko/trilhas/:id` | `trilha.editar` | tenant |
| `POST bko/trilhas` (idempotente pelo id do cliente) | `trilha.criar` | tenant; auditado |
| `PUT bko/trilhas/:id` (só rascunho) | `trilha.editar` | tenant; auditado |
| `POST bko/trilhas/:id/publicar` · `.../arquivar` | `trilha.publicar` | tenant; auditado (RN-AUD-01, só ids e status) |

Erros de regra: 422 com o código do domain e `detalhes.regra` (ex.: `TRILHA_INVALIDA` com `detalhes.problemas`).

## 4. Repositório SQL (ligado) e o que falta
**A fábrica SQL está ligada** (T-0058): `api/repositorio-postgres.ts` (`criarFabricaPostgres()`) implementa `FabricaRepositorio` sobre o schema `treinamento` (migração 0017, dicionário em `docs/banco/treinamento.md`) e o `moduloApi` de produção (`api/index.ts`) a passa em `criarApiTreinamento({ fabrica })`: as rotas respondem de verdade e o sync serve as cinco entidades (`trilha`, `progresso`, `tentativa`, `xp_lancamento`, `medalha_usuario`). Sem fábrica (`criarApiTreinamento()`), continua o 503 `TREINAMENTO_INDISPONIVEL` depois de licença e perfil; `api/memoria.ts` segue como implementação em memória dos testes sem banco.

Como funciona (tudo dentro de `ctx.comTenant`: papel `macuxi_app`, RLS forçado; nenhum `tenant_id` vem de fora além do da transação):
- `travarAluno`: `pg_advisory_xact_lock(hashtextextended(tenant || ':' || usuário, 0))`; a escrita do aluno é serializada (tetos de XP são ler-depois-gravar).
- `trilhas`/`trilha`/`trilhasDesde`: a trilha é UMA linha do pull com a árvore montada a partir de `modulo_trilha → licao → quiz → questao → alternativa` (todo nó tem `trilha_id`); cursor `(updated_at, id)` em microssegundos (`to_char ... US`), incluindo removidas; `updated_at < ate`.
- `inserirTrilha`/`atualizarTrilha`: o `updated_at` é do banco (`now()`, gatilho `tocar_trilha` sobe o da trilha a cada nó); editar **troca a árvore** (apaga alternativa → questão → quiz → lição → módulo por `trilha_id` e reinsere) na mesma transação e a rota devolve o `created_at`/`updated_at` lidos de volta.
- `mudarStatusTrilha` (publicar/arquivar): muda só `status`/`publicada_em`/`arquivada_em` e grava a linha de `trilha_publicacao` (append-only; autor = usuário da sessão, `request_id` da requisição). A auditoria `plataforma.auditoria` continua sendo do `tx.auditar` da rota.
- Aluno **append-only** (a aplicação só tem `select` e `insert`; UPDATE/DELETE = 42501 e o repositório nunca tenta): `gravarAtividade` usa `insert ... on conflict (<chave natural>) do nothing` — progresso `(tenant_id, usuario_id, licao_id)`, XP `(tenant_id, usuario_id, origem, referencia_id)`, medalha `(tenant_id, usuario_id, medalha_codigo)`, tentativa `(id)`. Reenvio não cria linha nem soma XP duas vezes.
- Leituras do tenant para ranking e painel (`lancamentosDoTenant`, `conclusoesDoTenant`, `tentativasDoTenant`) = só linhas vivas do tenant da transação; o ranking é calculado no domain a partir dos lançamentos.
- `usuarios()`: pela consulta pública do Core (ADR 0012), nunca por `core.*`. **Hoje** usa `core.cadastro_resumo@1` (declarada em `usaConsultas` do manifesto) para os usuários que têm atividade no Treinamento: traz id, nome e perfil; **equipe e regional vêm nulas e `ativo = true`**. Consequências: ranking `geral` e público por perfil funcionam; ranking por equipe/regional, público por equipe e a lista de pessoas sem atividade do painel dependem da consulta `core.usuarios_resumo@1` (`[{ id, nome, perfil, equipe_id, regional_id, ativo }]`, pedido ao engenheiro-software/modulo-core em R-20261102-131733-2). Quando existir, basta passar `criarFabricaPostgres({ usuarios })` com a nova fonte (`FonteDeUsuarios`).

Quem usa o quê: `api/rotas.ts` e `api/sync.ts` só falam com a interface `RepositorioTreinamento`; as consultas de uma rota rodam em série (a transação é uma conexão só).

### Como testar
- Sem banco: `pnpm --filter @macuxi/treinamento test` (domain, contracts, rotas e sync sobre o repositório em memória).
- Com Postgres real (`api/repositorio-postgres.db.test.ts`, dois tenants A/B, papel `macuxi_app`, RLS):
  `MACUXI_PG_EXIGIR=1 MACUXI_PG_AUTO_SUBIR=0 MACUXI_PG_HOST=localhost MACUXI_PG_PORTA=5432 MACUXI_PG_ADMIN_USUARIO=postgres MACUXI_PG_ADMIN_SENHA=postgres pnpm --filter @macuxi/treinamento test` (Node >= 24.7). O `vitest.config.ts` do módulo usa o globalSetup do `@macuxi/db` (banco efêmero com as migrações e as fixtures). Sem Postgres os testes de banco pulam com aviso; com `MACUXI_PG_EXIGIR=1` falham.
- O que o teste de banco prova: árvore gravada e relida; edição troca a árvore sem nó órfão; publicar/arquivar gravam a linha do tempo uma vez; pull paginado por cursor; idempotência de progresso, XP e medalhas (reenvio e corrida de dois envios iguais); UPDATE/DELETE nos dados do aluno = 42501; ranking só do tenant; `dia` do XP no fuso do tenant (Manaus x São Paulo); tenant B não lê nem grava trilha/progresso de A. Sem hora fixa: datas derivam de `criarRelogio` (dia civil no fuso do tenant) ou do `now()` do banco.
- Espelho Drizzle das 14 tabelas: código conferido em `docs/modulos/treinamento/espelho-drizzle.md` (vai para `modules/treinamento/db/nuvem.ts`, do banco-dados).

Resumo da migração 0017 (banco-dados), schema `treinamento`, 14 tabelas, todas com `id`, `tenant_id`, `created_at`, `updated_at`, `deleted_at`, `external_id` e RLS: conteúdo (`trilha`, `modulo_trilha`, `licao`, `quiz`, `questao`, `alternativa`, `trilha_publicacao`), aluno (`progresso`, `tentativa`, `xp_lancamento`, `medalha_usuario`) e catálogos (`medalha`, `desafio_vendas`, `desafio_vendas_produto`). O público-alvo fica nos arrays da `trilha` (não há tabela `publico_alvo`). O desafio de vendas (consumo de `vendedor.pedido.faturado@1`) ainda não tem código no repositório.

## 5. Premissas (T-0058)
- Trilha publicada não é editada (arquivar e criar outra); arquivada não volta.
- Público-alvo por perfil e equipe (RN-TRE-07); equipes informadas por id no BKO até existir o seletor do Core.
- Ranking: participam os perfis de `perfis_ranking` (padrão vendedor e promotor); o aluno vê o ranking do tenant inteiro (RN-TRE-03).
- Painel: público = pessoas ativas do escopo que estão no público de alguma trilha publicada; trilhas em rascunho ficam fora.
- Desafio de vendas (consumo de `vendedor.pedido.faturado@1`) fica para quando existir `desafio_vendas` no banco (backlog).
