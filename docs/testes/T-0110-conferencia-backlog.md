# T-0110 — Conferência do backlog antigo e dos PRs abertos de 04/11

> Dono: testes · 2026-11-07 (noite) · base: `main` em `e00a52df` (HEAD local) · só leitura: nenhum código de produção alterado.
> Método: cada item de `docs/backlog.md` conferido no código (grep/leitura) e no `git log -S`/`--grep`; os PRs pelo
> `git fetch origin pull/N/head`, merge-base `a9d9fcc` e comparação linha a linha do que o PR acrescenta com o arquivo no `main`.
> Legenda: **FEITO** (com commit ou arquivo) · **PARCIAL** · **NÃO FEITO** · **COBERTO** (já tem tarefa aberta T-0095+) · **OBSOLETO**.

## 1. Resumo

| Grupo | Itens | Feito | Parcial | Não feito | Coberto por tarefa aberta | Obsoleto/decisão |
|---|---|---|---|---|---|---|
| PRs #85–#89 | 5 | 5 (todos já no `main`) | — | — | — | — |
| Topo "Sprint 1" | 4 | 3 | — | — | 1 (T-0008) | — |
| "Futuro (histórico)" F01–F60 | 60 | 25 (+F60 feito/coberto) | 6 | 3 | 21 | 4 |
| "Pendências da T-0029" P01–P27 | 27 | 18 | — | 1 | 7 | 1 |

Os "não feito" e as partes que faltam dos "parcial" sem tarefa aberta viram as propostas N1 a N8 (§6.3).

**Fechar:** os 5 PRs; os itens marcados FEITO abaixo (saem do backlog com o commit); e, dentro das tarefas
T-0101, T-0102, T-0103, T-0105 e T-0106, os subitens que já estão no `main` (§5).
**Vira tarefa (sem tarefa hoje):** N1 a N8 (§6). O mais grave é o **N1** (refresh do BKO em `localStorage`, marcado
no backlog como "obrigatório antes do primeiro deploy", e a produção já tem roteiro de ligar).

## 2. PRs abertos de 04/11

Todos têm merge-base `a9d9fcc` e nenhum é ancestral do `main`, mas **cada commit do PR tem um equivalente no `main`**
(mesmo assunto, aplicado pelos lotes locais de 04/11). As poucas linhas do PR que não estão no `main` são versões
**anteriores** de trechos que o `main` já reescreveu depois (revisões de UX e T-0089/T-0090). Nada a trazer.

| PR | Conteúdo | Commit equivalente no `main` | O que difere | Decisão |
|---|---|---|---|---|
| #85 | T-0073/T-0072 card "Pedidos para aprovar" e visual do Gestão | `4d081160` | 8 linhas, todas versões antigas: `parado` com tom `erro` (no `main` é `aviso`, `equipe-agora.ts:14`), cores `danger`/`warning` (no `main` `warningInk`), título fixo da ficha (no `main` muda com o erro, `ficha-screen.tsx:52`), vazio de alertas (no `main` também considera pendências, `alertas-screen.tsx:67`) | **Fechar** sem merge |
| #86 | T-0071 3 🔴 e 🟡 de UX; PUT do orçamento idempotente (RN-VEN-33) | `65c550c1`, `c6c05548`, `ff9ea986` | `hash_envio`/idempotência estão em `modules/vendedor/api/orcamentos.ts:81-113`; `estadoDoDetalheAusente`, `folhaDoTransformar`, `abasDoPedido` em `textos-pedido.ts` e usados em `order-detail-screen.tsx:103,194`. O que difere são imports e linhas de tela que a T-0089/T-0090 reescreveu (aba Itens, totais do detalhe). O CI vermelho do PR não importa: o conteúdo seguiu verde pelo `main` | **Fechar** sem merge |
| #87 | T-0063 POST de medida idempotente sob concorrência (RN-CORE-19) | `1ef97f04` | nada (todas as linhas no `main`) | **Fechar** |
| #88 | T-0071 `deposito` e `estoque_saldo` no pull do Catálogo | `c33d4950` | só o cabeçalho e o import de `modules/catalogo/api/sync.ts`, que hoje listam mais entidades (`tabela_escalonada`, miniatura); `entidadeDeposito`/`entidadeEstoqueSaldo` em `sync.ts:95-96`; `sync-estoque.db.test.ts` idêntico | **Fechar** |
| #89 | coord: status da demo e recados de 04/11 | `78016629` | nada | **Fechar** |

