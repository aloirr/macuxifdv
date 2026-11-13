# T-0170 — Performance (Resultados e Produtividade): roteiro de valor × regra

- **Autor:** testes · **Data:** 2026-11-13 · **Tarefa:** T-0170 (frente de testes, nuvem)
- **Desenho:** `docs/desenho/performance-produtividade.md` (§1, §2, §3, §6 e §10).
- **Regras citadas:** RN-CORE-41 a RN-CORE-46 são as **propostas** da §8 do desenho (numeração a confirmar pelo gerente; ainda
  não estão no doc 03). Também RN-CORE-04, 10, 11, 14, 20, 21, 22, 26, 27 e RN-PRO-01.
- **Decisões D1–D7:** o Alexandre aprovou "tudo" em R-20261112-210236 (T-0170 inteira na v1.0.5). O recado confirma uma a
  uma só a D3 do Início (feriados nacionais no DU e na Meta/dia), que é a D4 daqui. As D1–D7 da Performance não aparecem
  uma a uma; o roteiro segue a **recomendação** de cada uma, como manda o desenho: D1 hoje conta nos dois (decorridos e restantes), D2 item = produto diferente, D3 visitas com extras, D4 feriados
  nacionais sempre, D5 padrão do FDV, D6 nome pelo tipo da meta, D7 meta proporcional. Se uma decisão mudar, a tabela
  afetada está indicada em cada caso.
- **Situação desta entrega:** só o roteiro. As funções da N-A (`calendarioDoPeriodo`, `resultadosDoPeriodo`,
  `produtividadeDoPeriodo`, `almocoDoDia`, `metaProdutividadeVigente`, `validarMetaProdutividade`) ainda não estão no
  `main` (conferido em 13/11, `origin/main` = `c98e3d7`). Os testes automáticos (§9) entram quando a N-A chegar.
- **Conferência:** todas as contas foram feitas à mão e conferidas por um script descartável fora do repositório (mesmas
  fórmulas, mesmos dados). Nenhum número abaixo veio de código do produto.

## 1. Cenário base

| Item | Valor |
|---|---|
| Tenant | T1, fuso `America/Manaus` (UTC−4, sem horário de verão). **Instante UTC = hora local + 4 h** |
| Semana útil | `metas.dias_uteis_semana` = segunda a sexta. `metas.feriados` vazio (só os nacionais, D4) |
| Usuário | V1, perfil vendedor, equipe **Boa Vista**, filha de **Norte** (raiz). Vendedor ligado. Meta do tipo **pedido** (card "Vendas", D6) |
| Hoje | **sexta 13/11/2026, 11:00** local (15:00Z) |
| Período padrão | Este mês: `de` = 01/11, `ate` = 30/11 |
| Metas do mês (`core.meta`) | `venda_cents` 18.000.000 (R$ 180.000,00) · `positivacao` 70 · `visitas` 200 · `itens_por_pedido` 800 (8,00) |
| Metas de produtividade | nenhuma linha em `core.meta_produtividade`: vale o padrão do FDV (§6.3, origem `padrao_fdv`), salvo no §7 |
| Parâmetros do almoço | corte 12:00 · janela 11:00 a 15:00 (§3.2) |

### 1.1 Calendário de novembro de 2026 (RN-CORE-41, D1, D4)
01/11 é domingo. Feriados nacionais no mês: 02/11 (segunda, Finados), 15/11 (domingo, não muda nada) e 20/11 (sexta,
Consciência Negra).

| Semana | Dias úteis | DU acumulado |
|---|---|---|
| 02–06/11 | 03, 04, 05, 06 (02 é feriado) | 1 a 4 |
| 09–13/11 | 09, 10, 11, 12, 13 | 5 a 9 |
| 16–20/11 | 16, 17, 18, 19 (20 é feriado) | 10 a 13 |
| 23–27/11 | 23, 24, 25, 26, 27 | 14 a 18 |
| 30/11 | 30 | 19 |

### 1.2 Dias do mês sintético (até hoje)
Horas locais. **P** = cliente com parada planejada no dia (rota ativa); **E** = visita extra. Toda visita tem `deleted_at`
nulo, `sem_gps = false` e `fechada_por = 'usuario'`, salvo indicação. `d` = `distancia_m`.

**Dia A** (modelo usado em **03/11, 04/11 e 12/11**, com clientes diferentes em cada dia): 8 visitas, 7 paradas planejadas,
todas visitadas.

| # | Rota | Check-in | Check-out | Resultado | d (m) | Duração | Intervalo antes |
|---|---|---|---|---|---|---|---|
| 1 | P | 07:50 | 08:20 | pedido | 40 | 30 | — |
| 2 | P | 08:45 | 09:25 | pedido | 60 | 40 | 25 |
| 3 | P | 09:55 | 10:35 | sem_pedido | 20 | 40 | 30 |
| 4 | P | 11:00 | 11:30 | pedido | 80 | 30 | 25 |
| 5 | E | 13:00 | 13:50 | pedido | 50 | 50 | **90 = almoço** (contém 12:00) |
| 6 | P | 14:15 | 14:55 | pedido | 30 | 40 | 25 |
| 7 | P | 15:25 | 16:05 | pedido | 70 | 40 | 30 |
| 8 | P | 16:30 | 17:10 | pedido | 90 | 40 | 25 |

**05/11 (qui), dia sem almoço:** 6 visitas, 5 paradas planejadas, todas visitadas. Mais uma **rota cancelada** no mesmo dia,
com 3 paradas não visitadas (ficam fora da cobertura, §1.4).

