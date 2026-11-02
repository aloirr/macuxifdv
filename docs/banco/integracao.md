# Dicionário de dados — schema `integracao` (Hub de Integração)

Migração: `db/migrations/0010_integracao.up.sql` (T-0032; volta = `.down.sql`, `drop schema integracao cascade`: apaga
Conectores, chaves, lotes, espelho, fila do ERP e trilhas; depois de um novo up cada Conector precisa de cadastro e chave
nova). Retenção da outbox: `0011_plataforma_outbox_retencao` ([plataforma.md](plataforma.md)). `pg_temp` no fim do
`search_path` das funções SECURITY DEFINER: `0012_search_path_pg_temp` (T-0042). Drizzle:
`modules/integracao/db/nuvem.ts` (uso interno da Integração). Origem: spec R-20261101-013336-banco-dados (revisão do banco da
T-0025) renumerada, desenho `docs/desenho/T-0032.md` §8, ADR 0013, campos de negócio em `docs/modulos/integracao/hub-api.md`
§17b; acréscimos da T-0027 (entidades por Conector, ids inválidos por sessão, `external_id` ≤ 200) e da T-0031 (auditoria
das decisões, erros de retorno, `decidida_por_perfil`).

Campos comuns (`id`, `tenant_id`, `created_at`, `updated_at`, `deleted_at`, `external_id`), RLS forçado (`isolamento_tenant`)
e gatilho de `updated_at` como em [plataforma.md](plataforma.md) — **exceto** `inativacao_auditoria` (sem gatilho:
append-only). **Todas fora do sync** (`TABELAS_FORA_DO_SYNC`): nada daqui vai ao aparelho; o que o app vê chega pelos
eventos `integracao.<entidade>.atualizado@1`. Tudo `timestamptz` em UTC; `alterado_em` e o cursor em milissegundos
(`timestamptz(3)`).

**Fronteira**: nenhuma FK para schema de módulo. FKs compostas `(tenant_id, x_id)` só dentro do schema (Conector, sessão,
lote, pendência, fila, retorno) e `tenant_id → plataforma.tenant`. O pedido chega pelo evento `vendedor.pedido.aprovado@1`
(o Hub não lê `vendedor.*`).

**Listas fechadas** (fonte da verdade = contratos da Integração; `db/testes/estatico.test.ts` compara): `entidade` e
`conector.entidades` = `ENTIDADES` (`vendedor, cliente, produto, preco, estoque, titulo, nota, rota`); `lote.modo` =
`ModoCarga`; `lote.status` = `ESTADOS_LOTE`; `lote_linha_erro.codigo` = `CODIGOS_ERRO_LINHA`; `conector.tipo` =
`TIPOS_CONECTOR`; `pendencia_inativacao.estado` = `ESTADOS_PENDENCIA_INATIVACAO`; `mapeamento.tipo` = `TIPOS_MAPEAMENTO`;
`pedido_fila_erp.estado` = `ESTADOS_PEDIDO_ERP`; `pedido_retorno(.erro).status` = `StatusRetornoErp`;
`pedido_retorno_erro.codigo/codigos` = `CODIGOS_ITEM_DESCARTADO` **+ `sequencia_repetida`** (decisão do gerente
R-20261101-160012: sequência repetida em `itens_faturados` vira descarte; o contrato ganha o código na onda 2). Mudar uma
lista é migração nova.

**`external_id` do ERP até 200** (`EXTERNAL_ID_MAX`, T-0027; check `char_length between 1 and 200`): `registro_atual`,
`sessao_carga_recebido` (obrigatório nas duas), `lote_linha_erro` (nulo = ilegível), `cursor_entidade.cursor_external_id`,
`pedido_retorno_erro.produto_external_id`.

**Grants ao `macuxi_app`** (mínimo): `select, insert, update` em quase todas; `delete` só em `lote_staging`,
`lote_linha_erro`, `sessao_carga_recebido` e `mapeamento`; **só `select, insert`** em `inativacao_auditoria` (append-only) e
`pedido_retorno` (trilha). Remoção de Conector, chave, fila e registro = `deleted_at`/`revogada_em`, nunca DELETE.

