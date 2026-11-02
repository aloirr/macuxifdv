# Promotor — coletas da loja, API, aba Loja e BKO de trade (T-0056)

Código: `modules/promotor/{domain,contracts,api,app,web}`. Regras de cálculo: [`regras.md`](regras.md). Eventos: [`eventos.md`](eventos.md).
RN-PRO-01: nenhuma rota, entidade, página ou ação do Promotor fala de pedido (testes `domain/rn-pro-01.test.ts`, `contracts/entidades.test.ts`, `api/rotas.test.ts`).

## 1. Entidades de sync (`contracts/entidades.ts`)
O `sync` do manifesto lista exatamente estas entidades (teste `contracts/entidades.test.ts`).

| Entidade | Direção | Conflito | Payload / linha | Evento publicado |
|---|---|---|---|---|
| `visita_loja` | push | `app_edita_ate_status` | `VisitaLoja` (o mesmo id vai aberto no check-in e fechado no checkout) | `promotor.visita_loja.concluida@1` no checkout |
| `foto_coleta` | push | `somente_insercao` | `FotoColeta` (+ `tx.registrarArquivo`, ADR 0010) | — |
| `checklist_resposta` | push | `somente_insercao` | `ChecklistResposta` | — |
| `gondola_registro` | push | `somente_insercao` | `GondolaRegistro` | `promotor.gondola.registrada@1` |
| `medicao_share` | push | `somente_insercao` | `MedicaoShare` | `promotor.share.medido@1` |
| `coleta_preco` | push | `somente_insercao` | `ColetaPreco` | `promotor.preco.coletado@1` |
| `ruptura_item` | push | `somente_insercao` | `RupturaItem` | `promotor.ruptura.registrada@1` |
| `validade_item` | push | `somente_insercao` | `ValidadeItem` | — |
| `ponto_extra` | push | `somente_insercao` | `PontoExtra` | — |
| `acao_concorrencia` | push | `somente_insercao` | `AcaoConcorrencia` | — |
| `tarefa_execucao` | push | `somente_insercao` | `TarefaExecucao` | `promotor.tarefa.concluida@1` |
| `categoria_gondola`, `checklist_loja`, `mix_obrigatorio`, `meta_share`, `concorrente`, `produto_concorrente`, `foto_referencia`, `tarefa_trade`, `ponto_extra_negociado` | pull | `servidor_vence` | linhas de `contracts/cadastros.ts` | — |

Alvo dos cadastros (RN-PRO-10, `domain/alvo.ts`): `cliente_id` = só a loja; `segmento` = lojas do segmento (`ClienteSync.segmento` do Core); os dois nulos = todas. Vale o mais específico (loja > segmento > todas) e, empatado, o de início de vigência mais recente.

## 2. Recebimento no servidor (`api/recebimento.ts`)
Mesmo caminho para o push do sync e para as rotas REST. Por item, na transação do tenant:
1. **perfil** — só o promotor coleta (doc 03 §2) → `PERFIL_SEM_ACESSO`;
2. **idempotência** — mesmo id e mesmo conteúdo = aceito sem 2º evento; conteúdo diferente = `conflito`; id de outro promotor = `ID_EM_USO`;
3. **visita de loja** — do próprio promotor (RN-CORE-04) e coleta **dentro da janela check-in..checkout** pelo instante da COLETA (RN-PRO-02, offline: coleta feita com a visita aberta e enviada depois do checkout é aceita) → `VISITA_LOJA_NAO_ENCONTRADA` / `RN-PRO-02`;
4. **carteira** — a loja está na carteira de quem envia → `FORA_DA_CARTEIRA`;
5. **fotos** — as fotos referenciadas são desta visita e já chegaram (RN-PRO-02) → `FOTO_NAO_RECEBIDA` / `RN-PRO-02`;
6. **preço** — variação acima de `variacao_preco_max_pct` sem `variacao_confirmada` → `RN-PRO-04`;
7. **checkout** — visita `realizada` com etapa obrigatória do checklist pendente → `RN-PRO-06`; permanência gravada = a recalculada (RN-PRO-07);
8. **evento** montado e validado pelo schema ANTES de gravar; grava e publica na mesma transação (outbox).

