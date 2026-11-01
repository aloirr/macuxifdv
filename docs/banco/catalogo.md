# Dicionário de dados — schema `catalogo`

Migração `db/migrations/0008_catalogo_preco.up.sql` (volta: `.down.sql` = `drop schema catalogo cascade`, apaga tabelas e
preços). Drizzle: `modules/catalogo/db/nuvem.ts` (uso interno do Catálogo). Origem: T-0029 (fatia do pedido), desenho
`docs/desenho/T-0029.md` §10, pedido R-20261101-042135-engenheiro-software; ADR 0005 (preço é do Catálogo) e ADR 0012
(o Vendedor lê preço pela consulta `catalogo.precos_cliente@1`, nunca pela tabela).
Esquema local do aparelho (FTS5 da busca): [aparelho-sqlite.md](aparelho-sqlite.md).

Campos comuns, RLS forçado (`isolamento_tenant`), gatilho de `updated_at`, índice de sync `(tenant_id, updated_at, id)` e
`external_id` único por tenant (parcial, vivos), como em [plataforma.md](plataforma.md).

**Fronteira**: nenhuma FK para o schema do Core. `produto_id` e `cliente_id` são validados pela API do Catálogo (contratos
do Core). FKs só dentro do schema, compostas por tenant: `tabela_preco_item → tabela_preco` e
`cliente_tabela_preco → tabela_preco`.

**RN-CAT-06**: preço é sempre o da tabela do cliente. Cliente sem linha viva em `cliente_tabela_preco`, ou produto sem item
vigente na tabela dele, = **sem preço** ("Sem preço para este cliente."). Não há tabela padrão de recurso.

## tabela_preco
| Coluna | Tipo | Regra |
|---|---|---|
| codigo | text not null | não vazio; único vivo por tenant (`tabela_preco_codigo_uk`) |
| nome | text not null | não vazio |
| ativo | boolean not null | padrão `true` |

Pull escopo tenant. Volume baixo (dezenas). Alvo de FK: único `(tenant_id, id)`.

## tabela_preco_item
| Coluna | Tipo | Regra |
|---|---|---|
| tabela_preco_id | uuid not null | FK composta para `tabela_preco` |
| produto_id | uuid not null | sem FK (cadastro base no Core, ADR 0005) |
| preco_cents | bigint not null | **> 0** (centavos) |
| vigencia_inicio | timestamptz | inclusivo, UTC; nulo = desde sempre |
| vigencia_fim | timestamptz | exclusivo, UTC; nulo = sem fim; `fim > inicio` quando os dois existem |

Índices: `tabela_preco_item_vigencia_uk (tenant_id, tabela_preco_id, produto_id, vigencia_inicio) NULLS NOT DISTINCT`
único entre os vivos (atende a consulta e impede início repetido, inclusive dois "desde sempre"); sync.
**Sobreposição** de vigências do mesmo produto na mesma tabela não é barrada pelo banco: a consulta usa o item vivo de
**maior início ≤ data** com `fim` nulo ou `> data`. Volume médio (produtos × tabelas × vigências).

Consulta típica (`catalogo.precos_cliente@1`):
```sql
select distinct on (i.produto_id) i.produto_id, i.preco_cents
  from catalogo.cliente_tabela_preco ct
  join catalogo.tabela_preco t on t.tenant_id = ct.tenant_id and t.id = ct.tabela_preco_id and t.ativo and t.deleted_at is null
  join catalogo.tabela_preco_item i on i.tenant_id = ct.tenant_id and i.tabela_preco_id = ct.tabela_preco_id
 where ct.cliente_id = $1 and ct.deleted_at is null and i.deleted_at is null and i.produto_id = any($2::uuid[])
   and (i.vigencia_inicio is null or i.vigencia_inicio <= $3) and (i.vigencia_fim is null or i.vigencia_fim > $3)
 order by i.produto_id, i.vigencia_inicio desc nulls last;
```
Nomes do pull: o contrato `ItemTabelaPreco` (`modules/catalogo/contracts/linhas-preco.ts`) usa `price_table_id`,
`product_id`, `price_cents`, `valid_from`, `valid_to`; o provedor do Catálogo mapeia das colunas acima.

## cliente_tabela_preco
| Coluna | Tipo | Regra |
|---|---|---|
| cliente_id | uuid not null | sem FK (Core); **uma viva por cliente** (`cliente_tabela_preco_cliente_uk (tenant_id, cliente_id)`) |
| tabela_preco_id | uuid not null | FK composta para `tabela_preco` |

Pull escopo carteira (filtro por `cliente_id`). Índice `(tenant_id, tabela_preco_id)` para "clientes desta tabela".
Volume = nº de clientes.

## Base de demo
Tabelas "Varejo" (`VAREJO`, todos os produtos, preço de tabela do seed) e "Atacado" (`ATACADO`, ≈ 7% menor, **sem**
`ACA-1K`, `SUC-1L`, `CRD-90`); supermercados e atacarejos no Atacado, os demais no Varejo; vigência desde o 1º dia do mês
anterior (00:00 de Manaus). Ver [README.md](README.md), "Base de demo".