## Funções
| Função | Quem chama | O que faz |
|---|---|---|
| `integracao.autenticar_chave(p_hash text)` | `macuxi_app` (só ele; `revoke from public`) | **Única leitura sem tenant** (ADR 0013 §3, etapa 3). `stable security definer`, `search_path = pg_catalog, integracao, pg_temp` (0012). Devolve **no máximo 1 linha**: `credencial_id, tenant_id, conector_id, prefixo, escopo, papel, versao_pepper, criada_em, expira_em, anterior_valida_ate, revogada_em, ultimo_uso_em, conector_identificador, conector_tipo, conector_ativo, ips_permitidos (inet[]), recebe_pedidos, entidades (text[])` — **nunca o hash**. Credencial ou Conector com `deleted_at` = nenhuma linha. Não decide nada (revogada, expirada, convivência, inativo e IP são do `avaliarChaveConector`). Busca pelo índice único `credencial_hash_uk` (meta p95 < 50 ms) |
| `integracao.expurgar_retencao(p_agora timestamptz default now(), p_limite int default 5000)` | `macuxi_worker` (só ele) | Retenção do Hub em blocos de até `p_limite` por item; devolve `(item, quantidade)`: `lote` concluído/falhou recebido há > 12 meses (cascata em `lote_staging` e `lote_linha_erro`), `credencial` revogada há > 12 meses, `lote_linha_erro.payload` > 30 dias, `lote_staging.corpo` 7 dias após concluído (30 em `falhou`), `sessao_carga_recebido` de sessão fechada há > 7 dias sem pendência aguardando válida, `registro_atual.payload` 30 dias após inativado. `search_path = pg_catalog, integracao, pg_temp` (0012). Agendamento: engenheiro-software (mesmo worker da outbox) |
| `integracao.sem_repeticao(text[])` | CHECK de `conector.entidades` | imutável; `true` se não há valor repetido |

Premissa (como `plataforma.tenant_por_codigo`, [rls.md](rls.md)): o dono das funções é superusuário ou tem `BYPASSRLS`.

**`pg_temp` por último** (0012, T-0042; recomendação da revisão R-20261101-172531): sem ele explícito, o Postgres procura o
schema temporário da sessão **antes** dos listados, e um papel com TEMP poderia sombrear um nome não qualificado com
objeto próprio rodando com os privilégios do dono. As 4 funções SECURITY DEFINER do banco (`plataforma.tenant_por_codigo`,
`integracao.autenticar_chave`, `integracao.expurgar_retencao`, `plataforma.expurgar_outbox`) ficam com
`search_path = pg_catalog, <schema>, pg_temp`. **Função SECURITY DEFINER nova já nasce assim** (`estatico.test.ts` confere
que toda SECURITY DEFINER das migrações está na lista da 0012 ou numa migração posterior com `pg_temp`).

## Escritas-guarda (a API usa; `db/testes/t0032.test.ts` exercita)
- **Upsert monotônico do registro** (🔴 V1, RN-INT-06): `insert into integracao.registro_atual as r (...) values (...) on conflict
  (tenant_id, entidade, external_id) do update set hash = excluded.hash, payload = excluded.payload, alterado_em =
  excluded.alterado_em, ... where excluded.alterado_em >= r.alterado_em returning (xmax = 0) as nova` — 0 linhas = obsoleta.
  `visto_em`/`sessao_id` da linha obsoleta: `update` à parte (a linha foi vista na sessão).
- **Cursor monotônico**: `insert into integracao.cursor_entidade as c (...) on conflict (tenant_id, conector_id, entidade) do
  update set ... where (c.cursor_alterado_em, c.cursor_external_id) < (excluded.cursor_alterado_em, excluded.cursor_external_id)`
  (collation "C": `'PRD-2' < 'prd-0'`).
