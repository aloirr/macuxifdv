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
próprio da CX (3 produtos no Varejo; o café entrou na T-0071) estava pronto no seed mas DESLIGADO — **ligado na T-0071**, ver "produto_relacao" abaixo — (`PRECO_PROPRIO_CX_LIGADO = false`) até a consulta
`catalogo.precos_cliente@1` filtrar `unidade is null` para o preço base: hoje ela lê todas as linhas do produto e leria a
da CX como preço da UN.

## produto_relacao (0020, `0020_pedido_ajuste_valor_produto_relacao`; T-0071, RF-CAT-03)
Relacionados do produto, base das sugestões do novo pedido (consulta `catalogo.sugestoes_pedido@1`, desenho
`docs/desenho/T-0071.md` §4.2) e da ficha. Pull escopo **tenant** (~5 linhas por produto; entidade `produto_relacao`).

| Coluna | Tipo | Regra |
|---|---|---|
| `produto_id` | uuid not null | produto de origem (core.produto, **sem FK**: fronteira; a API do Catálogo valida) |
| `relacionado_id` | uuid not null | produto sugerido (sem FK); `produto_relacao_nao_e_de_si`: diferente de `produto_id` |
| `tipo` | text not null | `complementar` ("Combina com o pedido"), `superior` ("Leve mais": versão superior), `substituto` (ficha/ruptura) — `produto_relacao_tipo_valido` = `TIPOS_RELACAO_PRODUTO` do contrato |
| `ordem` | integer not null default 0 | posição dentro do produto (a consulta percorre os produtos do pedido na ordem das linhas e, em cada um, pela `ordem`) |
| `ativo` | boolean not null default true | inativa = não sugere (fica para o BKO reativar) |

Únicos/índices: `produto_relacao_uk (tenant_id, produto_id, relacionado_id, tipo) where deleted_at is null` (também atende a
consulta das sugestões `produto_id = any(...) and tipo in (...)`), `produto_relacao_external_uk` (external_id vivo),
`produto_relacao_sync_ix (tenant_id, updated_at, id)`. RLS forçado (`isolamento_tenant`), gatilho `produto_relacao_updated_at`,
grant select/insert/update/delete ao `macuxi_app`. Origem hoje: base demo; depois entidade canônica no Hub (ERP) e aba
"Relacionados" no BKO do Catálogo (fila de corte). Volta: `.down.sql` apaga a tabela com os dados.
Testes: `db/testes/ajuste-valor-produto-relacao.test.ts` (RLS, checks, únicos, gatilho, up/down).

### Base de demo (T-0071)
Produtos novos (Varejo e Atacado, com estoque): `FIL-103` Filtro de papel 103 c/ 30 (R$ 5,49), `LPO-400` Leite em pó integral
400 g (R$ 16,90) e `AGU-1500` Água mineral 1,5 L (fardo 6) (R$ 19,90). `ACU-1K` Açúcar cristal 1 kg passa a R$ 4,99.
Relações: `CAF-500` → `ACU-1K`, `FIL-103`, `LPO-400` (complementar, ordem 1..3); `AGU-500` → `AGU-1500` (superior). Embalagens
da referência: `CAF-500` CX c/ 12 com **preço próprio** no Varejo (R$ 215,46 = 18,90 × 12 × 0,95) e `BIS-400` CX c/ 20 sem preço
próprio (UN × fator = R$ 117,80). O preço próprio da CX ficou **ligado** (`PRECO_PROPRIO_CX_LIGADO = true`): depende da correção
de `precosDoCliente` (só `unidade is null` no preço base; linhas com unidade em `embalagens[]`), entregue pelo modulo-catalogo na
mesma T-0071 — carregar esta base na demo só depois dela.

## 0033 — aplicação, etiquetas, referência cruzada e busca (`0033_catalogo_aplicacao_referencia`; T-0084 e T-0085)
Desenhos `docs/desenho/T-0084.md` §6 e `T-0085.md` §7; regras RN-CAT-09 (referência cruzada), RN-CAT-11 (aplicação), RN-CAT-12
(busca pela aplicação) e RF-CAT-09 (Catálogo do cadastro). **Correção do gerente (05/11, 21h, ordem do Alexandre):** as marcas
concorrentes NÃO vão para o Core (a ADR 0027 não vale). O Catálogo lê as marcas pelo contrato que o **Promotor** já publica (cadastro
`concorrente`). A 0033 não toca em `core.*` nem em `promotor.*`.

**`produto_conteudo`**
- `aplicacoes` (a "Aplicação" / descrição 2; o nome da coluna não muda; nos contratos novos o campo é `aplicacao`): até
  **2.000** caracteres (`produto_conteudo_aplicacoes_tamanho`). O up corta em 2.000 (sem espaço no fim) o que estiver acima,
  antes do CHECK; demo e fixtures não tinham nenhum texto acima.
- `etiquetas text[] not null default '{}'` (nova): etiquetas curtas (posição, lado, "novo"). Até 4, cada uma não nula, não vazia
  e com até 20 caracteres (`produto_conteudo_etiquetas_validas`, pela função imutável `catalogo.etiquetas_validas(text[])`,
  porque CHECK não aceita subconsulta).

**`produto_busca`** (documento do servidor)
- Colunas novas:
  - `aplicacao text`: a API grava o `textoIndice` de `expandirAplicacao`, com os anos de dentro das faixas;
  - `referencias text`: códigos crus + compactos das referências.
