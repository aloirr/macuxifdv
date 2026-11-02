# Schema `pesquisa` — dicionário de dados (migração 0016)

Dono: `banco-dados`. Tarefa: T-0057 (pedido R-20261102-132021-modulo-pesquisa). Migração:
`db/migrations/0016_pesquisa.up.sql` / `.down.sql` (o down apaga o schema inteiro). Seed demo: `db/seeds/demo/pesquisa.ts`.
Dados da fixture dois-tenants: `db/testes/pesquisa-fixture.ts`. Testes: `db/testes/pesquisa.test.ts` (30 casos).

Regras gerais: toda tabela com `id`, `tenant_id`, `created_at`, `updated_at`, `deleted_at`, `external_id`; RLS ligado e
**forçado** com a política `isolamento_tenant` (`tenant_id = plataforma.tenant_atual()`); índice de sync
`(tenant_id, updated_at, id)`; único de `external_id` vivo por tenant; gatilho `definir_updated_at`. Nenhuma FK para
`core`/`vendedor`/... (fronteira, ADR 0012): só dentro do schema, `plataforma.tenant` e `plataforma.arquivo`.
Papéis: `macuxi_app` (abaixo); `macuxi_worker` sem privilégio (não há tarefa entre tenants).

## Tabelas

### `pesquisa.questionario` — cabeçalho estável (contrato `Questionario`)
| Coluna | Tipo | Regra |
|---|---|---|
| `criado_em` | timestamptz not null | instante de negócio do contrato |
| `arquivado_em` | timestamptz | null = ativo; `>= criado_em`. Ao mudar, o gatilho `questionario_arquivado_toca_versoes` toca `updated_at` das versões **publicadas** (RF-PES-05: descem de novo no pull com `arquivado_em`) |

`macuxi_app`: select, insert, update. Índices: `questionario_ativo_ix (tenant_id, criado_em desc) where arquivado_em is null and deleted_at is null`.

### `pesquisa.questionario_versao` — conteúdo que o respondente vê (contrato `QuestionarioVersao`)
| Coluna | Tipo | Regra |
|---|---|---|
| `questionario_id` | uuid not null | FK composta `(tenant_id, questionario_id)` → `questionario` |
| `numero` | integer | `>= 1`; único por questionário (`questionario_versao_numero_uk`) |
| `status` | text | `rascunho` \| `publicada` (= `STATUS_VERSAO`) |
| `titulo` / `descricao` | text | 1–200 / até 1000 caracteres |
| `modo` | text | `avulsa` \| `checkout_obrigatoria` (= `MODOS`) |
| `frequencia` | text | `uma_vez_por_cliente` \| `a_cada_visita` \| `semanal` \| `mensal` (= `FREQUENCIAS`) |
| `publico_alvo` | jsonb objeto | `PublicoAlvo` do contrato, como está |
| `vigencia_inicio` / `vigencia_fim` | timestamptz | UTC, ambos inclusivos; fim null = sem prazo; fim `>=` início |
| `perguntas` / `regras` | jsonb lista | `Pergunta[]` (9 tipos) e `RegraCondicional[]` do contrato, como estão |
| `criada_em`, `publicada_em`, `publicada_por` | timestamptz, timestamptz, uuid | publicada ⇒ `publicada_em`, `publicada_por` e ≥ 1 pergunta; rascunho ⇒ ambos nulos |

RN-PES-01 no banco: **publicada é imutável** (gatilho `questionario_versao_publicada_imutavel`, SQLSTATE `23514`,
mensagem com "RN-PES-01"; só `updated_at` e `deleted_at` mudam) e **no máximo um rascunho vivo** por questionário
(`questionario_versao_rascunho_uk`, `23505`). Publicar = `update ... set status = 'publicada', publicada_em, publicada_por`
no rascunho. `macuxi_app`: select, insert, update (sem delete).