- **Decisão da pendência** (P-3): `update integracao.pendencia_inativacao set estado = 'confirmada'|'recusada', decidida_em,
  decidida_por, decidida_por_perfil, motivo_decisao where id = $1 and estado = 'aguardando' returning *` (0 linhas = decidida
  por outro) + `insert into integracao.inativacao_auditoria` **na mesma transação**.
- **Ids inválidos da sessão**: `insert into integracao.sessao_carga_recebido (tenant_id, sessao_id, external_id) ... on
  conflict (tenant_id, sessao_id, external_id) do nothing`; `update sessao_carga set linhas_sem_identificacao =
  linhas_sem_identificacao + $n, invalidas_omitidas = invalidas_omitidas + $m`.
- **Topologia** (RN-INT-13): sem constraint de array; a API faz `pg_advisory_xact_lock(hashtextextended('integracao.topologia:'
  || tenant, 0))` antes de ler os Conectores ativos. O banco guarda só o **P-7** (`conector_recebe_pedidos_uk`).
- **Poll de pedidos**: `select ... from integracao.pedido_fila_erp where tenant_id = $1 and estado = 'pendente' and
  retencao_codigo is null and deleted_at is null order by aprovado_em limit $2 for update skip locked`; retorno: `select ...
  for update` na linha antes de validar o saldo.
- **`ultimo_uso_em`** (no máximo 1×/min): `update integracao.credencial set ultimo_uso_em = now() where id = $1 and
  (ultimo_uso_em is null or ultimo_uso_em < now() - interval '1 minute')` (com o tenant da chave).

## conector
| Coluna | Tipo | Regra |
|---|---|---|
| identificador | text not null | `X-Macuxi-Conector-Id` / `hub.conectorId`; `^[A-Za-z0-9._-]{1,100}$`; **único entre os vivos do tenant** (`conector_identificador_uk`) |
| nome | text not null | 1..120 |
| tipo | text not null | `TIPOS_CONECTOR`; padrão `conector` |
| ativo | boolean not null | padrão `true`; desativar revoga as chaves (API) |
| recebe_pedidos | boolean not null | padrão `true` (como `ConectorCriar`); **P-7: no máximo um ativo com `recebe_pedidos` por tenant** (`conector_recebe_pedidos_uk`, parcial `recebe_pedidos and ativo and deleted_at is null`) |
| **entidades** | text[] not null | P-6/RN-INT-13: as que ESTE Conector alimenta; padrão as 8; não vazia, sem repetição, só `ENTIDADES` |
| ips_permitidos | inet[] not null | IP ou CIDR; vazio = qualquer IP; até 20; o `pg` devolve array de texto |
| versao_conector, versao_contrato | text | do sinal (≤ 40, ≤ 10) |
| ultimo_sinal_em, parado_por_versao, sinal_resumo (jsonb objeto), deriva_relogio_s | | sinal a cada minuto (fillfactor 90) |

## credencial
| Coluna | Tipo | Regra |
|---|---|---|
| conector_id | uuid not null | FK composta → `conector` |
| prefixo | text not null | `^[A-Za-z0-9_-]{4,12}$` (não é segredo) |
| hash_chave | text not null | **HMAC-SHA256(pepper, chave) em hex** (64, minúsculo); **único GLOBAL** (`credencial_hash_uk`, exceção nominal abaixo) |
| versao_pepper | smallint not null | ≥ 1 (troca de pepper sem invalidar tudo de uma vez) |
| escopo | text not null | padrão `integracao.v1` (`^[a-z][a-z0-9_]*\.v[1-9][0-9]*$`) |
| papel | text not null | `atual`\|`anterior`; **no máximo 1 de cada não revogada por Conector** (`credencial_papel_uk`) |
| expira_em, anterior_valida_ate, revogada_em, revogada_por (uuid), motivo_revogacao (≤ 200), ultimo_uso_em | | rotação nunca sobrescreve; `revogada_por` só com `revogada_em` |

