# Dicionário de dados — schema `treinamento`

Migração: `db/migrations/0017_treinamento.up.sql` (T-0058; volta = `0017_treinamento.down.sql`, `drop schema treinamento
cascade` — apaga trilhas, progresso, XP, medalhas e desafios; a licença em `plataforma.tenant_modulo` fica). Pedidos de origem:
R-20261102-131733-modulo-treinamento (T-0058, PR #42) e R-20261031-105033 / R-20261102-083826-modulo-treinamento (T-0011:
desafio de vendas e público-alvo). Regras: `docs/modulos/treinamento/regras.md`; rotas e repositório:
`docs/modulos/treinamento/api-e-telas.md` §4.

Campos comuns (`id`, `tenant_id`, `created_at`, `updated_at`, `deleted_at`, `external_id`), RLS forçado (`isolamento_tenant`)
e índice de sync `(tenant_id, updated_at, id)` em **todas** as 14 tabelas, como em [plataforma.md](plataforma.md).

**Fronteira**: nenhuma FK para outro schema. `usuario_id`, `autor_id`, `produto_id` e as equipes do público são validados
pela API com contratos do Core (o Treinamento não lê `core.*`). FKs só dentro do schema, compostas por tenant.
Os dados do aluno **não** têm FK para o conteúdo (o BKO pode regravar a árvore; os ids de conteúdo são estáveis).

**Listas fechadas** (fonte = código do Treinamento; `db/testes/treinamento.test.ts` compara): `trilha.status` =
`StatusTrilha` (`rascunho, publicada, arquivada`); `licao.tipo` = `TIPOS_LICAO` (`texto, video, pdf, link`);
`xp_lancamento.origem` = `ORIGENS_XP` (`licao, quiz, trilha, streak, desafio_vendas`); `trilha.publico_perfis` ⊆ `PERFIS`
do platform-sdk; `trilha_publicacao.acao` = `AcaoStatusTrilha` (`publicar, arquivar`). Mudar lista = migração nova.

## Conteúdo (BKO, RF-TRE-01) — pull como UMA linha `trilha` com a árvore inteira
Todo nó guarda `trilha_id` (desnormalizado, preso pela FK composta ao pai) e tem o gatilho `<tabela>_toca_trilha`
(`treinamento.tocar_trilha()`, SECURITY INVOKER): **inserir, alterar ou apagar qualquer nó sobe o `updated_at` da trilha**
para o `now()` da transação (uma vez por transação). `updated_at` de toda tabela com gatilho `definir_updated_at` = `now()`
do banco (o valor passado pela API é ignorado; leia de volta com `returning updated_at`).

| Tabela | Colunas de negócio | Regras / índices |
|---|---|---|
| `trilha` | `titulo` (1–200), `descricao` (≤ 2000), `status` (padrão `rascunho`), `obrigatoria` (false), `sequencial` (true), `prazo date` (data civil do tenant), `publico_perfis text[]` (⊆ PERFIS, ≤ 10), `publico_equipes uuid[]` (≤ 200, sem nulo), `publicada_em`, `arquivada_em` | `publicada` exige `publicada_em`; `arquivada` exige `arquivada_em`; `trilha_status_ix (tenant_id, status) where deleted_at is null`; `external_id` único por tenant |
| `modulo_trilha` | `trilha_id`, `ordem` (≥ 0), `titulo` (1–200), `pre_requisitos uuid[]` (ids de módulos, ≤ 100) | FK → `trilha`; `modulo_trilha_trilha_ix (tenant_id, trilha_id, ordem)` |
| `licao` | `trilha_id`, `modulo_id`, `ordem`, `titulo`, `tipo` (padrão `texto`), `texto` (≤ 20 000), `midia_url` (≤ 2000), `duracao_estimada_seg` (1–36 000, base do tempo mínimo RN-TRE-04), `pre_requisitos uuid[]` (ids de lições) | FK (tenant, trilha, módulo) → `modulo_trilha`; `licao_trilha_ix` |
| `quiz` | `trilha_id`, `licao_id` | **um quiz vivo por lição**: `quiz_licao_uk (tenant_id, licao_id) where deleted_at is null` |
| `questao` | `trilha_id`, `quiz_id`, `ordem`, `enunciado` (1–1000) | FK → `quiz` |
| `alternativa` | `trilha_id`, `questao_id`, `ordem`, `texto` (1–500), `correta` | FK → `questao`; "ao menos uma correta" é regra de publicação (API) |
| `trilha_publicacao` | `trilha_id`, `acao`, `de`, `para`, `autor_id`, `autor_nome`, `ocorrido_em`, `request_id` | **append-only** (só `select, insert`); `publicar` só de `rascunho` para `publicada`; `arquivar` de `rascunho`/`publicada` para `arquivada`; repetir sem mudar status não grava linha. A API também grava `plataforma.auditoria` (RN-AUD-01) |

