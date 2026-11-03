# Promotor — regras de cálculo (domain)

Implementação: `modules/promotor/domain/` (funções puras, sem I/O; rodam no app offline, na web e na API). Cada arquivo tem um `*.test.ts` com os casos abaixo (`it('RN-PRO-xx: ...')`). Contratos Zod das coletas: `modules/promotor/contracts/` (reaproveitam estas funções nos refinamentos; a API sempre revalida).

Convenções: percentuais com 2 casas (meio para cima); dinheiro em centavos inteiros (ADR 0002); instantes em UTC; datas de vencimento/prazo em dia civil `AAAA-MM-DD` no fuso do tenant (`dataLocal`, padrão `America/Manaus`); "sem dados" devolve `null`, nunca divide por zero.

## Parâmetros do tenant (doc 03, tabela de parâmetros)
| Parâmetro | Padrão | Onde entra | Regra |
|---|---|---|---|
| `variacao_preco_max_pct` | 50 | `exigeConfirmacaoDePreco(atual, anterior, limite?)` | RN-PRO-04 |
| `permanencia_min_min` | 10 | `visitaConta`, `visitaCurta`, `consolidarIndicadorDia` | RN-PRO-07 |
| `validade_proxima_dias` | 30 | `ehValidadeProxima`, `faixaDeRisco`, `resumirValidade` | RN-PRO-08 |
| `validade_critica_dias` | 7 | `faixaDeRisco`, `resumirValidade` | RN-PRO-08 (faixa definida pelo Promotor) |

`resolverParametros(parcial)` mistura com o padrão e recusa valores negativos ou crítico > próxima.

## 1. Share de gôndola e atingimento — RF-PRO-04, RN-PRO-03 (`share.ts`)
- **Share (%)** = frentes nossas ÷ frentes totais da categoria × 100. Quando medido em cm (nossos **e** total informados): cm nossos ÷ cm totais × 100 (`base: 'cm'`).
- **Atingimento (%)** = share ÷ meta de share da loja/categoria × 100. **Desvio (pp)** = share − meta. Situação: `atingiu` (share ≥ meta) | `abaixo` | `sem_meta` (meta ausente/zero) | `sem_dados`.
- Casos de borda: total 0 → `sem_dados` (share `null`); nossas > total, valores negativos, frentes fracionadas ou cm informado só pela metade → `inconsistente` com mensagem em português.
- Exemplo: 12 frentes nossas de 40 → 30%. Meta 40% → atingimento 75%, desvio −10 pp. Com 90 cm de 300 cm → 30% (base cm). 1 de 3 frentes → 33,33%.
- **Revalidação (contrato `MedicaoShare`)**: `share_pct` e `atingimento_pct` do aparelho só passam se conferirem com o recálculo (`calcularShare` e `atingimentoShare`); sem meta, `atingimento_pct` tem de ser nulo; meta informada exige `meta_share_id` (RN-PRO-10). Ex.: share 30 e meta 40 com atingimento 150 é recusado.
- **Média do dia** (`mediaShare`): share médio = média simples das categorias medidas; meta média e atingimento usam só as categorias que têm share **e** meta (mesmo conjunto). Ex.: (30 meta 40), (20 meta 20), (sem meta 10) → share médio 20; meta média 30; atingimento 83,33%.

## 2. Preço e índice de preço — RF-PRO-05, RN-PRO-04 (`preco.ts`)
- **Preço efetivo** = preço promocional se `em_promocao` ou `em_encarte`; senão o preço de prateleira. Promoção sem preço promocional é erro de preenchimento.
- **Índice de preço** = preço efetivo nosso ÷ preço efetivo do concorrente de referência × 100. < 100 = mais barato; = 100 igual; > 100 mais caro.
- **Variação vs. última coleta (%)** = |atual − anterior| ÷ anterior × 100. **Pede confirmação quando MAIOR que 50%** (exatamente 50% não pede). Comparação exata em inteiros (`|atual − anterior| × 100 > limite × anterior`). Sem coleta anterior → não pede.
- Exemplos: nosso R$ 10,90 (1090) ÷ concorrente R$ 10,00 (1000) → 109,00. Concorrente de prateleira R$ 10,00 em promoção a R$ 8,00 contra nosso R$ 10,00 → 125,00. R$ 5,99 digitado como R$ 599,00 (599 → 59900) → variação 9.900% → confirmar.

