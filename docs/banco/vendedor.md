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
(`TABELAS_FORA_DO_SYNC`). A aplicação lê, insere e atualiza (sem DELETE). Os seeds nunca baixam o contador; o seed demo
não reusa número já emitido, nem no `--recriar` (T-0026, ver [README.md](README.md), "Número do pedido na recarga").

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

### 0033 — aplicação no item (`0033_catalogo_aplicacao_referencia`; T-0084, RN-VEN-19)
**pedido_item.aplicacao** `text` nulo (nova):
- é o **retrato** da aplicação do produto no momento do pedido, ou seja, o que o cliente viu no orçamento;
- a API corta em `aplicacao_max_orcamento` (padrão 300, até 1.000), na última palavra inteira, com "…";
- nunca é trocada pelo cadastro atual;
- nulo = o vendedor desmarcou "Incluir aplicação no orçamento", o produto não tem aplicação, ou o item é anterior à 0033 (sem
  backfill);
- CHECK `pedido_item_aplicacao_tamanho` (`char_length <= 1000`).

Sai no detalhe do pedido (Campo, Gestão e BKO), nos dois PDFs e no pedido ao ERP (`vendedor.pedido.aprovado@1`, campo aditivo).

**Volta:** o `.down.sql` apaga a coluna com os retratos. O pedido não perde valor nem item.

**Fixture:** item 1 do p1 de A com "Motos 150 cc".

**Testes:** `db/testes/aplicacao-referencia.test.ts`.

## 0037 — formas de pagamento e prazos, pagamento do pedido (`0037_forma_prazo_escalonada`; T-0089, RN-VEN-24/25)
Desenho `docs/desenho/T-0089.md` §2, §4.1, §6 e §8 (P7 ajustada pelo gerente, R-20261106-074250). **Aditiva**: a condição antiga
(`condicao_pagamento`, `cliente_condicao`, `pedido.condicao_pagamento*`) fica como **legado** só de leitura para o APK antigo; nada
é apagado nem convertido. A mesma migração traz `core.cliente.prazo_medio_max_dias`/`formas_pagamento` (core.md) e
`catalogo.tabela_escalonada` (catalogo.md).

### forma_pagamento
| Coluna | Tipo | Regra |
|---|---|---|
| codigo | text not null | 1..20, não vazio; **único vivo por tenant** (`forma_pagamento_codigo_uk`) — é o código que `core.cliente.formas_pagamento` guarda |
| nome | text not null | 1..60, não vazio ("Pix", "Cartão") |
| ativo | boolean not null | padrão `true` |
| ordem | integer not null | padrão 0; ordem da lista |

Único `(tenant_id, id)` (alvo das FKs). Pull escopo tenant (`forma_pagamento_sync_ix`); `forma_pagamento_external_uk`. Volume: dezenas.
**Forma padrão (P7)**: todo tenant tem a forma **"À vista"** (`codigo = 'AVISTA'`, ordem 0, ativa, `external_id` nulo, id
`uuid_de_chave('<tenant>:vendedor.forma_pagamento:AVISTA'`) com o prazo "À vista". Existentes: backfill da 0037. Novos: gatilho
`tenant_semear_pagamento` (AFTER INSERT em `plataforma.tenant`, como a 0006 e a 0018), então o `provisionar_tenant` (tenant:criar e o
passo Empresa do portal), os seeds e as fixtures já recebem. `vendedor.semear_pagamento(tenant)` só semeia se o tenant **não tem
nenhuma forma** (viva ou apagada): quem apagou a padrão não a recebe de volta. Sem EXECUTE para ninguém além do dono.

### prazo_pagamento
| Coluna | Tipo | Regra |
|---|---|---|
| forma_pagamento_id | uuid not null | FK composta `(tenant_id, forma_pagamento_id)` → `forma_pagamento` (`prazo_pagamento_forma_ix`) |
| codigo | text not null | 1..20; **único vivo NO TENANT** (não só na forma): vai no `condicao_pagamento_codigo` do `vendedor.pedido.aprovado@1` e no de-para do Hub |
| descricao | text not null | 1..60 ("28/56 dias", "À vista"): só o prazo, sem o prazo médio |
| parcelas_dias | integer[] not null | `vendedor.parcelas_validas`: 1 dimensão, 1..24 itens, cada um 0..365 e não nulo, **sem decrescer**; `{0}` = à vista |
| prazo_medio_dias | integer not null | **gravado** pela API/consumidor com o `prazoMedioDias` do domain (média arredondada para cima, P2: 28/56 = 42). O banco NÃO recalcula; `vendedor.prazo_medio_coerente` só confere que fica entre a menor e a maior parcela |
| ativo, ordem | | como na forma |