- Gatilho `produto_busca_documento`:
  - **A** = sku, ean, nome e referencias;
  - **B** = marca e categoria;
  - **C** = atributos e aplicacao;
  - **D** = conteudo (que deixa de levar a aplicação).
- Backfill na migração: `aplicacao = produto_conteudo.aplicacoes`, em texto cru. A API reescreve expandido na próxima gravação
  ou pela reindexação do modulo-catalogo.

**`produto_referencia`** (nova): referência cruzada, "Equivale a: <marca> <código>" (RN-CAT-09). Pull escopo **tenant**
(entidade `produto_referencia`). Volume: até 3 × produtos (60 mil linhas com 20 mil produtos).

| Coluna | Tipo | Regra |
|---|---|---|
| `produto_id` | uuid not null | core.produto, **sem FK** (fronteira; a API valida) |
| `marca_id` | uuid not null | id da marca no cadastro `concorrente` do **Promotor**, lido pelo contrato do Promotor, **sem FK** (regra 1). Marca inativa: a referência sai da busca e da tela (filtro na leitura) |
| `codigo` | text not null | como foi escrito ("CB 3401"); `produto_referencia_codigo_preenchido`: `btrim` não vazio e até 30 caracteres |
| `codigo_compacto` | text not null | forma normalizada para a busca (sem acento, minúsculas, só `[a-z0-9]`: "CB 3401", "cb-3401" e "C.B.3401" = `cb3401`). **Gravada pela API** com o `codigoCompacto` do domain do Catálogo (uma implementação só; não é coluna gerada). O banco só confere `^[a-z0-9]{1,30}$` (`produto_referencia_codigo_compacto_formato`). Não vai ao aparelho (ele recalcula) |
| `ordem` | smallint not null | 1..3 (`produto_referencia_ordem_faixa`) |

Únicos e índices:
- `produto_referencia_ordem_uk (tenant_id, produto_id, ordem)` vivo: dá **no máximo 3 vivas por produto** e serve a leitura por
  produto (ficha, `catalogo.textos_produto@1`);
- `produto_referencia_codigo_uk (tenant_id, produto_id, marca_id, codigo_compacto)` vivo: a mesma marca não repete o código, nem
  com outra grafia;
- `produto_referencia_codigo_compacto_ix (tenant_id, codigo_compacto text_pattern_ops)` vivo: busca pelo código do concorrente
  por igualdade e por prefixo (`like 'cb34%'`);
- `produto_referencia_sync_ix (tenant_id, updated_at, id)` e `produto_referencia_external_uk`.

RLS forçado (`isolamento_tenant` + `manutencao`), gatilho `produto_referencia_updated_at`, grant select/insert/update/delete ao
`macuxi_app`.

**Sem mudança de schema:**
- "oferece junto" = `produto_relacao` com `tipo = 'complementar'`; o limite de 5 por produto fica no domain e na API;
- hierarquia sistema › grupo › linha = `catalogo_no` (níveis 1..8) + `produto_no`, da 0013.

**Volta:** o `.down.sql` apaga `produto_referencia` com os dados, as etiquetas e as colunas da busca, e devolve o gatilho da 0013
(recalcula o documento). O corte em 2.000 feito no up não volta.

**Testes:** `db/testes/aplicacao-referencia.test.ts` (estático; no CI: checks, peso C, RLS, únicos, sem FK, índice e up/down
com dados) e `db/testes/aparelho-sqlite.test.ts` (FTS v3 no aparelho).

### Base de demo (T-0084/T-0085)
- **4 autopeças novas** no fim da lista:
  - `PST-D01` Pastilha de freio dianteira (R$ 89,90);
  - `DSC-D01` Disco de freio dianteiro ventilado (R$ 159,90);
  - `FOL-G01` Filtro de óleo (R$ 28,90);
  - `AMR-T01` Amortecedor traseiro (R$ 219,90).
- **Árvore:** Freios › Pastilhas › Dianteiras, Freios › Discos › Dianteiros, Filtros › Filtros de óleo › Linha leve e Suspensão ›
  Amortecedores › Traseiros.
- **Aplicação** em 5 das 12 autopeças:
  - pastilha: "Fiat Uno 1.0/1.4 2010–2014; Fiat Palio 1.0/1.4 2012–2016";
  - filtro: "VW Gol G5/G6 1.0/1.6 2009–2016; VW Voyage 1.0/1.6 2009–2016";
  - amortecedor: "… a partir de 2018";
  - lâmpada H4: texto com mais de 300 caracteres e sem separador;
  - óleo 4T.
  - Os demais produtos ficam **sem** aplicação. Antes, todo produto tinha um texto padrão, que agora sairia no orçamento.
- **Sinônimos:** `vw` = volkswagen e `gm` = chevrolet.
- **Oferece junto:** pastilha → disco e fluido; filtro → óleo 5W30.
- **Referências** (`db/seeds/demo/catalogo-cadastro.ts`):
  - "CB 3401" (Freiomax) e "RF-1187" (Rodaforte) na pastilha;
  - "FB-0207" (Filtrobom) no filtro;
  - outras no disco, no amortecedor e na lâmpada ("VL H4.6055", Vialume).
  - As marcas são **fictícias**, cadastradas em `promotor.concorrente` (seed do Promotor).
  - As marcas próprias do fluido e da câmara passaram a Dotflex e Pneumaq, para não coincidir com as concorrentes.
- **Etiquetas:** "Dianteira" e "Novo" na pastilha, "Dianteira" no disco, "Traseira" no amortecedor e "Novo" no filtro.
- O documento de busca do servidor sai com a aplicação expandida e os códigos.
