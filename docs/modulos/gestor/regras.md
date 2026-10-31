# Gestor — regras de cálculo (domain)

Implementação: `modules/gestor/domain/` (funções puras, sem I/O; rodam no app offline, na web e na API). Cada arquivo tem um `*.test.ts` com os casos abaixo (`it('RN-...: ...')`). Contratos Zod (painel, ranking, alerta, fila de aprovação, pedido em nome e os espelhos dos eventos consumidos): `modules/gestor/contracts/`. Tarefa: T-0014 (domínio, contratos e manifesto; sem banco e sem telas) e o ajuste da T-0014 com as **8 decisões do Alexandre** (R-20261031-165536-alexandre), registradas aqui como **RN-GES-01 a 08** (texto proposto ao doc 03; numeração a confirmar pelo gerente-projetos). Requisitos: RF-GES-01 a 10 (`docs/produto/02`); regras: `docs/produto/03` (RN-CORE-04/20/21/22, RN-VEN-03/10/30/31/32/35, RN-PRO-01/02/03/05/07/11) e RN-GES-01..08 (abaixo).

Convenções: dinheiro em centavos inteiros, divisão meio para cima (RN-VEN-02); percentuais com 2 casas, meio para cima (`4.5` = 4,5%); instantes em UTC (ISO com `Z`); **"dia" = data civil no fuso do tenant** (`America/Manaus` por padrão, `localDate` de `@macuxi/comum`, ADR 0002) — só a exibição e o agrupamento por dia usam o fuso, o armazenado é UTC; "sem dado" devolve `null`, nunca divide por zero. **`null` num indicador significa "sem dado" ou "módulo opcional desativado"**: o painel continua válido (RN-CORE-03).

## Parâmetros do tenant
### Gerais (`parametros.ts`, `resolverParametros(parcial)`)
| Parâmetro | Padrão | Onde entra | Origem |
|---|---|---|---|
| `fuso` | `America/Manaus` | todo "dia" | doc 03 (tabela de parâmetros) |
| `base_apuracao` | `aprovado` (ou `faturado`) | `vendasDoPeriodo`, `painelDoMes` | RN-CORE-21; doc 03 |
| `feriados` | `[]` | dias úteis da meta e do ritmo | RN-CORE-22; `@macuxi/comum` |
| `permanencia_min_min` | 10 | visitas do promotor, trade, alerta `visita_curta` | RN-PRO-07 (mesmo parâmetro do Promotor) |
| `peso_parcial_conformidade` | 0 (0 a 1) | conformidade de gôndola do trade | RN-PRO-11 (mesmo parâmetro do Promotor) |
| `aprovacao_prazo_horas` | 24 (horas **úteis**, > 0) | prazo da fila de aprovação | decisões 1 e 3 (RN-GES-03) |
| `aprovacao_aviso_horas` | 4 (< prazo, horas úteis) | "vencendo" na fila | premissa T-0014 (mantida) |
| `horario_comercial` | `{ dias_semana: [1,2,3,4,5], inicio: '08:00', fim: '18:00' }` (1 = segunda … 7 = domingo; `fim` > `inicio`; `24:00` vale) | horas úteis do prazo de aprovação e do alerta | decisão 3 (RN-GES-03) |
| `pct_tolerancia_frequencia` | 50 (%, ≥ 0) | limite do alerta `cliente_sem_visita` | decisão 1 (RN-GES-01) |
| `dias_sem_visita_padrao` | 30 (dias inteiros, ≥ 0) | limite para cliente sem frequência | decisão 1 (RN-GES-01) |
| `dias_carencia_cliente_novo` | 15 (dias inteiros, ≥ 0) | cliente nunca visitado | decisão 2 (RN-GES-02) |

Valores negativos (ou fracionários nos campos de dias) são recusados por `resolverParametros` com mensagem em português que cita o parâmetro.

