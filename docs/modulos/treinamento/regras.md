# Treinamento — regras de cálculo (domain)

Implementação: `modules/treinamento/domain/` (funções puras, sem I/O; rodam no app offline, na web e na API). Cada arquivo tem um `*.test.ts` com os casos abaixo (`it('RN-TRE-xx: ...')`). Contratos Zod: `modules/treinamento/contracts/` (reaproveitam estas funções nos refinamentos; a API sempre revalida). Tarefa: T-0011 (domínio, sem banco e sem telas; ajustes A–D e desafio no faturamento, v2). Regras de negócio: `docs/produto/03-regras-de-negocio.md` (RN-TRE-01 a 08).

Convenções: nota e percentuais com 2 casas (meio para cima); XP sempre inteiro; instantes em UTC (ISO com `Z`), **"dia" = data civil no fuso do tenant** (`America/Manaus` por padrão, via `localDate` de `@macuxi/comum`, ADR 0002); ids UUID gerados no aparelho; "sem dados" devolve `null`, nunca divide por zero. Cada seção cita a RN-TRE do doc 03 (ver o mapa no fim). Todo número é padrão **parametrizável por tenant** (tabela abaixo). "Decisão 31/10" na coluna Origem indica que o Alexandre fixou o valor nessa data.

## Parâmetros do tenant (`parametros.ts`, `resolverParametros(parcial)`)
| Parâmetro | Padrão | Onde entra | Origem |
|---|---|---|---|
| `nota_minima_pct` | 70 | `aprovado`, `registrarTentativaQuiz` | RN-TRE-02 |
| `tentativas_max_dia` | 3 | `validarTentativa` | RN-TRE-02 |
| `intervalo_min_tentativas_min` | 0 (sem intervalo) | `validarTentativa` | decisão 31/10 (RN-TRE-02) |
| `nota_que_vale` | `melhor` (ou `ultima`) | `notaQueVale` | decisão 31/10 (RN-TRE-02) |
| `segundos_minimos_licao` | 30 | `tempoMinimoDaLicao` | RN-TRE-04 |
| `pct_minimo_duracao_licao` | 50 (0–100; 0 = só o piso) | `tempoMinimoDaLicao` | decisão 31/10 (RN-TRE-04) |
| `xp_licao` | 10 | `xpDaLicao` | RN-TRE-01 |
| `xp_acerto_questao` | 5 | `xpDoQuiz` | RN-TRE-01 |
| `xp_trilha` | 50 | `xpDaTrilha` | RN-TRE-01 |
| `xp_streak_por_dia` / `xp_streak_teto` | 2 / 20 | `xpDoStreak` | RN-TRE-01 |
| `xp_teto_diario` | 200 (0 = sem teto) | `proporLancamento` | decisão 31/10 (RN-TRE-01) |
| `xp_max_por_desafio` | 500 por vendedor e desafio (0 = sem teto) | `candidatoDoDesafio` / `proporLancamento` | decisão 31/10 (ajuste A; RF-TRE-06, RN-TRE-08) |
| `niveis_xp_min` | 0, 100, 250, 450, 700, 1000, 1400, 1900, 2500, 3200 (10 níveis) | `nivelDoXp` | decisão 31/10 (RF-TRE-03) |
| `streak_medalha_dias` | 7 | `medalhasPadrao` | decisão 31/10 (RF-TRE-03) |
| `perfis_ranking` | vendedor, promotor | `calcularRanking` | decisão 31/10 (RN-TRE-03) |
| `fuso` | `America/Manaus` | tudo que usa "dia" | doc 03, tabela de parâmetros |

Também por cadastro do desafio (RF-TRE-06, não por tenant): `xp_por_unidade`, `xp_max_por_pedido` (sem padrão: obrigatório no cadastro) e, opcionalmente, `xp_max_por_desafio` (tem prioridade sobre o do tenant; ausente = padrão 500).

`resolverParametros` recusa valores inválidos (nota fora de 0–100, tentativas < 1, XP negativo/fracionado, `pct_minimo_duracao_licao` fora de 0–100, `segundos_minimos_licao`/`xp_max_por_desafio` negativos ou fracionados, faixas que não começam em 0 ou não crescem, fuso inexistente). O desempate do ranking e a ordem dos critérios **não** são parâmetros (fixos, abaixo).