| # | Rota | Check-in | Check-out | d | Duração | Intervalo antes |
|---|---|---|---|---|---|---|
| 1 | P | 07:40 | 08:10 | 40 | 30 | — |
| 2 | P | 08:35 | 09:15 | 60 | 40 | 25 |
| 3 | P | 09:40 | 10:20 | 20 | 40 | 25 |
| 4 | P | 10:40 | 15:10 | 30 | **270** (atendimento longo) | 20 (começa 10:20: antes da janela) |
| 5 | P | 15:30 | 16:10 | 50 | 40 | 20 (começa 15:10: depois da janela) |
| 6 | E | 16:35 | 17:15 | 60 | 40 | 25 |

Nenhum intervalo contém 12:00 e nenhum começa entre 11:00 e 15:00: **sem almoço identificado** (§3.2, caso 4).

**06/11 (sex), visita fechada pela virada:** 7 visitas, 7 paradas planejadas, 6 visitadas.

| # | Rota | Check-in | Check-out | Fechada por / resultado | d | Duração | Intervalo antes |
|---|---|---|---|---|---|---|---|
| 1 | P | 08:10 | 08:40 | usuário | 40 | 30 | — |
| 2 | P | 09:05 | 09:45 | usuário | 60 | 40 | 25 |
| 3 | P | 10:10 | 10:50 | usuário | 20 | 40 | 25 |
| 4 | P | 11:15 | 11:45 | usuário | 80 | 30 | 25 |
| 5 | P | 13:15 | 13:55 | usuário | 50 | 40 | **90 = almoço** |
| 6 | P | 14:20 | 15:00 | usuário | 30 | 40 | 25 |
| 7 | E | 16:50 | 06/11 23:59:59 (2026-11-07T03:59:59Z) | **`auto` / `nao_finalizado`** (RN-CORE-11) | 70 | fora | 110 (ver A-1, §8) |

A 7ª parada planejada do dia não foi visitada.

**07/11 (sáb), dia trabalhado não útil, meio expediente:** 3 visitas, todas extras (sábado não tem rota).

| # | Rota | Check-in | Check-out | d | Duração | Intervalo antes |
|---|---|---|---|---|---|---|
| 1 | E | 08:00 | 08:30 | 40 | 30 | — |
| 2 | E | 08:55 | 09:35 | 60 | 40 | 25 |
| 3 | E | 10:00 | 10:40 | 20 | 40 | 25 |

Termina antes do corte: sem almoço (§3.2, caso 5).

**09/11 (seg), visita que atravessa o almoço, cliente fechado e visita removida:** 8 visitas, 8 paradas planejadas, todas
visitadas.

| # | Rota | Check-in | Check-out | Resultado | d | Duração | Intervalo antes |
|---|---|---|---|---|---|---|---|
| 1 | P | 07:55 | 08:25 | pedido | 40 | 30 | — |
| 2 | P | 08:50 | 09:30 | pedido | 60 | 40 | 25 |
| 3 | P | 09:55 | 10:35 | pedido | 20 | 40 | 25 |
| 4 | P | 11:40 | 12:20 | pedido | 80 | 40 (atravessa o corte) | 65 (começa 10:35: fora da janela) |
| 5 | P | 13:30 | 13:40 | **`cliente_fechado`** (RN-CORE-14) | 50 | fora do TMA | **70 = almoço** (caso 3: maior que começa na janela) |
| 6 | P | 14:05 | 14:45 | pedido | 30 | 40 | 25 |
| 7 | P | 15:10 | 15:50 | pedido | 70 | 40 | 25 |
| 8 | P | 16:15 | 16:55 | pedido | 90 | 40 | 25 |
| — | E | 17:30 | 17:45 | pedido, **`deleted_at` preenchido** | 10 | fora de tudo | — |

Intervalos que começam na janela: 12:20→13:30 (70), 13:40→14:05 (25), 14:45→15:10 (25). Almoço = 70.

**10/11 (ter), falta:** nenhuma visita. 6 paradas planejadas, nenhuma visitada.

**11/11 (qua), duas visitas no mesmo cliente, cliente sem coordenada e check-in sem GPS:** 8 linhas de visita, 7 visitas
contadas, 6 paradas planejadas, todas visitadas.

| # | Cliente | Rota | Check-in | Check-out | d | Duração | Intervalo antes |
|---|---|---|---|---|---|---|---|
| 1 | G1 | P | 07:45 | 08:15 | 40 | 30 | — |
| 2 | G2 | P | 08:40 | 09:20 | **nulo** (cliente sem coordenada) | 40 | 25 |
| 3 | G3 | P | 09:45 | 10:25 | nulo, **`sem_gps = true`** | 40 | 25 |
| 4 | G4 | P | 10:50 | 11:30 | 80 | 40 | 25 |
| 5 | G5 | P | 13:00 | 13:40 | 50 | 40 | **90 = almoço** |
| 6 | **G1** (de novo) | P | 14:05 | 14:25 | 30 | 20 | 25 |
| 7 | G7 | E | 14:50 | 15:30 | 70 | 40 | 25 |
| 8 | G8 | P | 15:55 | 16:35 | 90 | 40 | 25 |

**13/11 (sex), hoje até 11:00:** 4 visitas, 6 paradas planejadas, 3 visitadas, 3 ainda por fazer.

| # | Rota | Check-in | Check-out | d | Duração | Intervalo antes |
|---|---|---|---|---|---|---|
| 1 | P | 08:05 | 08:35 | 40 | 30 | — |
| 2 | P | 09:00 | 09:40 | 60 | 40 | 25 |
| 3 | E | 10:05 | 10:45 | 20 | 40 | 25 |
| 4 | P | 10:50 | **aberta** (check-in sem check-out) | 80 | fora | 5 |

**Depois de hoje:** 16/11 tem 5 paradas planejadas (rota já montada). Não entram em nada (§1.1, corte em hoje).

**Km (`core.deslocamento_dia`):** 03/11 = 95.000 m · 04/11 = 110.000 m · 12/11 = 88.000 m · 13/11 (hoje, parcial) = 30.000 m.
Os outros dias trabalhados não têm resumo.