### `pesquisa.resposta` — contrato `RespostaPesquisa` (só inserção)
| Coluna | Tipo | Regra |
|---|---|---|
| `id` | uuid | UUID do aparelho (idempotência do push, RF-PES-04) |
| `questionario_id`, `versao_id` | uuid not null | FK `(tenant_id, questionario_id, versao_id)` → versão **do mesmo questionário** (`23503`); a versão precisa estar **publicada** (gatilho `resposta_versao_publicada`, `23514`) |
| `usuario_id`, `equipe_id`, `cliente_id`, `visita_id` | uuid | sem FK (fronteira); equipe/cliente/visita podem ser nulos |
| `respondida_em` / `recebida_em` | timestamptz | hora do aparelho / do servidor (RN-PES-04) |
| `suspeita`, `motivos_suspeita` | boolean, text[] | motivos ⊂ {`RELOGIO_ADIANTADO`, `ANTES_DA_VIGENCIA`, `APOS_A_VIGENCIA`}; motivo ⇒ suspeita |
| `itens` | jsonb lista (≥ 1) | `ItemResposta[]` do contrato — fonte da verdade da resposta |

`macuxi_app`: **só select e insert** (sem update/delete). Índices: `resposta_questionario_ix (tenant_id, questionario_id, respondida_em desc)`,
`resposta_versao_ix`, `resposta_cliente_ix (tenant_id, cliente_id, questionario_id, respondida_em desc) where cliente_id is not null`
(frequência, RN-PES-02), `resposta_usuario_ix (tenant_id, usuario_id, respondida_em desc)`, `resposta_visita_ix`.

### `pesquisa.resposta_item` — valor normalizado por pergunta (resultados por SQL)
Escrita **só pelo gatilho** `resposta_normalizar` (AFTER INSERT na resposta); id = `plataforma.uuid_de_chave('<resposta_id>:pesquisa.resposta_item:<pergunta_id>')`.
Único `(tenant_id, resposta_id, pergunta_id)`. Coluna por tipo: `sim_nao` → `valor_bool`; `numero`/`escala` → `valor_num`;
`foto` → `valor_num` = quantidade de fotos; `texto` → `valor_texto`; `codigo_barras` → `valor_texto` (o código);
`data` → `valor_data`; `unica` → `opcao_ids` (1 elemento); `multipla` → `opcao_ids`. Índice `(tenant_id, pergunta_id)`.
`macuxi_app`: select, insert (o insert é o do gatilho, que roda com a RLS do contexto).

### `pesquisa.resposta_foto` — uma linha por foto (galeria)
Escrita **só pelo gatilho**; id = `uuid_de_chave('<resposta_id>:pesquisa.resposta_foto:<foto.id>')`; `arquivo_id = foto.id`, FK
`(tenant_id, arquivo_id)` → `plataforma.arquivo` (adiável, inicialmente imediata, como `core.visita.foto_fachada_id`).
A API já registra o arquivo (`tx.registrarArquivo`, finalidade `pesquisa_foto`) **antes** de inserir a resposta: sem a linha do
arquivo, a resposta inteira é recusada (`23503`). Colunas: `pergunta_id`, `capturada_em`, `largura_px`, `altura_px`.

Auditoria de publicação e arquivamento: `plataforma.auditoria` (`tx.auditar` da API, RN-AUD-01). Licença: `plataforma.tenant_modulo`
com `modulo = 'pesquisa'` (o seed demo ativa).

## Consultas do repositório SQL (troca do `criarRepositorioEmMemoria`)
Tudo dentro de `ctx.comTenant` (RLS; nunca filtre só por `tenant_id` na mão). Instantes de cursor com microssegundos, como o
Catálogo (`modules/catalogo/api/repositorio-postgres.ts`): `to_char(x at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`.
Linha → contrato: `vigencia = { inicio: vigencia_inicio, fim: vigencia_fim }`; `descricao` nula vira ausente; `motivos_suspeita` é array.