## 1. Trilha, módulos, lições e pré-requisitos — RF-TRE-01, RF-TRE-02 (`trilha.ts`)
- **Progresso** = lições concluídas ÷ total de lições × 100 (só contam lições da trilha). Trilha concluída = todas concluídas; trilha sem lições nunca é concluída (0%). Exemplo: 1 de 3 → 33,33%; por módulo também (`modulos[]`).
- **Pré-requisitos** (lição bloqueada até concluir os exigidos): trilha `sequencial` (padrão) exige a **lição anterior do módulo** e **todas as lições do módulo anterior**; além disso, `pre_requisitos` explícitos de lição (ids de lição) e de módulo (ids de módulo). Módulo bloqueado = algum módulo exigido ainda incompleto. `statusDaLicao` → `concluida | liberada | bloqueada` (+ `pendentes`); `statusDoModulo` → `concluido | liberado | bloqueado`.
- **Retomar de onde parou** (`proximaLicao`): primeira lição, na ordem módulo → lição, que está liberada e não concluída; `null` se a trilha acabou.
- **Validação para publicar** (`validarTrilha`): ids repetidos, pré-requisito inexistente e ciclo (a lição nunca liberaria).
- **Público-alvo** — RN-TRE-07 (`usuarioNoPublico`): `perfis` e `equipes`; critério vazio = sem restrição; com os **dois preenchidos vale a interseção** (perfil E equipe); com **só um**, vale esse; **ambos vazios = todo o tenant** (decisão 31/10). Usuário sem equipe não entra em trilha restrita por equipe. Exemplo: perfis [vendedor] + equipes [Norte] → só vendedor da equipe Norte; perfis [vendedor] sozinho → todo vendedor. Só trilha **publicada** é visível (`trilhasDisponiveis`).
- **Obrigatórias pendentes** (`trilhasPendentes`): publicada + `obrigatoria` + usuário no público + não concluída. Ordem: prazo crescente (sem prazo por último), depois id. `atrasada` = hoje > prazo; `dias_para_prazo` = prazo − hoje (negativo = vencido). Exemplo: hoje 31/10; prazo 30/10 → atrasada (−1); prazo 31/10 → não atrasada (0).

## 2. Quiz: nota, aprovação, tentativas — RN-TRE-02 (`quiz.ts`)
- **Correção** (`corrigirQuiz`): a questão acerta só se o conjunto de alternativas marcadas é exatamente o das corretas (múltipla escolha exige todas); em branco = erro. Resposta a questão de outro quiz ou repetida = erro (a API devolve 422).
- **Nota (0–100)** = acertos ÷ questões × 100, **2 casas, meio para cima**. Exemplo: 2/3 → 66,67; 7/10 → 70.
- **Aprovação**: nota ≥ [70%], limite inclusivo. A comparação é **exata** (`acertos × 100 ≥ mínimo × total`): arredondar para exibir nunca aprova quem ficou abaixo (69,996% aparece como 70 e continua reprovado).
- **Tentativas**: até [3] por dia, o dia no fuso do tenant. 4ª tentativa → recusada (`LIMITE_DIARIO`) com `proxima_em` = início do dia seguinte no fuso. Exemplo: 3 tentativas às 22:00 Manaus de 31/10 → liberada a partir de 01/11 04:00Z. A validação offline considera só as tentativas **anteriores** à nova (por `realizada_em`).
- **Intervalo mínimo** entre tentativas: `intervalo_min_tentativas_min` (padrão 0 = desligado); abaixo dele → `INTERVALO_MINIMO` com `proxima_em`. (decisão 31/10, RN-TRE-02)
- **Nota que vale** (`notaQueVale`): `melhor` (padrão) ou `ultima` por `realizada_em` (decisão 31/10; padrão **melhor nota**). Exemplo: tentativas 60, 80, 70 → vale 80. **Aprovado uma vez, aprovado sempre** (`quizAprovado`): tentativa posterior pior não revoga (progresso só por inserção). **Refazer depois de aprovado** é permitido dentro do limite diário, **sem XP novo** (o XP de acerto é só da 1ª tentativa) e a melhor nota é a que vale (decisão 31/10).
- **Lição com quiz** só conclui com o quiz aprovado (`QUIZ_PENDENTE`).