**Realizado do servidor (`RealizadoServidorSchema`, base 13/11 11:00):** `venda_cents` 8.460.000 · `venda_ate_ontem_cents`
8.100.000 · `positivacao` 38 · `positivacao_ate_ontem` 36 · `pedidos` 25 · `itens_distintos` 160. Até ontem (12/11): 23 pedidos e
145 itens distintos; hoje: 2 pedidos e 15 itens. Na semana 09–13/11: 12 pedidos e 84 itens. Os campos "até ontem" de
pedidos e itens **não existem** hoje no `RealizadoServidorSchema` (ver A-4, §8).

### 1.3 Resumo por dia (base de todas as médias)
| Dia | Visitas contadas | Extras | 1º check-in | Último check-in | Linhas no TMA (Σ min) | Intervalos no TMD (Σ min) | Almoço | Fim do dia | Jornada líquida | Raio: linhas (Σ m) | Planejadas consideradas / visitadas | Clientes atendidos |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 03 (A) | 8 | 1 | 07:50 = 470 | 16:30 = 990 | 8 (310) | 6 (160) | 90 | 17:10 = 1030 | 470 | 8 (440) | 7 / 7 | 8 |
| 04 (A) | 8 | 1 | 470 | 990 | 8 (310) | 6 (160) | 90 | 1030 | 470 | 8 (440) | 7 / 7 | 8 |
| 05 | 6 | 1 | 07:40 = 460 | 16:35 = 995 | 6 (460) | 5 (115) | — | 17:15 = 1035 | 575 | 6 (260) | 5 / 5 | 6 |
| 06 | 7 | 1 | 08:10 = 490 | 16:50 = 1010 | 6 (220) | 5 (210) | 90 | 16:50 = 1010 | 430 | 7 (350) | 7 / 6 | 6 |
| 07 (sáb) | 3 | 3 | 08:00 = 480 | 10:00 = 600 | 3 (110) | 2 (50) | — | 10:40 = 640 | 160 | 3 (120) | 0 / 0 | 3 |
| 09 | 8 | 0 | 07:55 = 475 | 16:15 = 975 | 7 (270) | 6 (190) | 70 | 16:55 = 1015 | 470 | 8 (440) | 8 / 8 | 7 |
| 10 | 0 | 0 | — | — | — | — | — | — | — | — | 6 / 0 | — |
| 11 | 7 | 1 | 07:45 = 465 | 15:55 = 955 | 8 (290) | 6 (150) | 90 | 16:35 = 995 | 440 | 6 (360) | 6 / 6 | 7 |
| 12 (A) | 8 | 1 | 470 | 990 | 8 (310) | 6 (160) | 90 | 1030 | 470 | 8 (440) | 7 / 7 | 8 |
| **13 (hoje)** | 4 | 1 | 08:05 = 485 | *(fora: hoje)* | 3 (110) | 3 (55) | *(fora)* | *(fora)* | *(fora)* | 4 (200) | **3 / 3** | 3 |

Dias trabalhados: 9 (03, 04, 05, 06, 07, 09, 11, 12, 13). Dias encerrados: 8 (os mesmos sem o 13). Visitas contadas: 59
(55 nos dias encerrados). Visitas extras: 10.

## 2. Calendário (`calendarioDoPeriodo`, RN-CORE-41, D1, D4)
| # | Período | Hoje | `du_total` | `du_decorridos` | `du_restantes` | `du_hoje` | O que confere |
|---|---|---|---|---|---|---|---|
| CAL-1 | novembro | **13/11** | 19 | 9 | 11 | 9 | caso base; 9 + 11 = 19 + 1 (hoje nos dois, D1) |
| CAL-2 | novembro | 12/11 | 19 | 8 | 12 | 8 | a observação do desenho ("quinta 12/11 é o DU 8 de 19") |
| CAL-3 | novembro | 20/11 (feriado) | 19 | 13 | 6 | **nulo** | feriado nacional não é útil (D4); 13 + 6 = 19, sem o +1 |
| CAL-4 | novembro | 01/11 (domingo) | 19 | 0 | 19 | nulo | 1º dia útil ainda não chegou |
| CAL-5 | novembro | 30/11 | 19 | 19 | 1 | 19 | último dia útil: restantes = 1 |
| CAL-6 | novembro | 14/11 (sábado) | 19 | 9 | 10 | nulo | dia não útil depois de hoje-útil |
| CAL-7 | outubro (Mês passado) | 13/11 | 21 | 21 | 0 | nulo | período encerrado; 12/10 é feriado nacional |
| CAL-8 | Esta semana 09–15/11 | 13/11 | 5 | 5 | 1 | 9 | `du_hoje` é a posição no **mês** (§1.3 do desenho) |
| CAL-9 | novembro, **segunda a sábado** | 12/11 | 23 | 9 | 15 | 9 | a outra observação do desenho ("DU 9 de 23") |
| CAL-10 | novembro, segunda a sexta, **sem** contar os nacionais | 13/11 | 21 | — | — | — | **não pode** dar 21: com a D4, 02/11 e 20/11 nunca são úteis (19) |

## 3. Resultados do mês (`resultadosDoPeriodo`, RN-CORE-42, RN-CORE-21, D1–D3, D6)
Período Este mês, hoje 13/11: `du_decorridos` = 9, `du_restantes` = 11. Gap = `max(0, meta − real)`; Meta/dia =
`⌈Gap ÷ 11⌉`; Real/dia = `round(real ÷ 9)`; atingimento = `round(10000 × real ÷ meta)`.

