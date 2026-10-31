# Gestor — regras de cálculo (domain)

Implementação: `modules/gestor/domain/` (funções puras, sem I/O; rodam no app offline, na web e na API). Cada arquivo tem um `*.test.ts` com os casos abaixo (`it('RN-...: ...')`). Contratos Zod (painel, ranking, alerta, fila de aprovação, pedido em nome e os espelhos dos eventos consumidos): `modules/gestor/contracts/`. Tarefa: T-0014 (domínio, contratos e manifesto; sem banco e sem telas). Requisitos: RF-GES-01 a 10 (`docs/produto/02`); regras: `docs/produto/03` (RN-CORE-04/20/21/22, RN-VEN-03/10/30/31/32/35, RN-PRO-01/02/03/05/07/11).

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
| `aprovacao_prazo_horas` | 24 | prazo da fila de aprovação | **premissa T-0014** (RF-GES-04) |
| `aprovacao_aviso_horas` | 4 (< prazo) | "vencendo" na fila | **premissa T-0014** |

### Regras de alerta (`alertas.ts`, `resolverRegras(ajustes)`; uma por tipo, cada uma liga/desliga e ajusta)
| Tipo | `limiar` | `janela_dias` | `amostra_min` | Severidade | Módulo de origem |
|---|---|---|---|---|---|
| `cliente_sem_visita` | 30 (dias) | — | — | atenção | Core |
| `ritmo_abaixo_meta` | 80 (% do ritmo esperado) | — | 3 (dias úteis decorridos) | atenção | Vendedor |
| `pedido_aguardando_aprovacao` | 24 (horas) | — | — | crítica | Vendedor |
| `ruptura_recorrente` | 3 (visitas da loja com ruptura) | 14 | — | atenção | Promotor |
| `visita_curta` | — (usa `permanencia_min_min`) | 3 | — | info | Promotor |
| `fotos_sem_gps` | 20 (% máximo) | 7 | 10 (fotos) | atenção | Promotor |

Tudo isso é **premissa da T-0014** (o doc 03 só fixa os 10 min e o princípio "o gestor vê o % de fotos sem GPS"; ver "Perguntas para o Alexandre").

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
- **Visitas (RN-CORE-20)**: `planejadas` = clientes distintos da rota do dia; `realizadas` = clientes **distintos** com check-in no dia (dia do check-in no fuso do tenant); `cobertura_pct` = realizadas ÷ planejadas × 100 (`null` sem rota; **pode passar de 100** quando há visita fora da rota). Exemplo: rota de 4, check-ins em A (duas vezes) e B → realizadas 2, cobertura 50%.
- **Tempo em cliente**: soma dos minutos das visitas **encerradas normalmente**; `tempo_medio_min` = total ÷ nº dessas visitas. Visita **fechada automaticamente** (RN-CORE-11, `encerramento: automatico`) conta como visita mas **não entra no tempo** (não há duração confiável). Exemplo: 20 min + 10 min → total 30, médio 15.
- **Conversão (RF-GES-02)**: visitas com pedido ativo (não cancelado/rejeitado, tipo pedido) ÷ visitas realizadas × 100; só vendedor com Vendedor ativo.
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
- **Escopo por perfil** (`escopoDoUsuario`): supervisor → seus subordinados (diretos e indiretos, sem ele); gerente → as equipes abaixo (idem, incluindo supervisores); analista e admin → tenant (leitura); vendedor, promotor e assistente → nenhum. Gestor que não consta no cadastro recebe escopo **vazio**, nunca o tenant. Toda consulta (painel, ranking, fila, alertas, pedido em nome) passa por `podeVer`/`filtrarPorEscopo`; a API revalida.
- **Resumo da equipe** (`resumirEquipe`): contagem por status do dia (quem não tem linha no dia = `sem_checkin`; inativo não conta), vendas e pedidos somados, meta somada **só de quem tem meta**, atingimento = Σ vendas do mês ÷ Σ meta (dos que têm meta), cobertura = Σ realizadas ÷ Σ planejadas. Sem nenhuma linha com vendas (Vendedor desativado) o total é `null`, não zero. `equipesAbaixo` = um resumo por subordinado direto que também lidera gente (cada supervisor de um gerente).

## 4. Ranking — `ranking.ts`, RF-GES-03
Indicadores: `vendas_cents`, `pedidos`, `positivados`, `ticket_medio_cents`, `atingimento_meta_pct` (**só no período mensal**; nos demais todos ficam sem dado), `cobertura_pct` (vendedor e promotor), `conformidade_pct` e `ruptura_pct` (promotor; **menor é melhor**). Períodos: `diario`; `semanal` = segunda a domingo da semana da data; `mensal` = mês civil — sempre no fuso do tenant. Participam os **ativos** do escopo de quem consulta (RN-CORE-04) com perfil do indicador; módulo do indicador desativado → ranking vazio, sem erro.

