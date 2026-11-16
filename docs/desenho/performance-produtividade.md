# Desenho — Performance: Resultados e Produtividade (T-0170)

- **Autor:** engenheiro-software · **Data:** 2026-11-12 (Manaus) · **Tarefa:** T-0170 · **Versão alvo:** v1.0.6
- **Origem:** R-20261112-204134-alexandre (§1 Início e §5 Performance), aprovado em 12/11/2026.
- **Imagens:** `recados/anexos/2026-11-12-T0170-final-performance-resultados.png`, `-performance-produtividade.png`,
  `-performance-periodo.png` e `-inicio.png`, no repositório de recados.
- **Filtro de período:** o padrão de `docs/design/pedidos-filtro-periodo.md` (`BotaoFiltro` + `FolhaPeriodo`, padrão Este mês).
- **Fora deste desenho:**
  - o rastreamento de localização (T-0156, `docs/desenho/tracking.md`, na nuvem). Aqui só a interface mínima que a Performance lê (§5);
  - o visual dos cards (designer-ux);
  - a Performance do vendedor vista pelo supervisor no Gestão (fase 2, §7.5).
- **Revisão de 13/11/2026:** respostas do Alexandre A-1 a A-5 (R-20261113-054601-testes e R-20261113-055707-alexandre),
  a CAL-8 do testes e as leituras do modulo-core (R-20261113-055130-modulo-core). Resumo na §11.

## Resumo da decisão
1. **Uma função pura por visão**, no `domain` do Core: `resultadosDoPeriodo` e `produtividadeDoPeriodo`. O app (offline), a API e o BKO
   chamam as mesmas funções, como já fazem com `painelDoUsuario` e `metaDoDia`. Os números batem nos três lugares.
2. **Um calendário só**, o do Core: a semana útil `metas.dias_uteis_semana`, os feriados nacionais e os feriados do tenant
   (parâmetro novo `metas.feriados`). O mesmo calendário serve o Início ("DU 9 de 20"), a Performance, a meta do dia e a RV.
3. **Produtividade calculada no aparelho, offline**, com as visitas e as paradas que ele já recebe. A janela do pull de `visita`,
   `rota` e `rota_parada` passa a cobrir o mês passado inteiro.
4. **Resultados:** o realizado de vendas, positivação e itens vem da API, como no Início (T-0073), com cópia para o offline. O
   aparelho faz o resto da conta (Gap, Meta/dia, Real/dia) com o calendário local.
5. **Período fora da janela do aparelho** (Este ano, um mês ou dia antigo): a mesma rota da API calcula tudo e o app mostra o
   sinal de "precisa de internet", como em Pedidos.
6. **Metas de produtividade** numa tabela nova do Core, `core.meta_produtividade`. Cada meta vale para o tenant, uma equipe ou um
   usuário, com a ordem usuário > equipe mais próxima > tenant > padrão do FDV. O BKO tem uma aba nova em **Metas e RV**.
7. **Km:** sai do resumo diário do rastreamento (`core.deslocamento_dia`). Enquanto o rastreamento não grava, os dois cards de km
   mostram "sem dado". Não há estimativa por linha reta.
8. **Itens por pedido:** indicador de meta novo, `itens_por_pedido`. O realizado vem de um campo novo e opcional na consulta
   `vendedor.pedidos_da_meta@1` (`itens_distintos`), sem versão nova.

## Decisões para o Alexandre
Cada item tem a recomendação. Sem resposta, o time segue a recomendação.

| # | Pergunta | Recomendação | Alternativa |
|---|---|---|---|
| D1 | **Hoje é dia decorrido ou restante?** Os números das imagens usam "DU 9 de 20 · 11 restantes": hoje conta como decorrido e fica fora dos restantes. Assim, na manhã do último dia útil, a Meta/dia some (0 restantes), mas ainda dá para vender o dia inteiro. | **Hoje conta nos dois.** Decorridos = dias úteis até hoje (9). Restantes = de hoje até o fim do mês (12). Meta/dia = Gap ÷ 12. É a regra que o sistema já usa (RN-CORE-22/26 e `diasUteisDoPeriodo`). Na tela: "DU 9 de 20 · 12 restantes". Nas imagens, a Meta/dia de faturamento passa de R$ 8,7 k para R$ 8,0 k. | Seguir a imagem ao pé da letra: restantes = depois de hoje (11). |
| D2 | **O que é "item" em Itens por pedido?** | **Produtos diferentes no pedido** (linhas de SKU), que é o mix do pedido. 10 caixas do mesmo produto = 1 item. | Soma das quantidades vendidas. |
| D3 | **Visitas (Resultados):** hoje, o realizado da meta "visitas" conta só as **paradas planejadas** visitadas (`indicadoresDoPeriodo`). | **Contar todas as visitas**, extras incluídas: um cliente por dia, com check-in. A rota já tem a cobertura e o % fora de rota. | Manter só as planejadas. |
| D4 | **Feriados nacionais:** hoje, a meta do dia só os desconta quando o tenant cadastra algum feriado próprio. | **Os nacionais contam sempre.** O BKO cadastra os estaduais e municipais em Parâmetros › Calendário. Muda também a meta do dia do Início e a projeção da RV. | Manter como está até existir o cadastro. |
| D5 | **Metas de produtividade sem cadastro:** | **O FDV traz um padrão** com os valores das imagens (§6.3). O BKO troca para o tenant, a equipe ou o usuário. O card mostra a meta e o ponto desde o 1º dia. | Sem meta até o BKO cadastrar: card sem ponto e sem "meta …". |
| D6 | **Nome do card "Faturamento"** quando a meta do tenant é do tipo pedido (RN-CORE-21). Nesse caso o realizado é a soma dos pedidos aprovados, não o faturado do ERP. | **O nome segue o tipo da meta:** "Faturamento" na meta de faturamento e "Vendas" na meta de pedido. | "Faturamento" sempre, como na imagem. |
| D7 | **Período menor que o mês** (Hoje, Ontem, Esta semana, um dia). As metas são mensais. | **Meta proporcional aos dias úteis do período.** Hoje usa a meta do dia da RN-CORE-26. A Meta/dia só aparece em Este mês e em Hoje (§2.3). | Mostrar só o realizado, sem meta, em período menor que o mês. |

Observação para o designer-ux e o corretor: os números das imagens são ilustrativos. Em novembro de 2026, com segunda a sexta e
os feriados nacionais (02/11 e 20/11), quinta 12/11 é o **DU 8 de 19**. Com segunda a sábado é o **DU 9 de 23**. O roteiro do
testes usa o calendário real.

## 1. Conceitos comuns

### 1.1 Período
- O filtro entrega um intervalo de **datas civis** `[de, ate]`, os dois inclusive, no fuso do tenant. Os atalhos seguem a
  `FolhaPeriodo`: Hoje, Ontem, Esta semana (segunda a domingo, RN-TRE-03), **Este mês** (padrão), Mês passado, Este ano e um dia,
  mês ou ano escolhido.
- **Corte em hoje:** o fim efetivo é `min(ate, hoje)`. Dias depois de hoje não têm realizado. Eles só entram na meta e nos dias
  úteis restantes.
- **Período encerrado:** `ate < hoje`. Não tem Meta/dia nem Meta/pedido, porque não há dia restante.

### 1.2 Fuso
- Todo instante fica gravado em UTC (`checkin_em`, `checkout_em`, `emitido_em`).
- A **data** e a **hora do dia** de cada fato saem do fuso do tenant (parâmetro "Fuso horário", padrão `America/Manaus`), com
  `localDate` de `@macuxi/comum` e uma função nova, `minutoDoDia(instante, fuso)`, de 0 a 1439.
- A data da visita é a `data_local`, gravada pelo servidor no check-in, a mesma da RN-CORE-11. O aparelho não recalcula.

### 1.3 Dias úteis
- **Fonte:** `ehDiaUtilDoTenant` e `diasUteisDoPeriodo` de `@macuxi/comum`, com:
  - a semana útil do Core, `metas.dias_uteis_semana` (padrão segunda a sábado, RN-CORE-26);
  - os feriados nacionais (`feriados.ts`, fixos e móveis), sempre, conforme a D4;
  - os feriados do tenant, no parâmetro novo `metas.feriados` (lista de datas `AAAA-MM-DD`, até 60 por ano). O BKO cadastra em
    Parâmetros › Calendário. A consulta `core.calendario_metas@1` já devolve `feriados`; ela passa a vir preenchida e o Gestor
    deixa de manter lista própria (fase 2).