| Método | SQL (resumo) |
|---|---|
| `listarQuestionarios` | `select q.*, (select count(*) from pesquisa.resposta r where r.questionario_id = q.id and r.deleted_at is null) as respostas from pesquisa.questionario q where q.deleted_at is null` + versões por `questionario_id in (...)` ordenadas por `numero`; `atualizado_em` = maior `updated_at` (questionário e versões) |
| `carregar(id)` | questionário por id (vivo) + versões `order by numero`; nenhuma linha = `null` |
| `criarQuestionario(q, v1, agora)` | `insert into pesquisa.questionario (id, tenant_id, criado_em, arquivado_em)` + `insert into pesquisa.questionario_versao (...)` na mesma transação |
| `gravarVersao(v, agora)` | `insert ... on conflict (id) do update set <conteúdo>` — o banco recusa se a existente for publicada (`23514`, RN-PES-01) e se já houver outro rascunho (`23505`) |
| `arquivar(id, agora)` | `update pesquisa.questionario set arquivado_em = $2 where id = $1 and arquivado_em is null` — o gatilho toca as versões publicadas (não precisa de update nelas) |
| `contarRespostas(qid)` | `select count(*) from pesquisa.resposta where questionario_id = $1 and deleted_at is null` |
| `obterResposta(id)` | `select ... from pesquisa.resposta where id = $1` |
| `inserirResposta(r, agora)` | `insert into pesquisa.resposta (...) values (...)` — itens/fotos saem do gatilho; `23505` no id = já existe (o domain já tratou duplicada/conflito antes) |
| `listarRespostas(qid)` | `select ... from pesquisa.resposta where questionario_id = $1 and deleted_at is null order by respondida_em desc` (índice `resposta_questionario_ix`) |
| `puxarVersoes(janela)` | `select v.*, q.arquivado_em, q.criado_em as questionario_criado_em from pesquisa.questionario_versao v join pesquisa.questionario q on q.tenant_id = v.tenant_id and q.id = v.questionario_id where v.status = 'publicada' and ($1::timestamptz is null or (v.updated_at, v.id) > ($1, $2::uuid)) and v.updated_at < $3 order by v.updated_at, v.id limit $4` |
| `puxarRespostas(janela, noEscopo)` | mesmo cursor em `pesquisa.resposta` (índice `resposta_sync_ix`), colunas do resumo `RespostaPesquisaSync`; o filtro `noEscopo` (usuário/carteira) continua no código. Volume alto: filtre por `usuario_id = any($5) or cliente_id = any($6)` quando o escopo couber num array |

Resultados por SQL (opcional, quando o volume pedir): `resposta_item` agrega por `pergunta_id` (contagem por `opcao_ids`,
média de `valor_num`, `valor_bool`), `resposta_foto` é a galeria.

## Integração no `main` (banco-dados local, depois da 0013–0015)
O PR da nuvem só traz arquivos novos; estes ajustes nos arquivos centrais foram provados numa cópia (suíte do `db` inteira
verde, menos a lista "down passo a passo", que depende dos nomes reais da 0013–0015):
1. `db/seeds/fixtures/dois-tenants.ts`: `import { gravarPesquisaDoisTenants } from '../../testes/pesquisa-fixture';` e, em
   `carregarDoisTenants`, antes do `commit`: `await gravarPesquisaDoisTenants(admin, { agora: opcoes.agora });`
   (sugestão: mover `db/testes/pesquisa-fixture.ts` para `db/seeds/fixtures/pesquisa.ts` no mesmo commit).
2. `db/seeds/demo/demo.ts`: `import { gravarPesquisaDemo } from './pesquisa';` e, em `carregarDemo`, antes do `commit`:
   `await gravarPesquisaDemo(admin, { hoje: dados['core.rota'][0]!.data as string });`
3. `db/testes/seed-demo.test.ts:271`: `modulos: [...MODULOS_DEMO, 'pesquisa'].sort()`.
4. `db/testes/estatico.test.ts`: `'0016_pesquisa'` na lista de migrações; as 5 tabelas `pesquisa.*` na lista de tabelas;
   `import * as nuvemPesquisa from '../../modules/pesquisa/db/nuvem'` em `tabelasDrizzle()`; e no teste "cobre toda tabela
   com tenant_id" somar `ORDEM_PESQUISA_FIXTURE`/`dadosPesquisaDoisTenants()` e ignorar `pesquisa.resposta_item` e
   `pesquisa.resposta_foto` (geradas pelo gatilho).
5. `db/testes/migracoes.test.ts`: acrescentar `'0016_pesquisa'` (e a 0013–0015) nas listas de up/down e somar 4 nos `passos`.
6. `modules/pesquisa/db/nuvem.ts` (espelho Drizzle, exigido pelo teste "toda tabela da migração tem espelho em Drizzle"):