**Desempate (ordem total, posições 1, 2, 3… sem repetir):** 1) valor do indicador (maior melhor; `ruptura_pct`: menor melhor); 2) **maior venda no período** (centavos); 3) **mais pedidos** no período; 4) nome (pt-BR, sem diferenciar acento/caixa); 5) id. Quem não tem dado no período (valor `null`) vai ao fim, **sem posição**, ordenado por nome e id; valor 0 é dado. Exemplo (semana): Bruno 50.000 (2 pedidos) e Carla 50.000 (1 pedido) → Bruno antes.

## 5. Alertas — `alertas.ts`, RF-GES-07 (P1)
`avaliarAlertas` devolve as **condições** que valem agora (só regra ligada **e** módulo de origem ativo); `reconciliarAlertas` compara com os alertas gravados e devolve `abrir`, `atualizar`, `encerrar` (idempotente: aplicar e reconciliar de novo dá vazio).
| Tipo | Condição | Alvo / responsável |
|---|---|---|
| `cliente_sem_visita` | cliente ativo da carteira: dias desde o último check-in de **qualquer usuário** (dia no fuso do tenant) ≥ `limiar` (30). **Nunca visitado alerta** (valor `null`). Sem carteira ou vendedor inativo: não alerta | cliente / vendedor da carteira |
| `ritmo_abaixo_meta` | ritmo (seção 2) < `limiar` (80%) e dias úteis decorridos ≥ `amostra_min` (3). Sem meta: não alerta | vendedor |
| `pedido_aguardando_aprovacao` | solicitação pendente há ≥ `limiar` (24) horas (a pendência segue a seção 6) | pedido / vendedor do pedido |
| `ruptura_recorrente` | nº de **visitas distintas** da loja (≥ permanência mínima) com ≥ 1 item em ruptura nos últimos `janela_dias` (14) ≥ `limiar` (3) | loja (cliente) / promotor da última ruptura |
| `visita_curta` | visita de loja com permanência < `permanencia_min_min` (10, RN-PRO-07) nos últimos `janela_dias` (3) | visita de loja / promotor |
| `fotos_sem_gps` | nos últimos `janela_dias` (7): fotos ≥ `amostra_min` (10) e % sem GPS **acima** (>) de `limiar` (20) | promotor |
- **Deduplicação**: chave `<tipo>:<alvo_id>`; um alerta aberto por chave (condição repetida na entrada, ou alerta que já existe, não abre outro). Duplicados já gravados: fica o mais antigo, os outros encerram com motivo `duplicado`.
- **Atualização**: se o valor/mensagem/severidade mudou (31 → 35 dias), atualiza o aberto.
- **Encerramento automático**: condição que deixou de valer → `condicao_normalizada`; regra desligada ou módulo desativado → `regra_inativa`.
- **Dispensado** pelo gestor: não reabre enquanto a condição persiste; se a condição some, encerra; se voltar, abre um alerta novo.
- Fora desta tarefa: "vendedor sem check-in até [10h]", "cliente da rota não visitado" e "desconto fora do padrão" (RF-GES-07) — dependem de rota planejada com horário e de evento de desconto; ficam para a próxima.

## 6. Fila de aprovação — `aprovacoes.ts`, RF-GES-04
- **A alçada é do Vendedor** (RN-VEN-10..13): o Gestor **não** recalcula quem aprova o quê. Consome `vendedor.pedido.aprovacao_solicitada@1` (que já traz `nivel`, `motivos`, `desconto_efetivo_pct`, `total_cents` e, opcionalmente, `credito` e `historico` do cliente) e a decisão é executada pela API pública do Vendedor (`pedido.aprovar`). O Gestor só: filtra por escopo, ordena por prazo e valida o comentário.
- **Pendente** = a solicitação **mais recente** do pedido sem nenhuma transição decisória (aprovado, rejeitado, cancelado, integrado/faturado) a partir dela; vale com eventos fora de ordem. Editar um aprovado gera nova solicitação e o pedido volta à fila (RN-VEN-31).
- **Prazo**: `prazo_em` = solicitação + `aprovacao_prazo_horas` (24 h corridas); `horas_restantes` = prazo − agora (negativo = vencido há N h); situação: **vencido** (≤ 0), **vencendo** (≤ `aprovacao_aviso_horas`, 4 h), **no_prazo**. Exemplo: solicitada 29/10 06:00Z, agora 31/10 12:00Z → −30 h, vencido.
- **Ordem**: prazo mais antigo primeiro (vencidos, depois vencendo, depois no prazo), desempate por `pedido_id`.
- **Quem vê**: só supervisor e gerente, dentro do escopo (RN-CORE-04); itens de nível `analista` ficam fora (fila do BKO do Vendedor, RF-VEN-09). **Quem decide** (`pode_decidir`): quem tem exatamente o perfil do `nivel` pedido; os demais itens do escopo são acompanhamento. Vendedor desativado → fila vazia.
- **Decisão** (`validarDecisao`): rejeitar exige comentário (≥ 3 caracteres); aprovar aceita sem comentário.
- `resumirFila`: total, vencidos, vencendo e "para mim".