### Regras de alerta (`alertas.ts`, `resolverRegras(ajustes)`; uma por tipo, cada uma liga/desliga e ajusta)
| Tipo | `limiar` | `janela_dias` | `amostra_min` | Severidade | Módulo de origem |
|---|---|---|---|---|---|
| `cliente_sem_visita` | — (vem do cliente e dos parâmetros, RN-GES-01/02; a regra só liga/desliga e recusa `limiar`) | — | — | atenção | Core |
| `ritmo_abaixo_meta` | 80 (% do ritmo esperado) | — | 3 (dias úteis decorridos) | atenção | Vendedor |
| `pedido_aguardando_aprovacao` | 24 (horas úteis, RN-GES-03) | — | — | crítica | Vendedor |
| `ruptura_recorrente` | 3 (visitas da loja com ruptura) | 14 | — | atenção | Promotor |
| `visita_curta` | — (usa `permanencia_min_min`) | 3 | — | info | Promotor |
| `fotos_sem_gps` | 20 (% máximo) | 7 | 10 (fotos) | atenção | Promotor |

Padrões **confirmados pelo Alexandre** (decisão 1): ritmo mínimo 80%, aprovação pendente 24 h (úteis), 3 rupturas em 14 dias, 20% de fotos sem GPS. A amostra de 10 fotos em 7 dias e a janela de 3 dias da visita curta seguem como premissa da T-0014.

## 1. Projeção dos eventos — `projecao.ts`, `apuracao.ts`
O read-model é alimentado só por eventos (nunca por tabela de outro módulo). O estado (`EstadoProjecao`) guarda **dados brutos**; todos os indicadores são **derivados na consulta**.
- **Idempotência por evento**: `evento_id` já aplicado volta `duplicado` e o estado não muda. **Por chave de negócio**: o mesmo `pedido_id`/`visita_id`/`resposta_id`… com `evento_id` novo não conta duas vezes (vence o carimbo `(ocorrido_em, evento_id)` maior).
- **Fora de ordem**: o histórico de status do pedido é um **conjunto** por `evento_id` e a situação é derivada dele (ordenado por instante e, no empate, `evento_id`); check-in e checkout casam por `visita_id` em qualquer ordem. Teste: sequência original, invertida e embaralhada dão o mesmo estado.
- Payload inválido → `invalido` com o motivo em português, estado intacto; evento de outro nome/versão → `ignorado`.
- O dia e a base de apuração não são fixados na gravação (só UTC): mudar fuso/base não exige replay.

**Apuração do pedido (RN-CORE-21, RN-VEN-30/31/32/35)**
- Conta na base `aprovado` se o status atual ∈ {aprovado, integrado_erp, faturado_parcial, faturado_total}; na base `faturado`, se ∈ {faturado_parcial, faturado_total}. A data de apuração é o instante em que entrou no **trecho contínuo final** desses status (editar um aprovado o devolve à revalidação e a data passa a ser a da nova aprovação).
- **Líquido de cancelamentos**: pedido cancelado (ou rejeitado) deixa de contar, mesmo depois de aprovado. Orçamento (RN-VEN-32) nunca conta. Pedido sem o evento `criado` (status chegou antes) não conta até o `criado` chegar.
- **Pedido em nome** conta para o `vendedor_id` (RN-CORE-21, RN-VEN-35), nunca para o `autor_id` (gestor).
- Exemplo: criado 29/10, aprovado 30/10 15:00Z → conta em 30/10 (base aprovado); faturado_total em 02/11 → conta em 02/11 (base faturado).

