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

## 4. Repositório e o que falta no banco
`api/repositorio.ts` define a interface; `api/memoria.ts` é a implementação em memória dos testes. **O `moduloApi` de produção ainda não tem fábrica**: as rotas respondem 503 `TREINAMENTO_INDISPONIVEL` depois de licença e perfil, e o sync não serve as entidades (o aparelho mantém a fila com `SYNC_NAO_IMPLEMENTADO`, retentável). Ligar = implementar `FabricaRepositorio` em SQL e passar em `criarApiTreinamento({ fabrica })`.

Migração 0017 (banco-dados), schema `treinamento`, toda tabela com `id`, `tenant_id`, `created_at`, `updated_at`, `deleted_at`, `external_id` e RLS:
- `trilha` (titulo, descricao, status, obrigatoria, sequencial, prazo date, publico_perfis text[], publico_equipes uuid[], publicada_em, arquivada_em) + árvore `modulo_trilha` (trilha_id, ordem, titulo, pre_requisitos uuid[]), `licao` (modulo_id, ordem, titulo, tipo, texto, midia_url, duracao_estimada_seg, pre_requisitos uuid[]), `quiz` (licao_id único), `questao` (quiz_id, ordem, enunciado), `alternativa` (questao_id, ordem, texto, correta). Alterar qualquer nó da árvore precisa subir o `updated_at` da trilha (o pull é por trilha).
- `progresso` (usuario_id, trilha_id, licao_id, concluida_em, tempo_gasto_seg), único (tenant_id, usuario_id, licao_id).
- `tentativa` (usuario_id, quiz_id, realizada_em, respostas jsonb, acertos, total_questoes, nota_pct numeric(5,2), aprovada, primeira_tentativa, finalizada).
- `xp_lancamento` (usuario_id, origem, referencia_id varchar(128), pontos, pontos_base, limitado_pelo_teto, ocorrido_em, dia date), único (tenant_id, usuario_id, origem, referencia_id) — violação = `duplicado`.
- `medalha_usuario` (usuario_id, medalha_codigo, conquistada_em), único (tenant_id, usuario_id, medalha_codigo).
- Índices de pull `(tenant_id, updated_at, id)` e `(tenant_id, usuario_id, updated_at, id)`; `desafio_vendas`/`publico_alvo` seguem o recado da T-0011.
- Seed da demo: 2 trilhas publicadas (uma obrigatória com quiz) e uma em rascunho.

Usuários (perfil, equipe, regional, ativo, nome) vêm do **Core** — o Treinamento não lê `core.*` (regra 1). A implementação SQL de `usuarios()` precisa de uma consulta do Core (ADR 0012), proposta: `core.usuarios_resumo@1` → `[{ id, nome, perfil, equipe_id, regional_id, ativo }]` do tenant.

## 5. Premissas (T-0058)
- Trilha publicada não é editada (arquivar e criar outra); arquivada não volta.
- Público-alvo por perfil e equipe (RN-TRE-07); equipes informadas por id no BKO até existir o seletor do Core.
- Ranking: participam os perfis de `perfis_ranking` (padrão vendedor e promotor); o aluno vê o ranking do tenant inteiro (RN-TRE-03).
- Painel: público = pessoas ativas do escopo que estão no público de alguma trilha publicada; trilhas em rascunho ficam fora.
- Desafio de vendas (consumo de `vendedor.pedido.faturado@1`) fica para quando existir `desafio_vendas` no banco (backlog).