**Público-alvo (RN-TRE-07)** fica nos arrays da `trilha` (forma do contrato `PublicoAlvoContrato` da T-0058): vazio = sem
restrição; perfis e equipes preenchidos = interseção; só um = esse. **Não há tabela `publico_alvo`** (pedida na T-0011):
seria uma segunda fonte do mesmo dado. Se o desafio de vendas precisar de público, entra com os mesmos dois arrays.

## Aluno (app) — append-only: a aplicação só lê e insere (UPDATE/DELETE = 42501)
| Tabela | Colunas | Chave natural (idempotência) e índices |
|---|---|---|
| `progresso` | `usuario_id`, `trilha_id`, `licao_id`, `concluida_em`, `tempo_gasto_seg` (≥ 0) | **`progresso_usuario_licao_uk (tenant_id, usuario_id, licao_id)`** (reenvio = `duplicado`); `progresso_usuario_sync_ix`; `progresso_trilha_ix (tenant_id, trilha_id, usuario_id)` (painel) |
| `tentativa` | `usuario_id`, `quiz_id`, `realizada_em`, `respostas jsonb` (array `[{questao_id, alternativa_ids}]`), `acertos`, `total_questoes`, `nota_pct numeric(5,2)` (0–100), `aprovada`, `primeira_tentativa`, `finalizada` (padrão true) | id = UUID do aparelho; `0 ≤ acertos ≤ total_questoes`; `tentativa_usuario_sync_ix`; `tentativa_usuario_quiz_ix (tenant_id, usuario_id, quiz_id, realizada_em)` (limite diário); `tentativa_quiz_ix` (painel) |
| `xp_lancamento` | `usuario_id`, `origem`, `referencia_id` (1–160 desde a 0044; 1–128 na 0017), `pontos`, `pontos_base`, `limitado_pelo_teto`, `ocorrido_em`, `dia date` (civil do tenant) | **`xp_lancamento_chave_uk (tenant_id, usuario_id, origem, referencia_id)`** (RN-TRE-01/04/08; violação = `duplicado`; TOTAL, alvo do `on conflict`); `xp_lancamento_tenant_id_uk (tenant_id, id)` (0044); `0 ≤ pontos ≤ pontos_base`; `limitado_pelo_teto = (pontos < pontos_base)` (lançamento de 0 ponto vale); `xp_lancamento_usuario_dia_ix` (teto diário); `xp_lancamento_ranking_ix (tenant_id, dia) include (usuario_id, pontos)` (ranking semanal/mensal/acumulado) |
| `medalha_usuario` | `usuario_id`, `medalha_codigo` (`^[a-z0-9_]{1,60}$`), `conquistada_em` | **`medalha_usuario_uk (tenant_id, usuario_id, medalha_codigo)`** |