## 2. Painel do dia por usuário de campo — `painel.ts` (`montarPainelDia`), RF-GES-01/02/10
Uma linha por (usuário, dia civil): `status_dia`, `visitas`, `vendas`, `mes`, `trade`, `pesquisa`, `treinamento`.
- **Status do dia (RF-GES-01)**: `em_visita` = há check-in aberto no dia; `em_rota` = já visitou e nada aberto; `sem_checkin` = nenhuma visita no dia.
- **Visitas (RN-CORE-20, RN-GES-05)**: `planejadas` = clientes distintos da rota do dia; `realizadas` = clientes **distintos** com check-in no dia (dia do check-in no fuso do tenant), da rota ou não; `planejadas_realizadas` = clientes **da rota** com check-in no dia da rota; `cobertura_pct` = planejadas_realizadas ÷ planejadas × 100, **no máximo 100** (`null` sem rota); `visitas_extras` = clientes visitados fora da rota do dia (num dia sem rota dentro de um período que tem rota, todo visitado é extra; `null` quando não há rota no período). Exemplos: rota de 4, check-ins em A (duas vezes) e B → realizadas 2, cobertura 50%, extras 0; rota de 10, visitas nos 10 + 2 fora → cobertura **100%** e **2 extras**; 8 da rota + 4 fora → 80% e 4 extras.
- **Tempo em cliente**: soma dos minutos das visitas **encerradas normalmente**; `tempo_medio_min` = total ÷ nº dessas visitas. Visita **fechada automaticamente** (RN-CORE-11, `encerramento: automatico`) conta como visita mas **não entra no tempo** (não há duração confiável). Exemplo: 20 min + 10 min → total 30, médio 15.
- **Conversão (RF-GES-02)**: visitas com pedido ativo (não cancelado/rejeitado, tipo pedido) ÷ visitas realizadas × 100; só vendedor com Vendedor ativo.
- **Vendido × faturado (RN-GES-06)**, seção `faturamento` do dia e `mes.faturamento` (mês até o dia), `faturamentoDoPeriodo`:
  - `vendido_cents` = Σ `total_cents` dos pedidos **criados** no período (dia da criação no fuso do tenant), tipo pedido (orçamento não entra, RN-VEN-32), sem cancelados nem rejeitados;
  - `faturado_cents` = quanto o ERP já faturou **desses pedidos** (`faturadoDoPedido`): faturamento total (`vendedor.pedido.faturado@1` com `parcial: false` ou status `faturado_total`) = total do pedido; parcial = Σ por item de min(quantidade faturada acumulada, pedida) ÷ pedida × total da linha, centavos meio para cima. Pedido sem `itens` no `criado` (campo PEDIDO ao Vendedor) fica com parcial **0 até o total**;
  - `a_faturar_cents` = vendido − faturado (o contrato recusa linha incoerente). É um número da "safra" de pedidos do período, então nunca fica negativo;
  - `vendas_cents` (abaixo) continua na **base de apuração** do tenant (RN-CORE-21) e é o que alimenta meta, ranking e ritmo.
  - Exemplo: pedido de R$ 100,00 (item 1: 10 un. = R$ 60,00; item 2: 4 un. = R$ 40,00); o ERP fatura 5 un. do item 1 → vendido 10.000, faturado **3.000**, a faturar 7.000; depois 1 un. do item 2 → faturado 4.000; faturamento total → 10.000 e a faturar 0. Item de 3 un. = R$ 10,00 com 1 un. faturada → 333.
- **Vendas do dia**: `vendas_cents` = Σ total dos pedidos apurados no dia; `pedidos`; `clientes_positivados` = clientes distintos (RN-CORE-20); `ticket_medio_cents` = vendas ÷ pedidos (meio para cima); `desconto_medio_pct` = (1 − Σ total final ÷ Σ total pela tabela) × 100, **ponderado** (RN-VEN-03), só com pedidos que trazem o total de tabela. Exemplo: 10.000 (tabela 10.000) + 9.000 (tabela 10.000) → vendas 19.000, ticket 9.500, desconto 5%.
- **Mês e meta (RN-CORE-21/22)**, `calcularMeta` / `painelDoMes`, mês acumulado até o dia consultado:
  - atingimento = realizado ÷ meta × 100; falta = max(0, meta − realizado);
  - **necessidade por dia útil = falta ÷ dias úteis restantes** (hoje conta se for útil; calendário de `@macuxi/comum` + `feriados` do tenant), centavos meio para cima; `0` com meta batida; `null` sem meta ou sem dia útil restante;
  - **ritmo (%)** = realizado até ontem ÷ (meta × dias úteis decorridos ÷ dias úteis do mês) × 100.
  - Exemplo (outubro/2026, 22 dias úteis; em 20/10: 13 decorridos, 9 restantes): meta R$ 22.000,00, realizado R$ 10.000,00 (R$ 9.000,00 até ontem) → atingimento 45,45%; falta R$ 12.000,00; necessidade **R$ 1.333,33**/dia útil; ritmo 900.000 ÷ (2.200.000 × 13/22 = 1.300.000) = **69,23%**. Com um feriado em 23/10: 8 restantes → R$ 1.500,00.
