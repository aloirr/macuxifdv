# Dicionário de dados — schema `vendedor`

Migrações: `db/migrations/0007_vendedor_pedido.up.sql` (Sprint 1: `pedido` e `pedido_item` para o pull; volta = `drop schema
vendedor cascade`, apaga os pedidos) e `0009_vendedor_pedido_completo.up.sql` (T-0029, fatia do pedido: número, retrato,
aprovação, histórico e condições; volta = `.down.sql`, apaga histórico, condições, contador e as colunas novas; os pedidos
ficam). Drizzle: `modules/vendedor/db/nuvem.ts` (uso interno do Vendedor). Origem da 0009: desenho `docs/desenho/T-0029.md`
§10, ADR 0011; pedidos R-20261101-042135-engenheiro-software e R-20261101-044128-modulo-vendedor (nomes exatos do pull).

Campos comuns, RLS forçado (`isolamento_tenant`), gatilho de `updated_at`, índice de sync `(tenant_id, updated_at, id)` e
`external_id` único por tenant, como em [plataforma.md](plataforma.md).

**Fronteira**: nenhuma FK para outro schema. `cliente_id`, `vendedor_id`, `autor_id`, `produto_id`, `visita_id`,
`rota_parada_id`, `tabela_preco_id` e `decidido_por_id` são validados pela API do Vendedor (consultas `core.cadastro_resumo@1`
e `catalogo.precos_cliente@1`, ADR 0012). FK só dentro do schema, composta por tenant: `pedido_item → pedido`,
`pedido_evento → pedido`, `pedido → condicao_pagamento`, `cliente_condicao → condicao_pagamento`; e `tenant_id → plataforma.tenant`.

**Listas fechadas** (fonte da verdade = código do Vendedor; `db/testes/estatico.test.ts` compara):
- status (`pedido.status`, `pedido_evento.de/para`) = `ORDER_STATUSES` (`modules/vendedor/domain/order.ts`, RN-VEN-30):
  `draft, queued, received, pending_approval, approved, sent_to_erp, integrated, invoiced_partial, invoiced, rejected, cancelled`;
- níveis (`pedido.nivel_aprovacao`, `pedido_evento.nivel`) = `NIVEIS_APROVACAO`: `supervisor, gerente, analista`;
- motivos (`pedido.motivos_aprovacao`) = `MOTIVOS_APROVACAO`: `desconto, credito, estoque, preco_minimo`.
O vocabulário do doc 03 (`STATUS_CONTRATO`: `em_aprovacao`, `aprovado`...) é só dos eventos e **não** vai ao banco.
Mudar uma lista é migração nova.

## pedido
| Coluna | Tipo | Regra |
|---|---|---|
| id | uuid | gerado no aparelho |
| cliente_id | uuid not null | sem FK (fronteira) |
| vendedor_id | uuid not null | dono do pedido; pedido em nome conta para o vendedor (RN-CORE-21) |
| autor_id | uuid not null | quem digitou (vendedor ou gestor em nome, RN-VEN-35) |
| status | text not null | `ORDER_STATUSES`; padrão `draft` |
| condicao_pagamento | text | legado (texto); a condição do pedido é `condicao_pagamento_id` |
| desconto_pct | numeric(5,2) not null | 0 a 100 |
| total_tabela_cents, total_cents | bigint not null | ≥ 0; **calculados pelo servidor** (RN-VEN-02) |
| observacao | text | |
| visita_id, rota_parada_id | uuid | sem FK (schema core) |
| criado_no_aparelho_em, recebido_em | timestamptz | |
| numero_erp | text | |
| motivo_cancelamento | text | |
| **numero** (0009) | text | legível, 6 dígitos (`000001`), **único por tenant** (`pedido_numero_uk`, parcial `numero is not null`); gerado só no servidor por `vendedor.proximo_numero_pedido()`; nulo nos pedidos anteriores à 0009 |
| **hash_envio** | text | sha256 **hex minúsculo** (64) do payload canônico do push (RN-VEN-33: reenvio igual = aceito sem efeito; diferente = conflito). Fora do pull |
| **cliente_resumo** | jsonb | retrato do cliente no aceite (D-6): `{ razao_social, nome_fantasia, documento, endereco, bairro, cidade, uf, codigo_erp }`; objeto. Fora do pull |
| **cliente_nome**, **vendedor_nome** | text | retrato (lista, detalhe e PDF sem consultar outro módulo) |
| **tabela_preco_id** | uuid | tabela do cliente usada no cálculo (sem FK: schema catalogo) |
| **condicao_pagamento_id** | uuid | FK `pedido_condicao_fk` para `condicao_pagamento`; tem de estar entre as do cliente (RN-VEN-14, a API valida) |
| **condicao_pagamento_descricao** | text | retrato da descrição |
| **nivel_aprovacao** | text | `NIVEIS_APROVACAO` ou nulo; **obrigatório em `pending_approval`** (`pedido_pendente_com_nivel`) |
| **motivos_aprovacao** | text[] not null | subconjunto de `MOTIVOS_APROVACAO`; padrão `{}` |
| **aprovacao_automatica** | boolean not null | `true` = aprovado dentro da alçada no recebimento (D-2); padrão `false` |
| **decidido_por_id**, **decidido_em** | uuid, timestamptz | quem aprovou/rejeitou e quando (decisão humana) |
| **motivo_rejeicao** | text | **obrigatório em `rejected`, 3+ caracteres sem contar espaços** (RN-GES-08, `pedido_rejeitado_com_motivo`) |