## 3. Presença e ruptura do mix — RF-PRO-06, RN-PRO-05 (`ruptura.ts`)
- **Status**: na gôndola → `presente`; fora da gôndola **com** produto no depósito → `ruptura_gondola` (falha de reposição); fora da gôndola e **sem** produto → `ruptura_total`. Fora da gôndola sem conferir o depósito não classifica.
- **Ruptura (%)** = itens do mix em ruptura ÷ itens do mix obrigatório × 100. Por padrão "em ruptura" = ruptura total + ruptura na gôndola (o consumidor não acha o produto). A **ruptura na gôndola com produto no depósito é contada à parte**: `falha_reposicao_pct` = ruptura_gondola ÷ mix × 100; `ruptura_total_pct` = ruptura_total ÷ mix × 100.
- **Confirmado (RN-PRO-05)**: a falha de reposição entra no % de ruptura e também é mostrada à parte. `resumirRuptura(itens, { incluirFalhaDeReposicao: false })` existe só para análises que a excluam.
- **Quantidade reposta**: inteiro ≥ 0, soma por visita; em ruptura total é sempre 0.
- Exemplo: mix de 10 itens (7 presentes, 1 ruptura na gôndola, 2 ruptura total) → ruptura 30%; falha de reposição 10%; ruptura total 20%.

## 4. Conformidade da gôndola — RF-PRO-03 (`gondola.ts`)
- Valores: `conforme | parcial | nao_conforme`. **Motivo obrigatório quando `nao_conforme`** (vazio/espaços não valem); em `parcial` é opcional. Fotos antes e depois são exigidas no contrato.
- **% conformidade (RN-PRO-11)** = (conformes + parciais × peso) ÷ gôndolas registradas × 100. O peso vem do parâmetro do tenant `peso_parcial_conformidade` (padrão 0, entre 0 e 1) via `resolverParametros`. O **total de parciais aparece à parte** (`resumirConformidade` → `parciais`; indicador → `conformidade_parciais`). Ex.: conforme, conforme, parcial, não conforme → 50% e 1 parcial; com peso 0,5 → 62,5%.

## 5. Validade próxima e avarias — RF-PRO-07, RN-PRO-08 (`validade.ts`)
- **Dias até vencer** = validade − hoje (dias civis; negativo = vencido). "Hoje" = data civil no fuso do tenant (`dataLocal(instante, fuso)`; 01/11 02:00Z é 31/10 em Manaus).
- **Faixa de risco (RN-PRO-08)**, com limites do tenant (`validade_critica_dias` 7, `validade_proxima_dias` 30, lidos de `resolverParametros`): `vencido` (< 0) · `crítico` (0 a 7) · `atenção` (8 a 30) · `ok` (> 30).
- **Validade próxima** = vencido + crítico + atenção (dias ≤ `validade_proxima_dias`).
- Resumo (`resumirValidade`): itens e unidades por faixa e total de validade próxima. Ex.: hoje 31/10; vencimentos 25/10 (3 un.), 03/11 (10 un.), 20/11 (5 un.), 01/03/2027 (100 un.) → vencido 3, crítico 10, atenção 5, ok 100; validade próxima = 3 itens / 18 unidades.
- **Avaria**: quantidade inteira ≥ 1, motivo e foto obrigatórios; resumo por motivo (`resumirAvarias`).

