# Dicionário de dados — schema `promotor`

Migração: `db/migrations/0015_promotor.up.sql` (T-0056; pedido R-20261102-131328-2-modulo-promotor; desenho em
`docs/modulos/promotor/coletas.md` §4). Volta: `0015_promotor.down.sql` = `drop schema if exists promotor cascade` — **apaga**
visitas de loja, coletas (só metadados das fotos; os binários ficam em `plataforma.arquivo`/armazenamento) e todos os
cadastros de trade; a licença `promotor` em `plataforma.tenant_modulo`/`perfil_modulo` fica. Pré-condição do down: 0016+ desfeitas.
Contratos: `modules/promotor/contracts/coletas.ts` (coletas) e `contracts/cadastros.ts` (linhas do pull). Testes:
`db/testes/promotor.test.ts` (estático + Postgres), `db/testes/seed-demo-promotor.test.ts`. Espelho Drizzle
(`modules/promotor/db/nuvem.ts`, T-0070): as 20 tabelas, comparadas com a 0015 (`estatico.test.ts`) e com o banco migrado
(`drizzle-x-banco.test.ts`); listas fechadas `*_BANCO` = CHECKs (`promotor.test.ts`). Colunas derivadas das coletas = somente leitura.

Campos comuns (`id`, `tenant_id`, `created_at`, `updated_at`, `deleted_at`, `external_id`), RLS ligado e **forçado** com a
política `isolamento_tenant` (`tenant_id = plataforma.tenant_atual()` no USING e no WITH CHECK, papel `macuxi_app`),
gatilho de `updated_at`, índice de sync `(tenant_id, updated_at, id)` e `external_id` único por tenant entre os vivos, como
em [plataforma.md](plataforma.md). `macuxi_worker`: nenhum privilégio (eventos `promotor.*@1` vão pela outbox, ADR 0007).

**Fronteira (ADR 0012)**: nenhuma FK para outro schema. `cliente_id`, `promotor_id`, `produto_id`, `visita_id` (Core) e
`arquivo_id` (plataforma) são validados pela API. FKs só para `plataforma.tenant` e dentro do schema, compostas por tenant.
**RN-PRO-01**: nenhuma tabela, coluna, índice ou função fala de pedido (teste estático).

**Listas fechadas** (fonte = código do Promotor; `promotor.test.ts` compara): `visita_loja.desfecho` = `DESFECHOS_VISITA`
(`realizada, loja_fechada, acesso_negado`); `foto_coleta.tipo` = `TIPOS_FOTO`; `gondola_registro.conformidade` =
`CONFORMIDADES`; `ruptura_item.status` = `STATUS_PRESENCA`; `ponto_extra.tipo` e `ponto_extra_negociado.tipo` =
`TIPOS_PONTO_EXTRA`; `validade_item.tipo` = `validade, avaria`; `acao_concorrencia.tipo` = `lancamento, promocao, acao_pdv, outro`.
O tipo da etapa do checklist (`TIPOS_ETAPA_CHECKLIST`) fica dentro do jsonb `itens` (a API confere). Mudar lista = migração nova.

## Como as coletas são guardadas (payload + colunas derivadas)
- Uma tabela por entidade de sync (11). A linha guarda o **payload do contrato exatamente como a API aceitou** (`payload jsonb`,
  com os defaults do Zod explícitos). Ele é a fonte da verdade e a base da idempotência: no reenvio a API lê a linha e compara
  com `mesmoConteudo` do domain (repetido × conflito). Voltar de `timestamptz`/`numeric` mudaria o texto e daria conflito falso.
- `CHECK (payload.id = id)`: o id da linha é o UUID gerado no aparelho; reenvio com o mesmo id bate na PK (**23505**).
- As colunas tipadas (instantes, ids, números, listas) são **derivadas** do payload pelo gatilho `promotor.derivar_<tabela>()`
  (BEFORE INSERT OR UPDATE) e servem a índices, relatórios e CHECKs. O gatilho **sempre sobrescreve** o que vier nelas: a API
  grava só `(id, tenant_id, promotor_id, [cliente_id,] payload, recebido_em)`. Nome da coluna = chave do payload = chave do contrato.
- **Por que não `GENERATED ALWAYS … STORED`**: coluna gerada recusa valor explícito no INSERT (`428C9`) e os testes de isolamento
  (`db/testes/vazamento.test.ts`, `tests/integracao/multitenant/vazamento-escrita.test.ts`) copiam linhas inteiras com
  `INSERT … SELECT jsonb_populate_record(...)` para provar o RLS (esperam 42501). Com o gatilho a cópia chega ao WITH CHECK.