## 7. Pedido em nome do vendedor — `pedido-em-nome.ts`, RF-GES-05, RN-VEN-35
O **motor é do Vendedor** (extensão e ação `pedido.criar_em_nome`, supervisor e gerente). O Gestor decide só **se a função aparece e para quem**: Vendedor desativado → `visivel: false`, sem erro e sem mensagem (RN-CORE-03); perfil fora de supervisor/gerente → `visivel: false` (PERFIL_SEM_ACESSO, matriz do doc 03); vendedor fora do escopo → negado com mensagem (FORA_DO_ESCOPO); promotor (RN-PRO-01) ou vendedor inativo → VENDEDOR_INVALIDO. Contexto passado à extensão (`ContextoPedidoEmNome`): `vendedor_id` = vendedor, `autor_id` = gestor, `cliente_id`, `visita_id?`; autor igual ao vendedor não é "em nome". A alçada do gestor (RN-VEN-10) e a revalidação final são da API do Vendedor.

## Eventos consumidos e espelhos (`contracts/eventos-consumidos.ts`)
Os schemas dos outros módulos não são dependência do Gestor; o contrato espelha só o que lê (campo novo opcional do publicador é ignorado). Campos **PEDIDO** são acréscimos opcionais pedidos ao publicador; ausentes → indicador `null`.
| Evento | Usado em | Observação |
|---|---|---|
| `core.cliente.atualizado@1` | carteira, alerta `cliente_sem_visita` | espelho: `cliente_id`, `vendedor_id`, `ativo`, `nome?` |
| `core.visita.checkin@1`, `core.visita.checkout@1` | visitas, tempo, status do dia | checkout com `encerramento` (`normal`/`automatico`, RN-CORE-11) |
| `vendedor.pedido.criado@1` | vendas | PEDIDO: `total_tabela_cents`, `tipo`, `visita_id`, `autor_id` |
| `vendedor.pedido.status_alterado@1` | apuração, fila | traz a transição (`para`, `alterado_em`) e cobre o faturamento (não consome `faturado@1`) |
| `vendedor.pedido.aprovacao_solicitada@1` | fila, alerta | PEDIDO: `credito`, `historico` |
| `promotor.visita_loja.concluida@1` | permanência, curtas, fotos | PEDIDO: `fotos_total`, `fotos_sem_gps` (RN-PRO-02) |
| `promotor.gondola.registrada@1`, `share.medido@1`, `preco.coletado@1`, `ruptura.registrada@1`, `tarefa.concluida@1` | trade | espelhos mínimos |
| `pesquisa.resposta.registrada@1`, `treinamento.licao.concluida@1`, `treinamento.medalha.conquistada@1` | pesquisa, treinamento | espelham os payloads publicados (`RespostaRegistradaV1`, etc.) |
| `core.rota.dia_planejado@1` | visitas planejadas | **PROPOSTO — falta no registro**; fora do `consome` até existir |
| `core.meta.definida@1` | meta do mês | **PROPOSTO — falta no registro**; fora do `consome` até existir |
Hierarquia da equipe (`MembroEquipe`: id, nome, perfil, superior_id, ativo): vem do cadastro de usuários do Core por contrato público (não é evento nesta tarefa); a API monta a lista e passa ao domain.

## Perguntas para o Alexandre (premissas da T-0014)
1. **Padrões dos alertas**: 30 dias sem visita, ritmo mínimo de 80% (a partir do 3º dia útil), 24 h de aprovação pendente, 3 rupturas em 14 dias, 20% de fotos sem GPS (mínimo de 10 fotos em 7 dias). Confirmar ou ajustar.
2. **Cliente nunca visitado** gera alerta `cliente_sem_visita`? (hoje sim; em carteira recém-importada isso gera muito alerta).
3. **Prazo da aprovação**: 24 horas corridas, com aviso 4 h antes? Ou em horário comercial?
4. **Quem decide na fila**: hoje só o perfil exato do nível pedido (supervisor decide nível supervisor; gerente, nível gerente). O gerente pode decidir item do nível supervisor?
5. **Cobertura** passa de 100% quando o vendedor visita cliente fora da rota (RN-CORE-20 literal). Limitar a 100% ou contar só clientes da rota?
6. **Faturado parcial** conta na base `faturado`? (hoje sim, pelo valor total do pedido, pois o evento não traz valor parcial).
7. **Analista e admin** veem painéis, ranking e alertas do tenant em leitura (RN-CORE-04); admin e analista também configuram as regras de alerta. Assistente não vê painel. Confirmar.
8. **Rejeição exige comentário**; aprovação aceita sem comentário (RF-GES-04 diz "com comentário"). Exigir nos dois?
