# Pacote pronto da primeira carga — `plataforma.sync_pacote` e `plataforma.sync_pacote_pedido` (0070)

Dono: `banco-dados`. Migração `db/migrations/0070_plataforma_sync_pacote.{up,down}.sql` (em cima da 0069, aditiva).
Origem: aprovação das soluções 4 e 5 do catálogo pelo dono do produto (15/11/2026). Decisão: ADR 0054 (proposta). Desenho:
`docs/desenho/T-catalogo-pacote.md` §1.4 (gerador e gatilhos), §1.5 (versão), §1.6 (manifesto) e §5, tarefa B.
Teste: `db/testes/sync-pacote.db.test.ts` (parte estática roda na sessão; banco e up/down só no CI).

## Para que serve
Na primeira carga, o aparelho baixa um arquivo SQLite compactado (`.sqlite.gz`) por (tenant, módulo, partição) em vez de puxar
150 mil linhas em páginas. O **worker** gera o arquivo, grava no armazenamento e registra a linha em `plataforma.sync_pacote`.
A **API** monta o manifesto (`GET /v1/sync/pacotes`) lendo essa tabela e, quando falta pacote, registra o pedido em
`plataforma.sync_pacote_pedido`. Nenhuma das duas tabelas vai ao aparelho (estão em `TABELAS_FORA_DO_SYNC`, `db/src/excecoes.ts`).

## `plataforma.sync_pacote` — o pacote gerado
| Coluna | Tipo | Nulo | Regra |
|---|---|---|---|
| `id` | uuid | não | PK, `gen_random_uuid()`; é o `<id>` da chave do arquivo |
| `tenant_id` | uuid | não | FK `plataforma.tenant (id)` |
| `modulo` | text | não | `^[a-z][a-z0-9-]*$` (`core`, `catalogo`...) |
| `particao` | text | não | `tenant` ou `filial:<uuid>` |
| `filial_id` | uuid | sim | só e sempre na partição de filial, igual ao uuid do texto (CHECK `sync_pacote_particao_valida`); sem FK (cache da plataforma) |
| `formato` | integer | não | padrão 1 (`FORMATO_PACOTE_SYNC` do SDK); `>= 1` |
| `situacao` | text | não | `pronto` (padrão), `substituido`, `apagado` |
| `horizonte` | timestamptz | não | relógio do banco na geração (watermark, ADR 0006): toda linha viva com `updated_at < horizonte` está no arquivo; vira o cursor `(horizonte, UUID nulo)` do manifesto |
| `geracao_base` | uuid | não | a `plataforma.tenant.geracao_base` na geração (ADR 0021); o manifesto só oferece a da geração atual |
| `chave_armazenamento` | text | não | **exatamente** `sync-pacotes/<tenant_id>/<modulo>/<particao>/<id>.sqlite.gz` (CHECK `sync_pacote_chave_do_tenant`: a chave sempre leva o tenant da linha) |
| `bytes` | bigint | não | tamanho do `.gz`, `> 0` |
| `md5` | text | não | `^[0-9a-f]{32}$` (minúsculas) |
| `entidades` | jsonb | não | objeto `{ "<entidade>": linhas }` (o mesmo do `_pacote.entidades` do arquivo), até 8 KB |
| `substituido_em` | timestamptz | sim | nulo só e sempre no `pronto` (CHECK `sync_pacote_substituido_coerente`) |
| `arquivo_apagado_em` | timestamptz | sim | preenchido só e sempre no `apagado` (CHECK `sync_pacote_apagado_coerente`) |
| `created_at`, `updated_at`, `deleted_at`, `external_id` | | | colunas obrigatórias (regra 5); `updated_at` pelo gatilho `sync_pacote_updated_at`; `external_id` sempre nulo |

Índices:
- `sync_pacote_pronto_uk` — **único** `(tenant_id, modulo, particao) where situacao = 'pronto' and deleted_at is null`: uma só
  linha pronta viva por partição; é o índice do manifesto.
- `sync_pacote_filial_ix` — `(tenant_id, filial_id) where filial_id is not null`: pacotes de uma filial.
- `sync_pacote_substituido_ix` — `(substituido_em) where situacao = 'substituido'`: retenção do worker (apagar o arquivo 1 h depois).

## `plataforma.sync_pacote_pedido` — pedido de geração
| Coluna | Tipo | Nulo | Regra |
|---|---|---|---|
| `id`, `tenant_id` | uuid | não | como acima |
| `modulo`, `particao`, `filial_id` | | | as mesmas regras do pacote (CHECKs `sync_pacote_pedido_*`) |
| `origem` | text | não | `lote` (`integracao.lote.concluido@1` na outbox), `manifesto` (GET sem pacote pronto) ou `agendado` (mais de 24 h com mudança) |
| `situacao` | text | não | `pendente` (padrão), `atendido`, `descartado` |
| `gerar_apos` | timestamptz | não | padrão `now()`; o gatilho de lote empurra para `now() + 5 min` a cada lote novo |
| `tentativas` | integer | não | padrão 0; 0..100 |
| `ultimo_erro` | text | sim | só código curto (1..200), nunca dado pessoal |
| `atendido_em` | timestamptz | sim | nulo só e sempre no `pendente` (CHECK `sync_pacote_pedido_atendido_coerente`) |
| `created_at`, `updated_at`, `deleted_at`, `external_id` | | | obrigatórias; gatilho `sync_pacote_pedido_updated_at` |