## 3. XP — RN-TRE-01, RN-TRE-02, RN-TRE-04 (`xp.ts`)
| Evento | XP | Referência do lançamento (`referencia_id`) | Exemplo |
|---|---|---|---|
| Lição concluída | 10 | `licao_id` | 10 |
| Acerto no quiz | 5 por questão, **só na 1ª tentativa** do quiz, **mesmo reprovada** (decisão 31/10; RN-TRE-02) | `quiz_id` | 4 acertos na 1ª tentativa → 20; 2ª tentativa → 0 |
| Trilha concluída | 50 | `trilha_id` | pago junto com a última lição |
| Streak diário (lição concluída ou quiz respondido até o fim) | 2 × dias consecutivos, até 20 | data do dia (`AAAA-MM-DD`) | 1º dia 2, 3º dia 6, 10º dia em diante 20 |
| Desafio de vendas (pedido faturado) | ver §8 | `desafio_id:pedido_id:evento_id` (parcial) ou `desafio_id:pedido_id:total` | — |

- **Lançamentos são append-only**: nunca se edita nem apaga; o **saldo é a soma** (`saldoXp`). Correção futura = novo lançamento (hoje não há ajuste manual; pendência).
- **Idempotência em duas camadas** (`proporLancamento`): (1) mesmo `id` (UUID do aparelho) → `duplicado/ID`; (2) mesma **chave natural** (usuário + origem + referência) com outro `id` → `duplicado/EVENTO` (mesma lição concluída em dois aparelhos paga uma vez). Evento sem pontos (ex.: quiz fora da 1ª tentativa) não gera lançamento.
- **Teto diário** [200] (decisão 31/10) por usuário e dia do fuso do tenant, para **lição, quiz, trilha e streak**: o que passa é cortado e marcado (`limitado_pelo_teto`, `pontos` < `pontos_base`); com o teto esgotado grava-se lançamento de **0 ponto** (mantém idempotência e auditoria). Exemplo com teto 25: 20 + 10 → 20 e 5. **Desafio de vendas não consome nem sofre o teto diário** (tem teto próprio, §8). Teto 0 = sem teto.
- **Lote offline** (`processarLote`): processa por `ocorrido_em` (e id no empate), para o teto valer para o que aconteceu primeiro; reenviar o lote não muda o saldo (RN-TRE-04).
- **Concluir lição** (`concluirLicao`): valida (§6) e devolve lição [10] + trilha [50] se foi a última + streak do dia. **Tentativa de quiz** (`registrarTentativaQuiz`): confere limite, corrige, aprova e devolve acertos (1ª tentativa) + streak do dia **só se o quiz foi respondido até o fim** (§4).

## 4. Streak — RF-TRE-03, RN-TRE-05 (`streak.ts`)
- **Atividade que conta** (decisão 31/10, ajuste B; RN-TRE-05) = **lição concluída** ou **quiz respondido até o fim** (toda questão com ao menos uma alternativa marcada: `quizRespondidoAteOFim`). **Abrir e abandonar não conta**: lição aberta, quiz iniciado ou abandonado, e quiz enviado com questão em branco não mantêm nem pagam o streak. `atividadesQueContam(registros)` filtra os registros do aparelho pelo tipo (`licao_concluida`, `quiz_finalizado`; qualquer outro tipo não conta). Exemplo: lições concluídas em 29 e 30/10 e quiz abandonado em 31/10 → sequência de 2 dias "em risco" no dia 31 (não 3). A tentativa de quiz incompleta ainda conta para o limite de tentativas do dia (RN-TRE-02) e paga o XP de acerto da 1ª tentativa, mas não o streak. **Dia** = data civil no fuso do tenant (01/11 02:00Z é 31/10 em Manaus).
- `sequenciaNaData(dias, d)` = dias consecutivos terminando em `d` (0 se `d` não teve atividade). `sequenciaAtual(dias, hoje)`: termina hoje, ou ontem com `em_risco: true` (ainda dá para manter); parou há 2+ dias → 0. `maiorSequencia` alimenta a medalha.
- O XP de streak é pago **uma vez por dia**, na primeira atividade do dia, com os dias consecutivos até aquele dia.