```ts
import { boolean, date, integer, jsonb, numeric, pgSchema, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { TIPOS_PERGUNTA } from '../contracts/pergunta';
import { FREQUENCIAS, MODOS } from '../contracts/publico';
import { STATUS_VERSAO } from '../contracts/questionario';

export const pesquisa = pgSchema('pesquisa');
const comuns = () => ({
  id: uuid('id').primaryKey().defaultRandom(),
  tenant_id: uuid('tenant_id').notNull(),
  created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updated_at: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  deleted_at: timestamp('deleted_at', { withTimezone: true }),
  external_id: text('external_id'),
});
export const questionario = pesquisa.table('questionario', {
  ...comuns(),
  criado_em: timestamp('criado_em', { withTimezone: true }).notNull().defaultNow(),
  arquivado_em: timestamp('arquivado_em', { withTimezone: true }),
});
export const questionarioVersao = pesquisa.table('questionario_versao', {
  ...comuns(),
  questionario_id: uuid('questionario_id').notNull(),
  numero: integer('numero').notNull(),
  status: text('status', { enum: STATUS_VERSAO }).notNull().default('rascunho'),
  titulo: text('titulo').notNull(),
  descricao: text('descricao'),
  modo: text('modo', { enum: MODOS }).notNull().default('avulsa'),
  frequencia: text('frequencia', { enum: FREQUENCIAS }).notNull().default('a_cada_visita'),
  publico_alvo: jsonb('publico_alvo').notNull().default({}),
  vigencia_inicio: timestamp('vigencia_inicio', { withTimezone: true }).notNull(),
  vigencia_fim: timestamp('vigencia_fim', { withTimezone: true }),
  perguntas: jsonb('perguntas').notNull().default([]),
  regras: jsonb('regras').notNull().default([]),
  criada_em: timestamp('criada_em', { withTimezone: true }).notNull().defaultNow(),
  publicada_em: timestamp('publicada_em', { withTimezone: true }),
  publicada_por: uuid('publicada_por'),
});
export const resposta = pesquisa.table('resposta', {
  ...comuns(),
  questionario_id: uuid('questionario_id').notNull(),
  versao_id: uuid('versao_id').notNull(),
  usuario_id: uuid('usuario_id').notNull(),
  equipe_id: uuid('equipe_id'),
  cliente_id: uuid('cliente_id'),
  visita_id: uuid('visita_id'),
  respondida_em: timestamp('respondida_em', { withTimezone: true }).notNull(),
  recebida_em: timestamp('recebida_em', { withTimezone: true }).notNull().defaultNow(),
  suspeita: boolean('suspeita').notNull().default(false),
  motivos_suspeita: text('motivos_suspeita').array().notNull().default([]),
  itens: jsonb('itens').notNull(),
});
export const respostaItem = pesquisa.table('resposta_item', {
  ...comuns(),
  resposta_id: uuid('resposta_id').notNull(),
  pergunta_id: uuid('pergunta_id').notNull(),
  tipo: text('tipo', { enum: TIPOS_PERGUNTA }).notNull(),
  valor_bool: boolean('valor_bool'),
  valor_num: numeric('valor_num'),
  valor_texto: text('valor_texto'),
  valor_data: date('valor_data'),
  opcao_ids: uuid('opcao_ids').array(),
});
export const respostaFoto = pesquisa.table('resposta_foto', {
  ...comuns(),
  resposta_id: uuid('resposta_id').notNull(),
  pergunta_id: uuid('pergunta_id').notNull(),
  arquivo_id: uuid('arquivo_id').notNull(),
  capturada_em: timestamp('capturada_em', { withTimezone: true }).notNull(),
  largura_px: integer('largura_px'),
  altura_px: integer('altura_px'),
});
```

## Base demo
`gravarPesquisaDemo` (na transação do `carregarDemo`) ou `carregarPesquisaDemo` (sozinho, sobre a base demo já carregada):
licença `pesquisa` no tenant demo e nos perfis vendedor, promotor, supervisor, gerente, analista e admin;
**"Exposição do café no PDV"** (avulsa, semanal, vendedores e promotor: sim/não, única, número e foto opcional) com 16 respostas
dos últimos 10 dias (Lucas, Camila e Joana, em clientes da carteira deles **fora da rota de hoje**); **"Satisfação do cliente na
visita"** (etapa obrigatória do checkout, a cada visita, vendedores: escala 1–5, sim/não, texto), sem respostas — aparece no
checkout de toda visita da demo. Ambas v1 publicadas pelo analista (Paulo) há 14 dias, sem prazo. Rodar de novo não duplica e não
regrava versão publicada (RN-PES-01).