| # | Indicador | Meta | Realizado | Atingimento (pb) | Gap | Meta/dia (ou Meta/pedido) | Real/dia | Situação | Fórmula e RN |
|---|---|---|---|---|---|---|---|---|---|
| R-1 | **Vendas** (`venda_cents`; o card se chama "Vendas" porque a meta é de pedido, D6) | 18.000.000 | 8.460.000 | **4700** (47,0%) | 9.540.000 | ⌈9.540.000 ÷ 11⌉ = 867.272,7… → **867.273** | 8.460.000 ÷ 9 = **940.000** | `a_cumprir` | RN-CORE-42, RN-CORE-21 (pedido aprovado pela emissão), RN-CORE-22 |
| R-2 | **Positivação** | 70 | 38 | 38 ÷ 70 = 5428,6 → **5429** | 32 | ⌈32 ÷ 11⌉ = ⌈2,91⌉ → **3** | 38 ÷ 9 = 4,22 → **4** | `a_cumprir` | RN-CORE-42, RN-CORE-20 |
| R-3 | **Visitas** | 200 | **59** (§1.3: pares cliente × dia com check-in, extras incluídas, sábado incluído, visita removida fora, duas visitas em G1 no dia 11 = 1) | **2950** | 141 | ⌈141 ÷ 11⌉ = ⌈12,82⌉ → **13** | 59 ÷ 9 = 6,56 → **7** | `a_cumprir` | RN-CORE-42, RN-CORE-20, D3 |
| R-4 | **Itens por pedido** | 800 | round(100 × 160 ÷ 25) = **640** (6,40) | **8000** | 160 | 800 + 160 × 9 ÷ 11 = 930,9 → em décimos para cima: 9,4 → **940** | **nulo** (o "Real" é o próprio realizado) | `a_cumprir` | RN-CORE-42, D2 |

Sensibilidade às decisões: com a D1 alternativa (restantes = 10, sem hoje), R-1 vira ⌈9.540.000 ÷ 10⌉ = 954.000; com a D3
alternativa (só planejadas), R-3 vira 59 − 10 = 49.

### 3.1 Variações dos Resultados
| # | Caso | Entrada que muda | Esperado | Regra |
|---|---|---|---|---|
| R-5 | **Meta batida** | positivação 72 | atingimento round(10000 × 72 ÷ 70) = **10286** (passa de 10000); Gap 0; Meta/dia **nula**; Real/dia round(72 ÷ 9) = 8; situação **`batida`**. Nada negativo | RN-CORE-42, RN-CORE-26 |
| R-6 | **Itens batida** | itens 170 em 20 pedidos (850) | atingimento 10625; Gap 0; Meta/pedido **nula**; `batida` | RN-CORE-42 |
| R-7 | **Sem pedido no período** | pedidos 0, itens 0 | realizado **0** (não "—"; exceção à divisão por zero da §1.5, A-3); atingimento 0; Gap 800; Meta/pedido = a própria meta = **800**; `a_cumprir` | RN-CORE-42, A-3 |
| R-8 | **Período encerrado** (Mês passado = outubro) | meta 17.000.000; realizado 15.120.000 | `du` 21/21/0; Gap 1.880.000; atingimento round(10000 × 15,12 ÷ 17) = **8894**; Meta/dia **nula** (0 restantes); Real/dia 15.120.000 ÷ 21 = **720.000** | RN-CORE-42, §1.1 do desenho |
| R-9 | **Dia 1 num domingo** (hoje 01/11) | realizado 0 | `du_decorridos` 0 → Real/dia **nulo**; Meta/dia ⌈18.000.000 ÷ 19⌉ = **947.369**; atingimento 0; `du_hoje` nulo ("DU — de 19") | RN-CORE-41, RN-CORE-42 |
| R-10 | **Período Hoje** (13/11) | — | Vendas: meta do dia ⌈(18.000.000 − 8.100.000) ÷ 11⌉ = **900.000**; realizado de hoje 8.460.000 − 8.100.000 = 360.000; atingimento **4000**; Gap 540.000; Meta/dia **nula**. Positivação: meta do dia ⌈(70 − 36) ÷ 11⌉ = **4**; realizado 2; atingimento 5000. Visitas: meta do dia ⌈(200 − 55) ÷ 11⌉ = ⌈13,18⌉ = **14**; realizado 4; atingimento round(10000 × 4 ÷ 14) = **2857**. Itens por pedido: meta do dia = 800 + (800 − 630) × 8 ÷ 11 = 923,6 → em décimos para cima **930** (realizado até ontem round(100 × 145 ÷ 23) = 630; 8 = DU decorridos antes de hoje; 11 restantes contando hoje); realizado de hoje round(100 × 15 ÷ 2) = **750**; atingimento round(10000 × 750 ÷ 930) = **8065**; Gap 180; Meta/pedido nula | RN-CORE-26, D7, A-4 |
| R-11 | **Esta semana** (09–15/11, proporcional) | vendas da semana 2.000.000; positivação da semana 15 | Vendas: meta round(18.000.000 × 5 ÷ 19) = **4.736.842**, atingimento **4222**, Gap 2.736.842. Positivação: meta round(70 × 5 ÷ 19) = **18**, atingimento **8333**, Gap 3. Visitas: meta round(200 × 5 ÷ 19) = **53**; realizado 8 + 0 + 7 + 8 + 4 = **27**; atingimento **5094**. Meta/dia **nula** nos três. Itens por pedido: meta = a **meta do dia** de hoje = **930** (R-10); realizado round(100 × 84 ÷ 12) = **700**; atingimento round(10000 × 700 ÷ 930) = **7527**; Gap 230 | D7, RN-CORE-42, A-4 |
| R-12 | **Um dia escolhido: 10/11** (falta) | realizado 0 | metas proporcionais a 1 de 19 DU: vendas round(18.000.000 ÷ 19) = 947.368; visitas round(200 ÷ 19) = 11; positivação round(70 ÷ 19) = 4; atingimento 0; Meta/dia nula | D7 |
| R-13 | **Promotor** | perfil promotor, mesmas visitas | só **Visitas** com valor (R-3). Vendas, Positivação e Itens: **`sem_dado`** e fora da tela | RN-PRO-01, §2.4 do desenho |
| R-14 | **Vendedor desligado, sem notas do ERP** | `venda_cents`, `positivacao`, `pedidos` nulos | Vendas, Positivação e Itens: **`sem_dado`** (nunca 0). Visitas segue R-3 | RN-CORE-27, §2.4 |
| R-15 | **Mês sem meta** | nenhuma linha de `core.meta` em novembro | os 4 indicadores **`sem_meta`**, com o realizado visível; atingimento, Gap e Meta/dia nulos | §2.3 do desenho |