Índices: `pedido_vendedor_sync_ix (tenant_id, vendedor_id, updated_at, id)` (pull por usuários visíveis);
`pedido_cliente_ix (tenant_id, cliente_id, created_at desc)`; `pedido_visita_ix (tenant_id, visita_id)` parcial;
`pedido_status_ix (tenant_id, status, created_at desc)` (lista do BKO e "para aprovar"); `pedido_numero_uk`; único
`(tenant_id, id)` (alvo das FKs). Volume alto: ~20 pedidos por vendedor por dia; janela do pull: criado ≥ hoje − 90 ou
status não final.

**Dados antigos na 0009**: `pending_approval` sem nível recebeu o nível pela alçada padrão do doc 03 (desconto ≤ 10%
supervisor, ≤ 15% gerente, acima analista) e motivos `{desconto}`; `rejected` sem motivo recebeu "Rejeitado antes do
registro do motivo.". O down tira as colunas (esses valores se perdem).

### Número legível — `vendedor.proximo_numero_pedido()`
Contador por tenant em `numeracao_pedido` (sequência **sem buraco** e sem revelar o volume de outro tenant). Função SQL
`SECURITY INVOKER` (RLS vale): usa `app.tenant_id`; sem contexto, falha. A linha do contador fica travada até o fim da
transação (pedidos do mesmo tenant numeram em fila; rollback devolve o número). **Uso no `receber`**: depois de saber que o
pedido é novo (idempotência), na mesma transação, por exemplo
`insert ... on conflict (id) do nothing returning id` e, se inseriu, `update vendedor.pedido set numero =
vendedor.proximo_numero_pedido() where id = $1`. Chamar num reenvio consome um número à toa.

## pedido_item
| Coluna | Tipo | Regra |
|---|---|---|
| pedido_id | uuid not null | FK composta para `pedido` |
| sequencia | integer not null | ≥ 1; único **constraint** `(tenant_id, pedido_id, sequencia)` (desenho T-0011 §3; alvo de `on conflict`) |
| produto_id | uuid not null | sem FK (cadastro base no Core) |
| quantidade | integer not null | > 0 |
| preco_tabela_cents, preco_unitario_cents, total_cents | bigint not null | ≥ 0 |
| desconto_pct | numeric(5,2) not null | 0 a 100 |
| **produto_sku**, **produto_nome**, **unidade** (0009) | text | retrato do produto no aceite (D-6) |

Pull com o escopo do pedido (join por `pedido_id`), índice de sync.

## pedido_evento (0009)
Linha do tempo do pedido (RF-VEN-05) e auditoria de negócio: uma linha por transição (`null → received`,
`received → approved | pending_approval`, `pending_approval → approved | rejected`, `→ cancelled`). A aplicação **só lê e
insere** (sem UPDATE/DELETE: histórico não se edita).