**Dependência que ainda não chegou** (visita ou foto da coleta) é retentável: no push volta `SYNC_NAO_IMPLEMENTADO` e o motor do app mantém o item `pendente`. Motivo: o `/v1/sync/push` agrupa os itens por entidade e não garante a ordem entre entidades diferentes do mesmo lote (pedido ao engenheiro-software de um código retentável próprio e/ou de preservar a ordem).

## 3. Rotas REST (`/v1/promotor`, `api/rotas.ts`)
O `createApp` aplica login, **licença do módulo**, perfil (ação do manifesto ou `perfis`), Zod e carteira.

| Método e caminho | Ação / perfis | Corpo / query | Resposta |
|---|---|---|---|
| `POST visitas-loja` | `coleta.registrar` (promotor); carteira pelo `cliente_id` | `VisitaLoja` | `{ id, situacao: criada \| repetida \| checkout }` |
| `POST coletas/fotos` · `checklist` · `gondola` · `share` · `precos` · `ruptura` · `validade` · `pontos-extras` · `concorrencia` · `tarefas` | ação de cada coleta (só promotor) | contrato da coleta | `ColetaRegistradaApi` |
| `GET relatorios/share` | supervisor, gerente, analista, admin (`PERFIS_RELATORIO`) | `FiltroRelatorio` (`de`, `ate`, `cliente_id`; padrão 30 dias no fuso do tenant) | `RelatorioShareApi` |
| `GET relatorios/ruptura` | idem | idem | `RelatorioRupturaApi` |

Recusa = `{ codigo, mensagem }` com o status da regra (403, 404, 409 `CONFLITO`, 422). Relatórios: escopo = promotores visíveis (`usuariosVisiveis`) **e** lojas da carteira (RN-CORE-04); só visitas que contam (RN-PRO-07); nome da loja pela consulta `core.cadastro_resumo@1` (ADR 0012) e da categoria pelo cadastro de trade.

## 4. Armazenamento e a migração 0015
`api/repositorio.ts` define `RepositorioPromotor` (visita, coletas, visitas do período, nomes das categorias) e a implementação **em memória** dos testes. A migração 0015 (schema `promotor`, banco-dados) já está no main e `moduloApi` sobe com `criarRepositorioSql()` (`api/repositorio-sql.ts`; SQL de referência em `docs/banco/promotor.md`).

**Repositório SQL (T-0056).** Só persistência: repetido × conflito × checkout continuam do domain/recebimento. Roda no `ClienteBanco` da transação de `ctx.comTenant` (papel `macuxi_app`, RLS), nunca em conexão própria. O INSERT grava só `id, tenant_id, promotor_id, [cliente_id,] payload (JSON.stringify + ::jsonb), recebido_em`; o gatilho deriva o resto. A tabela de cada entidade vem de um mapa fixo no código. `visita()` usa `FOR UPDATE` (envios simultâneos do mesmo id viram um). `gravarVisita` é `on conflict (id) do update set payload ... where checkout_em is null and promotor_id = excluded.promotor_id` (o `promotor_id` fica em coluna, fora do payload); 0 linhas afetadas lança `VISITA_LOJA_FECHADA` (409). `visitasDoPeriodo` converte `de`/`ate` em instantes UTC pelo fuso do tenant (`[meia-noite de de, meia-noite de ate+1)`): em Manaus, 23:59 local entra e 00:00 do dia seguinte fica fora. Corrida no `gravarColeta` (23505): a transação já está abortada e não dá para reler nela; o erro vira `503 COLETA_EM_CORRIDA` (retentável, o lote volta ao aparelho) e o reenvio lê a linha e decide repetida × conflito. Testes: `api/repositorio-sql.db.test.ts` (Postgres real; RLS A × B, idempotência, checkout, FK composta, limites do fuso).