- **Contas**, para um período `P` e `hoje`, conforme a D1:
  - `du_total` = dias úteis de `P`;
  - `du_decorridos` = dias úteis de `P` com data ≤ hoje;
  - `du_restantes` = dias úteis de `P` com data ≥ hoje. Hoje entra se for útil;
  - `du_hoje` = posição de hoje entre os dias úteis **do período**. No mês, é o "DU 9" do Início; em Esta semana, "DU 5 de 5".
    Em dia não útil ou com hoje fora do período, fica nulo e a tela mostra "DU — de 20" (CAL-8, §11).
  - Com a D1 recomendada, `du_decorridos + du_restantes = du_total + 1` em dia útil. A tela não soma os dois.
- Uma função nova, `calendarioDoPeriodo(de, ate, hoje, cal)`, devolve esses quatro números. O Início usa a mesma.

### 1.4 Termos
| Termo | Definição |
|---|---|
| **Visita** | Linha viva de `core.visita` do usuário: `deleted_at` nulo, com `data_local` no período. |
| **Visita contada** | Par (cliente, `data_local`) com ao menos um check-in. Dois check-ins no mesmo cliente e dia contam 1 (RN-CORE-20). |
| **Check-out real** | `checkout_em` com `fechada_por = 'usuario'`. O fechamento automático da virada do dia (`nao_finalizado`, RN-CORE-11) **não** é check-out real. |
| **Dia trabalhado** | Dia com ao menos uma visita. Pode ser dia não útil (sábado num tenant de segunda a sexta). |
| **Dia encerrado** | Dia trabalhado anterior a hoje. |
| **Parada planejada** | Par (cliente, data) de `rota_parada` viva, de rota não cancelada, do usuário. |

### 1.5 Arredondamento e unidades
Todos os valores trafegam em **inteiros**. A tela só formata.

| Grandeza | Unidade guardada | Arredondamento | Exibição (designer-ux) |
|---|---|---|---|
| Dinheiro | centavos | Meta/dia: para cima (`necessidadeDiaria`). Real/dia: meio para cima | "R$ 84,6 k" acima de R$ 10 mil |
| Contagem (positivação, visitas) | inteiro | Meta/dia: **para cima**. Real/dia: meio para cima | "12" |
| Itens por pedido | centésimos (640 = 6,40) | Real: meio para cima. Meta/pedido: **para cima**, em décimos | "6,4" (1 casa) |
| % (atingimento, fora de rota, cobertura) | pontos-base (10000 = 100%) | meio para cima | "47,0%" na Performance, "47%" no Início |
| Hora do dia (1º e último check-in) | minuto do dia, 0 a 1439 | média em minutos, meio para cima | "07:52" |
| Duração (TMA, TMD, almoço, jornada) | minutos | meio para cima | "27 min", "1h34", "7h40" |
| Visitas por dia | décimos (107 = 10,7) | meio para cima | "10,7" |
| Distância (raio, km) | metros | meio para cima | "58 m", "88 km", "8,2 km" |

"Meio para cima" vale para valores positivos: `Math.round`. Toda divisão por zero devolve **nulo** ("sem dado"), nunca 0.
**Exceção (A-3):** Itens por pedido com a fonte disponível e nenhum pedido no período mostra **0**, e não "—" (§2.1).

### 1.6 Situação de cada indicador
- **Resultados:** a barra fica vermelha abaixo de 100% e azul noite com 100% ou mais, conforme o recado. Situações:
  `a_cumprir`, `batida` (realizado ≥ meta), `sem_meta` e `sem_dado` (a fonte não existe, por exemplo o Vendedor desligado).
- **Produtividade:** cada indicador tem um **sentido** fixo (§3). As situações são:
  - `dentro` (ponto verde): valor ≤ meta nos indicadores "até" e ≥ meta nos "a partir de". **Igual à meta é dentro**;
  - `fora` (ponto laranja);
  - `sem_meta`: sem ponto e sem a linha "meta …". Só acontece se a D5 for recusada;
  - `sem_dado`: "—" e sem ponto.

## 2. Resultados

### 2.1 Fórmulas (período = mês)
`real` = realizado de `de` até `min(ate, hoje)`. `meta` = meta do mês do usuário (`core.meta`).

| Indicador | Realizado (`real`) | Gap | Meta/dia | Real/dia |
|---|---|---|---|---|
| **Faturamento** (`venda_cents`) | RN-CORE-21 pelo tipo da meta: pedido aprovado na data de emissão, ou faturado na data do ERP, líquido de cancelamento e devolução. Com o Vendedor desligado e notas do ERP: RN-CORE-27. | `max(0, meta − real)` | `⌈Gap ÷ du_restantes⌉` em centavos | `round(real ÷ du_decorridos)` |
| **Positivação** | Clientes distintos positivados no mês (RN-CORE-20 ou RN-CORE-27, nunca somadas). | idem | `⌈Gap ÷ du_restantes⌉`, inteiro | `round(real ÷ du_decorridos)`, inteiro |
| **Visitas** | Visitas contadas no período (§1.4), extras incluídas (D3). | idem | `⌈Gap ÷ du_restantes⌉`, inteiro | `round(real ÷ du_decorridos)`, inteiro |
| **Itens por pedido** | `round(100 × Σ itens_distintos ÷ nº de pedidos)`, sobre os mesmos pedidos que contam na meta de pedido (RN-CORE-21: aprovado, integrado ou faturado, pela emissão). **Sem pedido no período: 0** (A-3): atingimento 0, Gap = meta, Meta/pedido = meta, `a_cumprir`. Sem a fonte (Vendedor desligado, promotor): `sem_dado`. | `max(0, meta − real)` | **Meta/pedido** (abaixo) | **Real** = o próprio `real` |

- **Atingimento** = `round(10000 × real ÷ meta)`. Pode passar de 10000. A barra para em 100% e o número não.
- **Gap = 0** (meta batida): Meta/dia e Meta/pedido ficam nulas e a tela mostra "batida", como a RN-CORE-26. Nunca aparece
  valor negativo.
- **`du_restantes = 0`** (o mês acabou ou passou do último dia útil): a Meta/dia fica nula e o Gap continua visível.
- **`du_decorridos = 0`** (1º dia útil ainda não chegou, por exemplo dia 1 num domingo): o Real/dia fica nulo.
- **Meta/pedido** é a média de itens que os próximos pedidos precisam ter para o mês fechar na meta, mantido o ritmo de pedidos:
  - pedidos restantes ≈ pedidos feitos × `du_restantes ÷ du_decorridos`;
  - daí: **Meta/pedido = meta + (meta − real) × du_decorridos ÷ du_restantes**, arredondada para cima em décimos;
  - sem pedido no período: Meta/pedido = meta;
  - conferência com a imagem: meta 8,0, real 6,4, 9 decorridos e 11 restantes dão 8 + 1,6 × 9 ÷ 11 = 9,31. Pela D1
    recomendada (12 restantes): 8 + 1,6 × 9 ÷ 12 = 9,2.

### 2.2 Exemplo conferível
Pela D1 recomendada, com DU 9 de 20 e 12 restantes, meta R$ 180.000,00 e realizado R$ 84.600,00:
- Gap = R$ 95.400,00;
- Meta/dia = ⌈9.540.000 ÷ 12⌉ = 795.000 centavos, "R$ 8,0 k";
- Real/dia = round(8.460.000 ÷ 9) = 940.000 centavos, "R$ 9,4 k";
- atingimento = 4700 pontos-base, "47,0%".

Positivação 38/70: Gap 32, Meta/dia ⌈32 ÷ 12⌉ = 3, Real/dia round(38 ÷ 9) = 4.

### 2.3 Período diferente de um mês (D7)
| Período | Meta do período | Realizado | Meta/dia · Meta/pedido |
|---|---|---|---|
| Um mês (este, passado ou escolhido) | meta do mês | §2.1 | só no mês de hoje (encerrado: nula) |
| **Hoje** | a meta do dia da RN-CORE-26: `⌈(meta do mês − realizado até ontem) ÷ du_restantes do mês⌉`, contando hoje. **Itens por pedido:** a meta do dia de itens (abaixo, A-4) | realizado de hoje | nula (a própria meta já é do dia) |
| **Esta semana** | proporcional, como a linha de baixo. **Itens por pedido:** a meta do dia de itens de hoje (A-4) | realizado no intervalo | nula |
| Ontem, um dia escolhido | **proporcional**: Σ por mês `round(meta_mês × du(P ∩ mês) ÷ du(mês))`. Itens por pedido: média das metas mensais ponderada pelos dias úteis | realizado no intervalo; positivação = clientes distintos no intervalo | nula |
| Este ano, ano escolhido | Σ das metas dos meses do período até o mês de hoje; Itens por pedido = média das metas mensais ponderada pelos pedidos de cada mês | Faturamento e visitas somados. Positivação = **soma das positivações mensais** (o cliente conta uma vez por mês, como as metas). Itens = Σ itens ÷ Σ pedidos | nula |