- **Trade do promotor (RF-GES-10)** — espelha as regras do Promotor sobre os eventos `promotor.*@1`:
  - RN-PRO-07: só coletas de visitas **encerradas com ≥ 10 min** entram nos indicadores; visita abaixo disso é "curta" (sinalizada ao gestor: `visitas.curtas`) e visita aberta/automática não conta como realizada do promotor;
  - RN-PRO-11: conformidade = (conformes + parciais × `peso_parcial_conformidade`) ÷ gôndolas × 100; parciais à parte. Ex.: conforme, conforme, parcial, não conforme → 50% (peso 0) ou 62,5% (peso 0,5);
  - RN-PRO-03: share médio = média simples dos shares medidos; meta média e atingimento usam só quem tem share **e** meta (atingimento = Σ share ÷ Σ meta). Ex.: (30, meta 40), (20, meta 20), (10, sem meta) → share médio 20; meta média 30; atingimento 83,33%;
  - RN-PRO-05: ruptura = itens em ruptura (gôndola + total) ÷ itens do mix registrados × 100; falha de reposição (ruptura na gôndola com produto no depósito) à parte. Ex.: 10 itens, 1 na gôndola, 2 totais → ruptura 30%, falha 10%;
  - RN-PRO-04: índice de preço médio = média dos índices informados (sem índice não entra);
  - RN-PRO-02: `fotos_sem_gps_pct` = fotos sem GPS ÷ fotos × 100 do período, de **todas** as visitas (inclusive curtas); `null` quando o Promotor não informa as contagens. Ex.: 14 fotos, 3 sem GPS → 21,43%;
  - tarefas concluídas = `promotor.tarefa.concluida@1` do dia.
- **Pesquisa**: respostas do dia e as sinalizadas como suspeitas (RN-PES-04). **Treinamento**: lições, trilhas concluídas, XP ganho (já com o teto diário, RN-TRE-01) e medalhas.
- **Módulo opcional desativado**: `vendas`/`mes` = `null` sem Vendedor; `trade` = `null` sem Promotor; `pesquisa`/`treinamento` = `null` sem o módulo; `conversao_pedido_pct` = `null` sem Vendedor. **RN-PRO-01**: promotor nunca tem `vendas`/`mes`, mesmo com o Vendedor ativo; vendedor não tem `trade`. As visitas (Core) nunca somem.

## 3. Equipe e escopo — `equipe.ts`, RF-GES-01, RN-CORE-04
- **Árvore** gerente → supervisor → vendedor/promotor a partir de `superior_id` (cadastro do Core). Irmãos em ordem de nome (pt-BR, sem acento/caixa) e id. Superior que não existe no cadastro: o membro vira raiz. **Ciclo**: erro em português (dado corrompido não pode travar o painel).
- **Escopo por perfil** (`escopoDoUsuario`): supervisor → seus subordinados (diretos e indiretos, sem ele); gerente → as equipes abaixo (idem, incluindo supervisores); analista e admin → tenant **em modo leitura** (RN-GES-07: ação `painel_tenant.ver` no manifesto; não têm `fila_aprovacao.decidir` nem `alerta_equipe.dispensar`; configuram as regras com `alerta_regra.gerenciar`); vendedor, promotor e assistente → nenhum. Gestor que não consta no cadastro recebe escopo **vazio**, nunca o tenant. Toda consulta (painel, ranking, fila, alertas, pedido em nome) passa por `podeVer`/`filtrarPorEscopo`; a API revalida.
- **Resumo da equipe** (`resumirEquipe`): contagem por status do dia (quem não tem linha no dia = `sem_checkin`; inativo não conta), vendas e pedidos somados, meta somada **só de quem tem meta**, atingimento = Σ vendas do mês ÷ Σ meta (dos que têm meta), cobertura = Σ planejadas_realizadas ÷ Σ planejadas (máx. 100%, RN-GES-05), `visitas_extras` somadas à parte e `vendido`/`faturado`/`a_faturar` somados (RN-GES-06; `null` sem Vendedor). Sem nenhuma linha com vendas (Vendedor desativado) o total é `null`, não zero. `equipesAbaixo` = um resumo por subordinado direto que também lidera gente (cada supervisor de um gerente).