| Coluna | Tipo | Regra |
|---|---|---|
| pedido_id | uuid not null | FK composta para `pedido` |
| de | text | `ORDER_STATUSES` ou nulo (primeira transição) |
| para | text not null | `ORDER_STATUSES`; `de ≠ para` |
| autor_id, autor_nome, autor_perfil | uuid, text, text | retrato de quem fez (vendedor no recebimento automático) |
| motivo | text | "Dentro da alçada (5,0%)", texto da pendência, comentário ou motivo da rejeição |
| nivel | text | `NIVEIS_APROVACAO` ou nulo |
| acima_do_nivel | boolean not null | gerente decidiu um pedido do nível do supervisor (RN-GES-04); padrão `false` |
| ocorrido_em | timestamptz not null | padrão `now()` |

Índices: `pedido_evento_pedido_ix (tenant_id, pedido_id, ocorrido_em)` (detalhe e join do pull); sync. Volume: 2 a 3 por pedido.

## condicao_pagamento (0009)
| Coluna | Tipo | Regra |
|---|---|---|
| codigo | text not null | não vazio; único vivo por tenant |
| descricao | text not null | não vazia |
| ativo | boolean not null | padrão `true` |
| padrao | boolean not null | **no máximo uma padrão viva por tenant** (`condicao_pagamento_padrao_uk`); padrão tem de estar ativa |

Pull escopo tenant. Volume baixo.

## cliente_condicao (0009)
| Coluna | Tipo | Regra |
|---|---|---|
| cliente_id | uuid not null | sem FK (Core) |
| condicao_pagamento_id | uuid not null | FK composta para `condicao_pagamento` |

Par `(cliente_id, condicao_pagamento_id)` único vivo. Cliente sem linha viva = só a condição padrão (RN-VEN-14). Pull escopo
carteira. Volume = clientes × 1..4.

## numeracao_pedido (0009)
| Coluna | Tipo | Regra |
|---|---|---|
| ultimo | bigint not null | último número usado; ≥ 0 |

Uma linha por tenant (único `(tenant_id)`; id = `plataforma.uuid_de_chave('<tenant>:vendedor.numeracao_pedido')`). Fora do sync
(`TABELAS_FORA_DO_SYNC`). A aplicação lê, insere e atualiza (sem DELETE). Os seeds nunca baixam o contador.

No `pg` cru: `bigint` e `numeric` chegam como string (converta no provedor); `text[]` chega como array.

## 0013 — orçamento, frete, transportadora, entrega, unidade e faturamento (`0013_catalogo_vendedor_prevenda`)
Pedidos: T-0053/T-0054, R-20261102-093007 (novo pedido), R-20261102-094644 (preço mínimo). Todas as colunas novas são
opcionais ou têm padrão (rotas e APKs antigos continuam gravando).

**pedido** (novas): `tipo` pedido|orcamento (padrão pedido); `orcamento_validade` date (só orçamento); `orcamento_id`
(no pedido gerado pela conversão; FK no schema; único parcial = um orçamento vira no máximo um pedido); `convertido_em`
(no orçamento); `acrescimo_pct` numeric(5,2) (excludente com `desconto_pct`); `desconto_efetivo_pct` numeric(6,2)
(RN-VEN-03, sem frete, pode ser negativo); `frete_modalidade` CIF|FOB (R-20261102-105040: o pedido não tem valor de
frete); `transportadora_id` (FK `transportadora`); `transportadora_digitada` bool;
`transportadora_nome`, `transportadora_documento` (CNPJ 14 dígitos), `transportadora_telefone` (retrato da cadastrada ou
o digitado); `endereco_entrega_id` (core.cliente_endereco, sem FK) + `endereco_entrega` jsonb (retrato);
`enviado_erp_em`, `integrado_em`, `faturado_em`, `total_faturado_cents` (padrão 0).
CHECKs: orçamento só em draft/queued/received/cancelled (nunca aprovação nem ERP, RN-VEN-13/32); validade e conversão
só no orçamento; desconto **ou** acréscimo; CIF (a empresa paga, incluso no preço) sem transportadora; FOB (o cliente
paga) exige `transportadora_id` ou transportadora digitada; digitada exige nome e CNPJ e não tem `transportadora_id`.
`total_cents` não muda com o frete (RN-VEN-03, RN-CORE-21). Padrão do tenant: parâmetro `frete_modalidade_padrao` (CIF),
sem linha na demo (ausente = padrão).