Mês sem meta cadastrada não soma na meta. Se nenhum mês do período tiver meta, a situação fica `sem_meta`.

**Meta do dia de Itens por pedido (A-4, confirmada pelo Alexandre em 13/11):** é a Meta/pedido da §2.1 calculada no começo do dia.
- Conta: `meta + (meta − real até ontem) × DU decorridos antes de hoje ÷ DU restantes contando hoje`, arredondada para cima em
  décimos. "Real até ontem" = itens distintos até ontem ÷ pedidos até ontem, no mês.
- Exemplo do roteiro (`docs/testes/T-0170-performance.md`, R-10): meta 8,00, até ontem 23 pedidos e 145 itens (6,30), 8 DU antes de
  hoje e 11 restantes: 800 + 170 × 8 ÷ 11 = 923,6 → **9,3** (930).
- Sem pedido até ontem: a própria meta do mês. Real até ontem ≥ meta: a própria meta do mês (manter a média).
- Hoje não é dia útil: não há meta do dia (RN-CORE-26). Em Hoje, `sem_meta`; em Esta semana, vale a média ponderada da linha de baixo.
- O servidor manda `pedidos_ate_ontem` e `itens_distintos_ate_ontem` (§7.4), como já manda a venda e a positivação até ontem.

### 2.4 Por perfil e licença
- **Vendedor:** os 4 cards.
- **Promotor:** só Visitas. Faturamento, Positivação e Itens por pedido ficam `sem_dado` e a tela não os mostra (o promotor não
  vende, RN-PRO-01).
- **Vendedor desligado no tenant:**
  - Faturamento e Positivação seguem a RN-CORE-27 (notas do ERP) quando a Integração recebe notas; sem notas, `sem_dado`;
  - Itens por pedido fica `sem_dado`.

## 3. Produtividade

### 3.1 Fórmulas
Todas as médias são **por dia trabalhado** (§1.4), salvo indicação na linha. "Hoje" segue a §3.3.

| # | Indicador (chave) | Fórmula | Sentido | Unidade |
|---|---|---|---|---|
| 1 | **1º check-in** (`primeiro_checkin`) | média, nos dias trabalhados, do minuto do dia do **primeiro** `checkin_em` | até | minuto do dia |
| 2 | **Último check-in** (`ultimo_checkin`) | média, nos dias encerrados, do minuto do dia do **último** `checkin_em` | a partir de | minuto do dia |
| 3 | **TMA**, tempo médio de atendimento (`tma`) | média de `checkout_em − checkin_em` das visitas com check-out real, exceto `cliente_fechado`. Média **por visita**, não por dia | até | minutos |
| 4 | **TMD**, tempo médio de deslocamento (`tmd`) | média dos **intervalos** entre o check-out real de uma visita e o check-in da visita seguinte no mesmo dia, sem o intervalo do almoço (§3.2). O intervalo termina no check-in, então conta mesmo que essa visita seguinte fique sem check-out (A-1). Média por intervalo | até | minutos |
| 5 | **Almoço** (`almoco`) | média, nos dias encerrados **com almoço identificado** (§3.2), da duração do almoço | até | minutos |
| 6 | **Jornada líquida** (`jornada_liquida`) | média, nos dias encerrados, de `fim − 1º check-in − almoço do dia` (almoço não identificado = 0). `fim` = o maior entre o último check-out real e o último check-in | a partir de | minutos |
| 7 | **% fora de rota** (`fora_rota`) | visitas contadas **sem** parada planejada do mesmo cliente no mesmo dia ÷ visitas contadas. O par cliente + dia é a mesma chave da RN-CORE-20, e não `rota_parada_id` | até | pontos-base |
| 8 | **Visitas por dia** (`visitas_dia`) | visitas contadas nos dias encerrados ÷ dias trabalhados encerrados | a partir de | décimos |
| 9 | **Cobertura de rota** (`cobertura_rota`) | paradas planejadas visitadas ÷ paradas planejadas consideradas, no máximo 100% (RN-CORE-20 e RN-GES-05). **Consideradas** = paradas com data anterior a hoje, mais as de hoje **já visitadas**: parada de hoje ainda não feita não é falta. **No período Hoje**, entram todas as paradas de hoje (A-2): a cobertura mostra o andamento da rota do dia, e não 100% fixo | a partir de | pontos-base |
| 10 | **Raio médio do check-in** (`raio_checkin`) | média de `distancia_m` das visitas com GPS (`sem_gps = false`) e cliente com coordenada (`distancia_m` não nulo). Média por visita | até | metros |
| 11 | **Km por dia** (`km_dia`) | Σ `metros` de `core.deslocamento_dia` ÷ dias encerrados **com resumo de km** | até | metros |
| 12 | **Km por cliente** (`km_cliente`) | Σ `metros` ÷ clientes atendidos, **só nos dias com resumo de km**. Atendido = visita contada com check-out real e resultado diferente de `cliente_fechado`. É a soma do km dividida pela soma dos clientes do período, **nunca a média das razões de cada dia** (A-5); `amostra` = clientes atendidos | até | metros |

Para a média de horários (1 e 2), a conta é a média aritmética dos minutos do dia. Não há caso de virada de meia-noite, porque
cada visita pertence à `data_local` do seu check-in.

### 3.2 Almoço: como identificar
A regra do recado é "do último check-out da manhã ao primeiro check-in da tarde". O algoritmo abaixo cobre também a visita que
atravessa o almoço. Os parâmetros novos do Core estão na §8:
- `produtividade.almoco_corte` = 12:00;
- `produtividade.almoco_janela` = 11:00 a 15:00.

Para cada dia trabalhado:
1. Ordene as visitas por `checkin_em` e monte os **intervalos**: do check-out real da visita *i* ao check-in da visita *i + 1*.
   Visita sem check-out real não abre intervalo.
2. **Caso normal:** o almoço é o intervalo que **contém o corte** (começa antes de 12:00 e termina depois). É exatamente o
   "último check-out da manhã → primeiro check-in da tarde".
3. **Visita que atravessa o almoço** (nenhum intervalo contém o corte, por exemplo check-in 11:40 e check-out 12:20): o almoço é
   o **maior intervalo que começa dentro da janela** de 11:00 a 15:00.
4. Nenhum intervalo na janela: o dia fica **sem almoço identificado**. Ele não entra na média do almoço, entra na jornada com
   almoço 0 e não tira nenhum intervalo do TMD.
5. Dia que termina antes do corte (meio expediente no sábado): o mesmo caso 4.

### 3.3 Hoje e o dia em andamento
- O dia de hoje ainda não acabou. Os indicadores "de fim de dia" usam só **dias encerrados**: último check-in, almoço, jornada
  líquida, visitas por dia e km por dia.
- Os indicadores por visita ou por evento já fechado entram com hoje: 1º check-in, TMA, TMD, % fora de rota, raio, cobertura
  (com a regra de hoje da linha 9) e km por cliente (só com resumo de hoje, §5).
- **Período "Hoje":** todos os indicadores usam só hoje, até agora, **inclusive** os de fim de dia: visitas por dia, km por dia,
  último check-in, almoço e jornada (A-2). A tela mostra os valores parciais; a jornada vai até o último check-out real ou check-in.

### 3.4 Casos de borda
| Caso | Tratamento |
|---|---|
| **Dia sem check-in** (falta, folga, feriado) | Não é dia trabalhado: fica fora de todas as médias "por dia". As paradas planejadas do dia contam na cobertura como não visitadas. O dia útil sem visita continua nos `du_*` dos Resultados. |
| **Período sem nenhuma visita** | Todos os indicadores ficam `sem_dado`. Cobertura: `sem_dado` se não houver parada; 0% se houver parada planejada. |
| **Check-in sem check-out** (visita aberta agora) | Entra em visitas, % fora de rota, raio, 1º e último check-in. Fica fora do TMA. Não abre intervalo (TMD e almoço). |
| **Fechada na virada do dia** (`nao_finalizado`, RN-CORE-11) | É visita (conta), mas o check-out automático **não** é real: fica fora do TMA e do almoço. No TMD, o intervalo que **termina** no check-in dela conta normalmente (A-1); ela não abre intervalo depois de si. A jornada termina no último check-in, se ele for depois do último check-out real. |
| **Visita que atravessa o almoço** | §3.2, caso 3. O TMA da visita é a duração inteira, sem descontar nada. |
| **Cliente fechado** (`cliente_fechado`, RN-CORE-14) | Conta como visita, no TMD e no fora de rota. Fica fora do TMA e não é "cliente atendido" no km por cliente. |
| **Cliente sem coordenada** | `distancia_m` nulo: fica fora do raio. Não há check-in fora do raio sem coordenada (RN-CORE-10 sugere a coordenada). |
| **Check-in sem GPS** (`sem_gps`) | Fica fora do raio. Os outros indicadores usam só os horários. |
| **Visita extra** (fora da rota) | Conta em visitas e no numerador do % fora de rota. Não muda a cobertura. |
| **Duas visitas no mesmo cliente e dia** | 1 visita contada (§1.4). TMA e TMD usam as duas linhas, porque são tempos reais. |
| **Dia trabalhado sem resumo de km** | Fica fora do km por dia e do km por cliente (numerador e denominador). Sem nenhum dia com resumo: `sem_dado`. |
| **Relógio do aparelho errado** | O servidor recusa check-in fora da tolerância (RN-CORE-11). A Performance confia no `checkin_em` aceito. |
| **Visita removida** (`deleted_at`) | Fora de tudo. |