Pull escopo tenant; `prazo_pagamento_sync_ix`, `prazo_pagamento_external_uk`. Volume: dezenas.

### pedido (novas, nulas; pedido antigo e do APK antigo ficam nulos)
`forma_pagamento_id` e `prazo_pagamento_id` (FKs compostas no schema: `pedido_forma_pagamento_fk`, `pedido_prazo_pagamento_fk`) e o
**retrato** no aceite: `forma_pagamento_codigo`, `forma_pagamento_nome`, `prazo_codigo`, `prazo_descricao`, `prazo_parcelas_dias`
integer[] e `prazo_medio_dias`. CHECK **`pedido_pagamento_completo`**: as 8 juntas ou nenhuma; `pedido_prazo_parcelas_validas` e
`pedido_prazo_medio_coerente` (mesmas regras do prazo). Prazo da forma, ativos, permitidos ao cliente e dentro do prazo médio dele
(RN-VEN-24/25) e a RN-VEN-13 (título vencido) são da API (`validarPagamento`). Parâmetro `titulo_vencido_dias` (5): padrão no código
do Vendedor (nenhuma migração semeia parâmetro do Vendedor).

**Base de demo (T-0089)**: Pix e Dinheiro à vista; Cartão 30 e 30/60; Boleto 28, 28/56 e 30/60/90 (médios 0, 0, 30, 45, 28, 42,
60); a "À vista" padrão apagada; as 4 condições antigas mantidas (`db/seeds/demo/pagamento.ts`).
**Volta** (`.down.sql`): apaga gatilho e funções, as colunas do pedido (o pedido novo perde forma e prazo), as tabelas e as colunas
do cliente. Testes: `db/testes/forma-prazo-escalonada.test.ts` (estático, CHECKs, únicos, FKs, semeadura, RLS, up/down).

## 0050 — devolução do pedido (`0050_vendedor_pedido_devolucao`; T-0054, RN-VEN-37)
Pedidos R-20261102-132023 (item 4) e R-20261102-190604 do modulo-vendedor. Consumidor: `integracao.nota.atualizado@1`
(`criarConsumidorNotaDevolucao` em `modules/vendedor/api/retorno-erp.ts`), só nota `tipo = devolucao` com `pedido_uuid`.

**pedido_devolucao** — uma linha **viva** por nota de devolução do ERP. Colunas: `pedido_id` uuid not null (FK composta
`pedido_devolucao_pedido_fk` (tenant_id, pedido_id) → `vendedor.pedido`), `external_id` text **not null** (a chave da nota no ERP;
CHECK `pedido_devolucao_external_id_preenchido`, sem só espaços), `nota_numero` text not null, `nota_serie` text, `emitida_em`
timestamptz not null, `total_cents` bigint not null (CHECK `pedido_devolucao_total_nao_negativo`, >= 0) e as colunas comuns.
- **Único parcial** `pedido_devolucao_external_uk` (tenant_id, external_id) where deleted_at is null: o upsert do consumidor acha a
  linha viva pela nota (`select ... where external_id = $1 and deleted_at is null for update`); nota cancelada, inativada, sem
  pedido ou que deixou de ser devolução sai por **soft delete** (update `deleted_at`), e a mesma nota pode voltar numa linha nova.
- **Índice** `pedido_devolucao_pedido_ix` (tenant_id, pedido_id): a soma do devolvido e o detalhe do pedido.
- **O devolvido do pedido é a soma das linhas vivas** (decisão do banco-dados; opção dada no R-20261102-190604): não há
  `pedido.devolvido_cents`, para não haver duas verdades. A devolução não muda o status do pedido.
- **Fora do sync** (`TABELAS_FORA_DO_SYNC`; sem índice (tenant_id, updated_at, id)): só o servidor grava e soma; o aparelho recebe
  o devolvido pelo resumo do pedido. Volume baixo (devolução é rara; 1..2 por pedido).
- RLS forçado, `isolamento_tenant`, `manutencao` (0031), gatilho `pedido_devolucao_updated_at`; **select, insert, update** ao
  `macuxi_app` (sem delete). Sem dado pessoal.

**Fixture** (`DEVOLUCOES_FIXTURE`, grupo 0x3d): A com a parcial viva no p3 (R$ 200,00) e a mesma nota apagada; B com uma viva no p1.
**Volta** (`.down.sql`): `drop table if exists vendedor.pedido_devolucao` (as devoluções gravadas se perdem; volte antes o
Vendedor para `DEVOLUCAO_LIGADA = false`). Testes: `db/testes/pedido-devolucao.test.ts` (estático, Drizzle, upsert/soft delete e
soma com os comandos do consumidor, CHECKs, FK de outro tenant, sem DELETE, RLS entre tenants, EXPLAIN dos índices, up/down).

