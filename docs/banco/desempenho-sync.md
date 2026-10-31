# Desempenho do sync pull — EXPLAIN com volume (T-0002)

Dono: `banco-dados`. Meta do doc 04: **p95 < 300 ms** nas consultas críticas. Medido em 2026-10-31 no
Postgres do `db/docker-compose.yml` (Docker Desktop no Windows 11, máquina de desenvolvimento com outros
agentes rodando testes ao mesmo tempo — os tempos de relógio são pessimistas).

**Como reproduzir:** `pnpm --filter @macuxi/db exec tsx scripts/medir-sync.ts [--clientes 500] [--produtos 20000] [--ruido 8] [--rodadas 30]`.
O script cria um banco efêmero, carrega a fixture dois-tenants, acrescenta o volume abaixo (inclusive em
8 tenants de "ruído", para o RLS ter o que filtrar), roda `ANALYZE`, mede cada consulta **como
`macuxi_app` (RLS ligado) no contexto do tenant A** e apaga o banco.

- `EXPLAIN exec` = `Execution Time` do `EXPLAIN (ANALYZE, BUFFERS)` (só o servidor).
- p50/p95 = relógio no Node, ida e volta, incluindo transferir as linhas (até 500 por página).

## Resultado
Postgres 16.15 (Debian 16.15-1.pgdg12+2) (Docker local) · preparo do volume: 135.3 s · 30 rodadas por consulta (após 3 de aquecimento)
Volume: tenants 10 · produtos 200003 · clientes 5004 · carteira 1505 (por tenant: 500 clientes, 20000 produtos; 8 tenants de ruído)

| # | Consulta (papel macuxi_app, contexto tenant A) | Linhas | Índice | EXPLAIN exec (ms) | p50 (ms) | p95 (ms) |
|---|---|---|---|---|---|---|
| Q1 | produto: 1ª página do pull (cursor zero, 500 linhas) | 500 | produto_sync_ix | 7.418 | 25.49 | 48.05 |
| Q2 | produto: página do meio (cursor na linha 10.000) | 500 | produto_sync_ix | 1.581 | 26.63 | 92.54 |
| Q3 | produto: incremental (cursor nas ~50 últimas alterações) | 52 | produto_sync_ix | 0.264 | 6.27 | 7.30 |
| Q4 | produto: quantas alterações desde o cursor (contagem do meio) | 1 | produto_sync_ix | 15.651 | 15.50 | 16.95 |
| Q5 | cliente: pull no escopo da carteira do vendedor-1 (cursor zero) | 252 | cliente_tenant_id_uk + carteira_usuario_ix | 2.451 | 16.80 | 31.89 |
| Q6 | carteira: pull das linhas do vendedor-1, inclusive excluídas (cursor zero) | 252 | Seq Scan | 1.704 | 16.57 | 38.31 |
| Q7 | usuario: pull completo do tenant (cursor zero) | 8 | Seq Scan | 0.171 | 4.20 | 12.69 |

## Leitura
1. **Todas as consultas estão bem abaixo da meta** (pior p95: 92 ms; servidor < 16 ms). O custo dominante
   nas páginas de 500 linhas é a transferência (Docker no Windows), não o plano.
2. **O RLS vira condição de índice**: `plataforma.tenant_atual()` é `STABLE`, e o planejador usa
   `tenant_id = tenant_atual()` como primeira coluna do `Index Cond` de `produto_sync_ix`; a comparação de
   linha `(updated_at, id) > ($1, $2)` entra na mesma condição. Paginação por cursor sem `OFFSET`, custo
   constante em qualquer página (Q1 ≈ Q2, ~500 buffers).
3. **Contrato do pull para a API (T-0004, rota `/v1/sync/pull`)**: `where (updated_at, id) > ($cursor_ts, $cursor_id) order by
   updated_at, id limit N` — exatamente nessa forma (comparação de LINHA, não `updated_at > x or (...)`),
   para casar com o índice `(tenant_id, updated_at, id)`. Não repetir `tenant_id = $t` é opcional: o RLS já
   põe a condição; repetir não atrapalha o plano.
4. **Contagem de pendências (Q4)** custa proporcional ao que falta (10 mil linhas ≈ 10–16 ms). Para o app,
   prefira "tem mais?" (`limit N+1`) a `count(*)`.
