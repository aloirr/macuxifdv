# Treinamento — regras de cálculo (domain)

Implementação: `modules/treinamento/domain/` (funções puras, sem I/O; rodam no app offline, na web e na API). Cada arquivo tem um `*.test.ts` com os casos abaixo (`it('RN-TRE-xx: ...')`). Contratos Zod: `modules/treinamento/contracts/` (reaproveitam estas funções nos refinamentos; a API sempre revalida). Tarefa: T-0011 (domínio, sem banco e sem telas).

Convenções: nota e percentuais com 2 casas (meio para cima); XP sempre inteiro; instantes em UTC (ISO com `Z`), **"dia" = data civil no fuso do tenant** (`America/Manaus` por padrão, via `localDate` de `@macuxi/comum`, ADR 0002); ids UUID gerados no aparelho; "sem dados" devolve `null`, nunca divide por zero. Regra sem texto nos docs 02/03 está marcada **premissa T-0011** (a decidir pelo Alexandre; lista no fim).

## Parâmetros do tenant (`parametros.ts`, `resolverParametros(parcial)`)
| Parâmetro | Padrão | Onde entra | Origem |
|---|---|---|---|
| `nota_minima_pct` | 70 | `aprovado`, `registrarTentativaQuiz` | RN-TRE-02 |
| `tentativas_max_dia` | 3 | `validarTentativa` | RN-TRE-02 |
| `intervalo_min_tentativas_min` | 0 (sem intervalo) | `validarTentativa` | premissa T-0011 |
| `nota_que_vale` | `melhor` (ou `ultima`) | `notaQueVale` | premissa T-0011 |
| `tempo_min_licao_seg` | 30 | `validarConclusaoLicao` | RN-TRE-04 |
| `xp_licao` | 10 | `xpDaLicao` | RN-TRE-01 |
| `xp_acerto_questao` | 5 | `xpDoQuiz` | RN-TRE-01 |
| `xp_trilha` | 50 | `xpDaTrilha` | RN-TRE-01 |
| `xp_streak_por_dia` / `xp_streak_teto` | 2 / 20 | `xpDoStreak` | RN-TRE-01 |
| `xp_teto_diario` | 200 (0 = sem teto) | `proporLancamento` | premissa T-0011 |
| `niveis_xp_min` | 0, 100, 250, 450, 700, 1000, 1400, 1900, 2500, 3200 (10 níveis) | `nivelDoXp` | premissa T-0011 |
| `streak_medalha_dias` | 7 | `medalhasPadrao` | premissa T-0011 |
| `perfis_ranking` | vendedor, promotor | `calcularRanking` | premissa T-0011 |
| `fuso` | `America/Manaus` | tudo que usa "dia" | doc 03, tabela de parâmetros |

`resolverParametros` recusa valores inválidos (nota fora de 0–100, tentativas < 1, XP negativo/fracionado, faixas que não começam em 0 ou não crescem, fuso inexistente). O desempate do ranking e a ordem dos critérios **não** são parâmetros (fixos, abaixo).

## 1. Trilha, módulos, lições e pré-requisitos — RF-TRE-01, RF-TRE-02 (`trilha.ts`)
- **Progresso** = lições concluídas ÷ total de lições × 100 (só contam lições da trilha). Trilha concluída = todas concluídas; trilha sem lições nunca é concluída (0%). Exemplo: 1 de 3 → 33,33%; por módulo também (`modulos[]`).
- **Pré-requisitos** (lição bloqueada até concluir os exigidos): trilha `sequencial` (padrão) exige a **lição anterior do módulo** e **todas as lições do módulo anterior**; além disso, `pre_requisitos` explícitos de lição (ids de lição) e de módulo (ids de módulo). Módulo bloqueado = algum módulo exigido ainda incompleto. `statusDaLicao` → `concluida | liberada | bloqueada` (+ `pendentes`); `statusDoModulo` → `concluido | liberado | bloqueado`.
- **Retomar de onde parou** (`proximaLicao`): primeira lição, na ordem módulo → lição, que está liberada e não concluída; `null` se a trilha acabou.
- **Validação para publicar** (`validarTrilha`): ids repetidos, pré-requisito inexistente e ciclo (a lição nunca liberaria).
- **Público-alvo** (`usuarioNoPublico`): `perfis` e `equipes`; critério vazio = sem restrição; os dois preenchidos valem juntos (E); os dois vazios = todo o tenant. Usuário sem equipe não entra em trilha restrita por equipe. Só trilha **publicada** é visível (`trilhasDisponiveis`).
- **Obrigatórias pendentes** (`trilhasPendentes`): publicada + `obrigatoria` + usuário no público + não concluída. Ordem: prazo crescente (sem prazo por último), depois id. `atrasada` = hoje > prazo; `dias_para_prazo` = prazo − hoje (negativo = vencido). Exemplo: hoje 31/10; prazo 30/10 → atrasada (−1); prazo 31/10 → não atrasada (0).