## 6. Pontos extras — RF-PRO-08 (`pontos-extras.ts`)
- Conferência de cada ponto negociado: `cumprido` = existe + no lugar combinado + abastecido; `parcial` = existe mas falta algo; `nao_cumprido` = não existe (marcar "no lugar"/"abastecido" sem existir é inconsistente). Ponto que existe exige foto (contrato).
- **% cumprimento** = negociados cumpridos ÷ negociados × 100; pontos encontrados **sem** negociação contam à parte (`encontrados_nao_negociados`). Ex.: 4 negociados (2 cumpridos, 1 parcial, 1 ausente) → 50%.

## 7. Permanência e coleta com check-in aberto — RN-PRO-07, RN-PRO-02 (`permanencia.ts`)
- **Permanência (min)** = (checkout − check-in) em minutos, instantes UTC. Checkout anterior ao check-in é erro.
- **Revalidação (contrato `VisitaLoja`)**: o `permanencia_min` que vem do aparelho não é confiável. O contrato recalcula com `permanenciaMinutos(checkin_em, checkout_em)` e **recusa** a visita se o valor divergir mais que `PERMANENCIA_TOLERANCIA_MIN` (0,5 min, arredondamento) ou vier nulo com checkout. Ex.: 40 min reais com 600 informado é recusado. A API grava o valor recalculado.
- **Conta nos indicadores** quando ≥ 10 min; **visita curta** (< 10 min, encerrada) é sinalizada ao gestor; visita aberta não conta nem é "curta". Ex.: 9,99 min não conta; 10 conta.
- `coletaPermitida(visita)`: só com check-in feito e sem checkout (RN-PRO-02). A origem da foto (câmera, data/hora) é validada em `FotoColeta`. **RN-PRO-02**: `latitude`/`longitude` são opcionais (nulas) e `sem_gps` é obrigatório; coordenada presente => `sem_gps = false`, ausente => `sem_gps = true`, e o contrato recusa qualquer combinação inconsistente (inclusive só uma das duas coordenadas). A prova de presença é o check-in.

## 8. Checklist do dia e checkout — RF-PRO-02, RN-PRO-06 (`checklist.ts`)
- `progressoChecklist`: concluídas × pendentes, obrigatórias pendentes e % concluído (checklist vazio = 100%).
- `avaliarCheckout({ contexto, etapas })`: **bloqueia** se faltam etapas obrigatórias (mensagem lista as etapas e diz "Conclua-as para fazer o checkout"). **Exceção**: `contexto.clienteFechado = true` (`ContextoCheckout` de `@macuxi/core/contracts`) dispensa o checklist. A regra de cliente fechado (motivos `loja_fechada`/`acesso_negado`, foto da fachada obrigatória) é **única e vive no core (RN-CORE-14)**; o Promotor só consome e não valida a fachada. Ex.: obrigatória "Medir o share de massas" pendente → bloqueado; `clienteFechado` → liberado.

## 9. Vigência — RN-PRO-10 (`vigencia.ts`)
- `vigenteEm(v, data)`: início ≤ data ≤ fim (inclusivos; fim `null` = sem prazo). `versaoVigente(versoes, data)`: a de início mais recente entre as vigentes. A coleta grava o id da versão vigente no momento (checklist, mix, meta, foto de referência) — campos `*_id` em `contracts/coletas.ts`.

## 10. Tarefas pontuais — RF-PRO-10 (`tarefa.ts`)
- Situação: `pendente` | `atrasada` (hoje > prazo, sem conclusão) | `concluida` | `concluida_com_atraso`; sem prazo nunca atrasa. Conclusão exige ≥ 1 foto de comprovação.