**pedido_item** (novas): `fator` int > 0 (padrão 1); `quantidade_base` = quantidade × fator **preenchida pelo gatilho
`pedido_item_quantidade_base`** (o valor enviado é sobrescrito); `acrescimo_pct` (excludente com `desconto_pct`);
`preco_minimo_cents` (retrato RN-VEN-11); `quantidade_faturada` na UNIDADE BASE, de 0 a `quantidade_base` (padrão 0; T-0061 §2.1).

**transportadora** (RF-VEN-13): nome, documento (CNPJ, único vivo quando informado), inscricao_estadual, telefone, ativo.
Pull escopo tenant.

**pedido_faturamento** (RN-INT-08): pedido_id (FK), `evento_id` (id do evento `integracao.pedido.retorno_erp@1`; único por
tenant = idempotência), parcial, numero_erp, nota_numero, nota_serie, nota_emitida_em, nota_total_cents, `itens` jsonb
`[{sequencia, produto_id, quantidade (unidade base), total_cents}]`, faturado_em. A aplicação só lê e insere. Índice (tenant, pedido,
faturado_em).

## 0018 — medida no item do pedido (`0018_medidas`; T-0063, RN-VEN-15)
**pedido_item** (novas, **derivadas — nunca grave nelas**): `medida` text null (sigla vendida), `quantidade_embalagem` int not
null (unidades por embalagem; 1 na unidade) e `quantidade_unidades` int not null (total em unidades). **Fonte única =
`unidade`/`fator`/`quantidade`** (0009/0013): o gatilho **`pedido_item_medida`** (BEFORE INSERT/UPDATE) **sempre sobrescreve**
`medida = vendedor.medida_do_item(unidade)` (função IMMUTABLE: `upper(btrim(unidade))` se casar `^[A-Z]{1,4}$`, senão **nula**),
`quantidade_embalagem = fator` e `quantidade_unidades = quantidade × fator` (= `quantidade_base`, que o gatilho
`pedido_item_quantidade_base` da 0013 calcula do mesmo jeito; a ordem entre os dois não importa). O que vier nas três é ignorado
(não vira 23514/500). CHECKs travam a coerência mesmo com o gatilho desligado: `pedido_item_medida_formato`,
`pedido_item_medida_derivada` (`medida is not distinct from medida_do_item(unidade)`), `pedido_item_quantidade_embalagem_positiva`,
`pedido_item_embalagem_coerente` (= fator) e `pedido_item_quantidade_unidades_coerente` (= quantidade × fator). O código atual do
Vendedor (grava `unidade`/`fator`) continua igual.
**Por que não `GENERATED ALWAYS ... STORED`** (preferência do gerente na revisão 🟡1, com fallback): coluna gerada recusa valor
explícito no INSERT (`428C9`), e os testes de isolamento (`db/testes/vazamento.test.ts` e
`tests/integracao/multitenant/vazamento-escrita.test.ts`) copiam linhas inteiras com `INSERT ... SELECT
(jsonb_populate_record(...)).*` em toda tabela com `tenant_id` — mesmo motivo da 0015 (`promotor.derivar_*`). Gatilho que sempre
sobrescreve + CHECKs = mesma garantia (não divergem), sem quebrar a cópia.
**Retrato, sem FK para `core.medida`** (fronteira entre schemas): a API do Vendedor valida a sigla contra o Core.
**Backfill** dos itens existentes: **não reescreve `unidade`** (nem normaliza) e **não mexe em `updated_at`** (o gatilho
`pedido_item_updated_at` fica desligado só nesse UPDATE, dentro da transação; nada é puxado de novo pelo app). Unidade histórica
fora do formato (ex.: `CAIXA`, `CX12`, que a 0013 aceitava) **não aborta**: fica com `medida` nula e a migração emite um NOTICE
`tenant <codigo> (<id>): '<unidade>' x<n>`. Item sem `unidade` ou com `medida` nula: exibir a `unidade` gravada (ou a do produto).
PDF: "CX c/ 12" = `medida` + `quantidade_embalagem`.
Espelho Drizzle em `modules/vendedor/db/nuvem.ts` (T-0070): as três colunas como comuns, documentadas "somente leitura — nunca grave"
(`quantidade_embalagem`/`quantidade_unidades` com `$defaultFn` só para o insert tipado; o gatilho sobrescreve).
`COLUNAS_SEM_ESPELHO_DRIZZLE` (`db/src/excecoes.ts`) ficou vazia.