- Instantes: `promotor.instante_iso(text)` aceita só ISO 8601 UTC com `Z` (`AAAA-MM-DDTHH:MM:SS[.fração]Z`); data civil:
  `promotor.data_iso(text)` (`AAAA-MM-DD`). Fora do formato = nulo, e o CHECK de obrigatórios recusa (**23514**). São IMMUTABLE
  (com `Z`/ISO o resultado não depende de TimeZone/DateStyle); `execute` só para `macuxi_app`.
- Coleta presa à visita: FK composta `(tenant_id, visita_loja_id, promotor_id, cliente_id) → visita_loja (tenant_id, id,
  promotor_id, cliente_id)` (`visita_loja_dono_uk`): a coleta é da visita, **do mesmo promotor e da mesma loja**; visita de
  outro promotor, outra loja ou outro tenant = **23503** (RN-PRO-02, RN-CORE-04). Sem FK da coleta para cadastro de trade
  (`*_id` da versão vigente, RN-PRO-10): a API decide se aceita id de versão já removida.

## Grants (`macuxi_app`)
| Tabelas | Privilégios |
|---|---|
| 9 cadastros de trade | `select, insert, update` (BKO edita; removido = `deleted_at`, o pull leva a lápide). **Exceção desde a 0045:** `concorrente` só `select` (legado, ADR 0034) |
| `visita_loja` | `select, insert` + `update (payload)` — o checkout troca o payload; o gatilho rederiva o resto |
| 10 coletas | `select, insert` (somente inserção; correção = nova coleta) |
| todas | **sem DELETE** (42501), sem TRUNCATE/REFERENCES/TRIGGER |

## Cadastros de trade (pull; servidor vence; BKO de trade RF-PRO-11)
Alvo (RN-PRO-10): `cliente_id` (uma loja) **ou** `segmento` (lojas do segmento, `ClienteSync.segmento` do Core) **ou** nenhum
(todas as lojas) — CHECK `*_alvo_unico`. Vigência por data civil no fuso do tenant (`vigencia_fim` nulo = sem prazo; CHECK
`fim >= início`). As colunas são exatamente as das linhas de `contracts/cadastros.ts` (+ `tenant_id`, `created_at`).

| Tabela | Colunas próprias | Regras / índices |
|---|---|---|
| categoria_gondola | nome text (1–120), ordem int (0), ativo bool | nome único entre vivas sem diferenciar maiúsculas (`categoria_gondola_nome_uk`) |
| checklist_loja | alvo, vigência, nome text, itens jsonb (array de `ChecklistItem`: id, rotulo, tipo, obrigatoria, ordem, categoria_gondola_id) | **uma versão por (alvo, início)** entre vivas (`checklist_loja_versao_uk`, `nulls not distinct`); `(tenant_id, cliente_id)` |
| mix_obrigatorio | alvo, vigência, produto_id uuid, categoria_gondola_id uuid → categoria (FK composta) | uma versão por (produto, alvo, início) (`mix_obrigatorio_versao_uk`, `nulls not distinct`) |
| meta_share | alvo, vigência, categoria_gondola_id → categoria, meta_pct numeric(5,2) 0–100 | uma versão por (categoria, alvo, início) (`meta_share_versao_uk`) |
| concorrente | nome (1–120), ativo | nome único entre vivos. **LEGADO desde a 0045 (T-0113, ADR 0034):** as linhas foram copiadas com os mesmos ids para `catalogo.marca_concorrente` (o cadastro de marcas é do Catálogo; o Promotor lê por `catalogo.marcas@1`); a tabela fica **só de leitura** para o `macuxi_app` (insert/update revogados = 42501) até a fase 2 (drop, não antes de 2026-12-08) |
| produto_concorrente | concorrente_id = id da marca do Catálogo (**sem FK desde a 0045**; antes → concorrente), nome (1–200), produto_id (nosso), categoria_gondola_id → categoria, ativo | nome único por concorrente; `(tenant_id, produto_id)` |
| foto_referencia | alvo, vigência, categoria_gondola_id → categoria, arquivo_id (sem FK, ADR 0010), descricao (≤ 300) | `(tenant_id, categoria_gondola_id)` |
| tarefa_trade | alvo, vigência, titulo (1–160), instrucao (≤ 1000), prazo date | `(tenant_id, cliente_id)` |
| ponto_extra_negociado | cliente_id (obrigatório), tipo, local_combinado (1–500), produto_id, vigência | `(tenant_id, cliente_id)` |

**Pull pelo cursor** (todas as 9, mesmo padrão do Core; sem filtro de `deleted_at`, a lápide vai ao aparelho):
```sql
select id, nome, ordem, ativo, updated_at, deleted_at, external_id
  from promotor.categoria_gondola
 where tenant_id = $1 and (updated_at, id) > ($2::timestamptz, $3::uuid)
 order by updated_at, id
 limit $4;                                      -- índice categoria_gondola_sync_ix (tenant_id, updated_at, id)
```
A vigência e o alvo são resolvidos no aparelho/API pelo domain (`domain/alvo.ts`, `domain/vigencia.ts`); o pull leva todas as
versões vivas e as lápides.