## 0055 — endereço de entrega editado só no pedido (`0055_vendedor_endereco_editado`; T-0141 C, RN-VEN-17)
Desenho: `docs/desenho/T-0141.md` §2.1 e §6 (engenheiro-software). **Sem coluna nova**: o retrato `pedido.endereco_entrega`
(jsonb, 0013) é "o endereço do pedido" e ganha o campo `origem`. O endereço editado vale só para o pedido (e o orçamento);
o cadastro do cliente (`core.cliente_endereco`) não muda.

| Campo do retrato | `origem: 'erp'` (escolhido da lista) | `origem: 'editado'` (digitado) |
|---|---|---|
| `id` | id do `core.cliente_endereco` | `null` |
| `external_id` | o do ERP | `null` (o Conector usa os campos de texto) |
| `tipo`, `descricao` | do Core | ausente / `null` |
| `logradouro`, `numero`, `complemento`, `bairro`, `cidade`, `uf`, `cep` | do Core (como veio) | o digitado, normalizado (UF maiúscula, CEP só dígitos) |
| `principal` | do Core | `false` |
| coluna `endereco_entrega_id` | o id escolhido | `null` |

`origem` **ausente = 'erp'** (pedidos anteriores à T-0141 e APK que manda só o id): sem migração de dados.
CHECKs (defesa; a regra é do domain do Vendedor, `enderecoDoPedido`, e a API revalida):
- `pedido_endereco_entrega_origem`: retrato nulo, ou `origem` ausente/nula, `'erp'` ou `'editado'`;
- `pedido_endereco_editado_sem_id`: editado ⇒ coluna `endereco_entrega_id`, `id` e `external_id` do retrato nulos (um editado
  com o `external_id` do ERP levaria a entrega ao endereço do cadastro sem avisar);
- `pedido_endereco_editado_completo`: editado ⇒ logradouro, número, bairro e cidade preenchidos, `uf` `^[A-Z]{2}$`, `cep`
  `^[0-9]{8}$`. Os limites de tamanho (60/20/60/60/60) ficam no contrato (`EnderecoEditadoPedido`).
Drizzle: `EnderecoEntregaPedido` (com `origem`, `id`, `external_id`, `tipo`, `principal` opcionais) e `ORIGENS_ENDERECO_ENTREGA`
em `modules/vendedor/db/nuvem.ts`. Sync, políticas, grants e índices não mudam.
**Seed demo**: o p11 (aprovado, Lucas) com o endereço editado `ENDERECO_EDITADO_DEMO` (Av. Torquato Tapajós, 7500, Flores,
CEP 69058830), sem endereço no cadastro; os outros pedidos ficam no formato antigo (sem `origem`).
**Volta** (`.down.sql`): só remove os 3 CHECKs (os retratos editados ficam no jsonb e continuam legíveis). Testes:
`db/testes/pedido-endereco-editado.test.ts` (estático, gravação e leitura, 13 recusas, RLS entre tenants, up/down) e
`seed-demo.test.ts` (pedido editado da demo).

## 0056 — filial no pedido (`0056_core_filial`; T-0149, RN-CORE-39, RN-VEN-02, ADR 0040, desenho docs/desenho/T-0149.md §3.3)
Pedido R-20261110-064112-engenheiro-software.
| Coluna | Regra |
|---|---|
| `pedido.filial_id uuid` | id de `core.filial` (SEM FK, fronteira). Nulo nos pedidos anteriores à 0056 |
| `pedido.filial jsonb` | retrato no recebimento: `{ id, codigo, nome, cidade, uf, external_id, padrao }` (`RetratoFilial` de `modules/vendedor/domain/filial-pedido.ts`, tipo do `$type` em `modules/vendedor/db/nuvem.ts`) |

- CHECKs: `pedido_filial_objeto` (objeto) e `pedido_filial_coerente` (os dois nulos, ou os dois preenchidos com
  `filial->>'id' = filial_id`). Vale também para o orçamento (mesma tabela).
- Quem grava: a API do Vendedor no recebimento, na edição do orçamento e na conversão, com a filial **efetiva** do cliente
  (`core.cadastro_resumo@1`); o `branch_id` do aparelho é ignorado. A reserva (RN-VEN-20) desconta do saldo da filial do pedido.
- Índice parcial `pedido_filial_ix (tenant_id, filial_id) where filial_id is not null` (filtro "Filial" da lista do BKO).
- Pull: o retrato vai no `PedidoSyncSchema.filial` (detalhe offline). Volta: as 2 colunas, os CHECKs e o índice saem.
  Testes: `db/testes/filial.test.ts`.