## 3. Topo do backlog ("Sprint 1, abertas no quadro")

| Item | Situação | Evidência |
|---|---|---|
| T-0007 Produto no dono definitivo | FEITO | tarefa `concluida`, merge `6fba044` |
| T-0008 Adaptador SQLite | COBERTO | segue `em_teste` no quadro (faltam números da medição no aparelho); expo-sqlite pela ADR 0023 e passagem AsyncStorage→SQLite (`f8cb4a26`, `b320034c`) |
| T-0009 Integração: domínio e contratos | FEITO | `concluida`, merge `e20f6ac` |
| T-0010 Promotor: domínio | FEITO | `concluida`, merge `3352d2e` |

→ Remover T-0007, T-0009 e T-0010 dessa lista; manter só a T-0008.

## 4. Seção "Futuro (histórico)"

| # | Item | Situação | Evidência / onde está |
|---|---|---|---|
| F01 | Portal 🟢 seg.: segredo do TOTP na área de transferência; nome do secret nas páginas públicas | COBERTO (T-0093) | o TOTP sai com o portal só com e-mail e senha (T-0093, em andamento na árvore: `cadastro-totp.tsx` removido, ainda não commitado) |
| F02 | Portal 🟢: regex do `hosts-bko.test.ts` sem porta; limite do openapi.json atrás do rewrite | COBERTO (revisão R da T-0093) | o teste já tem casos com porta (`hosts-bko.test.ts:22-29`, `42008034`); conferir o 🟢 exato na revisão R |
| F03 | Portal 🟢14/15: cartões das bases com a última carga (rota de lotes por entidade) | COBERTO (T-0104) | não feito |
| F04 | Tabs, Progress, ButtonLink no kit | COBERTO (T-0104) | `packages/ui/src/web/ui.tsx` não tem Tabs/ButtonLink; 5 cópias de `tablist` (`tela-empresa.tsx`, `licencas-page.tsx`, `produtos-page.tsx`, `cadastros-page.tsx`, `trilhas-page.tsx`); `ProgressBar` só no mobile (`ui.tsx:198`) |
| F05 | Conector avisa ordem divergente | FEITO | `033489ae` (T-0099, #101) |
| F06 | Conector "nulo: limpa" por campo | FEITO | `033489ae` (T-0099, #101) |
| F07 | Miniatura do produto no pull | FEITO | `dd162d35` (T-0097, #102) |
| F08 | Modelos CSV e dicionário para o admin | COBERTO (T-0100) | ainda só super-admin (`modules/integracao/api/bko-modelos.ts:17,26`) |
| F09 | Download do Conector por link temporário | COBERTO (T-0098) | portal mostra "em breve" (`apps/web/components/portal/aba-integracao.tsx:193`) |
| F10 | ⏰ Faixa aberta de ano no índice local | FEITO | `68e14c6d` (T-0096, #105); teste `modules/catalogo/app/indice-virada-ano.test.ts` |
| F11 | Aviso no monitor para marca concorrente desconhecida | COBERTO (T-0103) | ainda só log. A 2ª parte (referência inválida descarta só a referência, 🟡 R-20261106-032516) está FEITA: `c9360567` |
| F12 | Kit de UI depois do portal (🟡/🟢 da revisão R-20261106-023316) | COBERTO (T-0104) | — |
| F13 | `aplicar-lote` com parâmetros do tenant (`limitePct`, `ttlConfirmacao`) | FEITO | `b5fbb6ec`; `aplicar-lote.ts:416-461` usa `lerParametrosHub` (`ttlSessaoMin`, `limiteInativacaoPct`, `ttlConfirmacaoInativacaoDias`). Resto: ver N8 |
| F14 | Seletor de clientes do pedido em nome (RN-VEN-35) | COBERTO (T-0101) | decidido no R-20261107-173950 a |
| F15 | Referência cruzada sem o Promotor | COBERTO (T-0113) | — |
| F16 | Etapa pendente: "Ver fila", aviso no Gestão, selo no Cliente 360 do BKO | COBERTO (T-0102) | não feito (sem "Ver fila" em `modules/core/app`, sem selo em `modules/core/web/components/cliente360`) |
| F17 | Catálogo: busca sem acerto acima de ~5 mil devolve vazio | FEITO | `b544cca8` |
| F18 | Catálogo 🟢6: `codigoCompacto` único no ranking e no índice | FEITO | `6619d075` |
| F19 | Plano de RV: fim da vigência por perfil; normalizar o gatilho; confirmação no "voltar" do navegador | PARCIAL | confirmação ao sair do editor feita (`1fb34b46`); fim da vigência por perfil e gatilho normalizado não aparecem em `modules/core/domain/plano-rv.ts`. **Sem tarefa nova**: pertence à T-0082 (em andamento, modulo-core) → N7 |
| F20 | Vendedor: slot `pedido.criar_em_nome`, `vendedor_id`/`autor_id` | FEITO | `3dc8c147` (T-0084 fatia A) |
| F21 | "Adicionar ao pedido" de `produto.acoes` | FEITO | `1b0b95cf`, prova da regra 7 em `0263f9f3` |
| F22 | `useAtualizacaoAutomatica` e rodapé em Pedidos e detalhe; `refreshing` sem `sync.running` | FEITO | `1b0b95cf`, `774aaef6`; `orders-screen.tsx:75-76` (spinner só do puxar) |
| F23 | "Gerando…" do PDF: reteste no APK | COBERTO (T-0101) | teste manual no aparelho |
| F24 | Número 000011 duplicado na base demo | FEITO | `e2aaf055` (`numerarPedidosDemo`) |
| F25 | Teste do cliente bloqueado no receber; revalidar estoque na API antes de `estoque_bloqueia` | COBERTO (T-0101) | não feito: `receber.ts:121-122` revalida RN-VEN-13, mas não há teste com `bloqueado: true` no receber; `estoque_bloqueia` só no domain do orçamento (`orcamento.ts:383`), sem checagem em `receber.ts` |
| F26 | CI sem superusuário (job do `@macuxi/db`) | FEITO | `f6397116` (T-0075); job `testes-db-sem-superusuario` em `.github/workflows/ci.yml:308` |
| F27 | RN-CORE-01 exceção que acrescenta módulo | OBSOLETO (decisão) | o dono do produto decidiu (R-20261107-173950 c): a exceção só restringe; quem acumula funções tem mais de um perfil → T-0112 |
| F28 | RN-CORE-12 em função de domínio | FEITO | `975a70e3`; `modules/core/domain/checkout-servidor.ts` e `checkout.ts` com testes citando RN-CORE-12 |
| F29 | `canApprove` duplicado | COBERTO (T-0102) | a cópia saiu do vendedor, mas segue local em `modules/core/web/lib/rules.ts:13` (não vem do platform-sdk) |
| F30 | Integração depois da T-0009 (schema, rotas, OpenAPI, Conector, carga por arquivo, monitor) | FEITO | 0010 `52bbdd15`; OpenAPI `d27f7903`/`531b4d07`; `apps/conector`; `bko-carga-arquivo.ts`; `bko-monitor.ts` |
| F31 | Promotor após a T-0010 (schema, API das coletas, Loja, BKO de trade, payloads Zod, `produto_id`) | FEITO | 0015 `da0e0a59`; T-0056 (PR #41 `2bacad4`); `modules/promotor/api/rotas.ts`, aba Loja (`app/index.ts:17`), `web/pages/trade-page.tsx`; eventos `promotor.*@1` em `contracts/eventos.ts`; `ProdutoId` do `core.produto` (`contracts/base.ts:21-25`) |
| F32 | `packages/platform-sdk/src/ambiente.ts` ausente | FEITO | existe desde `0a3d6122` (31/10) |
| F33 | Índice da carteira incluindo excluídos | FEITO | `carteira_usuario_sync_ix` sem filtro de `deleted_at` (`0003_plataforma_worker.up.sql:77`, `1dbdd490`) |
| F34 | `db/package.json` sem `@macuxi/platform-sdk` | **NÃO FEITO** | `db/esquema/plataforma.ts:15` e `db/testes/estatico.test.ts:6` importam o pacote; `db/package.json` não declara → N4 |
| F35 | 🟢6 e 7 da revisão da T-0002 | **NÃO FEITO** | (R-20261031-094047) `plataforma.tenant_por_codigo` ainda devolve `nome` sem autenticação (`0001_plataforma.up.sql:66-70`, nunca redefinida); regex de módulo com hífen × `_` (`0001:180`) → N5 |
| F36 | Demo web da Fase M (S0-008): roteiro manual M-01 com o Alexandre | OBSOLETO (propor fechar) | nenhum roteiro em `docs/testes` (o "M-01" da T-0076 é outro caso); a demo roda na API real (ADR 0020) |
| F37 | ADR 0003, linhas 66-67 citam a ponte do vendedor | FEITO | a ADR já diz "A ponte saiu do shell… nenhum módulo tem mais ambiente próprio" (`76fa68dd`) |
| F38 | Cancelamento devolvido ao ERP | COBERTO (T-0114) | — |
| F39 | Schema `vendedor` (pedido, pedido_item) | FEITO | 0007 `4556577d`, 0009 |
| F40 | Campo "canal" no cliente | COBERTO (T-0115) | — |
| F41 | Persistir visita com motivo de cliente fechado e foto da fachada (RN-CORE-14) | FEITO | 0006: `motivo_id`, `foto_fachada_id`, `exige_foto` (`0006_core_lote_a.up.sql:174-188, 310-313`); contrato `modules/core/contracts/visita.ts:44-53`; checkout validado na API `975a70e3` |
| F42 | Pesquisa: `suspeita`, `motivos_suspeita`, `largura_px`, `altura_px` | FEITO | `0016_pesquisa.up.sql:181-191, 292-302` (`0a073a43`) |
| F43 | Aparelho bloqueado por tenant e 23503 no `criarSessao` | PARCIAL | 23503/23505/42501 viram erro de cliente (`modules/core/api/repositorio.ts:10`, teste `autenticacao.test.ts:231`, `d53d5874`); a decisão "bloqueio vale para todos os usuários do tenant" não tem registro → N6 |
| F44 | Job de limpeza de sessões expiradas | COBERTO (T-0102) | não feito: só o índice `sessao_expira_ix`; a única tarefa periódica do Core é `alerta_pendencia_checkout` (`modules/core/api/index.ts:58`) |
| F45 | Telas que chamam rotas da Fase M (/me, /customers) | FEITO | só no modo demonstração: `etapasFaseM` (`modules/vendedor/app/etapas.ts:53-75`), `carregarFicha` com guarda `v1` (`use-vendedor.ts:250`), `useMe` só com `MODO_API === 'demo'` (`apps/web/lib/queries.ts:38-41`) |
| F46 | **Antes do 1º deploy: refresh do BKO em cookie httpOnly**; `trustProxy` | PARCIAL | `trustProxy` FEITO (`dba64e3e`; `MACUXI_TRUST_PROXY`, `apps/api/src/config.ts:36`). **Refresh segue no `localStorage`** (`packages/platform-sdk/src/web/session.ts:6-8,52,64`; ADR 0008 §46/§57 como pendência) → **N1** |
| F47 | Treinamento: unificar `PedidoFaturadoLido` e os 3 🟢 | PARCIAL / COBERTO (T-0106) | unificação FEITA (`0130dbbd`; `contracts/pedido-lido.ts:21`, `domain/desafio.ts:15` "tipo único"); os 🟢 estão sendo feitos agora (`domain/desafio.ts` alterado na árvore pelo modulo-treinamento) |
| F48 | Tabela de lançamento de XP (`referencia_id` ≤ 128, chave única) | FEITO | `xp_lancamento_chave_uk` e `xp_lancamento_referencia_tamanho` (`0017_treinamento.up.sql:384-386`, `76eb8727`). "XP de um vendedor por vez" fica na T-0106 |
| F49 | O-4: p95 da carga S0-110 | COBERTO (T-0105 job de desempenho; T-0107 carga) | — |
| F50 | Conector v2 | COBERTO (T-0116) | — |
| F51 | Conector: Firebird e MySQL | OBSOLETO (autorizado fora da fila, R-20261107-173950 d) | sob demanda do 1º cliente |
| F52 | Testes do Conector intermitentes | FEITO | T-0023 `concluida` |
| F53 | zod ≥ 4.6.6 | COBERTO (T-0105) | não feito: todos os pacotes em `zod ^3.25.76` (`pnpm-lock.yaml:7294`) |
| F54 | Feriados do tenant no calendário | PARCIAL / COBERTO (T-0105) | nacionais + parâmetro `feriados` do tenant no Gestor (`modules/gestor/domain/feriados.ts`, `contracts/parametros.ts:58`, `f29ad65b`); marcado como PROVISÓRIO até ir para `packages/comum` |
| F55 | Modo demonstração (mock-api) sem carteira/rota/visita | OBSOLETO (propor fechar) | a demo roda na API real na Magalu (ADR 0020); o mock-api é só Fase M |
| F56 | API do Catálogo: `variacaoEscopo` no sync; cota de IA atômica; timeout com `AbortSignal.timeout` | PARCIAL | cota atômica FEITA (`catalogo.debitar_cota_ia`, 0013 "INSERT … ON CONFLICT … WHERE consultas < limite"; `repositorio-postgres.ts:319`); timeout FEITO (T-0041, `provedor-http.test.ts:221`). **`variacaoEscopo` NÃO FEITO**: `ProvedorSync` só tem `escopo` (`packages/platform-sdk/src/api.ts:429-442`) → **N3** |
| F57 | Realizado de venda e positivação reais | FEITO | `76d8bb28` (consumidores de `vendedor.pedido.*`), `modules/core/api/consumidores-positivacao.ts` via `vendedor.pedidos_da_meta@1` |
| F58 | SDK: poda local das entidades com janela; push depois do commit | **NÃO FEITO** | (🟡5 e 🟡6 do R-20261031-224719) nada sai do aparelho por janela (as telas só filtram, `modules/core/app/lib/cliente360-local.ts:4-5,58-63`); o push do Expo ainda roda **dentro** da transação do consumidor (`modules/core/api/consumidores.ts:3-5, 46-50`) → **N2** |
| F59 | Job de desempenho no CI | COBERTO (T-0105) | sem `MACUXI_PERF`/`MACUXI_CARGA_MEDIR` nos workflows |
| F60 | BKO do Core na API nova: Clientes com farol, Metas por equipe, Plano de RV | FEITO / COBERTO | Farol `1fb34b46` (T-0081); Metas por equipe em `modules/core/web/components/metas/metas-page.tsx:24`; Plano de RV na T-0082 (em andamento) |

## 5. Seção "Pendências da T-0029" e afins

| # | Item | Situação | Evidência |
|---|---|---|---|
| P01–P03 | ✅ já marcados (T-0034/T-0035) | FEITO | — |
| P04 | Consumir `integracao.pedido.retorno_erp@1` e publicar `faturado@1` | FEITO | T-0054 (PR #44 `f894246`); `modules/vendedor/api/retorno-erp.ts`, `eventos-consumidos.ts` |
| P05 | OpenAPI do Hub | FEITO | `d27f7903`, `531b4d07` |
| P06 | Aba Catálogo no Campo | FEITO | `modules/catalogo/app/index.ts:23-24` (T-0052) |
| P07 | Aba Loja do promotor | FEITO | `modules/promotor/app/index.ts:17` (T-0056) |
| P08 | Equipe e Aprovações no Gestão | FEITO | `modules/gestor/app/index.ts:21-23` (T-0055); licença na demo é decisão do Alexandre |
| P09 | Ordem das abas (Equipe 10, Aprovações 20, Pedidos/Loja 40, Catálogo 60) | FEITO | as `ordem` acima batem com a sugestão |
| P10 | Revisão das telas da T-0029 (16 🟡, 12 🟢) | FEITO | T-0034, linha de 2026-11-01: 16 🟡 feitos, 🟢 baratos feitos; fio R-20261101-155135 encerrado |
| P11 | Cota de IA atômica e `ia_timeout_ms` | FEITO | 0013 + `modules/catalogo/domain/parametros.test.ts:77` |
| P12 | Lint `hora-fixa-em-teste` vira erro em 16/11 | COBERTO (T-0105) | ainda `warn` (`packages/config/eslint.mjs:49`), como previsto até 16/11 |
| P13 | Job de CI com relógio deslocado | COBERTO (T-0105) | sem job nos workflows |
| P14 | Riscos do guardião v5 (merge pelo MCP; recado de autorização da nuvem) | FEITO | `7d87a32d` (T-0050: merge pelo MCP com trava, `guarda-merge-mcp.mjs`, matcher em `.claude/settings.json:75`); T-0049 `concluida` |
| P15 | Guardião v5 e o PATH do gh | FEITO | `7d87a32d` (`localizarGh`, `guarda-gh.test.mjs:29-31`) |
| P16 | Guardião v7 (gh api de leitura com `$VAR`; MCP que grava direto no GitHub) | **NÃO FEITO** | nenhum hook para `push_files`/`create_or_update_file`; "sem pressa" no backlog → N8 (baixa) |
| P17 | Carga com 20 mil SKUs antes do piloto | COBERTO (T-0107) | — |
| P18 | Guarda de ordem nos consumidores do ERP | COBERTO (T-0095) | — |
| P19 | ERP não reativa o que o admin desligou | COBERTO (T-0095) | — |
| P20 | Cortes da T-0061 (aceitos pelo Alexandre) | OBSOLETO (decisão registrada) | nada a fazer |
| P21 | Depois da demo de 03/11 | FEITO, salvo 1 subitem | `pnpm timers` no CI `664cf39f`; `licencas.test` `45bf7b8d`; espelho Drizzle do Promotor (`modules/promotor/db/nuvem.ts`) e do item do pedido (`modules/vendedor/db/nuvem.ts:168`); `gravarDemoMedidas` `3b61a438`; `core.medidas@1` no `usaConsultas` `4f78c626` (`modules/integracao/manifest.ts:35`); queda 57P01 (`tests/integracao/apoio/api.ts:68-75`); T-0056 `concluida`. **Falta**: `core.medidas@1` ainda "proposta" em `.coord/contratos/modulos.md:49` e a nota de implementado no `docs/desenho/T-0061.md` → N7 |
| P22 | Ambiente Magalu: grupo de segurança por ambiente; renomear `DEMO_SSH_KEY`; renovar a chave `macuxi-demo-s3` até 31/12 | COBERTO (lembrete) | não é tarefa de código: o 3º tem data (aviso em 15/12) e deve ficar no roteiro de produção, não no backlog |
| P23 | Positivação acumulada do mês no Início | FEITO | 0023 `2a878b1f` (`core.positivacao_do_mes`) + consumidor `76d8bb28` |
| P24 | App percebe a base recriada | FEITO | 0022 `geracao_base` `2a878b1f`; `packages/platform-sdk/src/geracao-base.ts`, `motor-sync.geracao.test.ts`; limpeza no aparelho `aeb4fd62` |
| P25 | Pedidos fora da janela de 90 dias | FEITO | `orders-screen.tsx:77` (consulta ao servidor com sinal; "Disponível com conexão" sem sinal), `folha-periodo.test.ts:85`, rota com período (`listagem-periodo.test.ts`) |
| P26 | Acabamento visual de Início, Cliente 360 e Pedidos | COBERTO (T-0101) | — |
| P27 | `subir-demo.ps1` espera 180 s | FEITO | `88630657` (`scripts/demo/subir-demo.ps1:230-232`) |

## 6. O que fazer

### 6.1 Fechar
- PRs **#85, #86, #87, #88, #89**: fechar sem merge, com o motivo "conteúdo já no `main` em <commit da §2>".
- Tarefas que já entraram no `main` e seguem `aberta` no frontmatter: **T-0096** (`68e14c6d`), **T-0097** (`dd162d35`), **T-0099** (`033489ae`) — fechar depois da revisão do lote.
- Do backlog, sair com o commit: todos os FEITO e OBSOLETO das §3–§5.

### 6.2 Encolher tarefas abertas (subitens já feitos)
| Tarefa | Já feito (tirar do objetivo) | Fica |
|---|---|---|
| T-0101 | pedido em nome `3dc8c147`; Adicionar ao pedido `1b0b95cf`; atualização automática e rodapé `1b0b95cf`; 000011 `e2aaf055` | reteste do PDF no APK; teste do cliente bloqueado no receber; estoque revalidado na API; acabamento visual; seletor RN-VEN-35 |
| T-0102 | positivação do mês `2a878b1f`/`76d8bb28`; base recriada `2a878b1f`/`aeb4fd62`; RN-CORE-12 no domain `975a70e3` | resto da etapa pendente; `canApprove` do platform-sdk; job de limpeza de sessões |
| T-0103 | aplicar-lote com `limitePct`/`ttlConfirmacao`/`ttlSessao` do tenant `b5fbb6ec` | aviso de marca desconhecida no monitor (+ N8b) |
| T-0105 | job do `@macuxi/db` sem superusuário `f6397116`; gh fora do PATH `7d87a32d`; subir-demo 180 s `88630657` | lint 16/11; zod ≥ 4.6.6; job de desempenho; relógio deslocado; feriados para `packages/comum` |
| T-0106 | `PedidoFaturadoLido` unificado `0130dbbd`; tabela de XP com chave única e ≤ 128 `76eb8727` | os 3 🟢 (em andamento); XP de um vendedor por vez |

### 6.3 Viram tarefa (sem tarefa hoje)
| # | Item | Dono provável | Prioridade |
|---|---|---|---|
| **N1** | Refresh do BKO em cookie httpOnly (+ CSRF), no lugar do `localStorage` (`packages/platform-sdk/src/web/session.ts`; ADR 0008). O backlog diz "obrigatório antes do primeiro deploy" | engenheiro-software (API, SDK, ADR) + engenheiro-apps (`apps/web`) | **alta**: antes de ligar a produção (`docs/status/producao.md`) |
| N2 | Push do Expo fora da transação do consumidor (`modules/core/api/consumidores.ts`: segura o horizonte do pull de todos os tenants por até 10 s) e poda local das entidades com janela (ADR 0009 §5) | engenheiro-software (SDK: "depois do commit" e poda) + modulo-core | média |
| N3 | `variacaoEscopo` no `ProvedorSync`: quando `promotor_ve_preco_estoque` passa de sim para não, o preço que já está no aparelho do promotor não é apagado (RN-CAT-05; ADR 0009 §4). Confirmar se outro mecanismo cobre; se não, implementar | engenheiro-software + modulo-catalogo | média |
| N4 | `db/package.json` declarar `@macuxi/platform-sdk: workspace:*` (hoje só resolve pelo hoisting) | banco-dados (+ lock pelo engenheiro-software) | baixa, barata |
| N5 | 🟢6/7 da T-0002: `tenant_por_codigo` sem `nome` (enumeração de empresas por código) e regex de módulo alinhada ao `EVENTO_RE` | banco-dados, na próxima migração da plataforma | baixa |
| N6 | Decisão: bloqueio de aparelho vale para todos os usuários do tenant? (o 23503 já é erro de cliente) | modulo-core propõe, Alexandre decide | baixa |
| N7 | Plano de RV: fim da vigência por perfil e gatilho normalizado (peso ou faixas) — incluir na T-0082 em andamento; e `core.medidas@1` marcado como implementado em `.coord/contratos/modulos.md:49` + nota no `docs/desenho/T-0061.md` | modulo-core (RV); engenheiro-software (contratos e desenho) | baixa |
| N8 | (a) guardião v7: hooks para as ferramentas MCP que gravam no GitHub e `gh api` de leitura com `$VAR`; (b) no `aplicar-lote.ts:102,128`, `esperaMaxDependenciaMin` e `limiteLinhasInvalidas` ainda usam `PARAMETROS_PADRAO` (anexar à T-0103 se forem parâmetros do tenant) | (a) engenheiro-software; (b) modulo-integracao | baixa |

### 6.4 Teste manual (fora do alcance desta conferência)
- F23: "Gerando…" do PDF no APK (aparelho real): abrir pedido → Compartilhar PDF com 3G lento → o aviso aparece e some em até 20 s, sem toque duplo gerar dois arquivos.