## 2. Quiz: nota, aprovação, tentativas — RN-TRE-02 (`quiz.ts`)
- **Correção** (`corrigirQuiz`): a questão acerta só se o conjunto de alternativas marcadas é exatamente o das corretas (múltipla escolha exige todas); em branco = erro. Resposta a questão de outro quiz ou repetida = erro (a API devolve 422).
- **Nota (0–100)** = acertos ÷ questões × 100, **2 casas, meio para cima**. Exemplo: 2/3 → 66,67; 7/10 → 70.
- **Aprovação**: nota ≥ [70%], limite inclusivo. A comparação é **exata** (`acertos × 100 ≥ mínimo × total`): arredondar para exibir nunca aprova quem ficou abaixo (69,996% aparece como 70 e continua reprovado).
- **Tentativas**: até [3] por dia, o dia no fuso do tenant. 4ª tentativa → recusada (`LIMITE_DIARIO`) com `proxima_em` = início do dia seguinte no fuso. Exemplo: 3 tentativas às 22:00 Manaus de 31/10 → liberada a partir de 01/11 04:00Z. A validação offline considera só as tentativas **anteriores** à nova (por `realizada_em`).
- **Intervalo mínimo** entre tentativas: `intervalo_min_tentativas_min` (padrão 0 = desligado); abaixo dele → `INTERVALO_MINIMO` com `proxima_em`. (premissa T-0011)
- **Nota que vale** (`notaQueVale`): `melhor` (padrão) ou `ultima` por `realizada_em`. (premissa T-0011) **Aprovado uma vez, aprovado sempre** (`quizAprovado`): tentativa posterior pior não revoga (progresso só por inserção). Refazer depois de aprovado é permitido dentro do limite diário, sem XP novo.
- **Lição com quiz** só conclui com o quiz aprovado (`QUIZ_PENDENTE`).

## 3. XP — RN-TRE-01, RN-TRE-02, RN-TRE-04 (`xp.ts`)
| Evento | XP | Referência do lançamento (`referencia_id`) | Exemplo |
|---|---|---|---|
| Lição concluída | 10 | `licao_id` | 10 |
| Acerto no quiz | 5 por questão, **só na 1ª tentativa** do quiz (aprovada ou não) | `quiz_id` | 4 acertos na 1ª tentativa → 20; 2ª tentativa → 0 |
| Trilha concluída | 50 | `trilha_id` | pago junto com a última lição |
| Streak diário | 2 × dias consecutivos, até 20 | data do dia (`AAAA-MM-DD`) | 1º dia 2, 3º dia 6, 10º dia em diante 20 |
| Desafio de vendas | ver §8 | `desafio_id:pedido_id` | — |

- **Lançamentos são append-only**: nunca se edita nem apaga; o **saldo é a soma** (`saldoXp`). Correção futura = novo lançamento (hoje não há ajuste manual; pendência).
- **Idempotência em duas camadas** (`proporLancamento`): (1) mesmo `id` (UUID do aparelho) → `duplicado/ID`; (2) mesma **chave natural** (usuário + origem + referência) com outro `id` → `duplicado/EVENTO` (mesma lição concluída em dois aparelhos paga uma vez). Evento sem pontos (ex.: quiz fora da 1ª tentativa) não gera lançamento.
- **Teto diário** [200] por usuário e dia do fuso do tenant: o que passa é cortado e marcado (`limitado_pelo_teto`, `pontos` < `pontos_base`); com o teto esgotado grava-se lançamento de **0 ponto** (mantém idempotência e auditoria). Exemplo com teto 25: 20 + 10 → 20 e 5. **Desafio de vendas não consome nem sofre o teto.** Teto 0 = sem teto. (premissa T-0011)
- **Lote offline** (`processarLote`): processa por `ocorrido_em` (e id no empate), para o teto valer para o que aconteceu primeiro; reenviar o lote não muda o saldo (RN-TRE-04).
- **Concluir lição** (`concluirLicao`): valida (§6) e devolve lição [10] + trilha [50] se foi a última + streak do dia. **Tentativa de quiz** (`registrarTentativaQuiz`): confere limite, corrige, aprova e devolve acertos (1ª tentativa) + streak do dia.

## 4. Streak — RF-TRE-03, RN-TRE-01 (`streak.ts`)
- **Atividade** = lição concluída ou tentativa de quiz. **Dia** = data civil no fuso do tenant (01/11 02:00Z é 31/10 em Manaus).
- `sequenciaNaData(dias, d)` = dias consecutivos terminando em `d` (0 se `d` não teve atividade). `sequenciaAtual(dias, hoje)`: termina hoje, ou ontem com `em_risco: true` (ainda dá para manter); parou há 2+ dias → 0. `maiorSequencia` alimenta a medalha.
- O XP de streak é pago **uma vez por dia**, na primeira atividade do dia, com os dias consecutivos até aquele dia.