## 5. Níveis — RF-TRE-03, RN-TRE-06 (`niveis.ts`)
- Nível n começa em `niveis_xp_min[n−1]` (padrão em §Parâmetros). `nivelDoXp(xp)` → nível, XP do início, XP do próximo, **XP faltante** e **% do nível**. Exemplo: 99 XP → nível 1 (faltam 1); 100 → nível 2; 175 → nível 2, faltam 75, 50% do nível; 3200+ → nível 10 (máximo, sem próximo, 100%).
- `subiuDeNivel(antes, depois)` indica a celebração discreta (pode pular níveis).

## 6. Validação do progresso no servidor — RN-TRE-04, RN-TRE-02, RF-TRE-01 (`progresso.ts`)
`validarConclusaoLicao` revalida o que o aparelho enviou, nesta ordem: lição existe na trilha (`LICAO_DESCONHECIDA`) → **já concluída = `duplicado`** (idempotente, aceito sem efeito) → trilha publicada (`TRILHA_NAO_PUBLICADA`) → pré-requisitos (`LICAO_BLOQUEADA`) → **tempo mínimo da lição** (`TEMPO_MINIMO`, ver abaixo) → quiz aprovado quando a lição tem quiz (`QUIZ_PENDENTE`). Mensagens em português com a ação seguinte (a de tempo diz quantos segundos são exigidos). Na sincronização o servidor aplica as conclusões na ordem de `concluida_em`, acumulando as lições aceitas.

**Tempo mínimo da lição** (decisão 31/10, ajuste D; RN-TRE-04) — `tempoMinimoDaLicao(duracao_estimada_seg, params)`:
`tempo_minimo = max(segundos_minimos_licao, ceil(pct_minimo_duracao_licao% × duracao_estimada_seg))`, em segundos inteiros; sem duração informada (`duracao_estimada_seg` ausente, nula ou ≤ 0) vale só o piso. Padrões: 30 s e 50%. Exemplos: lição sem duração → 30 s (29 s não conta, 30 s conta); lição de 10 min (600 s) → 300 s (299 s não conta); lição de 40 s → 20 s < piso → 30 s; 61 s → 30,5 → 31 s. O cálculo usa inteiros para evitar erro de ponto flutuante (70% de 100 s = 70 s). `pct = 0` desliga a parte proporcional; `pct = 100` exige a duração inteira. `LicaoDef.duracao_estimada_seg` é opcional.

## 7. Medalhas — RF-TRE-03, RN-TRE-06 (`medalhas.ts`)
- Regras: `trilhas_concluidas` (≥ N), `nota_maxima` (nota = 100 em algum quiz; 99,99 não vale), `sequencia_dias` (maior sequência ≥ N). Catálogo padrão (decisão 31/10): **primeira trilha concluída**, **nota máxima no quiz**, **sequência de 7 dias** (`sequencia_7_dias`; o código acompanha o N em `medalhasPadrao(n)`).
- `avaliarMedalhas(catálogo, estado, jáConquistadas)` devolve só as **novas** — nunca em duplicidade (`medalha_usuario` único por usuário + medalha). Quem grava gera o UUID da conquista e publica `treinamento.medalha.conquistada@1`.