## 11. Indicador do dia — RF-PRO-12 (`indicador.ts`)
`consolidarIndicadorDia(entrada, parametros?)` devolve o que alimenta `indicador_promotor_dia`:
- **Lojas visitadas** = lojas distintas com visita que **conta** (RN-PRO-07). **Cobertura** = visitadas ÷ planejadas × 100.
- **Fotos (RN-PRO-02)**: `fotos_total`, `fotos_sem_gps` e `fotos_sem_gps_pct` = sem GPS ÷ total × 100 (nulo sem fotos); o gestor vê o % por promotor. **Parciais (RN-PRO-11)**: `conformidade_parciais`.
- **Tempo médio** = média da permanência das visitas que contam (1 casa). Visitas curtas e abertas são contadas à parte.
- **Coletas de visitas que não contam ficam fora** de conformidade, share, ruptura e preço.
- **% conformidade** (§4), **share médio × meta média e atingimento** (§1), **% ruptura** agregada (soma de itens em ruptura ÷ soma de itens do mix de todas as visitas válidas — não a média dos % por loja) e **falha de reposição** (§3), **índice de preço médio** = média simples dos índices (§2).
- Exemplo: 5 planejadas; visitas de 40, 20, 6 min e uma aberta → visitadas 2 (40%), tempo médio 30 min, 1 visita curta, 1 aberta; só as duas primeiras entram nos demais indicadores.

## 12. RN-PRO-01 — sem pedido
Teste `domain/rn-pro-01.test.ts`: nenhum export do `domain` tem nome ligado a pedido; nenhuma chave de `manifest.acoes` é ação de pedido (`ehAcaoDePedido` do platform-sdk); e, com um manifesto sintético do Vendedor declarando `pedido.*`, `pode(...)` é `true` para o vendedor e `false` para o promotor. O JSON do manifesto não contém a palavra "pedido" (`manifest.test.ts`).

## 13. Eventos publicados — T-0040 (`eventos.ts`)
Payloads Zod dos seis eventos `promotor.*@1` em `contracts/eventos.ts`; emissão em `domain/eventos.ts` (`montarEventoPromotor` e um montador por coleta): o payload é montado pelo tipo do contrato e validado antes de publicar; inválido = `ErroPayloadEvento`, nada publicado. Tabela com campos e consumidores: [eventos.md](eventos.md).

## Permissões por ação (manifesto, doc 03 §2)
- **Coletas** (`coleta.registrar`, `checklist_loja.responder`, `gondola.registrar`, `share.registrar`, `preco.registrar`, `ruptura.registrar`, `validade.registrar`, `ponto_extra.registrar`, `concorrencia.registrar`, `tarefa_trade.concluir`): **só o promotor**. Supervisor, gerente e analista apenas leem (estão em `perfis`, sem ação de escrita).
- **Cadastros de trade** (`mix_obrigatorio`, `meta_share`, `categoria_gondola`, `concorrente`, `foto_referencia`, `checklist_modelo`, `ponto_extra_negociado`, `tarefa_trade` `.gerenciar`): **analista e admin**. `admin` foi incluído em `manifest.perfis` para o módulo ficar efetivo para ele (RN-CORE-01).

## Premissas e pendências
- Produto nosso referenciado por `produto_id` (UUID do cadastro base do Core, ADR-0005); quando a T-0007 publicar `Produto` em `@macuxi/core/contracts`, o Promotor passa a importar o contrato.
- Decisões do Alexandre incorporadas ao doc 03: RN-PRO-05 (ruptura inclui falha de reposição e a mostra à parte), RN-PRO-08 (faixas), RN-PRO-11 (peso do parcial) e RN-PRO-02 (foto sem GPS aceita). Parâmetros do tenant: `validade_critica_dias`, `validade_proxima_dias`, `peso_parcial_conformidade`.
- Payloads dos eventos `promotor.*@1` escritos na T-0040 ([eventos.md](eventos.md)). A publicação na outbox (`tx.publicar` nas rotas de `modules/promotor/api`) entra quando as rotas de coleta existirem.
- `contracts` não reexporta mais os primitivos de `base.ts` (`Uuid`, `InstanteUtc`…); só os schemas de negócio.