**Pull dos cadastros de trade.** Próximo PR (T-0056 parte 2): até lá o pull dos 9 cadastros responde 501 `SYNC_NAO_IMPLEMENTADO` (ADR 0009 §7) e o aparelho segue com o cache local.

O que a 0015 precisa ter (recado ao banco-dados):
- `promotor.visita_loja` (colunas de `VisitaLoja` + `promotor_id`); `select … for update` por id;
- uma tabela por coleta (`foto_coleta`, `checklist_resposta`, `gondola_registro`, `medicao_share`, `coleta_preco`, `ruptura_item`, `validade_item`, `ponto_extra`, `acao_concorrencia`, `tarefa_execucao`) com as colunas do contrato + `visita_loja_id`, `promotor_id`, `cliente_id`, `recebido_em` (ou uma tabela `coleta` com `entidade` + `payload jsonb`, a critério do banco); PK `(tenant_id, id)`;
- índices: `visita_loja (tenant_id, checkin_em)`, `visita_loja (tenant_id, cliente_id, checkin_em desc)`, coletas `(tenant_id, visita_loja_id)`;
- cadastros de pull com as linhas de `contracts/cadastros.ts` (`updated_at`/`deleted_at` para o cursor do sync); seed da demo com categorias, mix, metas e um checklist para a loja do promotor;
- RLS ligado e as 6 colunas padrão em todas (regra 5).

## 5. Aba Loja (app Macuxi Campo, `app/`)
- Página `loja` (`navegacao: 'Loja'`, ícone `check`, `apps: ['campo']`, `acao: 'coleta.registrar'`, `ordem: 40`): só o promotor vê.
- Offline-first: lê o check-in aberto do Core (linhas `visita` + fila `visita`/`visita_checkout`), os cadastros de trade do pull e o estado do Promotor (`armazenamentoDoModulo('promotor')`); toda coleta vai para a fila do motor e é enviada em segundo plano.
- Fluxo: check-in (Core) → **Iniciar coletas nesta loja** → checklist, share (% e atingimento na hora), gôndola (fotos antes/depois + conformidade), mix (na gôndola / falta com estoque / sem estoque), preço (confirmação de variação), tarefas com foto → **Encerrar coletas da loja** (bloqueia com obrigatória pendente, RN-PRO-06).
- Câmera: o shell registra `definirCapturaFotoPromotor` (exportado de `@macuxi/promotor/app`), a mesma captura do Core (`fotos/<id>.jpg`); pode devolver a coordenada (sem ela a foto vai `sem_gps`, RN-PRO-02). Sem câmera registrada, a tela orienta o usuário.
- Toda a montagem das coletas está em `app/lib/loja.ts` (puro, testado) usando o domain.

## 6. BKO de trade (`web/`)
Página `trade` ("Trade marketing", grupo `analise`, perfis `PERFIS_RELATORIO`): KPIs de share médio × meta média × atingimento, tabela share × meta por loja/categoria, tabela de ruptura por loja (falha de reposição à parte), filtros na URL (`?de&ate&loja`) e exportação CSV (padrão Excel BR). Cadastros de trade (RF-PRO-11) e galeria de fotos ficam para depois da 0015.

## 7. Premissas (T-0056)
- A visita de loja usa o instante do check-in do Core; a janela da RN-PRO-02 é check-in..checkout (inclusive), pelo instante da coleta.
- Sem migração no main: produção sem recebimento (seguro, nada se perde); testes com repositório em memória.
- O "encerrar coletas" é separado do checkout do Core: a etapa `visita.etapas_checkout` (checklist como etapa do checkout do Core) e o mapeamento cliente fechado → `loja_fechada` ficam para a próxima fatia.
- Relatórios usam a última medição válida de cada loja/categoria (share) e a última visita válida com o mix conferido (ruptura) no período.