## 4. Ranking — `ranking.ts`, RF-GES-03
Indicadores: `vendas_cents`, `pedidos`, `positivados`, `ticket_medio_cents`, `atingimento_meta_pct` (**só no período mensal**; nos demais todos ficam sem dado), `cobertura_pct` (vendedor e promotor), `conformidade_pct` e `ruptura_pct` (promotor; **menor é melhor**). Períodos: `diario`; `semanal` = segunda a domingo da semana da data; `mensal` = mês civil — sempre no fuso do tenant. Participam os **ativos** do escopo de quem consulta (RN-CORE-04) com perfil do indicador; módulo do indicador desativado → ranking vazio, sem erro.

**Desempate (ordem total, posições 1, 2, 3… sem repetir):** 1) valor do indicador (maior melhor; `ruptura_pct`: menor melhor); 2) **maior venda no período** (centavos); 3) **mais pedidos** no período; 4) nome (pt-BR, sem diferenciar acento/caixa); 5) id. Quem não tem dado no período (valor `null`) vai ao fim, **sem posição**, ordenado por nome e id; valor 0 é dado. Exemplo (semana): Bruno 50.000 (2 pedidos) e Carla 50.000 (1 pedido) → Bruno antes.

## 5. Alertas — `alertas.ts`, RF-GES-07 (P1)
`avaliarAlertas` devolve as **condições** que valem agora (só regra ligada **e** módulo de origem ativo); `reconciliarAlertas` compara com os alertas gravados e devolve `abrir`, `atualizar`, `encerrar` (idempotente: aplicar e reconciliar de novo dá vazio).
| Tipo | Condição | Alvo / responsável |
|---|---|---|
| `cliente_sem_visita` | **RN-GES-01**: cliente ativo da carteira com dias desde o último check-in de **qualquer usuário** (dia no fuso do tenant) **acima** (>) do limite do cliente = ⌊frequência × (1 + `pct_tolerancia_frequencia` ÷ 100)⌋ — semanal (7) → 10, quinzenal (14) → 21, mensal (30) → 45; sem frequência → `dias_sem_visita_padrao` (30). **RN-GES-02**: nunca visitado só alerta com ≥ `dias_carencia_cliente_novo` (15) dias na carteira (valor `null`, limiar = carência). Sem carteira ou vendedor inativo: não alerta | cliente / vendedor da carteira |
| `ritmo_abaixo_meta` | ritmo (seção 2) < `limiar` (80%) e dias úteis decorridos ≥ `amostra_min` (3). Sem meta: não alerta | vendedor |
| `pedido_aguardando_aprovacao` | solicitação pendente há ≥ `limiar` (24) **horas úteis** (RN-GES-03; a pendência segue a seção 6) | pedido / vendedor do pedido |
| `ruptura_recorrente` | nº de **visitas distintas** da loja (≥ permanência mínima) com ≥ 1 item em ruptura nos últimos `janela_dias` (14) ≥ `limiar` (3) | loja (cliente) / promotor da última ruptura |
| `visita_curta` | visita de loja com permanência < `permanencia_min_min` (10, RN-PRO-07) nos últimos `janela_dias` (3) | visita de loja / promotor |
| `fotos_sem_gps` | nos últimos `janela_dias` (7): fotos ≥ `amostra_min` (10) e % sem GPS **acima** (>) de `limiar` (20) | promotor |
- **Deduplicação**: chave `<tipo>:<alvo_id>`; um alerta aberto por chave (condição repetida na entrada, ou alerta que já existe, não abre outro). Duplicados já gravados: fica o mais antigo, os outros encerram com motivo `duplicado`.
- **Atualização**: se o valor/mensagem/severidade mudou (31 → 35 dias), atualiza o aberto.
- Exemplos RN-GES-01/02 (hoje 30/10): cliente quinzenal visitado em 09/10 (21 dias) não alerta; em 08/10 (22 dias) alerta com valor 22 e limiar 21; sem frequência alerta a partir de 31 dias; cliente nunca visitado na carteira desde 16/10 (14 dias) não alerta, desde 15/10 (15 dias) alerta.
- **Entrada na carteira** (RN-GES-02): `na_carteira_desde` do `core.cliente.atualizado@1` (campo PEDIDO ao Core); sem ele, o primeiro evento do cliente com o vendedor atual (mínimo dos `ocorrido_em`, independe da ordem). Trocar de vendedor reinicia a carência.
- **Encerramento automático**: condição que deixou de valer → `condicao_normalizada`; regra desligada ou módulo desativado → `regra_inativa`.
- **Dispensado** pelo gestor: não reabre enquanto a condição persiste; se a condição some, encerra; se voltar, abre um alerta novo.
- Fora desta tarefa: "vendedor sem check-in até [10h]", "cliente da rota não visitado" e "desconto fora do padrão" (RF-GES-07) — dependem de rota planejada com horário e de evento de desconto; ficam para a próxima.