### 0059 — dados fiscais no retrato da filial (T-0159; sem DDL no Vendedor)
O cabeçalho do PDF de pedido e de orçamento mostra CNPJ, endereço e telefone da **filial de faturamento do pedido**
(R-20261110-215816, dono do produto). `pedido.filial` é jsonb com CHECK só de objeto e de id coerente: o retrato passa a levar
`cnpj` (14 dígitos), `logradouro`, `numero`, `complemento`, `bairro`, `cep` (8 dígitos) e `telefone` **sem migração** no
Vendedor, ao lado de `cidade`/`uf` (os nomes de `core.filial`, "0059" em core.md). Quem monta é `retratoFilialDoPedido`
(domain do Vendedor); a seed da demo usa a mesma função. Tipo: `RetratoFilial` (`Omit<Filial, 'ativo'>` do Core); pedidos anteriores ficam como
estão. Testes: `db/testes/filial-dados-fiscais.test.ts`.

## 0060 — marca no item (`0060_vendedor_pedido_item_marca`; T-0159, pedido R-20261110-215723-modulo-vendedor)
| Coluna | Regra |
|---|---|
| `pedido_item.marca text` | retrato de `core.produto.marca` no **recebimento** (coluna "Marca" do PDF, versões cliente e escritório), como `aplicacao` (0033): gravado pela API do Vendedor, nunca editado. 1..100 sem branco (`pedido_item_marca_tamanho`); `core.produto.marca` não tem limite no banco, então a API corta em 100 e grava nulo se vier vazia. Nulo = produto sem marca ou item anterior à 0060 |

- Sem backfill e sem índice (lida com os itens do pedido, por `pedido_id`). Aparelho: `ent_pedido_item` é JSON, sem DDL.
- Seed da demo: os itens dos pedidos levam a marca (fictícia) do produto.
- Volta (`0060_vendedor_pedido_item_marca.down.sql`): apaga o CHECK e a coluna (as marcas retratadas se perdem). Testes:
  `db/testes/pedido-item-marca.test.ts`.

## 0061 — filial no item, para a reserva por filial (`0061_vendedor_reserva_filial`; T-0149, RN-VEN-20, RN-CORE-39)
Não há tabela de reserva gravada: a reserva do RN-VEN-20 são os itens dos pedidos aceitos e ainda não faturados, cancelados ou
rejeitados. Para somar por filial numa tabela só, a filial do pedido passa a existir também no item, **derivada por gatilho**.
| Coluna | Regra |
|---|---|
| `pedido_item.filial_id uuid` | = `pedido.filial_id` do pedido do item (SEM FK, fronteira). Nulo = pedido sem filial (anterior à 0056). **Somente leitura**: a API nunca grava (o valor enviado é sobrescrito) |

- Gatilhos: `pedido_item_filial` (BEFORE INSERT/UPDATE OF `pedido_id`, `tenant_id`, `filial_id`; copia do pedido) e
  `pedido_filial_nos_itens` (AFTER UPDATE OF `filial_id` em `vendedor.pedido`, só quando muda; leva a filial nova aos itens, que
  ganham `updated_at` novo). Funções `vendedor.pedido_item_filial()` e `vendedor.pedido_filial_nos_itens()` (invoker, RLS vale).
- Backfill no up: a filial do pedido quando houver, com o gatilho de `updated_at` desligado (nenhum item volta ao pull).
- Índice `pedido_item_reserva_filial_ix (tenant_id, produto_id, filial_id) include (pedido_id, quantidade_base,
  quantidade_faturada) where deleted_at is null and filial_id is not null`. Consulta-modelo (reservado do produto na filial; o
  status fica com a API, `disponivelNaFilial` em `modules/vendedor/domain/estoque-filial.ts`):
  `sum(i.quantidade_base - i.quantidade_faturada)` de `pedido_item i join pedido p` com `i.tenant_id, i.produto_id, i.filial_id`
  fixos, `p.tipo = 'pedido'`, `p.deleted_at is null` e `p.status in ('received','pending_approval','approved','sent_to_erp',
  'integrated','invoiced_partial')`.
- RLS, políticas e grants sem mudança. Aparelho: sem DDL (`ent_pedido_item` é JSON; a coluna não entra no contrato de sync).
- Volta (`0061_vendedor_reserva_filial.down.sql`): apaga índice, gatilhos, funções e a coluna; nada se perde (a filial continua
  em `pedido.filial_id`). Testes: `db/testes/reserva-filial.test.ts`.