**Exceção nominal à regra "todo índice único começa por `tenant_id`"** (S0-023 regra 5; a ÚNICA do banco):
`integracao.credencial_hash_uk` = `unique (hash_chave)`, global de propósito. `autenticar_chave` procura a chave **antes** de
se saber o tenant; com `(tenant_id, hash_chave)` a busca viraria varredura entre tenants. O risco que a regra cobre (A
descobre dado de B por colisão, ou fica impedido de cadastrar) não existe: o valor é HMAC-SHA256 com o pepper do servidor
sobre uma chave **gerada pelo servidor**; nenhum tenant escolhe o valor, a colisão é impraticável (2^-256) e o 23505 nunca
chega ao cliente. **Condição de validade: a exceção cai se o Hub passar a aceitar chave escolhida pelo cliente ("traga sua
chave")**; nesse caso o índice volta a `(tenant_id, hash_chave)` e a busca sem tenant precisa de outro desenho (ADR nova).
Registrada pelo nome em `tests/integracao/banco/conformidade.test.ts` (`INDICES_UNICOS_GLOBAIS`); revisão
R-20261101-172531-engenheiro-software (T-0032).

## politica_versao
`versao_minima`, `versao_recomendada` (text not null, semver `MAIOR.MENOR.PATCH[-pre]`), `mensagem` (≤ 300), `pacote` (jsonb
objeto). Uma viva por tenant (`politica_versao_tenant_uk`). Sem linha = sem política (RN-INT-11).

## sessao_carga
| Coluna | Tipo | Regra |
|---|---|---|
| sessao_uuid | uuid not null | o UUID que o Conector manda; único por `(tenant_id, conector_id, sessao_uuid)`. O `id` é do Hub |
| conector_id, entidade | | FK → conector; `ENTIDADES` |
| iniciada_em, ultima_parte (≥ 1), fechada_em | | `fechada_em` nulo **sse** `situacao = 'aberta'` |
| situacao | text not null | `aberta`\|`completa`\|`expirada` |
| inativadas | int not null | ≥ 0 |
| **linhas_sem_identificacao** | int not null default 0 | T-0027: linhas inválidas sem `external_id` legível (ou acima de 200) somadas por parte; > 0 = não inativa nada |
| **invalidas_omitidas** | int not null default 0 | T-0027: linhas inválidas que o Conector não detalhou; > 0 = não inativa nada |
Índice `(tenant_id, entidade, situacao)`.

## sessao_carga_recebido
`sessao_id` (FK → sessao_carga, **on delete cascade**), `external_id` (obrigatório, 1..200). Guarda só os ids **não
aplicados** (`idsDaSessaoNoLote(...).invalidos`: erros do Hub e linhas inválidas do Conector com id), que **nunca** são
inativados (RN-INT-06, 🔴 da T-0027). Único `(tenant_id, sessao_id, external_id)`. Expurgo 7 dias depois de a sessão fechar.

## lote
| Coluna | Tipo | Regra |
|---|---|---|
| conector_id, entidade, modo, versao_contrato | | FK; `ENTIDADES`; `completo`\|`delta`; ≤ 10 |
| sessao_id, sessao_parte (≥ 1), sessao_ultimo | | FK → sessao_carga; **obrigatório no completo e proibido no delta** |
| chave_idempotencia | text not null | `^[A-Za-z0-9._:-]{16,128}$`; **único por `(tenant_id, conector_id, chave_idempotencia)`** (RN-INT-12) |
| hash_conteudo | text not null | sha256 hex do conteúdo canônico (mesma chave + outro hash = 409) |
| status | text not null | `ESTADOS_LOTE`; padrão `recebido`; **um `processando` por Conector+entidade** (`lote_processando_uk`) |
| recebidas | int not null | ≥ 1 |
| duplicadas_no_lote, com_erro, novas, atualizadas, inalteradas, **obsoletas**, inativadas, invalidas_omitidas, tentativas, bytes | int not null | ≥ 0 (`obsoletas`: 🔴 V1) |
| aplicado_ate_indice | int | checkpoint da aplicação em blocos (nulo = nada aplicado) |
| cursor_declarado, cursor_resultante, avisos | jsonb | |
| versao_conector (≤ 40), ultimo_erro (≤ 1000, sem dado pessoal) | text | |
| recebido_em, iniciado_em, concluido_em | timestamptz | retenção 12 meses |
Índices: fila `(tenant_id, status, recebido_em) where status in ('recebido','processando')`; `(tenant_id, recebido_em desc)`;
`... where com_erro > 0`; `(tenant_id, conector_id, recebido_em desc)`; `(tenant_id, entidade, recebido_em desc)`;
`(tenant_id, sessao_id, sessao_parte, recebido_em desc) where sessao_id is not null`.

## lote_staging
`lote_id` (1:1 único, FK **on delete cascade**), `corpo jsonb compression lz4` (objeto `{ registros, linhas_invalidas }`, até
8 MiB). Anulado pelo expurgo.

## lote_linha_erro
`lote_id` (FK cascade), `indice` (≥ 0), `origem` (`hub`\|`conector`), `codigo` (`CODIGOS_ERRO_LINHA`), `campo` (≤ 100),
`mensagem` (1..1000, sem dado pessoal), `reprocessavel`, `payload` (jsonb, **só origem hub**; expurgo 30 dias), `resolvido_em`,
`resolvido_no_lote_id` (sem FK), **`external_id` = chave do ERP da linha** (nulo = ilegível; ≤ 200). Único `(tenant_id,
lote_id, origem, indice)`; índices `(tenant_id, codigo, resolvido_em)` e expurgo `(tenant_id, created_at) where payload is not
null`. Até 5.500 por lote.

## registro_atual
| Coluna | Tipo | Regra |
|---|---|---|
| entidade, **external_id** (not null, 1..200) | text | chave `(tenant_id, entidade, external_id)` — `registro_atual_chave_uk include (hash, alterado_em)` (comparador de hash só com as chaves do lote) |
| conector_id | uuid not null | FK → conector |
| hash | text | **SHA-256 em hex minúsculo, 64 caracteres, do `jsonCanonico` do registro** (CHECK `registro_atual_hash_formato` = `^[0-9a-f]{64}$`, 0010); **nulo só se inativado** (`deleted_at`) |
| payload | jsonb | expurgado 30 dias após inativado |
| valor_controle | bigint | soma de controle da reconciliação |
| alterado_em | timestamptz(3) not null | guarda monotônica |
| ativo | boolean not null | "ativo" = `ativo and deleted_at is null` |
| lote_id, sessao_id | uuid | informativos, sem FK |
| visto_em, aplicado_em | timestamptz not null | |
| deleted_at | | **inativado pela carga completa** |
Índice de candidatos/contagem/reconciliação `(tenant_id, entidade, conector_id, visto_em) include (valor_controle) where ativo
and deleted_at is null`. Tabela única, sem partição (reavaliar acima de 50 milhões de linhas ou p95 > 300 ms). fillfactor 90.

**Formato final do hash** (T-0025, decisão do gerente R-20261101-194718, opção a): o domain da Integração
(`modules/integracao/domain/idempotencia.ts`, `hashRegistro`) calcula **SHA-256 hex (64) do `jsonCanonico(payload)`**; o CHECK
da 0010 fica como está. O FNV-1a de 16 hex da primeira versão do domain **não** é aceito (23514 no upsert; achado 🔴 da
revisão R-20261101-233652-2). Mudar o algoritmo = migração nova com o CHECK e recálculo do espelho (todo hash muda, a
próxima carga completa veria tudo como "atualizado").

## pendencia_inativacao
| Coluna | Tipo | Regra |
|---|---|---|
| sessao_id, entidade, conector_id | | FK → sessao_carga e conector; **uma por sessão**; **uma `aguardando` por Conector+entidade** |
| lote_id | uuid not null | sem FK (o lote expira) |
| estado | text not null | `aguardando`\|`confirmada`\|`recusada`\|`expirada` (expira em 7 dias: `expira_em`) |
| candidatos, total_ativos | int not null | ≥ 0 |
| percentual, limite_pct | numeric(5,2) not null | `limite_pct` em (0, 100] |
| amostra | jsonb not null | lista de até 50 `external_id` |
| decidida_em, **decidida_por** (uuid), **decidida_por_perfil** (`admin`\|`analista`) | | P-3/T-0031: **obrigatórios os três em confirmada/recusada; nulos em aguardando**; autor sempre da sessão do usuário |
| **motivo_decisao** | text | ≤ 300 |
Índice `(tenant_id, estado, entidade)`.

## inativacao_auditoria (APPEND-ONLY)
`pendencia_id` (FK → pendencia), `sessao_id`, `lote_id` (sem FK), `entidade`, `conector_id` (FK), `acao`
(`confirmar`\|`recusar`), `decidida_por` (uuid), `perfil` (`admin`\|`analista`), `decidida_em`, `quantidade` (o que a
pendência previa), `total_ativos`, `percentual numeric(5,2)`, `motivo` (≤ 300), **`inativadas`** (quantos foram de fato
inativados ao confirmar; **nulo na recusa**). Todos obrigatórios menos `motivo` e `inativadas`. **Só `select, insert`** ao
`macuxi_app` (UPDATE/DELETE = 42501); sem gatilho de `updated_at`. Índices `(tenant_id, decidida_em desc)` e `(tenant_id,
pendencia_id)`. Gravada na mesma transação da decisão (sem auditoria não há decisão), junto do `tx.auditar` da plataforma.

## cursor_entidade
`conector_id` (FK), `entidade`, `cursor_alterado_em timestamptz(3)`, `cursor_external_id text collate "C"` (1..200), os dois
nulos ou os dois preenchidos, `atualizado_em`. Único `(tenant_id, conector_id, entidade)`; escrita monotônica.

## reconciliacao
`conector_id` (FK), `entidade`, `data_referencia date`, `contagem_erp`, `soma_erp`, `contagem_macuxi`, `soma_macuxi`,
`diferenca_contagem`, `diferenca_soma` (bigint), `diferenca_pct numeric(12,2)`, `divergente`, `motivos text[]`
(`contagem_divergente`, `soma_divergente`, `soma_ausente`), `situacao` (`comparada`\|`pendente`), `evento_publicado`,
`calculada_em`. Único `(tenant_id, conector_id, entidade, data_referencia)` (reenviar substitui); `(tenant_id, data_referencia
desc) where divergente`.

## mapeamento
`tipo` (`condicao_pagamento`\|`deposito`\|`status`), `codigo_erp` e `codigo_macuxi` (1..60), `descricao` (≤ 200), `ativo`.
Único `(tenant_id, tipo, codigo_erp)` entre os vivos; **`condicao_pagamento`: um ativo por `codigo_macuxi`**.

## pedido_fila_erp
| Coluna | Tipo | Regra |
|---|---|---|
| pedido_uuid | uuid not null | **único TOTAL por tenant** (a linha removida continua garantindo a idempotência) |
| estado | text not null | `ESTADOS_PEDIDO_ERP`; padrão `pendente` |
| payload | jsonb | `PedidoParaErp`; **nulo se retido** |
| payload_origem | jsonb not null | `PedidoAprovadoParaFila` (do evento) |
| retencao_codigo, retencao_mensagem | text | `mapeamento_ausente`\|`mapeamento_ambiguo`\|`sequencia_repetida` |
| conector_id | uuid | FK → conector (quem retirou) |
| enviado_em, tentativas, numero_erp, motivo, nota_numero, nota_serie, nota_emitida_em, nota_total_cents (≥ 0) | | |
| notas_aplicadas | jsonb not null | lista `[{ numero, serie }]` |
| itens_faturados_acumulados | jsonb not null | objeto `{ "<sequencia>": { quantidade, valor_cents } }` |
| ultimo_retorno_em, aprovado_em (not null) | timestamptz | o poll ordena por `aprovado_em` |
Remoção só por `deleted_at` (sem DELETE). **Reativação** (RN-INT-08; decisão do gerente R-20261101-194718): pedido removido
(`deleted_at` preenchido; é o `removido_em` do domain `PedidoNaFila`, não há coluna com esse nome) e aprovado de novo **não**
ganha linha nova (o único total `pedido_fila_erp_pedido_uk` daria 23505): é um **UPDATE** da mesma linha que limpa
`deleted_at`, volta a `estado = 'pendente'` com `tentativas = 0` e regrava `payload`/`payload_origem`, `retencao_*` e
`aprovado_em` (o domain devolve `persistencia: 'atualizar'`, `modules/integracao/domain/pedido-fila.ts`). **Retido** = `payload` nulo + `retencao_codigo` preenchido
(CHECK da 0010, linha do `pedido_fila_erp_retido_sem_payload`). Índices: poll `(tenant_id, aprovado_em) where estado = 'pendente' and
retencao_codigo is null and deleted_at is null`; timeout `(tenant_id, enviado_em) where estado = 'enviado'`; retidos
`(tenant_id) where retencao_codigo is not null and deleted_at is null`; lista do BKO `(tenant_id, estado, aprovado_em desc)`.

## pedido_retorno
`pedido_uuid` (FK → fila), `status` (`StatusRetornoErp`), `numero_erp`, `motivo`, `nota_numero`, `nota_serie`,
`nota_emitida_em`, `nota_total_cents`, `itens_faturados` (jsonb lista), `ocorrido_em`, `conector_id` (FK). Trilha de cada
retorno **aceito e não repetido**; segunda guarda da idempotência: único `(tenant_id, pedido_uuid, status, nota_numero,
nota_serie) nulls not distinct`. **Só `select, insert`**. Índice `(tenant_id, pedido_uuid, ocorrido_em)`.

## pedido_retorno_erro
| Coluna | Tipo | Regra |
|---|---|---|
| pedido_uuid | uuid not null | FK → fila |
| **pedido_retorno_id** | uuid | FK → `pedido_retorno` gravado na mesma transação; **nulo quando o retorno é repetido** |
| status, numero_erp, nota_numero, nota_serie, ocorrido_em (not null) | | do retorno |
| indice (≥ 0), sequencia (≥ 1), quantidade (≥ 1) | int not null | do item descartado |
| produto_external_id | text not null | 1..200 |
| codigo | text not null | `CODIGOS_ITEM_DESCARTADO` + `sequencia_repetida` (o primeiro problema) |
| codigos | text[] not null | todos os problemas; não vazio; da mesma lista |
| campo (1..200), motivo (1..1000) | text not null | mensagem legível, sem dado pessoal |
| conector_id | uuid not null | FK → conector |
| resolvido_em | timestamptz | marcado no BKO |
Índices `(tenant_id, created_at desc)` (alerta "retorno com itens descartados" das últimas 24 h e lista do monitor) e
`(tenant_id, pedido_uuid)`. Volume: dezenas por dia no pior caso.

## Testes
`db/testes/t0032.test.ts` (autenticação sem tenant, P-7, entidades, 200 caracteres, idempotência do lote, upsert e cursor
monotônicos, decisão e auditoria append-only, fila/retorno/erros, expurgos como `macuxi_worker`); vazamento entre os 2 tenants
das 17 tabelas em `vazamento.test.ts` (fixture com linhas de A e B em todas, [fixture-dois-tenants.md](fixture-dois-tenants.md));
listas e índices em `estatico.test.ts`; up/down/up em `migracoes.test.ts`; Drizzle × banco em `drizzle-x-banco.test.ts`.
EXPLAIN com volume (20 mil SKUs, 1 milhão de preços, lote de 5.000) fica para a rodada das rotas (consultas reais da API).