## 6. Fila de aprovação — `aprovacoes.ts`, RF-GES-04
- **A alçada é do Vendedor** (RN-VEN-10..13): o Gestor **não** recalcula quem aprova o quê. Consome `vendedor.pedido.aprovacao_solicitada@1` (que já traz `nivel`, `motivos`, `desconto_efetivo_pct`, `total_cents` e, opcionalmente, `credito` e `historico` do cliente) e a decisão é executada pela API pública do Vendedor (`pedido.aprovar`). O Gestor só: filtra por escopo, ordena por prazo e valida o comentário.
- **Pendente** = a solicitação **mais recente** do pedido sem nenhuma transição decisória (aprovado, rejeitado, cancelado, integrado/faturado) a partir dela; vale com eventos fora de ordem. Editar um aprovado gera nova solicitação e o pedido volta à fila (RN-VEN-31).
- **Prazo (RN-GES-03)**: contado em **horas úteis** do horário comercial do tenant (`horario_comercial`: dias da semana + janela HH:MM no **fuso do tenant**, sem os `feriados`; padrão seg–sex 08:00–18:00). `prazo_em` = instante em que se completam `aprovacao_prazo_horas` (24) horas úteis desde a solicitação (`somarHorasUteis`; fora do horário começa na próxima abertura; terminando no fechamento, o prazo é o fechamento); `horas_restantes` = horas úteis até o prazo (`horasUteisEntre`, negativo = vencido há N horas úteis); situação: **vencido** a partir do instante do prazo (inclusive), **vencendo** (≤ `aprovacao_aviso_horas`, 4 h úteis), **no_prazo**. Janela 24×7 (`[1..7]`, 00:00–24:00) = horas corridas.
  - Exemplos (Manaus): sexta 17:00 + 24 h úteis = **quarta 11:00** (1 + 10 + 10 + 3); no fim de semana o relógio para (24 h corridas venceriam no sábado 17:00). Com prazo do tenant de 8 h: sexta 17:00 → vence **segunda 15:00**, "vencendo" a partir de segunda 11:00. Sexta 17:00 → segunda 09:00 = 2 h úteis.
  - Fuso: a mesma solicitação de sexta 21:30Z vale 0,5 h útil em Manaus (17:30) e 0 em São Paulo (18:30); com 8 h de prazo vence segunda 19:30Z (Manaus) ou 19:00Z (São Paulo). Fuso com horário de verão (ex.: Nova York em 01/11/2026) usa o relógio local de cada dia.