## 4. De onde vem cada dado
| Dado | Origem | No aparelho | Na API |
|---|---|---|---|
| Check-in (instante, GPS, distância, extra) | `core.visita` (`checkin_em`, `checkin_lat/lng`, `distancia_m`, `sem_gps`, `extra`), push do check-in | pull `visita` (§7.2) + fila local ainda não enviada | `core.visita` |
| Check-out (instante, resultado, quem fechou) | `core.visita` (`checkout_em`, `resultado`, `fechada_por`) | idem | idem |
| Rota planejada | `core.rota` (situação) + `core.rota_parada` (cliente, data) | pull `rota`, `rota_parada` | idem |
| Coordenada do cliente | `core.cliente.latitude/longitude`, já usada no `distancia_m` do check-in | não é lida pela Performance | — |
| Faturamento e positivação | RN-CORE-21 pela consulta `vendedor.pedidos_da_meta@1`, ou RN-CORE-27 por `core.nota_erp` | cópia da última resposta de `GET /v1/core/performance` | consulta + `apuracao.ts` |
| Pedidos e itens distintos | `vendedor.pedidos_da_meta@1` + o campo novo `itens_distintos` (dono: modulo-vendedor) | cópia da resposta | consulta |
| Metas do mês | `core.meta` (+ indicador novo `itens_por_pedido`) | pull `meta` | idem |
| Metas de produtividade | `core.meta_produtividade` (nova, §6) | pull `meta_produtividade` (novo) | idem |
| Calendário | parâmetros `metas.dias_uteis_semana` e `metas.feriados` + `@macuxi/comum` | pull `parametro` | `ctx.parametros()` |
| Km | `core.deslocamento_dia` (novo, do rastreamento, §5) | pull `deslocamento_dia` + pontos locais de hoje | idem |

O Core **não lê tabela do Vendedor**. Pedidos e itens chegam só pela consulta pública, como em T-0065 B (ADR 0012 e ADR 0019:
consulta opcional, sem aresta de dependência). Sem o Vendedor instalado ou licenciado, a consulta responde "indisponível" e os
cards ficam `sem_dado`.

