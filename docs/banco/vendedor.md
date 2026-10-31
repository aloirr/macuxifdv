# Dicionário de dados — schema `vendedor`

Migração `db/migrations/0007_vendedor_pedido.up.sql` (volta: `.down.sql` = `drop schema vendedor cascade`, apaga os pedidos).
Drizzle: `modules/vendedor/db/nuvem.ts` (uso interno do Vendedor). Mínimo da Sprint 1 para o pull de `pedido` e
`pedido_item` (D-2; desenho T-0016 §4.5 e §7; pedidos R-20261031-110346-modulo-vendedor e R-20261031-152927-engenheiro-software).
O push de pedido entra na Sprint 4: aí vêm `pedido_evento`, condições de pagamento e o resto do modelo.

Campos comuns, RLS forçado (`isolamento_tenant`), gatilho de `updated_at`, índice de sync `(tenant_id, updated_at, id)` e
`external_id` único por tenant, como em [plataforma.md](plataforma.md).

**Fronteira**: nenhuma FK para `core.*`. `cliente_id`, `vendedor_id`, `autor_id`, `produto_id`, `visita_id` e
`rota_parada_id` são validados pela API do Vendedor (carteira, usuário e produto pelos serviços/contratos do Core). FK só
dentro do schema (`pedido_item → pedido`, composta por tenant) e `tenant_id → plataforma.tenant`.

## pedido
| Coluna | Tipo | Regra |
|---|---|---|
| id | uuid | gerado no aparelho |
| cliente_id | uuid not null | sem FK (fronteira) |
| vendedor_id | uuid not null | dono do pedido; pedido em nome conta para o vendedor (RN-CORE-21) |
| autor_id | uuid not null | quem digitou (vendedor ou gestor em nome, RN-VEN-35) |
| status | text not null | lista do contrato (`ORDER_STATUSES`, RN-VEN-30): `draft, queued, received, pending_approval, approved, sent_to_erp, integrated, invoiced_partial, invoiced, rejected, cancelled`; padrão `draft` |
| condicao_pagamento | text | |
| desconto_pct | numeric(5,2) not null | 0 a 100 |
| total_tabela_cents, total_cents | bigint not null | ≥ 0 |
| observacao | text | |
| visita_id, rota_parada_id | uuid | sem FK (schema core) |
| criado_no_aparelho_em, recebido_em | timestamptz | |
| numero_erp | text | |
| motivo_cancelamento | text | |

Índices: `pedido_vendedor_sync_ix (tenant_id, vendedor_id, updated_at, id)` (pull por usuários visíveis);
`pedido_cliente_ix (tenant_id, cliente_id, created_at desc)` (últimos pedidos do cliente, rota de listagem do Vendedor);
`pedido_visita_ix (tenant_id, visita_id)` parcial; único `(tenant_id, id)` (alvo da FK do item).
Volume alto: ~20 pedidos por vendedor por dia; janela do pull: criado ≥ hoje − 90 ou status não final.
A mudança da lista de status é migração nova (o teste estático compara o CHECK com `ORDER_STATUSES`).

## pedido_item
| Coluna | Tipo | Regra |
|---|---|---|
| pedido_id | uuid not null | FK composta para `pedido` |
| sequencia | integer not null | ≥ 1; único **constraint** `(tenant_id, pedido_id, sequencia)` (desenho T-0011 §3; alvo de `on conflict`) |
| produto_id | uuid not null | sem FK (cadastro base no Core) |
| quantidade | integer not null | > 0 |
| preco_tabela_cents, preco_unitario_cents, total_cents | bigint not null | ≥ 0 |
| desconto_pct | numeric(5,2) not null | 0 a 100 |

Pull com o escopo do pedido (join por `pedido_id`), índice de sync.
No `pg` cru: `bigint` e `numeric` chegam como string (converta no provedor).