Índices:
- `sync_pacote_pedido_pendente_uk` — **único** `(tenant_id, modulo, particao) where situacao = 'pendente' and deleted_at is null`:
  idempotência por partição. A API grava com
  `insert ... on conflict (tenant_id, modulo, particao) where situacao = 'pendente' and deleted_at is null do nothing`; o gatilho de
  lote do worker usa `... do update set gerar_apos = excluded.gerar_apos`.
- `sync_pacote_pedido_fila_ix` — `(gerar_apos) where situacao = 'pendente'`: fila do worker (`for update skip locked`).
- `sync_pacote_pedido_filial_ix` — `(tenant_id, filial_id) where filial_id is not null`.

## Índice novo em `catalogo.tabela_preco_item`
`tabela_preco_item_filial_sync_ix (tenant_id, filial_id, updated_at, id)`: leitura por filial com o keyset `(updated_at, id)`,
usada pelo pull do Catálogo (`filtroFilial`) e pelo `pacote.puxar` (páginas de 5.000 até o horizonte). Pedido no §5 B do desenho.
O EXPLAIN com volume (150 mil itens) fica para a carga do CI da tarefa G (`tests/carga/`); sem Postgres na sessão.

## RLS e grants
As duas tabelas: `enable` + `force row level security`, `isolamento_tenant` (macuxi_app, `tenant_id = plataforma.tenant_atual()`
no USING e no WITH CHECK) e `manutencao` (0031). `revoke all ... from public`.

| Papel | `sync_pacote` | `sync_pacote_pedido` |
|---|---|---|
| `macuxi_app` (API) | SELECT no próprio tenant | SELECT; INSERT só de `id, tenant_id, modulo, particao, filial_id, origem` no próprio tenant |
| `macuxi_worker` (gerador) | SELECT (todos os tenants); INSERT só de `id, tenant_id, modulo, particao, filial_id, formato, horizonte, geracao_base, chave_armazenamento, bytes, md5, entidades`; UPDATE só de `situacao, substituido_em, arquivo_apagado_em, deleted_at` em linha que **não** está `apagado`; DELETE só de linha `apagado` | SELECT (todos); INSERT de `id, tenant_id, modulo, particao, filial_id, origem, gerar_apos`; UPDATE só de `situacao, gerar_apos, tentativas, ultimo_erro, atendido_em, deleted_at` em linha `pendente`; DELETE só de linha que não está `pendente` |
| `macuxi_portal`, PUBLIC | nada | nada |

Políticas do worker (como as `despacho_*` das outboxes): `sync_pacote_gerador` (select, true), `sync_pacote_gerador_gravar`
(insert, true), `sync_pacote_gerador_marcar` (update, `situacao <> 'apagado'`), `sync_pacote_gerador_expurgar` (delete,
`situacao = 'apagado'`); `sync_pacote_pedido_gerador`, `_gravar`, `_marcar` (`situacao = 'pendente'`) e `_expurgar`
(`situacao <> 'pendente'`). O app não escolhe `situacao`, `gerar_apos` nem `atendido_em` (sem INSERT na coluna); a `origem`
gravada pela API é sempre `manifesto` (regra da API; o banco não distingue).

## Ciclo de vida (desenho §1.4)
1. **Pedido**: lote concluído (outbox), manifesto sem pacote ou agendado de 24 h grava `sync_pacote_pedido` `pendente` (um por
   partição).
2. **Geração** (worker, `pg_try_advisory_lock` da partição): gera o arquivo, `PUT` em `chave_armazenamento` e, **na mesma
   transação**: marca o `pronto` anterior da partição como `substituido` (`substituido_em = now()`), insere o novo `pronto` (o
   único parcial impede dois prontos) e marca o pedido `atendido` (`atendido_em`). Partição que não deve mais existir (módulo sem
   licença, filial removida) = pedido `descartado`.
3. **Retenção**: 1 h depois de `substituido_em`, o worker apaga o arquivo e marca `apagado` (`arquivo_apagado_em`); a linha
   `apagado` e os pedidos fora de `pendente` podem ser apagados pelo worker (expurgo).
4. **Leitura**: a API lê o `pronto` vivo da partição com `geracao_base` igual à do tenant e devolve URL pré-assinada; sem pronto,
   grava o pedido e o aparelho segue no pull paginado.

## Volume
Por (tenant, módulo): 1 pacote `tenant` + 1 por filial prontos; substituídos por pouco tempo. Pedidos: no máximo 1 pendente por
partição. Linhas pequenas (metadados); os bytes ficam no armazenamento.

## Caminho de volta
`0070_plataforma_sync_pacote.down.sql` apaga o índice de `catalogo.tabela_preco_item` e as duas tabelas (com índices, gatilhos,
políticas e grants). Os arquivos no armazenamento **ficam**: antes, liste
`select chave_armazenamento from plataforma.sync_pacote where situacao <> 'apagado';` e apague os objetos. Pré-condição: API e
worker sem as rotas e o gerador (`MACUXI_SYNC_PACOTES` desligado). Idempotente. `plataforma.excluir_tenant` já apaga as linhas
do tenant (descoberta dinâmica de tabelas com `tenant_id`); os objetos do armazenamento do tenant são do gerador.

## Fixture dois-tenants
`SYNC_PACOTE_FIXTURE` (grupos `0x67` e `0x68`): A com `catalogo`·`tenant` pronto, `catalogo`·`filial:<padrão>` pronto e um
`catalogo`·`tenant` substituído; B com `core`·`tenant` pronto. Pedidos atendidos (A `lote`, B `manifesto`); nenhum pendente.
