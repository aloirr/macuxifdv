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
- **Premissa a confirmar**: o texto "contada à parte" pode ser lido também como "fora do %"; `resumirRuptura(itens, { incluirFalhaDeReposicao: false })` entrega esse outro cálculo. Padrão = incluir.
- **Quantidade reposta**: inteiro ≥ 0, soma por visita; em ruptura total é sempre 0.
- Exemplo: mix de 10 itens (7 presentes, 1 ruptura na gôndola, 2 ruptura total) → ruptura 30%; falha de reposição 10%; ruptura total 20%.

## 4. Conformidade da gôndola — RF-PRO-03 (`gondola.ts`)
- Valores: `conforme | parcial | nao_conforme`. **Motivo obrigatório quando `nao_conforme`** (vazio/espaços não valem); em `parcial` é opcional. Fotos antes e depois são exigidas no contrato.
- **% conformidade** = (conformes + parciais × peso) ÷ gôndolas registradas × 100; peso do parcial = 0 por padrão (configurável). Ex.: conforme, conforme, parcial, não conforme → 50%; com peso 0,5 → 62,5%.

## 5. Validade próxima e avarias — RF-PRO-07, RN-PRO-08 (`validade.ts`)
- **Dias até vencer** = validade − hoje (dias civis; negativo = vencido). "Hoje" = data civil no fuso do tenant (`dataLocal(instante, fuso)`; 01/11 02:00Z é 31/10 em Manaus).
- **Validade próxima** = dias ≤ 30 (inclui o já vencido).
- **Faixa de risco** (limites definidos pelo Promotor sobre a RN-PRO-08, configuráveis): `vencido` (< 0) · `crítico` (0 a 7) · `atenção` (8 a 30) · `ok` (> 30).
- Resumo (`resumirValidade`): itens e unidades por faixa e total de validade próxima. Ex.: hoje 31/10; vencimentos 25/10 (3 un.), 03/11 (10 un.), 20/11 (5 un.), 01/03/2027 (100 un.) → vencido 3, crítico 10, atenção 5, ok 100; validade próxima = 3 itens / 18 unidades.
- **Avaria**: quantidade inteira ≥ 1, motivo e foto obrigatórios; resumo por motivo (`resumirAvarias`).

## 6. Pontos extras — RF-PRO-08 (`pontos-extras.ts`)
- Conferência de cada ponto negociado: `cumprido` = existe + no lugar combinado + abastecido; `parcial` = existe mas falta algo; `nao_cumprido` = não existe (marcar "no lugar"/"abastecido" sem existir é inconsistente). Ponto que existe exige foto (contrato).
- **% cumprimento** = negociados cumpridos ÷ negociados × 100; pontos encontrados **sem** negociação contam à parte (`encontrados_nao_negociados`). Ex.: 4 negociados (2 cumpridos, 1 parcial, 1 ausente) → 50%.

## 7. Permanência e coleta com check-in aberto — RN-PRO-07, RN-PRO-02 (`permanencia.ts`)
- **Permanência (min)** = (checkout − check-in) em minutos, instantes UTC. Checkout anterior ao check-in é erro.
- **Revalidação (contrato `VisitaLoja`)**: o `permanencia_min` que vem do aparelho não é confiável. O contrato recalcula com `permanenciaMinutos(checkin_em, checkout_em)` e **recusa** a visita se o valor divergir mais que `PERMANENCIA_TOLERANCIA_MIN` (0,5 min, arredondamento) ou vier nulo com checkout. Ex.: 40 min reais com 600 informado é recusado. A API grava o valor recalculado.
- **Conta nos indicadores** quando ≥ 10 min; **visita curta** (< 10 min, encerrada) é sinalizada ao gestor; visita aberta não conta nem é "curta". Ex.: 9,99 min não conta; 10 conta.
- `coletaPermitida(visita)`: só com check-in feito e sem checkout (RN-PRO-02). A origem da foto (câmera, data/hora, coordenada) é validada em `FotoColeta`.

## 8. Checklist do dia e checkout — RF-PRO-02, RN-PRO-06 (`checklist.ts`)
- `progressoChecklist`: concluídas × pendentes, obrigatórias pendentes e % concluído (checklist vazio = 100%).
- `avaliarCheckout`: **bloqueia** se faltam etapas obrigatórias (mensagem lista as etapas e diz "Conclua-as para fazer o checkout"). **Exceção**: desfecho `loja_fechada` ou `acesso_negado` libera o checkout sem checklist, mas **exige a foto da fachada** (sem ela, bloqueia pedindo a foto). Ex.: obrigatória "Medir o share de massas" pendente → bloqueado; loja fechada com fachada → liberado.