## 13. Recebimento das coletas — RN-PRO-02/04/06, idempotência (`coleta.ts`, T-0056)
- `podeColetar(perfil)`: só o promotor (doc 03 §2). `avaliarColeta`: perfil → visita de loja do próprio promotor (de outro = "não encontrada", RN-CORE-04) → **janela da visita**: o instante da coleta (`*_em`, `instanteDaColeta`) entre o check-in e o checkout, inclusive (`coletaNaJanelaDaVisita`). Offline: coleta feita com a visita aberta e enviada depois do checkout é aceita; feita depois do checkout é recusada.
- Falta de dependência que o aparelho ainda vai enviar (visita inexistente, foto não recebida) é `retentavel` (o item fica na fila). Foto de outra visita é recusa de vez (`recusaDeFotos`).
- `transicaoVisitaLoja`: 1º envio cria (aberta ou já fechada); aberta → fechada com os dados do check-in iguais = checkout; mesmo conteúdo = repetida; reabrir, mudar loja/check-in ou alterar um checkout feito = conflito. `mesmoConteudo` compara sem depender da ordem das chaves.
- `checkoutRespeitaChecklist` (RN-PRO-06 no servidor): visita `realizada` com a última resposta de alguma etapa obrigatória não concluída bloqueia; `loja_fechada`/`acesso_negado` dispensam.
- `recusaDeVariacaoDePreco` (RN-PRO-04 no servidor): variação acima do limite do tenant sem `variacao_confirmada` é recusada. Ex.: 599 → 59900 sem confirmação = recusa; exatamente 50% passa.

## 14. Cadastro que vale para a loja — RN-PRO-10 (`alvo.ts`)
- `cadastroValeParaLoja`: não removido, vigente na data civil e com alvo = a loja (`cliente_id`), o segmento da loja (`segmento`, sem diferenciar maiúsculas) ou todas (os dois nulos).
- `checklistDaLoja` / `metaDaCategoria`: o mais específico (loja > segmento > todas) e, empatado, o de início mais recente. Ex.: meta geral 30% e meta da loja 45% → 45%.

## 15. Relatórios do BKO — RF-PRO-12 (`relatorios.ts`)
- `visitasQueContam` (RN-PRO-07): só visitas encerradas com a permanência mínima entram.
- `relatorioShareMeta`: por loja e categoria vale a **última** medição de visita que conta; atingimento e desvio recalculados (RN-PRO-03); resumo = `mediaShare`.
- `relatorioRupturaPorLoja`: por loja, a **última** visita que conta com o mix conferido (`resumirRuptura`, RN-PRO-05); maior ruptura primeiro.
- `parametrosDosBrutos` (`parametros.ts`): parâmetros do tenant vindos da API ou do aparelho; valor inválido cai no padrão e nunca derruba a requisição nem a tela.

## 16. Cadastros de trade no BKO — RF-PRO-11, RN-PRO-03/06/10, RN-AUD-01 (`cadastros.ts`, `api/rotas-cadastros.ts`, T-0069)
Página `trade-cadastros` ("Cadastros de trade", grupo Cadastros) em `modules/promotor/web`: abas Checklists de visita, Categorias, Metas de share, Mix de ruptura e Concorrentes e produtos, mais o bloco **Parâmetros do tenant (somente leitura)** com validade crítica (7 dias), validade em atenção (30 dias) e peso do parcial (0), lidos de `GET /v1/promotor/cadastros/parametros` (`parametrosDoTenant`). Aba e "mostrar desativados" ficam na URL; cada tabela exporta CSV.