### 3.2 Virada do dia sem sinal nos Resultados (V-1, RN-CORE-26, §7.1 do desenho)
Última sincronização em **12/11, 20:22**: a cópia tem `venda_cents` 8.100.000 e `positivacao` 36. O aparelho acorda em
**13/11, 07:30**, sem sinal, antes de qualquer visita do dia. As visitas locais vão até 12/11 (55).

| Indicador | Com a cópia no próprio 12/11 (dec. 8, rest. 12) | Em 13/11 offline (dec. 9, rest. 11) |
|---|---|---|
| Vendas | Meta/dia 9.900.000 ÷ 12 = 825.000; Real/dia 8.100.000 ÷ 8 = 1.012.500 | Meta/dia ⌈9.900.000 ÷ 11⌉ = **900.000**; Real/dia 8.100.000 ÷ 9 = **900.000**; atingimento **4500** |
| Positivação | — | Gap 34; Meta/dia ⌈34 ÷ 11⌉ = **4**; Real/dia round(36 ÷ 9) = **4**; atingimento round(5142,9) = **5143** |
| Visitas (locais) | — | 55; Gap 145; Meta/dia ⌈145 ÷ 11⌉ = **14**; Real/dia round(55 ÷ 9) = **6**; atingimento **2750** |

- A tela mostra a base: **"base de 12/11, 20:22"**. A linha do calendário passa a "DU 9 de 19 · 11 restantes".
- Conferência cruzada: a Meta/dia offline de 13/11 é igual à meta do dia do período Hoje (R-10): 900.000, 4 e 14. O hoje da
  cópia (12/11) passou a contar como "ontem" (RN-CORE-26).

## 4. Produtividade do mês (`produtividadeDoPeriodo`, RN-CORE-43 a RN-CORE-46)
Período Este mês, hoje 13/11 às 11:00. Meta = padrão do FDV (origem `padrao_fdv`, D5). "Amostra" = base da média
(`ProdutividadeIndicadorSchema.amostra`). Arredondamento: meio para cima (§1.5).

| # | Indicador | Conta (dados do §1.3) | Valor | Exibição | Meta | Situação | Amostra | RN |
|---|---|---|---|---|---|---|---|---|
| P-1 | **1º check-in** | (470 + 470 + 460 + 490 + 480 + 475 + 465 + 470 + 485) ÷ 9 = 4265 ÷ 9 = 473,9. **Hoje entra** | **474** | 07:54 | até 480 (08:00) | **dentro** | 9 dias | RN-CORE-43 |
| P-2 | **Último check-in** | (990 + 990 + 995 + 1010 + 600 + 975 + 955 + 990) ÷ 8 = 7505 ÷ 8 = 938,1. **Hoje fora** (dia em andamento); visita removida das 17:30 fora | **938** | 15:38 | a partir de 1020 (17:00) | **fora** | 8 dias | RN-CORE-43 |
| P-3 | **TMA** | Σ das durações com check-out real, sem cliente fechado: 310 × 3 + 460 + 220 + 110 + 270 + 290 + 110 = 2390, em 57 visitas = 41,9. Fora: a fechada pela virada (06), a aberta de hoje, o cliente fechado (09). Entram: a de 270 min (05) e as duas linhas de G1 (11) | **42** | 42 min | até 30 | **fora** | 57 visitas | RN-CORE-43, RN-CORE-11, RN-CORE-14 |
| P-4 | **TMD** | Σ dos intervalos sem o almoço: 160 × 3 + 115 + 210 + 50 + 190 + 150 + 55 = 1250, em 45 intervalos = 27,8. Entram: o intervalo depois do cliente fechado (09), o de 110 min que termina no check-in da visita fechada pela virada (06, ver A-1) e os de hoje (25, 25, 5). Sai o almoço de cada dia | **28** | 28 min | até 25 | **fora** | 45 intervalos | RN-CORE-43, RN-CORE-44 |
| P-5 | **Almoço** | dias encerrados com almoço: 90 (03) + 90 (04) + 90 (06) + 70 (09, caso 3) + 90 (11) + 90 (12) = 520 ÷ 6 = 86,7. Fora: 05 (sem almoço), 07 (sábado antes do corte) e hoje | **87** | 1h27 | até 90 | **dentro** | 6 dias | RN-CORE-44 |
| P-6 | **Jornada líquida** | (470 + 470 + 575 + 430 + 160 + 470 + 440 + 470) ÷ 8 = 3485 ÷ 8 = 435,6. Dia 05 sem almoço = desconto 0 (1035 − 460). Dia 06 termina no **último check-in** (16:50), não no fechamento automático | **436** | 7h16 | a partir de 480 | **fora** | 8 dias | RN-CORE-44 |
| P-7 | **% fora de rota** | visitas contadas sem parada do mesmo cliente no mesmo dia: 1 + 1 + 1 + 1 + 3 + 0 + 1 + 1 + 1 = 10, sobre 59 = 1694,9. Hoje entra. A removida não conta | **1695** | 16,9% | até 1000 | **fora** | 59 visitas | RN-CORE-43, RN-CORE-20 |
| P-8 | **Visitas por dia** | 55 visitas contadas nos dias encerrados ÷ 8 dias trabalhados encerrados = 6,875. O sábado (07) é dia trabalhado; a falta (10) não | **69** | 6,9 | a partir de 110 | **fora** | 8 dias | RN-CORE-43 |
| P-9 | **Cobertura de rota** | visitadas ÷ consideradas = (7 + 7 + 5 + 6 + 8 + 0 + 6 + 7 + 3) ÷ (7 + 7 + 5 + 7 + 8 + 6 + 6 + 7 + 3) = 49 ÷ 56 = 0,875. A falta (10) conta 6 não visitadas; hoje considera só as 3 já visitadas; 16/11 e a rota cancelada (05) ficam fora | **8750** | 87,5% | a partir de 9000 | **fora** | 56 paradas | RN-CORE-43, RN-CORE-20, RN-GES-05 |
| P-10 | **Raio médio do check-in** | Σ `distancia_m` com GPS e coordenada: 440 × 4 + 260 + 350 + 120 + 360 + 200 = 3050, em 58 linhas = 52,6. Fora: G2 (sem coordenada) e G3 (sem GPS) no dia 11. Entram: a fechada pela virada, a aberta de hoje e o cliente fechado | **53** | 53 m | até 100 | **dentro** | 58 visitas | RN-CORE-43, RN-CORE-10 |
| P-11 | **Km por dia** | dias encerrados com resumo: (95.000 + 110.000 + 88.000) ÷ 3 = 97.666,7. O resumo parcial de hoje fica fora (dia em andamento) | **97.667** | 97,7 km | até 120.000 | **dentro** | 3 dias | RN-CORE-46 |
| P-12 | **Km por cliente** | dias com resumo, hoje incluído: (95.000 + 110.000 + 88.000 + 30.000) ÷ (8 + 8 + 8 + 3) = 323.000 ÷ 27 = 11.963,0. Hoje: só as 3 visitas com check-out real (a aberta não é atendida) | **11.963** | 12,0 km | até 12.000 | **dentro** | 27 clientes (ver A-5) | RN-CORE-46 |