- **Ordem**: prazo mais antigo primeiro (vencidos, depois vencendo, depois no prazo), desempate por `pedido_id`.
- **Quem vê**: supervisor e gerente, dentro do escopo (RN-CORE-04); analista e admin veem a fila do **tenant em modo leitura** (RN-GES-07, `pode_decidir` sempre falso); itens de nível `analista` ficam fora (fila do BKO do Vendedor, RF-VEN-09). Vendedor, promotor e assistente: fila vazia. Vendedor desativado → fila vazia.
- **Quem decide (RN-GES-04)** (`podeDecidir`): supervisor decide o nível supervisor; gerente decide o nível gerente **e também o nível supervisor** (`acima_do_nivel: true` no item); os demais itens do escopo são acompanhamento.
- **Registro da decisão (RN-GES-04)** (`registrarDecisao`): valida a decisão, o perfil (analista/admin/campo → `SOMENTE_LEITURA`), a pendência (`NAO_PENDENTE`), o escopo (`FORA_DO_ESCOPO`) e o nível (`FORA_DA_ALCADA`); devolve o `RegistroDecisaoAprovacao` (pedido, vendedor, decisão, comentário, `nivel_pedido`, `decidido_por_id`, `decidido_por_perfil`, `acima_do_nivel`, `decidido_em`) para a auditoria e, quando o gerente decide um item do supervisor, um `AvisoDecisaoAoSupervisor` (`tipo: aprovacao_decidida_pelo_gerente`, destinatário = primeiro supervisor acima do vendedor na hierarquia). O Gestor **não publica evento**: a API entrega o aviso à notificação do Core. A execução e a revalidação da alçada continuam na API do Vendedor (`pedido.aprovar`).
- **Decisão (RN-GES-08)** (`validarDecisao`): comentário obrigatório **só na rejeição** (≥ 3 caracteres, sem contar espaços); aprovar continua em 1 toque, sem comentário. Exemplo: `{ decisao: 'aprovar' }` é aceito; `{ decisao: 'rejeitar' }` sem motivo (ou só com espaços) é recusado com a mensagem "RN-GES-08: informe o motivo da rejeição (mínimo 3 caracteres)" na resposta.
- `resumirFila`: total, vencidos, vencendo e "para mim" (o que quem consulta pode decidir).

## 7. Pedido em nome do vendedor — `pedido-em-nome.ts`, RF-GES-05, RN-VEN-35
O **motor é do Vendedor** (extensão e ação `pedido.criar_em_nome`, supervisor e gerente). O Gestor decide só **se a função aparece e para quem**: Vendedor desativado → `visivel: false`, sem erro e sem mensagem (RN-CORE-03); perfil fora de supervisor/gerente → `visivel: false` (PERFIL_SEM_ACESSO, matriz do doc 03); vendedor fora do escopo → negado com mensagem (FORA_DO_ESCOPO); promotor (RN-PRO-01) ou vendedor inativo → VENDEDOR_INVALIDO. Contexto passado à extensão (`ContextoPedidoEmNome`): `vendedor_id` = vendedor, `autor_id` = gestor, `cliente_id`, `visita_id?`; autor igual ao vendedor não é "em nome". A alçada do gestor (RN-VEN-10) e a revalidação final são da API do Vendedor.