## Coletas (push; ~8 visitas por promotor/dia, ~40 coletas por visita)
Base de toda coleta: `id`, `tenant_id`, `promotor_id` (do token), `cliente_id` (a loja da visita), `payload jsonb`,
`recebido_em timestamptz` (instante do servidor no aceite), comuns. **Derivadas** (gatilho) abaixo. Índices de toda coleta:
`(tenant_id, visita_loja_id)` (por visita) e o de sync.

| Tabela | Derivadas do payload | CHECKs / índices extras |
|---|---|---|
| visita_loja | visita_id, **cliente_id**, checklist_modelo_id, checkin_em, checkout_em, permanencia_min numeric, desfecho, foto_fachada_id (sem `cliente_id` de base: vem do payload) | obrigatórios (visita, loja, check-in); checkout completo (`checkout_em`, `desfecho` e `permanencia_min` juntos); checkout ≥ check-in; RN-PRO-06 loja fechada/acesso negado exigem `foto_fachada_id`; `visita_loja_dono_uk`; índices `(tenant_id, checkin_em)`, `(tenant_id, cliente_id, checkin_em desc)`, `(tenant_id, promotor_id, checkin_em desc)`, `(tenant_id, visita_id)` |
| foto_coleta | visita_loja_id, tipo, tirada_em, sem_gps, arquivo_ref | tipo em `TIPOS_FOTO` |
| checklist_resposta | visita_loja_id, checklist_item_id, obrigatoria, concluida, respondido_em | sem único por item (a última resposta vale, RN-PRO-06) |
| gondola_registro | visita_loja_id, categoria_gondola_id, foto_antes_id, foto_depois_id, conformidade, registrado_em | conformidade em `CONFORMIDADES` |
| medicao_share | visita_loja_id, categoria_gondola_id, frentes_nossas, frentes_total, share_pct, meta_share_id, meta_pct, atingimento_pct, medido_em | frentes ≥ 0; pct 0–100; `(tenant_id, cliente_id, categoria_gondola_id, medido_em desc)` (última por loja/categoria) |
| coleta_preco | visita_loja_id, produto_id, concorrente_id, produto_concorrente_id, preco_cents, preco_promocional_cents bigint, em_promocao, indice_preco, coletado_em | preços > 0 (centavos); produto do concorrente exige concorrente; `(tenant_id, cliente_id, produto_id, coletado_em desc)` (última coleta do item na loja, RN-PRO-04) |
| ruptura_item | visita_loja_id, produto_id, mix_obrigatorio_id, status, quantidade_reposta, registrado_em | status em `STATUS_PRESENCA`; ruptura total ⇒ reposta 0; `(tenant_id, cliente_id, registrado_em desc)` |
| validade_item | visita_loja_id, produto_id, tipo, validade date, quantidade, registrado_em | tipo `validade` exige a data; quantidade > 0; `(tenant_id, validade)` parcial (alertas de vencimento) |
| ponto_extra | visita_loja_id, ponto_extra_negociado_id, tipo, existe, no_lugar, abastecido, registrado_em | tipo em `TIPOS_PONTO_EXTRA`; `(tenant_id, ponto_extra_negociado_id)` parcial |
| acao_concorrencia | visita_loja_id, concorrente_id, tipo, registrado_em | tipo da lista |
| tarefa_execucao | visita_loja_id, tarefa_trade_id, concluida_em | `foto_ids` com ≥ 1 foto; `payload.cliente_id = cliente_id` (a loja da visita); `(tenant_id, tarefa_trade_id)` |

## SQL da `RepositorioPromotor` (modules/promotor/api/repositorio.ts)
Tudo na transação aberta por `ctx.comTenant` (papel `macuxi_app`, `app.tenant_id` = tenant do token); `$t` = `tenant_id`.
Mapear a linha → `VisitaLojaGuardada` = `{ ...payload, promotor_id }`; → `ColetaGuardada` = `{ entidade, id, visita_loja_id,
promotor_id, cliente_id, payload, recebido_em }`. Payload entra como `JSON.stringify(payload)`; volta como objeto (jsonb).