5. **Escopo de carteira (Q5)**: semi-join com `carteira_usuario_ix` (parcial, `deleted_at is null`) +
   ordenação em memória. Com 500 clientes por vendedor é trivial; acima de ~10 mil clientes por vendedor,
   reavaliar.
6. **Pendência anotada — carteira com excluídas (Q6)**: o pull da carteira do vendedor precisa trazer
   também as linhas excluídas (tombstones), e o índice `carteira_usuario_ix` é parcial (`deleted_at is
   null`), então hoje é `Seq Scan` (1,5 mil linhas, 1,7 ms — irrelevante agora). Quando a rota de sync
   existir (T-0004), criar em migração nova `carteira_usuario_sync_ix (tenant_id, usuario_id, updated_at, id)`
   (docs/desenho/T-0002.md §6.2).
   `core.usuario` (Q7) também faz Seq Scan por ter poucas linhas — esperado.

## Planos (EXPLAIN ANALYZE, BUFFERS)

### Q1 — produto: 1ª página do pull (cursor zero, 500 linhas)

```sql
select * from core.produto
  where (updated_at, id) > ($1::timestamptz, $2::uuid)
  order by updated_at, id limit 500
```

```text
Limit (actual time=0.086..7.196 rows=500 loops=1)
  Buffers: shared hit=508
  ->  Index Scan using produto_sync_ix on produto (actual time=0.083..6.964 rows=500 loops=1)
        Index Cond: ((tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::uuid) AND (ROW(updated_at, id) > ROW('1970-01-01 00:00:00+00'::timestamp with time zone, '00000000-0000-0000-0000-000000000000'::uuid)))
        Buffers: shared hit=508
Planning Time: 0.505 ms
Execution Time: 7.418 ms
```

### Q2 — produto: página do meio (cursor na linha 10.000)

```sql
select * from core.produto
  where (updated_at, id) > ($1::timestamptz, $2::uuid)
  order by updated_at, id limit 500
```

```text
Limit (actual time=0.053..1.413 rows=500 loops=1)
  Buffers: shared hit=506
  ->  Index Scan using produto_sync_ix on produto (actual time=0.051..1.252 rows=500 loops=1)
        Index Cond: ((tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::uuid) AND (ROW(updated_at, id) > ROW('2026-08-02 12:22:10.923+00'::timestamp with time zone, 'e6951dc6-c514-438d-8de7-dc7ff507d3fc'::uuid)))
        Buffers: shared hit=506
Planning Time: 0.679 ms
Execution Time: 1.581 ms
```

### Q3 — produto: incremental (cursor nas ~50 últimas alterações)

```sql
select * from core.produto
  where (updated_at, id) > ($1::timestamptz, $2::uuid)
  order by updated_at, id limit 500
```

```text
Limit (actual time=0.050..0.191 rows=52 loops=1)
  Buffers: shared hit=55
  ->  Index Scan using produto_sync_ix on produto (actual time=0.048..0.173 rows=52 loops=1)
        Index Cond: ((tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::uuid) AND (ROW(updated_at, id) > ROW('2026-10-31 01:11:23.252+00'::timestamp with time zone, 'e41fa64b-344f-4d29-be56-6e6e4749c6dd'::uuid)))
        Buffers: shared hit=55
Planning Time: 0.417 ms
Execution Time: 0.264 ms
```

### Q4 — produto: quantas alterações desde o cursor (contagem do meio)

```sql
select count(*) from core.produto where (updated_at, id) > ($1::timestamptz, $2::uuid)
```

```text
Aggregate (actual time=15.566..15.567 rows=1 loops=1)
  Buffers: shared hit=92
  ->  Index Only Scan using produto_sync_ix on produto (actual time=0.050..13.671 rows=10002 loops=1)
        Index Cond: ((tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::uuid) AND (ROW(updated_at, id) > ROW('2026-08-02 12:22:10.923+00'::timestamp with time zone, 'e6951dc6-c514-438d-8de7-dc7ff507d3fc'::uuid)))
        Heap Fetches: 0
        Buffers: shared hit=92
Planning Time: 0.439 ms
Execution Time: 15.651 ms
```

### Q5 — cliente: pull no escopo da carteira do vendedor-1 (cursor zero)

```sql
select c.* from core.cliente c
  where (c.updated_at, c.id) > ($1::timestamptz, $2::uuid)
    and exists (select 1 from core.carteira k
                 where k.tenant_id = c.tenant_id and k.cliente_id = c.id
                   and k.usuario_id = $3 and k.deleted_at is null)
  order by c.updated_at, c.id limit 500
```

