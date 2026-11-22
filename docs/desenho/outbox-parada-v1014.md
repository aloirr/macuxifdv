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

## 4. Como confirmar
Rode o workflow do §6 e leia o resultado assim:
- A hipótese do §2 se confirma com quase tudo em `integracao.lote.recebido@1`, numa só `entidade_lote`, e a `classe_erro`
  `integracao: espera da mesma entidade`. A **primeira** linha, a mais antiga e com outra `classe_erro`, é a raiz.
- Se o grosso estiver em `core.notificacao.criada@1` com a `classe_erro` `core: efeito HTTP …`, vale o §3 (configuração do FCM).
- Qualquer outro nome: a `classe_erro` diz qual consumidor falhou. Mande o resultado para o engenheiro-software.

## 5. Correção proposta
**Agora, operação:**
1. Corrigir a causa da raiz, pela `classe_erro` da primeira linha. Na fila do Hub, outra saída é cancelar o lote raiz pelo monitor
   (Cancelar lote, RN-INT-15).
2. Só depois, reprocessar os eventos parados pelo §7. Pushes antigos (§3) não valem a reentrega, e o Alexandre decide se eles ficam parados.

**No código (próxima versão, por recado a cada dono):**
- **modulo-integracao** (`aplicar-lote.ts`): a espera `mesma_entidade_em_andamento` não pode gastar tentativas sem teto. Proposta:
  o lote que espera conclui o consumo sem erro, e quem termina um lote reenvia o `integracao.lote.recebido@1` do próximo lote da
  mesma chave. Também cabe uma varredura periódica (ADR 0022) que republica o lote `recebido` que ficar sem evento vivo.
- **engenheiro-software** (plataforma): o SDK passa a ter um "adiar" do consumidor, que pede nova tentativa sem gastar tentativa,
  para espera de negócio (precisa de ADR, porque muda o contrato do consumidor). A linha de métricas do worker passa a trazer os
  parados por nome de evento (só nome e número), para o alerta já dizer qual fila parou.
- **Se for o push**: conferir os secrets `PROD_FCM_*`. Ver também se um erro de configuração (403) deve parar o evento logo, sem
  repetir 10 vezes.

## 6. Como rodar o diagnóstico
1. Actions › `producao — diagnóstico da outbox (só leitura)` › Run workflow.
2. Em "Use workflow from", escolha a **tag da versão publicada** (ex. `v1.0.17`), não o `main`.
3. Em `empresas`, o código da empresa (ex. `thathyany`).
   Para lotes, conectores, cursores, Hub e filiais, marque `contagem_integracao`.
4. Aprove o environment `PRODUCAO`.
5. No fim do resumo, em "Desligar o LOGIN", confira "NOLOGIN"; se houver erro, ali está o que rodar.

Leia o resultado pelo §4.

## 7. Reprocesso dos parados (v1.0.21; R-20261121-194900-alexandre)
> engenheiro-software, 21/11/2026 (Manaus). Workflow `producao-reprocessar-outbox.yml`. Caso da AM2808: 36 eventos
> (2 `integracao.catalogo_no.atualizado@1`, classe `catalogo: SQLSTATE 23505, catalogo_no_codigo_uk`; 34
> `integracao.produto.atualizado@1`, classe `catalogo: ReferenciaAusenteErp`), run 44958892233.

**Por que não o reprocesso de lote do BKO.** `criarRotaReprocessarLote` (`modules/integracao/api/bko-lotes-acoes.ts`) reabre um
**lote** (`integracao.lote` volta a `recebido` e o `integracao.lote.recebido@1` sai de novo). Os 36 não são lotes: são eventos de
consumidor (Catálogo) que o Hub já publicou. Reaplicar o lote não os reentrega: a rota só aceita lote Com falha ou Concluído com
avisos, e as linhas iguais ao Hub viram "inalteradas", sem evento novo. O caminho que de fato reaplica um evento parado é o
**despachante** (`apps/api/src/despachante.ts`, `entregar`): os mesmos consumidores, a mesma licença do tenant e a mesma
idempotência por `plataforma.evento_consumo` (o Core, que já consumiu o produto, não repete). Por isso o reprocesso é
`Despachante.reprocessarParados`, que chama esse `entregar`. Nenhum caminho de outro dono mudou.

**Senha do autorizador → aprovação do Alexandre.** No BKO, quem não tem `lote.reprocessar` informa a senha de um autorizador
(RN-INT-16). No workflow não há usuário do BKO: o job roda no environment `PRODUCAO` e só começa com a aprovação do Alexandre.
O registro é o próprio run (quem disparou, quem aprovou, SHA e saída).

**Como roda.** CLI `apps/api/src/cli/reprocessar-outbox.ts` num contêiner descartável do serviço `worker` (mesma imagem e mesmo
ambiente do despachante no ar: `macuxi_worker` + `macuxi_app`, nunca o admin), pela mesma chave SSH do
`producao-diagnostico-outbox.yml`. Nenhum segredo novo e nenhum SQL à mão.
- `confirmar=false` (padrão): só a lista dos parados da empresa (contagem por evento e classe do erro), sem payload e sem
  gravar nada.
- `confirmar=true`: cada parado é tentado **uma vez**, do mais antigo para o mais novo (os 2 nós antes dos 34 produtos).
  Publicou: sai da outbox. Falhou: `tentativas` vai de 10 para 11, `ultimo_erro` é gravado e o log mostra a classe nova.
- Teto de 100 eventos por empresa, contado antes de ler qualquer payload: acima disso nada muda (saída 5).

**Idempotência.** A lista pega só `publicado_em` nulo e `tentativas >= 10` daquela empresa; entram os de `tentativas = 10`.
Com `confirmar=true`, cada evento roda na **própria transação**: trava a linha com `for no key update skip locked` só se ela
ainda estiver parada (`tentativas = 10`, sem `publicado_em`), entrega e grava o resultado no mesmo commit. Se a rodada cair no
meio, os já confirmados ficam publicados ou com `tentativas = 11`, e só os restantes entram numa nova rodada. Depois da
tentativa, nenhuma rodada seguinte seleciona o evento (aparece como "já reprocessados antes e parados de novo"), e o despachante
também não, porque ele só pega `< 10`. O alerta OUTBOX_PARADA continua contando o evento (`>= 10`). O `concurrency: producao-vm`
impede duas rodadas juntas, e a trava por evento impede a mesma tentativa duas vezes.

**Log.** Só contagens, ids técnicos, nomes de evento e classes de erro (a mesma classe do diagnóstico, `classeDoErro`). Nunca o
payload nem a mensagem. O log técnico do despachante sai sem o campo `erro`.

**Antes de rodar na AM2808.** A causa dos 2 nós (mesmo código sob pais diferentes) sai com a migração 0092 (código único entre
irmãos, `catalogo_no_pai_codigo_uk`, RN-CAT-18), já no `main`. Rode o reprocesso **depois** do deploy da v1.0.21; antes dele o
workflow para com a saída 9 (a imagem no ar não tem a CLI). Sequência: `confirmar=false`, conferir 36 e as duas classes, depois
`confirmar=true`. Sem a 0092 no banco, os 2 nós param de novo e os 34 produtos também (uma tentativa só).