## 5. Km e o rastreamento de localização
O rastreamento contínuo é a T-0156 ([tracking.md](tracking.md), ADR 0061). A Performance não grava ponto: só lê
`core.deslocamento_dia` ([tracking.md §5.3](tracking.md#53-resumo-diário)).

| Coluna | Tipo | Regra |
|---|---|---|
| `usuario_id`, `data` | uuid, date | único vivo por (tenant, usuário, data) |
| `metros` | integer ≥ 0 | Σ haversine entre pontos consecutivos, descartando ponto com precisão > [50 m] e salto com velocidade implícita > [150 km/h] |
| `pontos` | integer ≥ 0 | pontos usados |
| `primeiro_ponto_em`, `ultimo_ponto_em` | timestamptz | — |
| `origem` | text | `'rastreamento'` (reservado para `'manual'` no futuro) |

- Pull com a mesma janela das visitas (§7.2) e escopo de usuário (RN-CORE-04).
- Km de hoje: pelos pontos locais com `metrosDoTrajeto` (tracking.md §3.4); quando o resumo do servidor chega, ele vence.

**Até o rastreamento existir** (ou para usuário sem termo aceito):
- Km por dia e Km por cliente ficam `sem_dado` ("—", sem ponto), com a meta visível.
- Os outros 10 indicadores não dependem do rastreamento.
- **Rejeitado:** km estimado em linha reta entre os check-ins. Ele fica abaixo do real (de 20% a 40% em área urbana), muda de
  escala quando o rastreamento entrar e induziria a uma meta errada.

## 6. Metas de produtividade no BKO

### 6.1 Modelo de dados (pedido ao banco-dados)
`core.meta_produtividade`, com os campos comuns (`id`, `tenant_id`, `created_at`, `updated_at`, `deleted_at`, `external_id`) e RLS:

| Coluna | Tipo | Regra |
|---|---|---|
| `escopo` | text | `'tenant' \| 'equipe' \| 'usuario'` (CHECK) |
| `equipe_id` | uuid null | obrigatório só em `equipe` (CHECK de coerência); FK composta para `core.equipe` |
| `usuario_id` | uuid null | obrigatório só em `usuario` (CHECK); FK composta para `core.usuario` |
| `indicador` | text | um dos 12 de `INDICADORES_PRODUTIVIDADE` (CHECK) |
| `valor` | integer | na unidade da §1.5. Faixa por indicador no domain e na API (§6.4). No banco, só `>= 0` |
| `vigencia_inicio` | text `AAAA-MM` | mês a partir do qual vale |
| `atualizado_por` | uuid null | auditoria |

- **Único vivo** por (tenant, escopo, alvo, indicador, vigência), com `coalesce` do alvo nulo no índice.
- Índice por (tenant, indicador, escopo).
- **Sem histórico apagado:** trocar a meta de um mês que já começou grava uma linha nova com a vigência do mês de hoje. O mês
  passado continua com a meta que valia.
- O sentido ("até" ou "a partir de") **não** fica no banco: é fixo por indicador, no contrato (§7.4).

### 6.2 Qual meta vale (`metaProdutividadeVigente`, domain)
Para um usuário, um indicador e o **último mês do período**:
1. a linha `usuario` do usuário;
2. a linha `equipe` da equipe dele, ou da mais próxima subindo a árvore de `core.equipe`;
3. a linha `tenant`;
4. o padrão do FDV (§6.3; D5).

Em cada nível, vale a linha de maior `vigencia_inicio` ≤ mês. A resposta leva a **origem** (`usuario`, `equipe`, `tenant` ou
`padrao_fdv`). O BKO a mostra ("herdada da equipe Norte"). O app não a mostra.

### 6.3 Padrão do FDV (D5)
São os valores das imagens. Jornada líquida não aparece na imagem: 8h00 é a proposta.

| Indicador | Padrão | Indicador | Padrão |
|---|---|---|---|
| 1º check-in | até 08:00 | % fora de rota | até 10% |
| Último check-in | a partir de 17:00 | Visitas por dia | a partir de 11,0 |
| TMA | até 30 min | Cobertura de rota | a partir de 90% |
| TMD | até 25 min | Raio médio do check-in | até 100 m |
| Almoço | até 1h30 | Km por dia | até 120 km |
| Jornada líquida | a partir de 8h00 | Km por cliente | até 12 km |

Os padrões ficam numa constante do contrato (`META_PRODUTIVIDADE_PADRAO`), não em linha no banco. O tenant novo não precisa de
seed. É a mesma regra dos parâmetros (RN-CORE-31).

### 6.4 Validações (domain `validarMetaProdutividade` + API; erro 422 `META_PRODUTIVIDADE_INVALIDA` com `detalhes.campo`)
| Indicador | Faixa aceita |
|---|---|
| 1º e último check-in | 00:00 a 23:59, em minutos de 0 a 1439 |
| TMA, TMD | de 1 a 480 min |
| Almoço | de 0 a 240 min |
| Jornada líquida | de 60 a 960 min |
| % fora de rota, cobertura | de 0% a 100% (0 a 10000) |
| Visitas por dia | de 0,1 a 100,0 (1 a 1000) |
| Raio | de 1 a 5000 m |
| Km por dia | de 1 a 2000 km |
| Km por cliente | de 0,1 a 500 km |

Mais estas regras:
- `vigencia_inicio` ≥ mês de hoje. O passado não muda, a mesma regra do plano de RV (RN-CORE-30).
- O alvo existe, está vivo e está **no escopo de quem edita** (RN-CORE-04). O usuário-alvo tem perfil vendedor ou promotor.
- Último check-in ≥ 1º check-in, conferido na **meta resolvida** do mesmo alvo. Se não fechar, o erro fica no campo
  editado.

### 6.5 Tela do BKO: Metas e RV › aba **Produtividade**
- **No topo, o seletor "Valem para":** Empresa (padrão) · Equipe ‹lista› · Usuário ‹busca›. Depois, o mês de início da vigência
  (padrão: o mês de hoje).
- **Tabela de 12 linhas**, uma por indicador, na ordem da §3.1. Colunas:
  - **Indicador**;
  - **Regra**: "até" ou "a partir de", só leitura;
  - **Meta**: o campo, com máscara por unidade (hh:mm, min, %, km, m, número com 1 casa);
  - **Vale hoje**: a meta resolvida e a origem ("Padrão do FDV", "Empresa", "Equipe Norte").
- **Campo vazio = herda.** "Voltar a herdar" apaga a linha do alvo (soft delete) e passa a valer o nível de cima.
- **Salvar** grava em lote os indicadores alterados, num `PUT` só. A tabela mostra o erro de cada campo.
- **Permissão:** ação nova `meta_produtividade.editar` para gerente (equipes abaixo), analista e admin (tenant). O assistente vê
  em leitura (`meta.ver`). Supervisor, vendedor e promotor não entram no BKO (RN-CORE-33).
- **Auditoria** `meta_produtividade.editar`, com antes e depois de cada linha.
- **Parâmetros › Calendário** (para a D4): a lista de feriados do tenant (data e nome), com os nacionais do ano mostrados em
  leitura. Mais os dois parâmetros do almoço (§3.2), na ação existente `parametro.inicio`.

## 7. Onde calcula e como sincroniza

### 7.1 Fluxo
```
Aparelho (Campo)                                                  API (core)                         Vendedor
 pull: visita, rota, rota_parada, meta, meta_produtividade,
       deslocamento_dia, parametro (calendário)
 fila local: check-ins/outs ainda não enviados ─┐
                                                 ├─► produtividadeDoPeriodo(...)   ← offline, na hora (< 100 ms com 1 mês)
 cópia de GET /v1/core/performance ─────────────┤
   (realizado de vendas, positivação, itens)    └─► resultadosDoPeriodo(...)      ← Gap, Meta/dia, Real/dia com o calendário local

 período fora da janela ──── GET /v1/core/performance?de&ate ──► mesmas funções sobre o banco ──► consulta pedidos_da_meta@1
                             (precisa de sinal; tela de carregando como em Pedidos)
```
- **Produtividade:** sempre no aparelho, quando o período cabe na janela. Assim, o check-in feito sem sinal já muda o TMA. A
  API calcula igual, para o BKO, para o período fora da janela e para o Gestor na fase 2.
- **Resultados:** o aparelho pede `GET /v1/core/performance` a cada sincronização (RN-CORE-23) e guarda a resposta de **Este
  mês** e **Mês passado**. Offline, ele usa a cópia e recalcula Meta/dia e Real/dia com o "hoje" do aparelho. Se o dia virar
  sem sinal, vale a mesma regra da RN-CORE-26: a tela mostra de quando é a base ("base de 12/11, 20:22").
- **Visitas (Resultados)** sai das visitas locais, como na Produtividade. Assim, o card anda com o check-in mesmo offline.
- **Início:** os 4 cards e os 6 indicadores chamam as mesmas funções, com o período Este mês. Não há rota nova para o Início:
  o `GET /v1/core/inicio` atual continua para a equipe e o recado do dia.

### 7.2 Janelas do pull (modulo-core, `sync.ts` + `janelas-sync.ts`)
Hoje, `visita`, `rota` e `rota_parada` vêm com `data >= hoje − 40`. Isso não cobre o **Mês passado** inteiro: em 13/11, o dia
01/10 está 43 dias atrás. A proposta:
- **Nova janela:** `data >= least(hoje − 40, início do mês anterior)`, igual para o SQL e para o predicado de poda (o
  `indicador_diario` já usa o início do mês anterior);
- **Volume:** cerca de 600 visitas e 600 paradas a mais no pior caso, por vendedor. Não pesa no aparelho de referência;
- `meta_produtividade`: todas as vivas do tenant, sem janela (são poucas, cerca de 12 por alvo);
- `deslocamento_dia`: a mesma janela das visitas.

### 7.3 Rotas da API
| Rota | Ação | Escopo |
|---|---|---|
| `GET /v1/core/performance?de&ate[&usuario_id]` | `meta.ver` | vendedor e promotor: só a si (`usuario_id` ausente ou o próprio, senão 404); supervisor e gerente: a equipe; analista, assistente e admin: o tenant (RN-CORE-04) |
| `GET /v1/core/metas-produtividade?escopo&alvo_id&vigencia` | `meta.ver` | BKO |
| `PUT /v1/core/metas-produtividade` (lote) | `meta_produtividade.editar` | BKO, idempotente por (alvo, indicador, vigência) |
| `DELETE /v1/core/metas-produtividade/:id` ("voltar a herdar") | `meta_produtividade.editar` | BKO |

Todas passam pela licença do Core (sempre ativa), pelo perfil e pela carteira. Período de no máximo 366 dias.

### 7.4 Contratos Zod (proposta para `modules/core/contracts/performance.ts`; dono: modulo-core)
```ts
import { z } from 'zod';
import { ehDataCivil } from '@macuxi/comum/calendar';

const Id = z.string().uuid();
const Data = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(ehDataCivil, 'Data inexistente. Use AAAA-MM-DD.');
const AnoMes = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);
const Inteiro = z.number().int();
const NaoNeg = Inteiro.nonnegative();

// ---- Indicadores ----
export const INDICADORES_RESULTADO = ['venda_cents', 'positivacao', 'visitas', 'itens_por_pedido'] as const;
export const INDICADORES_PRODUTIVIDADE = [
  'primeiro_checkin', 'ultimo_checkin', 'tma', 'tmd', 'almoco', 'jornada_liquida',
  'fora_rota', 'visitas_dia', 'cobertura_rota', 'raio_checkin', 'km_dia', 'km_cliente',
] as const;
export type IndicadorProdutividade = (typeof INDICADORES_PRODUTIVIDADE)[number];

export const UNIDADES_PRODUTIVIDADE = {
  primeiro_checkin: 'minuto_do_dia', ultimo_checkin: 'minuto_do_dia', tma: 'minutos', tmd: 'minutos', almoco: 'minutos',
  jornada_liquida: 'minutos', fora_rota: 'pontos_base', visitas_dia: 'decimos', cobertura_rota: 'pontos_base',
  raio_checkin: 'metros', km_dia: 'metros', km_cliente: 'metros',
} as const satisfies Record<IndicadorProdutividade, string>;

/** 'ate' = dentro quando valor ≤ meta; 'a_partir_de' = dentro quando valor ≥ meta (igual é dentro). */
export const SENTIDO_PRODUTIVIDADE = {
  primeiro_checkin: 'ate', ultimo_checkin: 'a_partir_de', tma: 'ate', tmd: 'ate', almoco: 'ate', jornada_liquida: 'a_partir_de',
  fora_rota: 'ate', visitas_dia: 'a_partir_de', cobertura_rota: 'a_partir_de', raio_checkin: 'ate', km_dia: 'ate', km_cliente: 'ate',
} as const satisfies Record<IndicadorProdutividade, 'ate' | 'a_partir_de'>;

export const FAIXA_META_PRODUTIVIDADE = {
  primeiro_checkin: [0, 1439], ultimo_checkin: [0, 1439], tma: [1, 480], tmd: [1, 480], almoco: [0, 240],
  jornada_liquida: [60, 960], fora_rota: [0, 10000], visitas_dia: [1, 1000], cobertura_rota: [0, 10000],
  raio_checkin: [1, 5000], km_dia: [1000, 2_000_000], km_cliente: [100, 500_000],
} as const satisfies Record<IndicadorProdutividade, readonly [number, number]>;

/** D5: padrão do FDV quando não há meta do usuário, da equipe nem do tenant. */
export const META_PRODUTIVIDADE_PADRAO = {
  primeiro_checkin: 480, ultimo_checkin: 1020, tma: 30, tmd: 25, almoco: 90, jornada_liquida: 480,
  fora_rota: 1000, visitas_dia: 110, cobertura_rota: 9000, raio_checkin: 100, km_dia: 120_000, km_cliente: 12_000,
} as const satisfies Record<IndicadorProdutividade, number>;

// ---- Metas de produtividade: linha do sync e do BKO ----
export const ESCOPOS_META_PRODUTIVIDADE = ['tenant', 'equipe', 'usuario'] as const;

const dentroDaFaixa = (v: { indicador: IndicadorProdutividade; valor: number }, ctx: z.RefinementCtx) => {
  const [min, max] = FAIXA_META_PRODUTIVIDADE[v.indicador];
  if (v.valor < min || v.valor > max) ctx.addIssue({ code: 'custom', path: ['valor'], message: `Meta fora da faixa aceita (${min} a ${max}).` });
};
const alvoCoerente = (v: { escopo: string; equipe_id?: string | null; usuario_id?: string | null }, ctx: z.RefinementCtx) => {
  if ((v.escopo === 'equipe') !== Boolean(v.equipe_id)) ctx.addIssue({ code: 'custom', path: ['equipe_id'], message: 'Equipe só e sempre no escopo equipe.' });
  if ((v.escopo === 'usuario') !== Boolean(v.usuario_id)) ctx.addIssue({ code: 'custom', path: ['usuario_id'], message: 'Usuário só e sempre no escopo usuário.' });
};

export const MetaProdutividadeSchema = z
  .object({
    id: Id,
    escopo: z.enum(ESCOPOS_META_PRODUTIVIDADE),
    equipe_id: Id.nullable(),
    usuario_id: Id.nullable(),
    indicador: z.enum(INDICADORES_PRODUTIVIDADE),
    valor: NaoNeg,
    vigencia_inicio: AnoMes,
    updated_at: z.string().datetime(),
    deleted_at: z.string().datetime().nullable(),
  })
  .superRefine(alvoCoerente);
export type MetaProdutividade = z.infer<typeof MetaProdutividadeSchema>;

export const MetasProdutividadePutSchema = z
  .object({
    escopo: z.enum(ESCOPOS_META_PRODUTIVIDADE),
    equipe_id: Id.nullable().default(null),
    usuario_id: Id.nullable().default(null),
    vigencia_inicio: AnoMes,
    metas: z
      .array(z.object({ indicador: z.enum(INDICADORES_PRODUTIVIDADE), valor: NaoNeg }).strict().superRefine(dentroDaFaixa))
      .min(1)
      .max(INDICADORES_PRODUTIVIDADE.length)
      .refine((l) => new Set(l.map((m) => m.indicador)).size === l.length, 'Indicador repetido.'),
  })
  .strict()
  .superRefine(alvoCoerente);
export type MetasProdutividadePut = z.infer<typeof MetasProdutividadePutSchema>;

// ---- Performance ----
export const PerformanceQuerySchema = z
  .object({ de: Data, ate: Data, usuario_id: Id.optional() })
  .strict()
  .refine((q) => q.de <= q.ate, { path: ['ate'], message: 'O fim vem antes do início.' })
  .refine((q) => Date.parse(q.ate) - Date.parse(q.de) <= 365 * 86_400_000, { path: ['ate'], message: 'Período de no máximo 366 dias.' });

export const CalendarioPeriodoSchema = z
  .object({ du_total: NaoNeg, du_decorridos: NaoNeg, du_restantes: NaoNeg, du_hoje: NaoNeg.nullable() })
  .strict();

export const SITUACOES_RESULTADO = ['a_cumprir', 'batida', 'sem_meta', 'sem_dado'] as const;
export const ResultadoIndicadorSchema = z
  .object({
    indicador: z.enum(INDICADORES_RESULTADO),
    situacao: z.enum(SITUACOES_RESULTADO),
    /** Unidades da §1.5: centavos, inteiro ou centésimos (itens). */
    meta: NaoNeg.nullable(),
    realizado: NaoNeg.nullable(),
    atingimento_pb: NaoNeg.nullable(),
    gap: NaoNeg.nullable(),
    /** Meta/dia; em itens_por_pedido, Meta/pedido em centésimos (múltiplo de 10). Nula: período encerrado, sem restantes ou batida. */
    meta_dia: NaoNeg.nullable(),
    /** Real/dia; em itens_por_pedido, nulo (o "Real" é o próprio realizado). */
    real_dia: NaoNeg.nullable(),
  })
  .strict();

export const SITUACOES_PRODUTIVIDADE = ['dentro', 'fora', 'sem_meta', 'sem_dado'] as const;
export const ORIGENS_META_PRODUTIVIDADE = ['usuario', 'equipe', 'tenant', 'padrao_fdv'] as const;
export const ProdutividadeIndicadorSchema = z
  .object({
    indicador: z.enum(INDICADORES_PRODUTIVIDADE),
    situacao: z.enum(SITUACOES_PRODUTIVIDADE),
    valor: NaoNeg.nullable(),
    meta: NaoNeg.nullable(),
    meta_origem: z.enum(ORIGENS_META_PRODUTIVIDADE).nullable(),
    /** Base da média: dias, visitas, intervalos ou, no km por cliente, clientes atendidos (A-5). O app não mostra. */
    amostra: NaoNeg,
  })
  .strict();

/** O que só o servidor sabe; o aparelho guarda e recalcula o resto (§7.1). */
export const RealizadoServidorSchema = z
  .object({
    tipo_meta_venda: z.enum(['pedido', 'faturamento']),
    /** Nulos = fonte indisponível (Vendedor desligado e sem notas, ou promotor). */
    venda_cents: NaoNeg.nullable(),
    positivacao: NaoNeg.nullable(),
    /** Positivação até ontem, para a meta do dia de "Hoje" (RN-CORE-26). */
    positivacao_ate_ontem: NaoNeg.nullable(),
    venda_ate_ontem_cents: NaoNeg.nullable(),
    pedidos: NaoNeg.nullable(),
    itens_distintos: NaoNeg.nullable(),
    /** A-4: pedidos e itens distintos do mês até ontem, para a meta do dia de Itens por pedido (Hoje e Esta semana). */
    pedidos_ate_ontem: NaoNeg.nullable(),
    itens_distintos_ate_ontem: NaoNeg.nullable(),
    /** Em período de vários meses: positivação somada por mês (§2.3). */
    por_mes: z.array(z.object({ periodo: AnoMes, venda_cents: NaoNeg.nullable(), positivacao: NaoNeg.nullable(), pedidos: NaoNeg.nullable(), itens_distintos: NaoNeg.nullable() }).strict()).max(13),
  })
  .strict();

export const PerformanceSchema = z
  .object({
    usuario_id: Id,
    de: Data,
    ate: Data,
    hoje: Data,
    /** Instante (UTC) da base do servidor; o app mostra "base de …" quando o dia virou sem sinal. */
    base_em: z.string().datetime(),
    calendario: CalendarioPeriodoSchema,
    realizado_servidor: RealizadoServidorSchema,
    resultados: z.array(ResultadoIndicadorSchema).max(INDICADORES_RESULTADO.length),
    produtividade: z.array(ProdutividadeIndicadorSchema).max(INDICADORES_PRODUTIVIDADE.length),
  })
  .strict();
export type Performance = z.infer<typeof PerformanceSchema>;

// ---- Km (T-0156) ----
export const DeslocamentoDiaSchema = z
  .object({ id: Id, usuario_id: Id, data: Data, metros: NaoNeg, pontos: NaoNeg, origem: z.enum(['rastreamento']), updated_at: z.string().datetime(), deleted_at: z.string().datetime().nullable() })
  .strict();
```

**Mudanças aditivas em contratos existentes (sem `@2`):**
- `INDICADORES_META` (Core, `contracts/sync.ts`) e o CHECK de `core.meta.indicador` ganham `itens_por_pedido` (valor em
  centésimos). O valor novo chega a quem lê `core.meta.definida@1`:
  - o Gestor lê com `tolerante` e só usa `venda_cents`. O modulo-gestor confirma por teste que ignora o valor novo;
  - o **plano de RV** monta as regras a partir de `INDICADORES_META` (`web/lib/plano-rv.ts`). O indicador novo **não** entra
    na RV sem decisão do Alexandre: o modulo-core filtra a lista do plano.
- `vendedor.pedidos_da_meta@1`: `PedidoDaMetaSchema` ganha `itens_distintos: z.number().int().nonnegative().optional()`.
  Ausente (Vendedor antigo) deixa o card `sem_dado`.
- O registro em `.coord/contratos/` (consulta e entidades de sync `meta_produtividade` e `deslocamento_dia`) é do
  engenheiro-software, na entrega do modulo-core.

### 7.5 Fase 2 (fora da v1.0.6)
- A consulta `core.performance@1` para o Gestor: a Performance do vendedor no app Gestão e no BKO, e o ranking por indicador
  de produtividade (RF-GES-03).
- O Gestor passa a ler os feriados de `core.calendario_metas@1`, e sai a lista própria em `parametros.horario_comercial`.

## 8. RN propostas (texto para o doc 03; numeração a confirmar pelo gerente)
- **RN-CORE-41 Calendário das metas.**
  - Dia útil = dia da semana útil do tenant (`metas.dias_uteis_semana`) que não é feriado nacional nem feriado do tenant
    (`metas.feriados`, cadastrado no BKO). Os nacionais contam sempre (D4).
  - Num período: decorridos = dias úteis até hoje, inclusive; restantes = de hoje, inclusive, até o fim (D1).
  - O Início ("DU n de N"), a Performance, a meta do dia (RN-CORE-26) e a RV (RN-CORE-29) usam o mesmo calendário.
  - Datas no fuso do tenant.
- **RN-CORE-42 Resultados da Performance.**
  - Para Faturamento, Positivação, Visitas e Itens por pedido: real / meta, atingimento = real ÷ meta, Gap = máx(0, meta − real),
    Meta/dia = Gap ÷ restantes e Real/dia = real ÷ decorridos. Positivação e visitas são **inteiras**, com Meta/dia arredondada
    para cima e Real/dia para o inteiro mais próximo. Dinheiro em centavos, com Meta/dia arredondada para cima.
  - Itens por pedido = produtos diferentes ÷ pedidos que contam na meta (RN-CORE-21; D2). Meta/pedido = meta + (meta − real)
    × decorridos ÷ restantes, arredondada para cima em décimos; sem pedido no período, é a própria meta, e o realizado mostra 0
    (A-3). Em Hoje e Esta semana, a meta de Itens por pedido é a meta do dia: a mesma conta com o realizado até ontem, os dias
    úteis antes de hoje e os restantes contando hoje (A-4).
  - Visitas = cliente × dia com check-in, extras incluídas (D3).
  - Meta batida: "batida", nunca valor negativo. Período encerrado: sem Meta/dia.
  - Período menor que o mês: meta proporcional aos dias úteis; Hoje usa a meta do dia (RN-CORE-26). Período de vários meses:
    soma das metas e das positivações mensais (D7).
- **RN-CORE-43 Indicadores de produtividade.** As fórmulas da §3.1, com o sentido de cada uma:
  - médias por dia trabalhado (dia com check-in); TMA e raio por visita; TMD por intervalo, do check-out real ao check-in
    seguinte, mesmo que a visita seguinte fique sem check-out (A-1); km por cliente = soma do km ÷ soma dos clientes (A-5);
  - só check-out feito pelo usuário entra em TMA, TMD, almoço e jornada. O fechamento automático (RN-CORE-11) não entra;
  - cliente fechado fica fora do TMA;
  - cliente sem coordenada ou check-in sem GPS fica fora do raio;
  - indicadores de fim de dia (último check-in, almoço, jornada líquida, visitas por dia, km por dia) só com dias encerrados,
    salvo no período Hoje, em que todos usam o dia em andamento (A-2);
  - cobertura = planejadas visitadas ÷ planejadas até ontem mais as de hoje já visitadas (RN-CORE-20 e RN-GES-05).
- **RN-CORE-44 Almoço e jornada líquida.**
  - Almoço do dia = o intervalo entre visitas (do check-out ao check-in seguinte) que contém o corte [12:00]. Se uma visita
    atravessar o corte, vale o maior intervalo que começa na janela [11:00–15:00]. Sem intervalo na janela, o dia não tem
    almoço identificado.
  - Jornada líquida = (o maior entre o último check-out e o último check-in) − 1º check-in − almoço do dia.
- **RN-CORE-45 Metas de produtividade.**
  - Cada um dos 12 indicadores tem meta por usuário, equipe ou tenant, nesta ordem de precedência (a equipe mais próxima
    subindo a árvore), com o padrão do FDV por baixo (D5).
  - Vigência por mês de início; mês que já começou não muda.
  - Faixas da §6.4.
  - Editam no BKO: gerente (equipes abaixo), analista e admin, com auditoria. O assistente lê.
  - Ponto verde = dentro da meta (igual é dentro); laranja = fora; "—" = sem dado.
- **RN-CORE-46 Km.**
  - Km do dia = soma das distâncias entre os pontos do rastreamento do expediente, sem ponto de precisão pior que [50 m] e sem
    salto acima de [150 km/h] (T-0156).
  - Km por dia = km ÷ dias com resumo; km por cliente = km ÷ clientes atendidos nesses dias.
  - Sem rastreamento ou sem termo aceito (RN-CORE-13): sem dado. Nunca há estimativa.

**Parâmetros novos (tabela do doc 03):**

| Parâmetro | Padrão |
|---|---|
| Feriados do tenant (`metas.feriados`) | nenhum (os nacionais contam sempre) |
| Corte do almoço (`produtividade.almoco_corte`) | 12:00 |
| Janela do almoço (`produtividade.almoco_janela`) | 11:00–15:00 |
| Precisão máxima do ponto para o km (`rastreamento.km_precisao_max_m`) | 50 m |
| Velocidade máxima entre pontos (`rastreamento.km_velocidade_max_kmh`) | 150 km/h |

RN-CORE-20 ganha a observação "visitado também conta visita extra na meta de visitas (RN-CORE-42)", se a D3 for aceita.

## 9. Plano por agente
Ordem com dependências. As horas são de trabalho do agente, sem a espera do CI.

| Ordem | Agente | Entrega | Horas | Depende de |
|---|---|---|---|---|
| 0 | gerente-projetos | Leva D1–D7 ao Alexandre, cria as tarefas, grava as RN 41–46 no doc 03 e marca **Travado pela nuvem** onde couber | 1,5 | — |
| 1 | banco-dados | Migração `core.meta_produtividade` (CHECKs, únicos, RLS, grants), `core.deslocamento_dia` (só tabela e RLS; quem escreve é a T-0156), `itens_por_pedido` no CHECK de `core.meta.indicador`, espelho Drizzle, tabelas SQLite do aparelho e testes de banco (CI) | 6 | D5 |
| 1 | modulo-vendedor | `itens_distintos` em `vendedor.pedidos_da_meta@1` (contagem de `produto_id` distintos vivos do pedido) + teste | 2 | — |
| 1 | designer-ux | `docs/design/performance.md`: os cards de Resultados (com "batida" e sem Meta/dia), a grade de Produtividade (12 cards, jornada líquida incluída; a imagem tem 11), os estados sem meta e sem dado, a linha "DU · restantes", os formatos da §1.5, o BKO (aba Produtividade e Calendário), tudo na marca v1 | 6 | D1, D6 |
| 2 | modulo-core | **Contratos e domain:** `contracts/performance.ts` (§7.4) e, no domain, `calendarioDoPeriodo`, `resultadosDoPeriodo`, `produtividadeDoPeriodo`, `almocoDoDia`, `metaProdutividadeVigente`, `validarMetaProdutividade` e `metrosDoTrajeto`, com testes citando RN-CORE-41..46 e cada caso de borda da §3.4 | 13 | D1–D7 |
| 3 | modulo-core | **API e sync:** `GET /v1/core/performance`, CRUD de metas de produtividade, parâmetros novos, entidades de sync `meta_produtividade` e `deslocamento_dia`, janela do mês passado (§7.2) e a lista do plano de RV sem `itens_por_pedido` | 7 | 1, 2 |
| 4 | modulo-core | **App Campo:** a aba Performance (filtro, segmentado, cards, cópia offline, carregando fora da janela) e, no Início, os 4 cards e os 6 indicadores com as mesmas funções; sai "Metas" do Mais | 10 | 3, designer |
| 4 | modulo-core | **BKO:** Metas e RV › Produtividade e Parâmetros › Calendário | 7 | 3, designer |
| 4 | engenheiro-apps | Barra de 6 abas no shell do Campo (a Performance no lugar de Metas), a rota da aba e a revisão técnica das telas | 3 | 3 |
| 4 | modulo-gestor | Teste de que `core.meta.definida@1` com `itens_por_pedido` é ignorado na projeção | 1 | 1 |
| 5 | testes | O roteiro de valor × regra de cada indicador (planilha com um mês sintético e os resultados esperados), e2e do app e do BKO, offline e virada do dia, permissões e escopo, isolamento de tenant e o período fora da janela | 8 | 4 |
| 5 | corretor-redundancias | Parecer das telas (Performance, Início e BKO) pelo print. Ponto a olhar: o Real/dia de Visitas e as Visitas por dia (com dias trabalhados = dias úteis, os dois dão quase o mesmo número em abas diferentes) | 2 | 4 |
| 5 | design-de-marca | Parecer das cores (barra vermelha ou azul noite, pontos verde e laranja) na marca v1 | 0,5 | designer |
| 6 | engenheiro-software | Registro em `.coord/contratos/`, revisão final (fronteiras, RLS, idempotência, offline) | 3 | 5 |
| — | T-0156 (nuvem) | Rastreamento: os pontos e o job que grava `core.deslocamento_dia` (§5). Sem ele, os cards de km saem "sem dado" | à parte | LGPD |

**Total:** cerca de 70 h de agentes, sem a T-0156. Com 4 frentes em paralelo na etapa 4, cabe em **3 a 4 dias de esteira**
depois das decisões. Não cabe na v1.0.5 sem atrasá-la. Na v1.0.6, os cards de km saem "sem dado" se a T-0156 não estiver no ar.

**Riscos**
1. **D1 muda os números das imagens aprovadas:** a Meta/dia de faturamento passa de R$ 8,7 k para R$ 8,0 k e a linha mostra
   "12 restantes". Se o Alexandre preferir a imagem, a troca é numa função só (`calendarioDoPeriodo`), sem retrabalho de tela.
2. **D4 muda números que já estão no ar:** a meta do dia e a RV projetada de novembro mudam (02/11 e 20/11 deixam de ser úteis).
   Avisar o Alexandre e os supervisores antes do build.
3. **D3 muda o realizado da meta "visitas"** no Início, em Metas e na RV (as extras passam a contar). A mesma observação.
4. **`itens_por_pedido` em `INDICADORES_META`:** o plano de RV e o Gestor leem essa lista. Mitigação: filtrar no plano e
   testar no Gestor (etapas 3 e 4).
5. **Janela maior no pull:** a carga inicial sobe pouco (cerca de 1.200 linhas a mais). O testes mede o tempo da 1ª sincronização
   no aparelho de referência.
6. **Km depende da T-0156 e da revisão jurídica da T-0145.** Sem elas, 2 dos 12 indicadores ficam "sem dado" por tempo
   indeterminado.
7. **Dado ruim de campo:** a visita esquecida aberta e fechada pela virada do dia distorceria o TMA e a jornada. A regra do
   check-out real (§3.4) cobre o caso; o testes inclui no roteiro.
8. **Fronteira:** o Core lê pedidos só pela consulta. Se o Vendedor estiver fora do ar, os Resultados mostram a cópia anterior
   com "base de …", e nunca zeros.

## 10. Critérios de aceite (para o testes)
1. Um mês sintético (planilha no roteiro) dá os mesmos números no app offline, na API e no BKO, para os 16 indicadores.
2. Cada caso de borda da §3.4 tem um teste no domain citando a RN.
3. Trocar de período filtra o que está na memória em < 100 ms, com um mês de visitas (cerca de 300). O período fora da janela
   vai ao servidor, com sinal.
4. Vendedor só vê a si mesmo (404 para outro `usuario_id`). Promotor vê só Visitas em Resultados. Tenant A não lê meta do
   tenant B.
5. Meta do usuário vence a da equipe, que vence a do tenant, que vence o padrão. "Voltar a herdar" volta ao nível de cima.
6. Sem resumo de km, os 2 cards de km mostram "—" e os outros 10 seguem normais.

## 11. Revisão de 13/11/2026: respostas do Alexandre e leituras do modulo-core

### 11.1 Respostas A-1 a A-5 (chat do Alexandre, 13/11; R-20261113-054601-testes e R-20261113-055707-alexandre)
| # | Pergunta do testes | Resposta | Onde mudou |
|---|---|---|---|
| A-1 | O intervalo que termina no check-in de uma visita fechada pela virada entra no TMD? | **Sim.** O TMD termina no check-in; o check-out esquecido não importa. | §3.1 linha 4, §3.4, RN-CORE-43 |
| A-2 | Em Hoje, visitas por dia, km por dia e último check-in usam o dia em andamento? | **Sim.** | §3.3, RN-CORE-43 |
| A-3 | Itens por pedido sem pedido: "—" ou 0? | **0** (`a_cumprir`, Gap = meta). Sem a fonte continua `sem_dado`. | §1.5, §2.1, RN-CORE-42 |
| A-4 | Itens por pedido em Hoje e Esta semana: meta do mês ou proporcional? | **Meta do dia**, com a conta da Meta/pedido sobre o realizado até ontem (930 no roteiro). | §2.3, §7.4, RN-CORE-42 |
| A-5 | Km por cliente: soma ÷ soma ou média das razões diárias? | **Soma do km ÷ soma dos clientes atendidos** no período; `amostra` = clientes. | §3.1 linha 12, §7.4, RN-CORE-43 |

### 11.2 CAL-8 (R-20261113-070723-testes)
Vale o código da N-A: `du_hoje` é a posição de hoje entre os dias úteis **do período** (§1.3). No mês, coincide com o "DU 9" do
Início. Em Esta semana, a tela mostra "DU 5 de 5 · 1 restante" (`textoDosDiasUteis`), que só faz sentido com a posição no
período. O testes passa a esperar 5 na CAL-8; o domain não muda.

### 11.3 Leituras do modulo-core (R-20261113-055130-modulo-core)
| # | Leitura | Parecer |
|---|---|---|
| 1 | `du_hoje` = posição no período | **Confirmada** (§11.2). |
| 2 | Em Hoje, a meta de Itens é a do mês | **Trocar:** meta do dia de itens (A-4), em Hoje e em Esta semana. |
| 3 | Período menor que o mês: Itens pela média ponderada pelos DU; sem DU, `sem_meta` | Confirmada, salvo Esta semana com hoje útil (A-4). |
| 4 | Vários meses: soma até o mês de hoje; Itens sem pedido em nenhum mês = média simples | Confirmada. |
| 5 | Itens sem pedido: realizado nulo, `a_cumprir`, Meta/pedido = meta | **Trocar:** realizado **0**, atingimento 0 e Gap = meta (A-3). |
| 6 | Real/dia em todo período; nulo em Itens | Confirmada. |
| 7 | Check-out real = `fechada_por = 'usuario'` e resultado ≠ `nao_finalizado`; a fila local grava `fechada_por: 'usuario'` | Confirmada. Fica na costura do PC (engenheiro-apps e modulo-core). |
| 8 | Almoço, caso 3, só se o dia passou do corte | Confirmada: é o caso 5 da §3.2. |
| 9 | Km só em dias trabalhados com resumo; km por cliente com hoje quando há resumo | Confirmada, com a A-5. |
| 10 | Parada de rota cancelada ou removida não é planejada; rota ausente conta como válida | Confirmada. |
| 11 | `metrosDoTrajeto`: ponto sem precisão sai; salto medido desde o último ponto aceito | Confirmada. |

**Pedido ao modulo-core (domain e contrato, sem mudar a interface pública):**
- `resultados.ts` › `realizadoDoPeriodo`: com `pedidos = 0` e a fonte disponível, realizado 0 (A-3).
- `resultados.ts` › `metaDoPeriodo`: em Hoje e em Esta semana com hoje útil, a meta de Itens é a meta do dia de itens (A-4).
- `contracts/performance.ts` › `RealizadoServidorSchema`: `pedidos_ate_ontem` e `itens_distintos_ate_ontem`, nulos quando não há
  fonte. São campos novos de um contrato que ainda não tem consumidor fora do Core, sem versão nova.
- Com isso, os 3 `it.fails` de A-3 e A-4 do testes viram `it`; o da CAL-8 vira `it` com o valor 5.

### 11.4 Números das RN
A numeração da §8 (RN-CORE-41 a 46) colide com a T-0171, a T-0172 e o desenho do Início, que já usam 41 a 43. A troca é só de
texto, nos títulos dos testes e nos comentários. O gerente define os números no doc 03 e avisa o modulo-core e o testes.

### 11.5 Revisão do código da N-A (PR #124) e da N-C (PR #120)
- **Cobertura em Hoje sempre 100% (média, modulo-core):** em `produtividade.ts`, o filtro das paradas consideradas usa
  `data < e.hoje || contadas.has(k)`. No período Hoje, só as paradas já visitadas entram, e a cobertura dá sempre 100%, com o
  ponto verde. A correção é `data < e.hoje || modoHoje || contadas.has(k)`, conforme a §3.1, linha 9.
- **Km com o 1º ponto ruim (baixa, T-0156):** em `metrosDoTrajeto`, um 1º ponto errado com boa precisão vira a referência e
  faz os pontos seguintes parecerem saltos. Fica para a T-0156, porque o km não entra na v1.0.6.
- **Costura da fila local (baixa):** o check-in ainda não enviado precisa de `data_local` no fuso do tenant e o check-out de
  `fechada_por: 'usuario'` (leitura 7).
- **N-C:** sem achado. `STATUS_ENVIADO` vai para `contracts` na costura (desenho do Início, §4.1).