## Eventos consumidos e espelhos (`contracts/eventos-consumidos.ts`)
Os schemas dos outros módulos não são dependência do Gestor; o contrato espelha só o que lê (campo novo opcional do publicador é ignorado). Campos **PEDIDO** são acréscimos opcionais pedidos ao publicador; ausentes → indicador `null`.
| Evento | Usado em | Observação |
|---|---|---|
| `core.cliente.atualizado@1` | carteira, alerta `cliente_sem_visita` | espelho: `cliente_id`, `vendedor_id`, `ativo`, `nome?`; PEDIDO: `frequencia_visita` (semanal/quinzenal/mensal, RN-GES-01) e `na_carteira_desde` (RN-GES-02) |
| `core.visita.checkin@1`, `core.visita.checkout@1` | visitas, tempo, status do dia | checkout com `encerramento` (`normal`/`automatico`, RN-CORE-11) |
| `vendedor.pedido.criado@1` | vendas, vendido | PEDIDO: `total_tabela_cents`, `tipo`, `visita_id`, `autor_id`, `itens` (`produto_id`, `quantidade`, `total_cents`; RN-GES-06) |
| `vendedor.pedido.status_alterado@1` | apuração, fila | traz a transição (`para`, `alterado_em`); `faturado_total` sem evento de faturamento conta como total |
| `vendedor.pedido.faturado@1` | faturado (RN-GES-06) | **cópia provisória** de `PedidoFaturadoEvento` (modules/vendedor/contracts/eventos.ts): itens faturados por retorno, `parcial` |
| `vendedor.pedido.aprovacao_solicitada@1` | fila, alerta | PEDIDO: `credito`, `historico` |
| `promotor.visita_loja.concluida@1` | permanência, curtas, fotos | PEDIDO: `fotos_total`, `fotos_sem_gps` (RN-PRO-02) |
| `promotor.gondola.registrada@1`, `share.medido@1`, `preco.coletado@1`, `ruptura.registrada@1`, `tarefa.concluida@1` | trade | espelhos mínimos |
| `pesquisa.resposta.registrada@1`, `treinamento.licao.concluida@1`, `treinamento.medalha.conquistada@1` | pesquisa, treinamento | espelham os payloads publicados (`RespostaRegistradaV1`, etc.) |
| `core.rota.dia_planejado@1` | visitas planejadas | **PROPOSTO — falta no registro**; fora do `consome` até existir |
| `core.meta.definida@1` | meta do mês | **PROPOSTO — falta no registro**; fora do `consome` até existir |
Hierarquia da equipe (`MembroEquipe`: id, nome, perfil, superior_id, ativo): vem do cadastro de usuários do Core por contrato público (não é evento nesta tarefa; o contrato da hierarquia entra na T-0017); a API monta a lista e passa ao domain.
As cópias dos formatos de eventos dos outros módulos ficam aqui **por enquanto**: o engenheiro-software vai publicar o schema de cada evento no `contracts` do módulo dono, e o Gestor passa a importar de lá (leitura tolerante).

## Decisões do Alexandre (RN-GES, texto proposto ao doc 03)
Padrões parametrizáveis por tenant (R-20261031-165536-alexandre). Números entre colchetes = parâmetro.
- **RN-GES-01** Alerta "cliente sem visita": alerta quando os dias desde a última visita (de qualquer usuário) passam do limite do cliente = ⌊frequência de visita × (1 + [50%])⌋ — semanal → 10 dias, quinzenal → 21, mensal → 45; cliente sem frequência definida → [30] dias. Demais padrões mantidos: ritmo mínimo [80%], aprovação pendente [24 h], [3] rupturas em [14] dias, [20%] de fotos sem GPS.
- **RN-GES-02** Cliente nunca visitado só gera o alerta depois de [15] dias na carteira do vendedor atual.
- **RN-GES-03** O prazo da aprovação é contado em horário comercial do tenant: dias úteis (sem feriados) e janela configurável, no fuso do tenant; padrão seg–sex [08:00–18:00]. Fora da janela o prazo não corre.
- **RN-GES-04** O gerente pode decidir item do nível do supervisor; a decisão registra quem decidiu, com que perfil e em que nível estava o pedido, e o supervisor do vendedor é avisado.
- **RN-GES-05** Cobertura de rota = clientes planejados visitados ÷ planejados, no máximo 100%; visitas fora da rota formam o indicador "visitas extras".
- **RN-GES-06** O painel mostra "vendido" (valor do pedido criado) e "faturado" (só o que o ERP faturou, inclusive parcial pelos itens faturados); "a faturar" = vendido − faturado.
- **RN-GES-07** Analista e admin veem os painéis do tenant em modo leitura no BKO; não decidem aprovações nem dispensam alertas.
- **RN-GES-08** Comentário obrigatório só na rejeição; aprovar continua em 1 toque.
