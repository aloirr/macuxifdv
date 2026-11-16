# Dicionário de dados — schema `gestor` (módulo Gestor)

Migração: `db/migrations/0014_gestor.up.sql` (T-0055, frente nuvem; pedido R-20261102-131601-modulo-gestor, PR #40). Volta =
`.down.sql` (`drop schema gestor cascade`: apaga projeção, idempotência, alertas e ajustes; refazer o up recria tudo vazio,
a projeção se refaz com os eventos novos e os alertas na próxima leitura). Drizzle: `modules/gestor/db/nuvem.ts` (uso interno
do Gestor). Achatamento puro do `EstadoProjecao`: `modules/gestor/db/projecao.ts`. Testes: `db/testes/gestor.test.ts`.
Seed da demo: `db/seeds/demo/gestor.ts`. Fixture dois-tenants: `db/seeds/fixtures/gestor.ts` (grupos de id `0x70`–`0x73`).

**Dependência de numeração:** o executor (`db/src/migrador.ts`) recusa buraco na numeração. A `0014` só sobe com a `0013`
(Catálogo, outra frente) já na pasta; até lá, o CI do branch da 0014 fica vermelho no `lerMigracoes` por esse motivo.

Campos comuns (`id`, `tenant_id`, `created_at`, `updated_at`, `deleted_at`, `external_id`), RLS forçado (`isolamento_tenant`
por `plataforma.tenant_atual()`), gatilho de `updated_at`, índice `(tenant_id, updated_at, id)` e `external_id` único por
tenant em todas as 4 tabelas, como em [plataforma.md](plataforma.md). Grants: `macuxi_app` select/insert/update/delete nas 4;
**nenhum** grant ao `macuxi_worker` e **nenhuma** função SECURITY DEFINER (o teste de conformidade de `tests/` só aceita as
funções revisadas).
**Nada vai ao aparelho por sync de tabela**: o app Gestão lê `/v1/gestor` e guarda o cache do módulo (`mod:gestor:`).
**Fronteira**: nenhuma FK para outro schema (`alvo_id`, `responsavel_id`, `usuario_id` são ids dos contratos).

## 1. Tabelas

| Tabela | Para quê | Chave natural (unicidade) | Índices de consulta |
|---|---|---|---|
| `evento_aplicado` | idempotência do consumidor (`processados` do EstadoProjecao) | `unique (tenant_id, evento_id)` | `(tenant_id, created_at)` (retenção) |
| `projecao_fato` | EstadoProjecao achatado: um fato por tabela/chave | `unique (tenant_id, tabela, chave)` | `(tenant_id, tabela, ocorrido_em)` período; `(tenant_id, usuario_id, tabela)` pessoa |
| `alerta` | contrato `Alerta` (RF-GES-07) | **um vivo por chave**: `unique (tenant_id, chave) where status <> 'encerrado' and deleted_at is null` | `(tenant_id, status)`; `(tenant_id, responsavel_id)` |
| `alerta_regra` | `AjustesRegras` (ajuste parcial por tipo; sem linha = padrão) | `unique (tenant_id, tipo)` | — (≤ 6 linhas/tenant) |

### `evento_aplicado`
`evento_id text` (envelope do platform-sdk; não vazio), `nome text` (formato `<modulo>.<entidade>.<fato>@vN`),
`ocorrido_em timestamptz`. Retenção: 120 dias, feita pela **API do Gestor na transação do tenant** (RLS):
`delete from gestor.evento_aplicado where created_at < $agora - interval '120 days'` (índice `evento_aplicado_retencao_ix`;
`$agora` = `ctx.agora()`), por exemplo no fim de `aplicar` ou num job diário. As chaves de negócio da projeção protegem a
reentrega tardia depois do expurgo. Expurgo de todos os tenants pelo worker, se preciso, vem em migração própria com revisão.

### `projecao_fato`
| Coluna | Tipo | Conteúdo |
|---|---|---|
| `tabela` | text | chave do `EstadoProjecao`: `clientes, carteira_pendente, entradas_carteira, planejadas, metas, pedidos, aprovacoes, visitas, visitas_loja, gondolas, shares, precos, rupturas, tarefas, respostas, licoes, medalhas` (CHECK = `TABELAS_PROJECAO`) |
| `chave` | text | chave do fato na tabela (pedido_id, visita_id, `<usuario_id>|<AAAA-MM-DD>`, `<cliente_id>|<vendedor_id>`...) |
| `dados` | jsonb | o valor do fato **exatamente como o domain guarda** (objeto com `v`; texto em `carteira_pendente`/`entradas_carteira`) |
| `carimbo` | text | maior `v` do fato (`"<ms 15 dígitos>|<evento_id>"`, ordena como texto); `''` quando não há |
| `ocorrido_em` | timestamptz null | instante principal (pedido: `criado_em`; visita: `checkin_em`; aprovação: `solicitada_em`...) |
| `usuario_id` | uuid null | dono do fato (vendedor do cliente/pedido, usuário da visita, promotor) |

### `alerta`
Colunas do contrato `Alerta`: `chave` (`<tipo>:<alvo_id>`), `tipo` (= `TIPOS_ALERTA`), `alvo_tipo` (= `ALVOS_ALERTA`),
`alvo_id uuid`, `responsavel_id uuid null`, `valor`/`limiar double precision null` (chegam ao Node como `number`),
`severidade` (= `SEVERIDADES`), `mensagem`, `status` (= `STATUS_ALERTA`, padrão `aberto`), `aberto_em`, `encerrado_em`,
`motivo_encerramento` (= `MOTIVOS_ENCERRAMENTO`). Coerência (CHECK): `status = 'encerrado'` ⇔ `encerrado_em` preenchido;
motivo só em encerrado. Dispensado continua **vivo** (não reabre enquanto a condição persiste); encerrado libera a chave.

### `alerta_regra`
`tipo` (= `TIPOS_ALERTA`), `ajuste jsonb` (objeto; `AjusteRegraAlerta`: `ativa`, `limiar`, `janela_dias`, `amostra_min`,
`severidade`, todos opcionais), `atualizado_por_id uuid null` (quem gravou pelo BKO; a auditoria continua na plataforma).

## 2. EstadoProjecao ⇄ linhas
`modules/gestor/db/projecao.ts` (puro, testado ida e volta em `db/testes/gestor.test.ts`):
- `achatarEstado(estado)` → `FatoProjecao[]` (`tabela, chave, carimbo, dados, ocorrido_em, usuario_id`), uma linha por chave;
- `montarEstado(linhas, eventosAplicados)` → `EstadoProjecao` (`linhas` = `select tabela, chave, dados from gestor.projecao_fato`,
  `eventosAplicados` = `select evento_id from gestor.evento_aplicado`).

## 3. Fábrica SQL do `RepositorioGestor` (para o modulo-gestor)
Tudo na transação do tenant (`AcessoTenant.db`, RLS), nunca com tenant do corpo.
- **`estado(a)`**: `select tabela, chave, dados from gestor.projecao_fato where deleted_at is null` +
  `select evento_id from gestor.evento_aplicado` → `montarEstado`.
- **`aplicar(a, eventos)`**: `select pg_advisory_xact_lock(hashtext('gestor:' || $tenant))` (serializa os consumidores do mesmo
  tenant) → `estado(a)` → `aplicarEventos` → para cada evento `aplicado`:
  `insert into gestor.evento_aplicado (tenant_id, evento_id, nome, ocorrido_em) values (...) on conflict (tenant_id, evento_id) do nothing`;
  para cada fato que mudou (compare `achatarEstado` antes/depois por `tabela|chave`):
  `insert into gestor.projecao_fato (tenant_id, tabela, chave, carimbo, dados, ocorrido_em, usuario_id) values (...)
  on conflict (tenant_id, tabela, chave) do update set carimbo = excluded.carimbo, dados = excluded.dados, ocorrido_em = excluded.ocorrido_em, usuario_id = excluded.usuario_id, deleted_at = null`.
  Quem decide o vencedor é o domain (carimbo, histórico por `evento_id`); o lock evita duas transações sobrescreverem uma à outra.
- **`alertas(a)`**: `select ... from gestor.alerta where deleted_at is null` (filtrar `status <> 'encerrado'` quando só os vivos interessam).
- **`aplicarOperacoesAlerta(a, ops, o)`**: na ordem `encerrar` → `atualizar` → `abrir` (o encerrado libera a chave antes do novo):
  `update ... set status = 'encerrado', encerrado_em = $, motivo_encerramento = $ where id = $`;
  `update ... set valor, mensagem, severidade where id = $`; `insert ... (id = o.novoId(), status 'aberto', aberto_em = o.agora)`.
  Violação `23505` em `alerta_vivo_uk` = outra transação abriu a mesma chave: releia e reconcilie (ou use o mesmo advisory lock).
- **`gravarAlerta(a, alerta)`**: `update gestor.alerta set status, encerrado_em, motivo_encerramento, valor, mensagem, severidade where id = $`.
- **`ajustesRegras(a)`**: `select tipo, ajuste from gestor.alerta_regra where deleted_at is null` → `{ [tipo]: ajuste }`.
- **`gravarAjustesRegras(a, ajustes)`**: por tipo, `insert ... on conflict (tenant_id, tipo) do update set ajuste = excluded.ajuste, atualizado_por_id = excluded.atualizado_por_id`;
  tipo ausente no objeto = `delete` (ou `ajuste = '{}'`).
- Drizzle (opcional): `eventoAplicado`, `projecaoFato`, `alerta`, `alertaRegra` de `modules/gestor/db/nuvem.ts`.

## 4. Base de demo
`carregarDemoGestor(admin, dados)` (`db/seeds/demo/gestor.ts`), na transação de `carregarDemo`:
licença `gestor` no tenant demo + `perfil_modulo` para supervisor (Renata), gerente (Marcelo), analista (Paulo) e admin
(Sérgio); projeção montada pelo próprio domain do Gestor com os eventos equivalentes aos dados da demo (carteira dos 30
clientes de Manaus — supermercado/atacarejo semanal, o resto quinzenal —, visitas, rotas de hoje, metas de venda do mês,
pedidos com a linha do tempo e as aprovações pendentes com o crédito do cliente). Alertas e regras não são semeados
(reconciliação na leitura; regra sem ajuste = padrão). Upsert pelas chaves naturais (idempotente).

## 0084 — tipos de alerta de produtividade (`0084_core_almoco_gestor_alerta_produtividade`; T-0180, D3/D4)
`alerta_tipo_valido` (gestor.alerta) passa a aceitar também `parado_entre_visitas` e `sem_checkin_inicio`, os únicos alertas
de produtividade que vão ao gestor (sem push; só a lista de Alertas). `alerta_regra_tipo_valido` **não muda**: as regras de
produtividade ficam no parâmetro `alertas.produtividade` do Core (JSON validado por Zod), sem linha em `gestor.alerta_regra`.
"Um aberto por pessoa" (D4) usa o índice `alerta_vivo_uk` de sempre: os dois tipos usam a MESMA chave por pessoa (sugestão:
`produtividade:<usuario_id>`, definida pelo domain do Gestor) e o mais novo encerra o anterior na mesma transação. Volta: o down **apaga** os alertas dos 2 tipos (derivados; a
avaliação os recria) e devolve o CHECK da 0014. Teste: `db/testes/almoco-alerta-produtividade.db.test.ts`.