### 4.1 Discriminadores (o erro comum que cada dado pega)
| Se a função... | O número muda para | Indicador |
|---|---|---|
| contar o fechamento automático do dia 06 como check-out real | TMA (2390 + 430) ÷ 58 = 48,6 → 49; jornada do dia 06 = 1439 − 490 − 90 = 859 | P-3, P-6 |
| contar a visita removida do dia 09 | último check-in do dia 09 = 17:30; fora de rota 11 ÷ 60 | P-2, P-7 |
| contar o cliente fechado no TMA | 2400 ÷ 58 = 41,4 → 41 | P-3 |
| contar G2/G3 com distância 0 em vez de excluir | 3050 ÷ 60 = 50,8 → 51 | P-10 |
| contar as duas visitas em G1 como 2 | 60 visitas contadas; fora de rota 1667 | P-7, R-3 |
| contar as paradas pendentes de hoje como falta | 49 ÷ 59 = 8305 | P-9 |
| contar as paradas de 16/11 ou da rota cancelada | denominador 61 ou 59 | P-9 |
| identificar almoço no dia 05 (que não tem intervalo na janela) | almoço com 7 dias, abaixo de 87; jornada do dia 05 abaixo de 575 | P-5, P-6 |
| no dia 09, escolher o intervalo de 65 (começa antes da janela) | almoço (520 − 70 + 65) ÷ 6 = 85,8 → 86 | P-5 |
| incluir hoje no último check-in / jornada / visitas por dia | 906 / 406 / 66 (são os valores do V-2) | P-2, P-6, P-8 |
| fazer o km por cliente como média das razões de cada dia, e não Σ km ÷ Σ clientes | (11.875 + 13.750 + 11.000 + 10.000) ÷ 4 = 11.656 | P-12 |
| tratar o sábado como não trabalhado | 1º check-in 473; visitas por dia 52 ÷ 7 = 7,4 | P-1, P-8 |

### 4.2 Variações da Produtividade
**K-1 — Km sem rastreamento** (nenhuma linha em `core.deslocamento_dia`, ou usuário sem termo aceito, RN-CORE-46, §5 do
desenho):

| Indicador | Valor | Situação | Meta | Amostra |
|---|---|---|---|---|
| Km por dia | **nulo ("—")** | **`sem_dado`**, sem ponto | 120.000, origem `padrao_fdv` (continua visível) | 0 |
| Km por cliente | **nulo ("—")** | **`sem_dado`**, sem ponto | 12.000, `padrao_fdv` | 0 |
| Os outros 10 | iguais a P-1 a P-10 | iguais | iguais | iguais |

Nunca há estimativa em linha reta entre check-ins (§5, "Rejeitado").

**V-2 — Virada do dia sem sinal na Produtividade.** Mesmos dados, nenhuma visita nova. O aparelho vira para **sábado
14/11, 07:00**, sem sinal. A visita aberta de 13/11 continua sem check-out no aparelho (o fechamento automático do servidor
ainda não chegou). 13/11 passa a ser dia encerrado.

| Indicador | Muda? | Esperado | Conta |
|---|---|---|---|
| 1º check-in | não | 474 | — |
| Último check-in | sim | **906** (15:06) | (7505 + 650) ÷ 9 = 906,1. O último check-in de 13/11 é a visita aberta (10:50) |
| TMA | não | 42 | a aberta continua fora |
| TMD | não | 28 | a aberta não abre intervalo |
| Almoço | não | 87 | 13/11 não tem almoço identificado |
| Jornada líquida | sim | **406** (6h46) | 13/11: fim = max(10:45, 10:50) = 650; 650 − 485 − 0 = 165; (3485 + 165) ÷ 9 = 405,6 |
| % fora de rota | não | 1695 | — |
| Visitas por dia | sim | **66** (6,6) | 59 ÷ 9 = 6,56 |
| Cobertura | sim | **8305** (83,1%) | as 3 paradas não feitas de 13/11 viram falta: 49 ÷ 59 |
| Raio | não | 53 | — |
| Km por dia | sim | **80.750** | (293.000 + 30.000) ÷ 4 |
| Km por cliente | não | 11.963 | — |