## 0020 — ajuste em R$ no pedido e no item (`0020_pedido_ajuste_valor_produto_relacao`; T-0071, RN-VEN-02/03/18)
Desenho `docs/desenho/T-0071.md` §5 (premissas confirmadas em R-20261103-140707). **Aditiva**: padrões constantes, nenhuma
linha reescrita; pedido anterior fica `0`/`0`/`'pct'` (quem precisa do R$ dele usa Σ (`preco_unitario_cents` × `quantidade`) − `total_cents`).

**pedido** (novas): `desconto_valor_cents` e `acrescimo_valor_cents` bigint not null default 0 = o R$ do ajuste do PEDIDO,
**sobre o total dos itens** (digitado, ou derivado do % pela API); `ajuste_em` text not null default `'pct'` ∈ `pct | valor`
(`MODOS_AJUSTE` no Drizzle) = o que o vendedor digitou (Editar e Duplicar reabrem no mesmo modo). `desconto_pct`/`acrescimo_pct`
continuam com o % (digitado, ou o equivalente com 2 casas no modo `valor`): quem já lê o pedido não muda.
CHECKs: `pedido_ajuste_valor_nao_negativo` (>= 0), `pedido_ajuste_valor_exclusivo` (desconto **ou** acréscimo em R$),
`pedido_ajuste_sentido_coerente` (% e R$ em sentidos opostos são recusados: desconto em R$ exige `acrescimo_pct = 0` e acréscimo em
R$ exige `desconto_pct = 0`), `pedido_ajuste_em_valido`. "R$ do pedido > total dos itens" é recusado pela API (`ajuste_invalido`).
Índice **`pedido_orcamento_aberto_ix`** `(tenant_id, vendedor_id, orcamento_validade) where tipo = 'orcamento' and convertido_em
is null and deleted_at is null`: lista de Orçamentos por vendedor/validade e janela do pull (orçamento aberto entra mesmo com
mais de 90 dias; desenho §1.4 b).

**pedido_item** (novas): `desconto_unitario_cents` e `acrescimo_unitario_cents` bigint not null default 0 = R$ por unidade da
**medida vendida** (1 FD, 1 CX, 1 UN), **sempre gravado** (digitado, ou `preco_tabela_cents − preco_unitario_cents` no modo %);
`ajuste_em` ∈ `pct | valor`. Semântica gravada (desenho §2.1): `preco_unitario_cents` = preço final da medida vendida depois do
ajuste do item e antes do ajuste do pedido; `total_cents` da linha = `preco_unitario_cents × quantidade − rateio do ajuste do pedido`.
CHECKs: `pedido_item_ajuste_valor_nao_negativo`, `pedido_item_ajuste_valor_exclusivo`, `pedido_item_ajuste_sentido_coerente`
(como no pedido, contra `desconto_pct`/`acrescimo_pct` do item), **`pedido_item_desconto_unitario_ate_tabela`**
(`desconto_unitario_cents <= preco_tabela_cents`), **`pedido_item_ajuste_unitario_coerente`** (com R$ gravado:
`preco_unitario_cents = preco_tabela_cents − desconto_unitario_cents + acrescimo_unitario_cents`; item legado 0/0 fica fora) e
`pedido_item_ajuste_em_valido`. O teto do preço mínimo (RN-VEN-11) continua na API (`preco_abaixo_minimo`).
Caso da referência (desenho §3.2): café 1890 − R$ 1,00 → `desconto_unitario_cents = 100`, `preco_unitario_cents = 1790`,
`desconto_pct = 5.29`, `ajuste_em = 'valor'`; água 1790 com 5% → 1701, `desconto_unitario_cents = 89`, `ajuste_em = 'pct'`.
**Volta** (`.down.sql`): apaga as colunas e o índice; o pedido mantém o % equivalente, o preço final e o total (só se perde o
modo digitado e o R$ exato). Testes: `db/testes/ajuste-valor-produto-relacao.test.ts` (checks, padrão, up/down com dados).

**Base de demo (T-0071)**: cliente **Mini Box Japiim** (`C5110`, Mercadinho, Av. Ajuricaba 1200 + endereço de entrega, sem
título vencido nem bloqueio, condições À vista/28/28-56) para reproduzir a referência; pedidos recentes do Lucas em 3 mercadinhos
(clientes parecidos, desenho §4.3); alçada do vendedor 5%. Ver [README.md](README.md), "Base de demo".
