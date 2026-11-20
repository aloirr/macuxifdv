# OUTBOX_PARADA desde a v1.0.14: causa provável e o que fazer

> Para o Alexandre. engenheiro-software, 19/11/2026 (Manaus). Feito só pelo código e pelo `git log`, sem acesso à produção.
> **Nada se reprocessa sem o sim do Alexandre.**

## 1. O que o alerta diz
- O `OUTBOX_PARADA` acende quando há evento com `publicado_em` nulo e `tentativas >= 10` (`apps/api/src/observabilidade.ts`, `SQL_RESUMO_OUTBOX`).
- Quem chega a 10 é o despachante (`apps/api/src/despachante.ts`). Cada falha de um consumidor soma 1 tentativa e grava o motivo em
  `plataforma.evento.ultimo_erro`. A espera entre as tentativas cresce (5 s, 10 s, 20 s… até 15 min). Na 10ª, uns 36 min depois da
  1ª, o evento para e o despachante não o pega mais.
- Só para evento que tem consumidor instalado. Os outros ficam com `tentativas = 0` e não entram na conta.
- Os 36 eventos, portanto, falharam 10 vezes seguidas num consumidor. O motivo de cada um está no `ultimo_erro`.

## 2. Causa provável (certeza média)
**Fila de lotes do Hub travada: eventos `integracao.lote.recebido@1` parando em cadeia.**

- O consumidor `aplicarLote` (`modules/integracao/api/aplicar-lote.ts:84-113`) usa a outbox como fila. Lote que precisa esperar
  **lança erro** para a outbox tentar de novo. São dois motivos de espera (`ordenarFilaAplicacao`,
  `modules/integracao/domain/aplicacao.ts:42-72`):
  - `dependencia`: a outra entidade ainda está aberta. Tem teto de 30 min (`esperaMaxDependenciaMin`) e por isso cabe nas 10 tentativas.
  - `mesma_entidade_em_andamento`: há um lote anterior do mesmo Conector e da mesma entidade ainda `recebido`. **Não tem teto.**
- Quando o evento de um lote para (10 falhas por qualquer motivo), o lote fica `recebido` para sempre. A partir daí, todo lote
  novo do mesmo Conector e da mesma entidade espera por ele, falha 10 vezes em uns 36 min e também para. Com o Conector mandando
  delta a cada ciclo, chega-se rápido a dezenas de eventos. **Uma falha na raiz vira N eventos parados.**
- Por que desde a v1.0.14: o código da fila é anterior, mas foi a v1.0.14 que pôs o Hub no ar com o monitor e o ciclo do ERP (#476),
  o reprocessar e o cancelar lote (#396, #448, migração 0087). A falha na raiz não aparece no código: está no `ultimo_erro` do
  **primeiro** evento parado. Os candidatos são uma consulta do Core no lote (`core.filiais@1`, `core.medidas@1`,
  `core.cadastro_cliente@1`) ou o conteúdo do staging.
- O grau de certeza é médio porque o mecanismo é certo e explica o número, mas eu não vi os dados. O workflow do §6, lido como
  no §4, confirma ou derruba esta hipótese em um minuto.

## 3. Outras hipóteses (certeza baixa)
- **Push (`core.notificacao.criada@1`)**: se o push pelo FCM foi ligado nesse deploy (`push.env` com `MACUXI_PUSH_ATIVO=1`), um 403
  ou 401 de configuração, ou uma falha de rede, faz o efeito depois do commit lançar erro, e o evento volta até parar
  (`modules/core/api/push.ts:174-181`). Sinal na consulta: `classe_erro` `core: efeito HTTP 403` (ou 401).
- **Payload que o consumidor não aceita**: quando o `schema.parse` falha no despachante, a falha é a mesma nas 10 tentativas.
  Sinal: `ultimo_erro` com `ZodError: dados inválidos` depois do módulo (`classe_erro` `<módulo>: ZodError`).

## 4. Como confirmar (só leitura; o Alexandre roda)
Rode o workflow do §6.

Como ler o resultado:
- A hipótese do §2 se confirma com quase tudo em `integracao.lote.recebido@1`, numa só `entidade_lote`, e a `classe_erro`
  `integracao: espera da mesma entidade`. A **primeira** linha, a mais antiga e com outra `classe_erro`, é a raiz.
- Se o grosso estiver em `core.notificacao.criada@1` com a `classe_erro` `core: efeito HTTP …`, vale o §3 (configuração do FCM).
- Qualquer outro nome: a `classe_erro` diz qual consumidor falhou. Mande o resultado para o engenheiro-software, que encaminha ao dono.

## 5. Correção proposta
**Agora, operação:**
1. Corrigir a causa da raiz, pela `classe_erro` da primeira linha. Na fila do Hub, outra saída é cancelar o lote raiz pelo monitor
   (Cancelar lote, RN-INT-15).
2. Só depois, voltar os eventos parados a zero tentativas, **começando pelo mais antigo** (o despachante segue a ordem de
   `ocorrido_em`). Pushes antigos (§3) não valem a reentrega, e o Alexandre decide se eles ficam parados.

**No código (próxima versão, por recado a cada dono):**
- **modulo-integracao** (`aplicar-lote.ts`): a espera `mesma_entidade_em_andamento` não pode gastar tentativas sem teto. Proposta:
  o lote que espera conclui o consumo sem erro, e quem termina um lote reenvia o `integracao.lote.recebido@1` do próximo lote da
  mesma chave. Também cabe uma varredura periódica (ADR 0022) que republica o lote `recebido` que ficar sem evento vivo.
- **engenheiro-software** (plataforma): o SDK passa a ter um "adiar" do consumidor, que pede nova tentativa sem gastar tentativa,
  para espera de negócio (precisa de ADR, porque muda o contrato do consumidor). A linha de métricas do worker passa a trazer os
  parados por nome de evento (só nome e número), para o alerta já dizer qual fila parou.
- **Se for o push**: conferir os secrets `PROD_FCM_*`. Ver também se um erro de configuração (403) deve parar o evento logo, sem
  repetir 10 vezes.

## 6. Diagnóstico pelo GitHub (workflow só leitura)
O que já existe não basta: o `/v1/saude` e a linha `tipo: metricas` do worker só dão os totais (`pendentes`, `parados`,
`mais_antigo_s`), sem o nome do evento nem o `ultimo_erro`. Por isso há o workflow
**`producao — diagnóstico da outbox (só leitura)`** (`.github/workflows/producao-diagnostico-outbox.yml`). Ele é manual, roda no
environment `PRODUCAO` (com a sua aprovação) e só lê.

**O que você faz** (sem secret): depois do merge, Actions › `producao — diagnóstico da outbox (só leitura)` › Run workflow, com
`thathyany`, e aprove o environment `PRODUCAO`. No fim do resumo, confira "NOLOGIN" em "Desligar o LOGIN"; se ali houver
erro, está escrito o que rodar.

**O que o log e o resumo mostram, por empresa:**
- o resumo, com os parados (10 tentativas ou mais), os que estão em nova tentativa (1 a 9) e o horário do primeiro parado;
- os parados agrupados por nome do evento, entidade e status do lote, classe do erro (`classe_erro`: módulo e rótulo
  fixo, código ou nome do erro, sem o texto da mensagem), quantidade, tentativas mínimas e máximas e o primeiro e o último
  horário em Manaus;
- a fila de lotes do Hub em `recebido` ou `processando`, com entidade, status, quantidade, conectores e horários em Manaus.

Nunca aparecem o payload, o id do evento, o `tenant_id`, e-mail, CPF, nome ou coordenada.