Resultados no mesmo instante (cópia de 13/11, 11:00; `du` 19/9/10, `du_hoje` nulo, "DU — de 19"): Vendas Meta/dia
⌈9.540.000 ÷ 10⌉ = **954.000**, Real/dia 940.000; a tela mostra "base de 13/11, 11:00".

**H-1 — Período Hoje (13/11, até 11:00)** (§3.3 do desenho: todos os indicadores só com hoje, até agora; ver A-2):

| Indicador | Esperado | Situação | Conta |
|---|---|---|---|
| 1º check-in | 485 (08:05) | fora | — |
| Último check-in | 650 (10:50) | fora | o que já aconteceu |
| TMA | 37 | fora | 110 ÷ 3 = 36,7 |
| TMD | 18 | dentro | 55 ÷ 3 = 18,3 |
| Almoço | nulo | `sem_dado` | nenhum intervalo na janela ainda |
| Jornada líquida | 165 (2h45) | fora | max(10:45, 10:50) − 08:05 − 0 |
| % fora de rota | 2500 | fora | 1 ÷ 4 |
| Visitas por dia | 40 (4,0) | fora | 4 ÷ 1 |
| Cobertura | 10000 | dentro | 3 ÷ 3 (pendentes de hoje não são falta) |
| Raio | 50 | dentro | 200 ÷ 4 |
| Km por dia | 30.000 | dentro | resumo parcial de hoje |
| Km por cliente | 10.000 | dentro | 30.000 ÷ 3 |

**S-1 — Período sem nenhuma visita.**
- Um dia escolhido = 10/11 (falta, 6 paradas planejadas): os 11 indicadores ficam **`sem_dado`**; cobertura = **0**
  (0 ÷ 6), situação **fora**.
- Um dia escolhido = 08/11 (domingo, sem parada): os 12 ficam **`sem_dado`**, inclusive a cobertura.

**S-2 — Igual à meta é dentro.** Meta do usuário `km_cliente` = 11.963 → valor 11.963, **dentro** (§1.6). E `tma` = 42 →
dentro (o caso M-3 do §5).

## 5. Metas de produtividade (`metaProdutividadeVigente`, `validarMetaProdutividade`, RN-CORE-45, §6 do desenho)
Árvore: **Norte** (raiz) › **Boa Vista** (equipe do V1). Indicador `tma` (o valor do mês é 42, P-3). Mês = o **último mês do
período**.

| # | Linhas vivas em `core.meta_produtividade` | Período | Meta resolvida | Origem | Situação do TMA 42 |
|---|---|---|---|---|---|
| M-1 | nenhuma | novembro | 30 | `padrao_fdv` | fora |
| M-2 | tenant 45 (vig. 2026-11) | novembro | 45 | `tenant` | dentro |
| M-3 | tenant 45; equipe **Norte** 40 (2026-11) | novembro | 40 (Boa Vista não tem linha: sobe até Norte) | `equipe` | fora |
| M-4 | tenant 45; Norte 40; equipe Boa Vista 50 (2026-11) | novembro | 50 (a mais próxima vence) | `equipe` | dentro |
| M-5 | tenant 45; Norte 40; usuário V1 **42** (2026-11) | novembro | 42 | `usuario` | **dentro** (igual) |
| M-6 | M-5 com a linha do usuário **apagada** (`deleted_at`, "voltar a herdar") | novembro | 40 | `equipe` | fora |
| M-7 | tenant 50 (2026-09) e tenant 45 (2026-11) | novembro | 45 (maior vigência ≤ mês) | `tenant` | dentro |
| M-8 | M-7 | **Mês passado** (outubro) | 50 (a de 2026-11 ainda não vale) | `tenant` | — |
| M-9 | usuário V1 35 (vig. **2026-12**); Norte 40 (2026-11) | novembro | 40 (a do usuário só vale em dezembro) | `equipe` | fora |
| M-10 | tenant **T2** com `tma` 10 | novembro, usuário de T1 | 30 | `padrao_fdv` | fora (a linha de T2 não entra; RLS e API no e2e) |
| M-11 | só `km_dia` do usuário (100.000) | novembro | `km_dia` 100.000 `usuario`; os outros 11 seguem o padrão `padrao_fdv` | — | — |

**Validações** (erro 422 `META_PRODUTIVIDADE_INVALIDA` com `detalhes.campo`; hoje 13/11/2026):

| # | Entrada | Esperado |
|---|---|---|
| VAL-1 | `tma` 0 · 1 · 480 · 481 | inválido · válido · válido · inválido (`campo` = `tma`) |
| VAL-2 | `almoco` 0 · 240 · 241 | válido · válido · inválido |
| VAL-3 | `jornada_liquida` 59 · 60 · 960 · 961 | inválido · válido · válido · inválido |
| VAL-4 | `primeiro_checkin` 1439 · 1440 | válido · inválido |
| VAL-5 | `fora_rota` 10000 · 10001 | válido · inválido |
| VAL-6 | `visitas_dia` 0 · 1 · 1000 · 1001 | inválido · válido · válido · inválido |
| VAL-7 | `raio_checkin` 0 · 5000 · 5001 | inválido · válido · inválido |
| VAL-8 | `km_dia` 999 · 1000 · 2.000.000 · 2.000.001 | inválido · válido · válido · inválido |
| VAL-9 | `km_cliente` 99 · 100 · 500.000 · 500.001 | inválido · válido · válido · inválido |
| VAL-10 | `vigencia_inicio` 2026-10 · 2026-11 · 2026-12 | inválido (passado não muda, RN-CORE-30) · válido · válido |
| VAL-11 | `ultimo_checkin` 420 (07:00) com `primeiro_checkin` resolvido 480 (padrão) | inválido, `campo` = `ultimo_checkin` |
| VAL-12 | `primeiro_checkin` 1080 (18:00) com `ultimo_checkin` resolvido 1020 (padrão) | inválido, `campo` = `primeiro_checkin` (o campo editado) |
| VAL-13 | lote com `tma` duas vezes | inválido ("Indicador repetido") |
| VAL-14 | escopo `equipe` sem `equipe_id`; escopo `tenant` com `usuario_id` | inválidos (`alvoCoerente`) |