## 8. Desafio de vendas — RF-TRE-06 (P1), RN-TRE-08 (`desafio.ts`)
- **Paga no FATURAMENTO** (ajuste C; RN-TRE-08): o XP sai quando o pedido é **faturado** (status vindo do ERP pelo Hub), **não** quando é criado. Pedido apenas criado, sem `faturado_em`, não gera XP (`PEDIDO_NAO_FATURADO`).
- **Entrada** (contrato oficial: `docs/desenho/T-0011.md` §2 e `.coord/contratos/eventos.md`): o Treinamento consome **somente `vendedor.pedido.faturado@1`** (opcional; não consome `vendedor.pedido.criado@1`). O Vendedor publica **um evento por retorno aceito do ERP**; `itens` = **o que foi faturado neste retorno** (o consumidor soma; o total depois de parciais traz só o saldo). Leitura tolerante por `PedidoFaturadoLido` (contracts): `pedido_id`, `vendedor_id`, `faturado_em`, `itens[{produto_id, quantidade}]` e `parcial` (boolean, **padrão false** se ausente); campos a mais são ignorados e o Treinamento não importa nada do Vendedor nem da Integração. Payload sem `faturado_em` ou sem os ids é recusado; `itens` ausente vira lista vazia. O `evento_id` **vem do envelope** (não do payload) e entra no domínio como `PedidoFaturadoLido.evento_id`.
- **XP do pedido** = unidades dos itens da campanha × `xp_por_unidade`, inteiro (para baixo), limitado a `xp_max_por_pedido` (o máximo vale para o **pedido todo**, somando os eventos: o que os eventos anteriores do pedido já pagaram é descontado e o evento que o atinge paga só o saldo). Exemplo: 3 un. × 2 = 6; 50 un. × 2 = 100 → 20. Quantidade ≤ 0 é ignorada.
- **Vários retornos e idempotência** (RN-TRE-08 "idempotente por pedido"; desenho T-0011 §2): cada evento paga as quantidades da campanha que **traz**; o desafio **não** guarda "item já pago" por produto.
  - **Chave natural** (`referencia_id`): parcial (`parcial: true`) → `desafio_id:pedido_id:evento_id`; total (`parcial` false/ausente) → `desafio_id:pedido_id:total`. A função é `candidatoDoDesafio(desafio, pedido, lancamentoId, opcoes)` (um candidato por evento, ou `null`).
  - **O mesmo retorno entregue duas vezes** (mesmo `evento_id`) **não paga duas vezes**: barrado pelos lançamentos já gravados e, sem histórico, pela chave natural de `proporLancamento`.
  - **Duas parciais do mesmo produto** pagam as duas quantidades. **Parcial + total** paga a soma (o total traz só o saldo). Exemplo (2 XP/un.): parcial de 2 un. = 4; total de 5 un. = 10; total do desafio = 14.
  - **Segundo total do mesmo pedido** não paga, nem com outro `evento_id` (defesa: a chave `...:total` é uma só por pedido).
  - **Parcial sem itens** (vazio ou ausente) é **ignorada**: sem XP e sem lançamento (`PARCIAL_SEM_ITENS`; defesa, o publicador não publica). **Pedido sem `faturado_em`** não gera XP (`PEDIDO_NAO_FATURADO`).
  - O histórico é do **vendedor e do desafio** (outro vendedor ou outro desafio pagam o mesmo evento). A API processa os eventos de um pedido na ordem de entrega (a outbox é ordenada por pedido) e passa os lançamentos já gravados em `opcoes.lancamentos`.
  - **Sem estorno**: cancelamento depois do faturamento não retira XP (append-only).
- **Teto por desafio** (ajuste A; RN-TRE-01, RF-TRE-06): `xp_max_por_desafio` = máximo de XP **por vendedor em cada desafio** (soma dos lançamentos do vendedor com referência `desafio_id:*`, de eventos totais e parciais), **fora do teto diário**. Padrão do tenant **500**; o cadastro do desafio pode trazer o seu (prioridade); 0 = sem teto. O evento que cruza o teto paga **só o saldo**; esgotado, grava-se lançamento de **0 ponto** (`limitado_pelo_teto`, idempotência e auditoria). Exemplo com teto 30 e pedidos de 20 XP: 20, depois 10 (de 20), depois 0. Vale também dentro de um mesmo lote. Outro vendedor ou outro desafio têm o seu teto.
- **Fora do teto diário**: o desafio continua sem consumir nem sofrer o `xp_teto_diario` de 200 (RN-TRE-01).
- **Vigência**: dia do **faturamento** no fuso do tenant entre `vigencia_inicio` e `vigencia_fim`, **inclusivo** (26/10 00:00 Manaus = 04:00Z entra; 03:59Z não). Desafio inativo ou de outro tenant não pontua. O lançamento fica no dia do faturamento (conta no ranking desse dia).
- O XP vai ao `vendedor_id` do pedido (em pedido "em nome", o vendedor, não o gestor). `candidatoDoDesafio` serve a total e parcial; a API passa os lançamentos do vendedor no desafio em `opcoes.lancamentos`.