Desafio de vendas: `referencia_id` = `desafio_id:pedido_id:evento_id` (parcial) ou `desafio_id:pedido_id:total`. A
serialização dos tetos (diário e por desafio) é da API: `pg_advisory_xact_lock` por (tenant, usuário) na transação.

### Lançamento de XP (0044) — T-0106 (R-20261107-233051-modulo-treinamento)
Migração `0044_treinamento_xp_referencia`, só em `xp_lancamento`, sem tabela, índice, política nem grant novo:
- `xp_lancamento_referencia_tamanho` passa a `char_length(referencia_id) between 1 and 160` (3 UUIDs com `:` = 110).
- `xp_lancamento_tenant_id_uk unique (tenant_id, id)`: idempotência por id com o tenant (duplicado motivo ID; o PK `id` fica).
- A chave natural `xp_lancamento_chave_uk` fica **total**, não parcial em `deleted_at is null`: a tabela é append-only (o
  `macuxi_app` não grava `deleted_at`), então as duas barram o mesmo, e só a total serve ao
  `on conflict (tenant_id, usuario_id, origem, referencia_id) do nothing` do repositório (com a parcial: 42P10).
- Sem o índice `text_pattern_ops` pedido: sob RLS o `LIKE` não é leakproof e nunca vira Index Cond para o `macuxi_app`. O
  teto do desafio (`origem = 'desafio_vendas' and referencia_id like '<desafio_id>:%'`) entra por `xp_lancamento_chave_uk`
  com igualdade em (tenant, usuário, origem) e filtra o LIKE entre os lançamentos de desafio do usuário.
- "XP processado por usuário": sem tabela de controle nesta migração — a idempotência do evento já vem de
  `plataforma.evento_consumo` (ADR 0007) e da chave natural; se o modulo-treinamento precisar de um marcador por usuário, pede
  com colunas e consulta.
- Down: para com P0001 (e a contagem) se houver referência acima de 128; senão tira o único e volta o CHECK a 1..128.
- Testes: `db/testes/xp-referencia.test.ts` (128 e 160 entram, 161 e vazia = 23514, chave natural = 23505 e `on conflict`
  sem duplicar, mesmo id = 23505, plano do teto do desafio, vazamento, up/down com dados).
Níveis, streak, ranking e painel de adesão são **calculados** (domain) — sem tabela própria.

## Catálogos e desafio de vendas
| Tabela | Colunas | Regras |
|---|---|---|
| `medalha` | `codigo`, `nome` (1–200), `regra jsonb` (`{tipo: trilhas_concluidas\|nota_maxima\|sequencia_dias, ...}`), `ativa` | único `(tenant_id, codigo)` entre as vivas; sem linha = catálogo padrão do código (`MEDALHAS_PADRAO`) |
| `desafio_vendas` | `nome` (1–200), `ativo`, `vigencia_inicio`, `vigencia_fim` (≥ início), `xp_por_unidade` (> 0), `xp_max_por_pedido` (> 0), `xp_max_por_desafio` (≥ 0; **nulo = padrão do tenant**, 0 = sem teto) | `desafio_vendas_vigentes_ix (tenant_id, vigencia_inicio, vigencia_fim) where ativo and deleted_at is null` |
| `desafio_vendas_produto` | `desafio_id`, `produto_id` (sem FK: fronteira) | único `(tenant_id, desafio_id, produto_id)` entre os vivos; `(tenant_id, produto_id)`; mínimo de 1 produto por desafio = API |

## Repositório SQL (para o modulo-treinamento, `FabricaRepositorio` em `modules/treinamento/api`)
Tudo dentro de `ctx.comTenant` (RLS); nenhum `tenant_id` vindo de fora além do da transação.
- `travarAluno(u)`: `select pg_advisory_xact_lock(hashtextextended($tenant || ':' || $u, 0))`.
- `trilhas()` / `trilha(id)`: `trilha` + nós vivos `where trilha_id = any($ids) and deleted_at is null order by ordem`, montados na
  árvore do contrato (alternativas na ordem de `ordem`). Converter: `prazo::text`, `publico_perfis`/`publico_equipes` (arrays),
  instantes com `.toISOString()`.