```sql
-- visita(s, id): trava a linha até o fim da transação (envios simultâneos do mesmo id viram um)
select id, promotor_id, payload from promotor.visita_loja where tenant_id = $t and id = $1 for update;

-- gravarVisita(s, v): 1º envio insere; checkout troca o payload SÓ se a visita ainda está aberta e é do mesmo promotor
-- (a decisão repetido/conflito/checkout é do domain: transicaoVisitaLoja, com a linha travada acima)
insert into promotor.visita_loja as v (id, tenant_id, promotor_id, payload, recebido_em)
values ($1, $t, $2, $3::jsonb, now())
on conflict (id) do update set payload = excluded.payload
 where v.checkout_em is null and v.promotor_id = excluded.promotor_id;      -- rowCount 0 = nada mudou (fechada)

-- coleta(s, entidade, id): <tabela> = a da entidade (mapa fixo no código, nunca texto do cliente)
select id, visita_loja_id, promotor_id, cliente_id, payload, recebido_em from promotor.<tabela> where tenant_id = $t and id = $1;

-- gravarColeta(s, c): só INSERT (o reenvio igual foi resolvido antes pela leitura; corrida = 23505 → reler e comparar)
insert into promotor.<tabela> (id, tenant_id, promotor_id, cliente_id, payload, recebido_em)
values ($1, $t, $2, $3, $4::jsonb, $5);
-- 23503 = visita de outro promotor/loja/tenant (FK composta); 23514 = payload fora do formato (id, instante sem Z...)

-- coletasDasVisitas(s, entidade, ids): índice <tabela>_visita_ix (tenant_id, visita_loja_id)
select id, visita_loja_id, promotor_id, cliente_id, payload, recebido_em
  from promotor.<tabela> where tenant_id = $t and visita_loja_id = any($1::uuid[]) and deleted_at is null
 order by visita_loja_id, id;

-- visitasDoPeriodo(s, {de, ate, fuso, cliente_id?}): data LOCAL do check-in no fuso do tenant -> limites em instantes UTC
-- (meia-noite de `de` e de `ate + 1` no fuso); índice visita_loja_checkin_ix (tenant_id, checkin_em)
select id, promotor_id, payload from promotor.visita_loja
 where tenant_id = $t
   and checkin_em >= ($1::date)::timestamp at time zone $3
   and checkin_em <  ($2::date + 1)::timestamp at time zone $3
   and ($4::uuid is null or cliente_id = $4)        -- com loja: visita_loja_cliente_ix
   and deleted_at is null
 order by checkin_em, id;

-- nomesDasCategorias(s, ids): id sem cadastro fica fora do mapa
select id, nome from promotor.categoria_gondola where tenant_id = $t and id = any($1::uuid[]);
```
Ex.: em Manaus (UTC−4) o dia D vai de `D 04:00Z` a `D+1 04:00Z` (exclusivo): check-in às 23:59 locais entra (03:59Z de D+1);
00:00 de D+1 fica de fora — `promotor.test.ts` prova os limites e o uso do índice.

## Seed da demo e fixture
- Demo: `db/seeds/demo/promotor.ts` — `dadosDemoPromotor({ hoje })` (pura) e `gravarDemoPromotor(admin, { hoje })` (dentro da
  transação do `carregarDemo`; exige a 0015, banco local e o tenant demo). Licença Promotor no tenant e para promotor,
  supervisor, gerente, analista e admin (mesmos ids do `demo.ts`; nunca Vendedor para o promotor); 3 categorias (Mercearia,
  Bebidas, Limpeza), mix de 5 produtos, metas de share (gerais + Mercearia da loja 0), checklist com 5 etapas (2 obrigatórias),
  2 concorrentes e 4 produtos comparados (um por categoria; o de Bebidas entrou na T-0070 para o BKO de trade da T-0069), 1 tarefa de campanha, 1 ponto extra negociado na loja 0, e as visitas de loja da Joana ligadas às
  visitas `v-pr1` (loja 0) e `v-pr2` (loja 4) do Core com fotos, gôndola, share (domain), ruptura, preços, checklist, validade,
  ponto extra, concorrência e tarefa. Ligar no `demo.ts`: ver a entrega da T-0056 (uma linha no `carregarDemo`, antes do commit).
- Fixture dois-tenants: `db/seeds/fixtures/promotor.ts` — ver [fixture-dois-tenants.md](fixture-dois-tenants.md) §T-0056.

## Pendências
- Esquema local `modules/promotor/db/local.ts`, se o app usar (banco-dados local). O espelho Drizzle da nuvem entrou na T-0070.
- `criarRepositorioSql()` em `modules/promotor/api` com o SQL acima (modulo-promotor).

**Base de demo, T-0085 (0033) e T-0113 (0045):** desde a 0045 as 6 marcas da demo (2 do trade e 4 de autopeças) são gravadas em `catalogo.marca_concorrente` pelo seed do Catálogo, antes deste, com os mesmos ids; o seed do Promotor só as grava no cadastro antigo numa base sem a 0045. As 4 de autopeças: Freiomax, Rodaforte, Filtrobom e Vialume (`external_id` `MARCA-<NOME>`, sem produto comparado nem coleta). São as marcas das referências cruzadas do Catálogo da demo, em `db/seeds/demo/catalogo-cadastro.ts`.