## 6. Critérios do §10 do desenho × este roteiro
| Critério | Onde | Situação |
|---|---|---|
| 1. Mês sintético com os mesmos números no app offline, na API e no BKO, para os 16 indicadores | §3 (4 Resultados) e §4 (12 Produtividade): valor esperado, fórmula e RN | roteiro pronto; o domain entra no §9; o app, a API e o BKO entram no e2e da etapa 5 |
| 2. Cada caso de borda da §3.4 com teste no domain citando a RN | tabela abaixo | casos no roteiro; os testes entram com a N-A |
| 3. Troca de período em < 100 ms com ~300 visitas | fora deste roteiro (carga no aparelho, etapa 5) | pendente |
| 4. Vendedor só vê a si; promotor só Visitas; tenant A não lê meta de B | R-13, M-10 (domain); 404 e RLS no e2e | parcial |
| 5. Usuário > equipe > tenant > padrão; voltar a herdar | M-1 a M-9 | roteiro pronto |
| 6. Sem resumo de km, 2 cards "—" e os outros 10 normais | K-1 | roteiro pronto |

**Casos de borda da §3.4 do desenho:**

| Caso | Dado no mês sintético | Casos |
|---|---|---|
| Dia sem check-in | 10/11 (falta, 6 paradas) | P-8, P-9, S-1 |
| Período sem nenhuma visita | 10/11 e 08/11 | S-1 |
| Check-in sem check-out | visita 4 de 13/11 | P-3, P-4, P-10, P-12, V-2 |
| Fechada na virada do dia | visita 7 de 06/11 | P-3, P-4, P-6 |
| Visita que atravessa o almoço | visita 4 de 09/11 | P-5 |
| Cliente fechado | visita 5 de 09/11 | P-3, P-4, P-7, P-12 |
| Cliente sem coordenada | G2 em 11/11 | P-10 |
| Check-in sem GPS | G3 em 11/11 | P-10 |
| Visita extra | 10 extras (07/11 inteiro) | P-7, P-9, R-3 |
| Duas visitas no mesmo cliente e dia | G1 em 11/11 | P-3, P-4, P-7, R-3 |
| Dia trabalhado sem resumo de km | 05, 06, 07, 09 e 11/11 | P-11, P-12 |
| Visita removida | 09/11, 17:30 | P-2, P-7 |
| Dia sem almoço | 05/11 (e 07/11, antes do corte) | P-4, P-5, P-6 |
| Relógio do aparelho errado | não se aplica ao domain (o servidor recusa, RN-CORE-11) | — |

## 7. Como rodar (quando a N-A estiver no `main`)
Sem banco, no `pnpm test` da raiz:
```
pnpm --filter ./tests exec vitest run modulos/core-performance-
pnpm --filter ./tests typecheck:tests
```

## 8. Pontos confirmados e em aberto
Respostas do Alexandre no chat da sessão da nuvem, 13/11/2026 ~05:45 (Manaus), texto literal: "A2: Sim · A3: 0 · A4: Meta do
dia · A5: km por cliente é o km rodado dividido pela quantidade de clientes atendidos. O periodo so aumenta ou diminui o km
e o cliente."

| # | Ponto | Resposta | No roteiro |
|---|---|---|---|
| A-1 | O intervalo que **termina** no check-in de uma visita fechada pela virada (06/11, 15:00 → 16:50) entra no TMD? A §3.4 diz que a visita "fica fora do TMD", mas o intervalo é aberto pelo check-out real da visita anterior | **em aberto** (engenheiro-software) | assume que **entra** (110 min): TMD = 28. Se não entrar: 1140 ÷ 44 = 25,9 → **26** |
| A-2 | No período **Hoje**, "Visitas por dia", "Km por dia" e "Último check-in" usam o dia em andamento? | **Sim** | H-1 como está |
| A-3 | Itens por pedido sem pedido no período | **0** | R-7: realizado 0, `a_cumprir`, Meta/pedido = meta. Vendedor desligado continua `sem_dado` (R-14: a fonte não existe) |
| A-4 | Meta de Itens por pedido em Hoje e em Esta semana | **Meta do dia** | R-10 e R-11: 930. A conta da meta do dia de uma **média** é leitura do testes, a confirmar pelo engenheiro-software: Meta/pedido da §2.1 com o realizado até ontem e os DU decorridos **antes** de hoje (8), restantes contando hoje (11), como a RN-CORE-26. Pede `pedidos_ate_ontem` e `itens_distintos_ate_ontem` no `RealizadoServidorSchema` (modulo-core) |
| A-5 | Km por cliente | **km rodado ÷ clientes atendidos**; o período só muda os dois totais | P-12 como está: Σ km ÷ Σ clientes (11.963), `amostra` = clientes (27). A média das razões diárias (11.656) é erro (§4.1) |

## 9. Testes automáticos (entram com a N-A)
Arquivos novos, um por função, todos com os dados do §1.2 montados num construtor só:
- `tests/modulos/core-performance-calendario.test.ts`: CAL-1 a CAL-10.
- `tests/modulos/core-performance-resultados.test.ts`: R-1 a R-15 e V-1.
- `tests/modulos/core-performance-produtividade.test.ts`: P-1 a P-12, §4.1, K-1, V-2, H-1, S-1 e S-2.
- `tests/modulos/core-performance-metas.test.ts`: M-1 a M-11 e VAL-1 a VAL-14.

Cada `it` cita o caso e a RN (`P-3 · RN-CORE-43: …`). Divergência entre o esperado e a função vai por recado ao
modulo-core, com o caso; o testes não corrige o domain.