- `inserirTrilha(t)`: insere a trilha e os nós (ids do BKO). `atualizarTrilha(t)`: `update trilha ...` e **troca a árvore**
  (apagar `alternativa → questao → quiz → licao → modulo_trilha` por `trilha_id` e reinserir, na mesma transação) — o
  `updated_at` da trilha sobe sozinho. Publicar/arquivar: `status`, `publicada_em`/`arquivada_em` e uma linha em `trilha_publicacao`.
- `trilhasDesde(p)`: `where (updated_at, id) > ($desde, $id) and updated_at < $ate order by updated_at, id` (inclui removidas;
  índice `trilha_sync_ix`).
- `estadoDoAluno(u)` / `linhasDoAluno(...)`: por `(tenant_id, usuario_id, updated_at, id)`.
- `gravarAtividade(u, e)`: `insert ... on conflict do nothing` com o alvo da chave natural (progresso:
  `(tenant_id, usuario_id, licao_id)`; xp: `(tenant_id, usuario_id, origem, referencia_id)`; medalha:
  `(tenant_id, usuario_id, medalha_codigo)`; tentativa: `(id)`); `respostas` com `JSON.stringify`; `nota_pct` volta como texto
  (`Number(...)`), `dia` como `dia::text`.
- `conclusoesDoTenant()` / `tentativasDoTenant()` / `lancamentosDoTenant()`: leitura do tenant (`deleted_at is null`).
- `usuarios()`: vem do Core (consulta pública), nunca de `core.*`.

## Base de demo (`db/seeds/demo/treinamento.ts`)
Licença `treinamento` ativa e liberada para os 7 perfis; trilhas "Visita que vende" (publicada, obrigatória, vendedor +
promotor, quiz de 3 questões), "Portfólio Sabor do Norte" (publicada, todo o tenant, quiz de 2) e "Gôndola perfeita"
(rascunho, promotor da Equipe Manaus); jornada de Lucas (115 XP, sequência de 3 dias até hoje, 2 medalhas), Camila (110 XP,
2 medalhas) e Joana (10 XP); desafio "Sabor do Norte" no mês corrente (açaí, suco de cupuaçu, farinha). Idempotente, só no
Postgres local, datas relativas ao "hoje" de Manaus e nunca no futuro.
**Ligar no `demo.ts`** (rodada local): `import { gravarTreinamentoDemo } from './treinamento';` e, em `carregarDemo`, logo antes de
`await admin.query('commit')`: `await gravarTreinamentoDemo(admin, { hoje: dados['core.rota'][0]!.data as string });` — e no
`db/testes/seed-demo.test.ts:271` esperar `modulos: [...MODULOS_DEMO, 'treinamento'].sort()`.

## Testes
`db/testes/treinamento.test.ts` (estático + Postgres: RLS entre A e B, unicidade/idempotência, append-only, checks, gatilho da
trilha, seed da demo e idempotência do seed). Fixture própria nos dois tenants: `db/testes/fixture-treinamento.ts`, carregada
pelo `globalSetup` logo depois da dois-tenants (cobre `vazamento.test.ts` e `tests/integracao/multitenant/*`).

## Pendências (rodada local do banco-dados)
1. **Espelho Drizzle** em `modules/treinamento/db/nuvem.ts` (as 14 tabelas) e incluir o schema em `db/testes/drizzle-x-banco.test.ts`;
   o `estatico.test.ts` libera o schema da comparação só enquanto o espelho não existir.
2. Mover a fixture de `db/testes/fixture-treinamento.ts` para `db/seeds/fixtures/dois-tenants.ts` (opcional).
3. Ligar o seed no `demo.ts` (linha acima).