## 9. Vigência — RN-PRO-10 (`vigencia.ts`)
- `vigenteEm(v, data)`: início ≤ data ≤ fim (inclusivos; fim `null` = sem prazo). `versaoVigente(versoes, data)`: a de início mais recente entre as vigentes. A coleta grava o id da versão vigente no momento (checklist, mix, meta, foto de referência) — campos `*_id` em `contracts/coletas.ts`.

## 10. Tarefas pontuais — RF-PRO-10 (`tarefa.ts`)
- Situação: `pendente` | `atrasada` (hoje > prazo, sem conclusão) | `concluida` | `concluida_com_atraso`; sem prazo nunca atrasa. Conclusão exige ≥ 1 foto de comprovação.

## 11. Indicador do dia — RF-PRO-12 (`indicador.ts`)
`consolidarIndicadorDia(entrada, parametros?)` devolve o que alimenta `indicador_promotor_dia`:
- **Lojas visitadas** = lojas distintas com visita que **conta** (RN-PRO-07). **Cobertura** = visitadas ÷ planejadas × 100.
- **Tempo médio** = média da permanência das visitas que contam (1 casa). Visitas curtas e abertas são contadas à parte.
- **Coletas de visitas que não contam ficam fora** de conformidade, share, ruptura e preço.
- **% conformidade** (§4), **share médio × meta média e atingimento** (§1), **% ruptura** agregada (soma de itens em ruptura ÷ soma de itens do mix de todas as visitas válidas — não a média dos % por loja) e **falha de reposição** (§3), **índice de preço médio** = média simples dos índices (§2).
- Exemplo: 5 planejadas; visitas de 40, 20, 6 min e uma aberta → visitadas 2 (40%), tempo médio 30 min, 1 visita curta, 1 aberta; só as duas primeiras entram nos demais indicadores.

## 12. RN-PRO-01 — sem pedido
Teste `domain/rn-pro-01.test.ts`: nenhum export do `domain` tem nome ligado a pedido; nenhuma chave de `manifest.acoes` é ação de pedido (`ehAcaoDePedido` do platform-sdk); e, com um manifesto sintético do Vendedor declarando `pedido.*`, `pode(...)` é `true` para o vendedor e `false` para o promotor. O JSON do manifesto não contém a palavra "pedido" (`manifest.test.ts`).

## Permissões por ação (manifesto, doc 03 §2)
- **Coletas** (`coleta.registrar`, `checklist_loja.responder`, `gondola.registrar`, `share.registrar`, `preco.registrar`, `ruptura.registrar`, `validade.registrar`, `ponto_extra.registrar`, `concorrencia.registrar`, `tarefa_trade.concluir`): **só o promotor**. Supervisor, gerente e analista apenas leem (estão em `perfis`, sem ação de escrita).
- **Cadastros de trade** (`mix_obrigatorio`, `meta_share`, `categoria_gondola`, `concorrente`, `foto_referencia`, `checklist_modelo`, `ponto_extra_negociado`, `tarefa_trade` `.gerenciar`): **analista e admin**. `admin` foi incluído em `manifest.perfis` para o módulo ficar efetivo para ele (RN-CORE-01).

## Premissas e pendências
- Produto nosso referenciado por `produto_id` (UUID do cadastro base do Core, ADR-0005); quando a T-0007 publicar `Produto` em `@macuxi/core/contracts`, o Promotor passa a importar o contrato.
- Faixas de risco da validade (crítico ≤ 7 dias) e peso do parcial na conformidade (0) são definições do Promotor, não do doc 03 — confirmar com o negócio.
- Interpretação de "contada à parte" da ruptura (§3) a confirmar.
- Contratos dos payloads de evento `promotor.*@1` ainda não foram escritos (só os nomes); serão criados com o primeiro consumidor.
- **Pergunta de produto (aberta)**: GPS obrigatório na foto (`FotoColeta.latitude/longitude`). Dentro da loja o GPS pode faltar; decidir com o Alexandre se aceita coordenada nula com flag `sem_gps`.
- `contracts` não reexporta mais os primitivos de `base.ts` (`Uuid`, `InstanteUtc`…); só os schemas de negócio.