**Rotas** (`/v1/promotor/cadastros/<cadastro>`; `categorias`, `checklists`, `metas-share`, `mix`, `concorrentes`, `produtos-concorrente`):
| Método | Quem | Efeito |
|---|---|---|
| `GET` (lista e `parametros`) | supervisor, gerente, analista, admin | lista os vivos; `?incluir_removidos=true` traz também os desativados |
| `POST` | analista, admin (ação `*.gerenciar` do manifesto) | cria; idempotente pelo `id` do cliente (repetir = mesmo cadastro; mesmo id com outro conteúdo = 409) |
| `PUT /:id` | analista, admin | edita; reenvio igual não altera nem audita; desativado = 409 |
| `DELETE /:id` | analista, admin | **desativa** (lógico: `deleted_at`, e `ativo = false` onde existe); nunca apaga; repetir é idempotente |
Supervisor e gerente recebem 403 na escrita (a ação não os inclui) e a tela esconde Novo/Editar/Desativar para eles. Toda rota passa por login, licença do módulo (`RN-CORE-02`), perfil e tenant do token (RLS). Ações: categoria `categoria_gondola.gerenciar`, checklist `checklist_modelo.gerenciar`, meta `meta_share.gerenciar`, mix `mix_obrigatorio.gerenciar`, concorrente e produto do concorrente `concorrente.gerenciar`.

**Validação (domain `cadastros.ts`, revalidada na API pelo contrato `contracts/cadastros-bko.ts`):**
- **Meta de share (RN-PRO-03)**: **percentual** (40 = 40%), entre 0 e 100 **inclusive**, até 2 casas (a coluna é `meta_pct numeric(5,2)`). Fora disso, `NaN` ou 3 casas = recusa.
- **Checklist (RN-PRO-06)**: nome obrigatório, **pelo menos 1 etapa**, cada etapa com nome e id único; quais são obrigatórias é livre (as obrigatórias bloqueiam o checkout).
- **Alvo (RN-PRO-10)**: loja OU segmento (canal) OU todas as lojas, nunca loja e segmento juntos; **vigência** com fim ≥ início. Duplicidade (mesmo nome entre vivos; mesma versão de alvo+início) = 409 com mensagem em português.
- Nome obrigatório (categoria/concorrente até 120, produto do concorrente até 200); ordem inteira ≥ 0; `validarPrecoCents` (inteiro ≥ 0, RN-PRO-04) existe no domain para o preço de referência do concorrente, ainda sem coluna (ver pendências).
- Referências: categoria e concorrente precisam existir e estar vivos; loja e produto são conferidos no Core pela consulta `core.cadastro_resumo@1` (ADR 0012, nenhuma leitura de tabela do Core).

**Auditoria (RN-AUD-01)**: `tx.auditar` na mesma transação, ações `<cadastro>.criar|editar|desativar` (ex.: `meta_share.editar`), com `antes`/`depois` só de ids, números, flags e datas (metas: categoria e `meta_pct`; checklist: nº de etapas e de obrigatórias). Nunca o nome da categoria, do concorrente, do produto nem o texto das etapas.

**Como a promotora recebe**: as escritas usam as MESMAS tabelas que `sync-cadastros.ts` lê no pull (`TABELAS_CADASTRO`) e renovam `updated_at` (gatilho do banco e `updated_at = now()` explícito); a desativação grava `deleted_at` e vira lápide no pull incremental `(updated_at, id)`. Sem migração e sem mexer no provedor de pull. Testes: `api/rotas-cadastros.test.ts` (memória: permissões, validação, idempotência, auditoria, SQL das escritas nas tabelas do pull) e `api/cadastros.db.test.ts` (Postgres: criar/editar/desativar aparecem no pull seguinte, lápide, RLS; pula sem Docker).

**Pendências**: (1) "preço do concorrente": `promotor.produto_concorrente` não tem coluna de preço de referência (o preço vem das coletas, `coleta_preco`); para cadastrar preço no BKO faltaria `preco_referencia_cents bigint check (>= 0)` em `produto_concorrente` (e no `ProdutoConcorrenteSync` do pull). (2) Parâmetros do tenant só leitura; edição fica para outra tarefa. (3) Foto de referência, tarefas de campanha e ponto extra negociado (demais cadastros do pull) ainda sem tela. (4) Loja e produto são digitados por identificador, até existir seletor do Core no BKO.