## 5. Níveis — RF-TRE-03 (`niveis.ts`)
- Nível n começa em `niveis_xp_min[n−1]` (padrão em §Parâmetros). `nivelDoXp(xp)` → nível, XP do início, XP do próximo, **XP faltante** e **% do nível**. Exemplo: 99 XP → nível 1 (faltam 1); 100 → nível 2; 175 → nível 2, faltam 75, 50% do nível; 3200+ → nível 10 (máximo, sem próximo, 100%).
- `subiuDeNivel(antes, depois)` indica a celebração discreta (pode pular níveis).

## 6. Validação do progresso no servidor — RN-TRE-04, RN-TRE-02, RF-TRE-01 (`progresso.ts`)
`validarConclusaoLicao` revalida o que o aparelho enviou, nesta ordem: lição existe na trilha (`LICAO_DESCONHECIDA`) → **já concluída = `duplicado`** (idempotente, aceito sem efeito) → trilha publicada (`TRILHA_NAO_PUBLICADA`) → pré-requisitos (`LICAO_BLOQUEADA`) → **tempo na lição ≥ [30 s]** (`TEMPO_MINIMO`; 29 s não conta, 30 s conta) → quiz aprovado quando a lição tem quiz (`QUIZ_PENDENTE`). Mensagens em português com a ação seguinte. Na sincronização o servidor aplica as conclusões na ordem de `concluida_em`, acumulando as lições aceitas.

## 7. Medalhas — RF-TRE-03 (`medalhas.ts`)
- Regras: `trilhas_concluidas` (≥ N), `nota_maxima` (nota = 100 em algum quiz; 99,99 não vale), `sequencia_dias` (maior sequência ≥ N). Catálogo padrão (premissa T-0011): **primeira trilha concluída**, **nota máxima no quiz**, **sequência de 7 dias** (`sequencia_7_dias`; o código acompanha o N em `medalhasPadrao(n)`).
- `avaliarMedalhas(catálogo, estado, jáConquistadas)` devolve só as **novas** — nunca em duplicidade (`medalha_usuario` único por usuário + medalha). Quem grava gera o UUID da conquista e publica `treinamento.medalha.conquistada@1`.

## 8. Desafio de vendas — RF-TRE-06 (P1) (`desafio.ts`)
- Entrada só pelo **evento** `vendedor.pedido.criado@1`, lido de forma tolerante por `PedidoCriadoLido` (contracts): `pedido_id`, `vendedor_id`, `criado_em`, `itens[{produto_id, quantidade}]`; campos a mais do Vendedor são ignorados e o Treinamento não importa nada do Vendedor.
- **XP do pedido** = unidades dos itens da campanha × `xp_por_unidade`, inteiro (para baixo), limitado a `xp_max_por_pedido`. Exemplo: 3 un. × 2 = 6; 50 un. × 2 = 100 → 20 (teto do desafio). Quantidade ≤ 0 é ignorada.
- **Vigência**: dia do pedido no fuso do tenant entre `vigencia_inicio` e `vigencia_fim`, **inclusivo** (26/10 00:00 Manaus = 04:00Z entra; 03:59Z não). Desafio inativo ou de outro tenant não pontua.
- **Idempotente por pedido**: referência `desafio_id:pedido_id`; evento repetido não pontua de novo; dois desafios diferentes podem pontuar o mesmo pedido. O XP vai ao `vendedor_id` do pedido (em pedido "em nome", o vendedor, não o gestor). Pedido cancelado depois **não estorna** (append-only; pendência).

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
- Consome (opcional) `vendedor.pedido.criado@1` pela leitura tolerante `PedidoCriadoLido`.

## Premissas T-0011 (para o Alexandre decidir)
1. **Teto diário de XP** [200], aplicado a lição, quiz, trilha e streak; desafio de vendas fica fora do teto.
2. **Quiz paga XP de acerto na 1ª tentativa mesmo se reprovada** (RN-TRE-02 diz "só na 1ª tentativa", sem exigir aprovação).
3. **Streak** = lição concluída ou tentativa de quiz; paga na 1ª atividade do dia, `min(2 × dias, 20)`.
4. **Refazer quiz após aprovado** é permitido (dentro do limite diário, sem XP); aprovado uma vez continua aprovado. Nota que vale padrão = **melhor**.
5. **Intervalo entre tentativas** desligado (0) por padrão; o doc não define.
6. **Desempate**: segue a RN-TRE-03 (quem atingiu primeiro vem antes de trilhas concluídas), depois trilhas, nome e id.
7. **Faixas de nível** padrão (10 níveis, até 3.200 XP) e **medalhas padrão** (primeira trilha, nota máxima, 7 dias).
8. **Público-alvo**: perfis e equipes valem juntos (E); ambos vazios = todo o tenant. **Ranking** só com vendedor e promotor (parâmetro).
9. **Semana do ranking** = segunda a domingo; **dia** do ranking e do teto = fuso do tenant.
10. **Desafio de vendas**: `xp_por_unidade` com teto `xp_max_por_pedido`; payload do pedido lido por nomes `pedido_id/vendedor_id/criado_em/itens[produto_id, quantidade]` (a confirmar com o Vendedor).