```text
Limit (actual time=2.092..2.208 rows=252 loops=1)
  Buffers: shared hit=27
  ->  Sort (actual time=2.089..2.145 rows=252 loops=1)
        Sort Key: c.updated_at, c.id
        Sort Method: quicksort  Memory: 58kB
        Buffers: shared hit=27
        ->  Hash Semi Join (actual time=0.753..1.563 rows=252 loops=1)
              Hash Cond: (c.id = k.cliente_id)
              Buffers: shared hit=27
              ->  Bitmap Heap Scan on cliente c (actual time=0.128..0.583 rows=503 loops=1)
                    Recheck Cond: (tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::uuid)
                    Filter: (ROW(updated_at, id) > ROW('1970-01-01 00:00:00+00'::timestamp with time zone, '00000000-0000-0000-0000-000000000000'::uuid))
                    Heap Blocks: exact=9
                    Buffers: shared hit=16
                    ->  Bitmap Index Scan on cliente_tenant_id_uk (actual time=0.104..0.105 rows=503 loops=1)
                          Index Cond: (tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::uuid)
                          Buffers: shared hit=7
              ->  Hash (actual time=0.586..0.589 rows=252 loops=1)
                    Buckets: 1024  Batches: 1  Memory Usage: 24kB
                    Buffers: shared hit=11
                    ->  Bitmap Heap Scan on carteira k (actual time=0.197..0.368 rows=252 loops=1)
                          Recheck Cond: ((tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::uuid) AND (usuario_id = 'aaaaaaaa-0001-4000-8000-000000000006'::uuid) AND (deleted_at IS NULL))
                          Heap Blocks: exact=9
                          Buffers: shared hit=11
                          ->  Bitmap Index Scan on carteira_usuario_ix (actual time=0.182..0.182 rows=252 loops=1)
                                Index Cond: ((tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::uuid) AND (usuario_id = 'aaaaaaaa-0001-4000-8000-000000000006'::uuid))
                                Buffers: shared hit=2
Planning:
  Buffers: shared hit=8
Planning Time: 7.446 ms
Execution Time: 2.451 ms
```

### Q6 — carteira: pull das linhas do vendedor-1, inclusive excluídas (cursor zero)

```sql
select * from core.carteira
  where usuario_id = $3 and (updated_at, id) > ($1::timestamptz, $2::uuid)
  order by updated_at, id limit 500
```

```text
Limit (actual time=1.503..1.616 rows=252 loops=1)
  Buffers: shared hit=25
  ->  Sort (actual time=1.501..1.556 rows=252 loops=1)
        Sort Key: updated_at, id
        Sort Method: quicksort  Memory: 58kB
        Buffers: shared hit=25
        ->  Seq Scan on carteira (actual time=0.031..1.320 rows=252 loops=1)
              Filter: ((usuario_id = 'aaaaaaaa-0001-4000-8000-000000000006'::uuid) AND (ROW(updated_at, id) > ROW('1970-01-01 00:00:00+00'::timestamp with time zone, '00000000-0000-0000-0000-000000000000'::uuid)) AND (tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::uuid))
              Rows Removed by Filter: 1253
              Buffers: shared hit=25
Planning Time: 0.405 ms
Execution Time: 1.704 ms
```

### Q7 — usuario: pull completo do tenant (cursor zero)

```sql
select id, nome, email, perfil, equipe_id, ativo, updated_at, deleted_at from core.usuario
  where (updated_at, id) > ($1::timestamptz, $2::uuid) order by updated_at, id limit 500
```

```text
Limit (actual time=0.105..0.110 rows=8 loops=1)
  Buffers: shared hit=1
  ->  Sort (actual time=0.103..0.105 rows=8 loops=1)
        Sort Key: updated_at, id
        Sort Method: quicksort  Memory: 26kB
        Buffers: shared hit=1
        ->  Seq Scan on usuario (actual time=0.034..0.073 rows=8 loops=1)
              Filter: ((ROW(updated_at, id) > ROW('1970-01-01 00:00:00+00'::timestamp with time zone, '00000000-0000-0000-0000-000000000000'::uuid)) AND (tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::uuid))
              Rows Removed by Filter: 2
              Buffers: shared hit=1
Planning:
  Buffers: shared hit=1
Planning Time: 0.541 ms
Execution Time: 0.171 ms
```