## 9. Ranking — RF-TRE-04, RN-TRE-03 (`ranking.ts`)
- **Períodos** (`intervaloDoPeriodo`): semanal = segunda a domingo da semana da data (31/10/2026, sábado → 26/10 a 01/11); mensal = mês civil; acumulado = sem limites. Conta o `dia` do lançamento (fuso do tenant).
- **Escopo**: `geral`, `equipe` ou `regional`. **Participam** só usuários **ativos**, do tenant e com perfil em `perfis_ranking`. Dado de outro tenant é ignorado (RN-TRE-03: visível só dentro do tenant).
- **Ordem (total, sem posições empatadas)**: 1) mais XP no período; 2) **quem atingiu primeiro** esse XP (`atingiu_em` = instante do último lançamento com pontos no período; sem XP fica por último) — é o desempate da RN-TRE-03; 3) mais trilhas concluídas no período; 4) nome (pt-BR, sem diferenciar maiúsculas/acentos); 5) id. Exemplo: Ana 40 XP em 10/10 + 10 em 15/10 e Bruno 50 XP em 12/10 → ambos 50, Bruno à frente (chegou antes). Quem não tem XP no período aparece no fim com 0.
- `posicaoDoUsuario` devolve a linha do usuário (o vendedor vê a própria posição e a dos colegas).

## 10. Adesão e conclusão — RF-TRE-05 (`adesao.ts`)
- **Adesão do mês** = pessoas do público com ao menos uma lição concluída no mês civil (fuso do tenant) ÷ pessoas do público × 100. Quem não é do público é ignorado; ids repetidos contam uma vez; **público vazio → `adesao_pct: null`**. Exemplo: 1 de 4 → 25%.
- **Público da trilha** (`publicoDaTrilha`) = usuários ativos no público-alvo; **conclusão da trilha** = % do público que a concluiu (null se vazio).

## 11. Eventos e contratos
- Publica `treinamento.licao.concluida@1` (`LicaoConcluidaV1`: progresso, usuário, trilha, lição, nota do quiz, `xp_ganho`, `trilha_concluida`) e `treinamento.medalha.conquistada@1` (`MedalhaConquistadaV1`). O doc 02 não lista outros eventos; trilha concluída e nível viajam dentro de `licao.concluida`.
- Consome (opcional) **somente `vendedor.pedido.faturado@1`** pela leitura tolerante `PedidoFaturadoLido` (contrato, soma dos itens e idempotência por `evento_id` em §8). Não consome `vendedor.pedido.criado@1`.

## Mapa das regras por RN-TRE
- **RN-TRE-01** (XP): valores de XP e teto diário de 200 (§3).
- **RN-TRE-02** (quiz): nota mínima, tentativas, intervalo, nota que vale, XP só na 1ª tentativa mesmo reprovada, refazer sem XP novo (§2).
- **RN-TRE-03** (ranking): período, semana de segunda a domingo, escopo, desempate XP → quem atingiu primeiro → trilhas → nome → id, visível só no tenant (§9).
- **RN-TRE-04** (offline/servidor): validação do progresso e tempo mínimo da lição = maior entre 30 s e 50% da duração — ajuste D (§6), idempotência de lançamentos e lote (§3).
- **RN-TRE-05** (streak): lição concluída ou quiz respondido até o fim; paga uma vez por dia — ajuste B (§4).
- **RN-TRE-06** (níveis e medalhas): faixas e medalhas padrão (§5, §7).
- **RN-TRE-07** (público-alvo): perfis, equipes, interseção (§1).
- **RN-TRE-08** (desafio de vendas): paga no faturamento — ajuste C, teto por desafio fora do teto diário — ajuste A, itens somados e idempotência por `evento_id`, sem estorno (§8).
- **RF-TRE-01 a 05**: trilha, níveis, medalhas, adesão (§1, §5, §7, §10).

## Fora desta fase
- Estorno de XP do desafio (pedido cancelado após faturado): não há.
- Ajuste manual de XP pelo BKO (lançamento corretivo): não existe ainda.
- Tabelas `desafio_vendas` e `publico_alvo`, o histórico de eventos pagos por pedido (já derivável de `xp_lancamento.referencia_id`; a referência do desafio tem até 110 caracteres: a coluna precisa de pelo menos 128) e os campos novos (`xp_max_por_desafio` no desafio; `duracao_estimada_seg` na lição): a pedir ao banco-dados quando a API for escrita.
