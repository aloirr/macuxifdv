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

## 0013 — cota de IA, árvore, conteúdo, busca do servidor, estoque e log (`0013_catalogo_vendedor_prevenda`)
Pedidos: R-20261101-222233-3-modulo-catalogo (cota), T-0047/T-0052, R-20261102-093007 (árvore, unidade). Toda tabela com
campos comuns, RLS forçado, `updated_at` por gatilho e FKs compostas só dentro do schema (produto_id é do Core, sem FK).

| Tabela | Colunas principais | Únicos / índices | Sync |
|---|---|---|---|
| `uso_ia` | usuario_id, dia (date, fuso do tenant), consultas | `uso_ia_dia_uk (tenant_id, usuario_id, dia)` | fora |
| `catalogo_no` | pai_id (FK no schema), nivel 1..8 (raiz = 1), codigo, nome, ordem, ativo | código vivo; (tenant, pai, ordem) | tenant |
| `produto_no` | produto_id, no_id (FK) | (tenant, produto, nó) vivo; (tenant, nó) | tenant |
| `produto_conteudo` | produto_id, descricao, aplicacoes (= `applications`), argumentos_venda, faq jsonb `[{pergunta,resposta}]`, campanha (= `is_campaign`), destaque | 1 vivo por produto | tenant |
| `produto_atributo` | produto_id, nome, valor, valor_num numeric(14,4), unidade, ordem | (tenant, produto, nome) vivo; (tenant, nome, valor) | tenant |
| `produto_midia` | produto_id, tipo foto/video/pdf, arquivo_id (plataforma.arquivo, sem FK) ou url, titulo, ordem, principal | 1 foto principal viva por produto | tenant |
| `sinonimo` | termo, sinonimos text[] (>= 1), ativo | (tenant, lower(termo)) vivo | tenant |
| `produto_busca` | produto_id, sku, ean, nome, marca, categoria, atributos, conteudo, ativo, documento tsvector (GATILHO) | 1 vivo por produto; GIN(documento) | índice de sync (reconstrução) |
| `deposito` | codigo, nome, ativo | código vivo | tenant |
| `estoque_saldo` | deposito_id (FK), produto_id, quantidade numeric(14,3) na unidade base, atualizado_erp_em | (tenant, depósito, produto) vivo; (tenant, produto) | tenant |
| `busca_log` | usuario_id, termo NORMALIZADO (1..200), origem llm/regras/cache/offline, resultados, duracao_ms, ocorrido_em | (tenant, ocorrido_em desc); parcial `resultados = 0` | fora; só select/insert |

`tabela_preco_item.unidade` (nova): nulo = unidade base; `CX` = preço próprio da caixa (RN-VEN-15). O único vivo virou
`tabela_preco_item_unidade_vigencia_uk (tenant_id, tabela_preco_id, produto_id, unidade, vigencia_inicio) nulls not distinct`.

### Funções
- `catalogo.debitar_cota_ia(p_usuario_id uuid, p_limite integer, p_agora timestamptz default now()) returns integer`
  (RN-CAT-03): um `INSERT ... ON CONFLICT ON CONSTRAINT uso_ia_dia_uk DO UPDATE SET consultas = consultas + 1 WHERE
  consultas < p_limite RETURNING consultas`. Atômico (a linha do dia fica travada até o fim da transação), sem corrida
  entre requisições simultâneas (teste: 40 em paralelo com limite 7 = exatamente 7 débitos). Devolve o total do dia
  DEPOIS do débito, ou **null** = limite atingido (nada gravado) ou `p_limite <= 0` (IA desligada). Dia civil de
  `p_agora` no fuso de `plataforma.tenant.fuso`. Sem `app.tenant_id`: erro 42501. Função do invocador (RLS vale).
  Uso no callback `debitarCota` da T-0041: `select catalogo.debitar_cota_ia($usuario, $limite_consultas_ia_dia, $agora)`
  na transação do tenant, só com desfecho `respondida`.
- `catalogo.consultas_ia_do_dia(p_usuario_id uuid, p_agora timestamptz default now()) returns integer`: consumo do dia
  (0 sem linha), para o `verificarConsultaIa`.
- `catalogo.sem_acento(text)` (immutable) e o gatilho `produto_busca_documento`: pesos A = sku/ean/nome, B =
  marca/categoria, C = atributos, D = conteúdo; config `portuguese`. Consulta da rota de busca:
  `documento @@ websearch_to_tsquery('portuguese', catalogo.sem_acento($texto))` ordenado por `ts_rank_cd`.
  O Catálogo mantém `produto_busca` a partir do produto do Core (consulta ou evento do Core) + conteúdo e atributos próprios.
- **Fica para depois:** `produto_embedding` (pgvector), porque exige `CREATE EXTENSION vector`, que nem todo ambiente de
  teste da nuvem tem; entra em migração própria quando o ranking semântico (RN-CAT-08) for ligado.

### Base de demo (0013)
33 produtos (linha automotiva + detergente 5 L para a busca em linguagem natural: "óleo para moto 150 cilindradas" acha
`OLE-4T-1L`), árvore de 3 níveis (Alimentos, Bebidas, Limpeza e higiene, Automotivo), conteúdo, atributos, 5 sinônimos,
documento de busca, 2 depósitos (CD Manaus, Loja Centro) com rupturas e saldos baixos, CX em 9 produtos. O preço
próprio da CX (3 produtos no Varejo) está pronto no seed mas DESLIGADO (`PRECO_PROPRIO_CX_LIGADO = false`) até a consulta
`catalogo.precos_cliente@1` filtrar `unidade is null` para o preço base: hoje ela lê todas as linhas do produto e leria a
da CX como preço da UN.
