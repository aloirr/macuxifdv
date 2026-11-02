# ADR 0018 — Modelo de sincronização do app: Sincronizar, fila automática, push e novidades

- **Status**: aceita (2026-11-02, decisão do Alexandre no R-20261102-121135 e no R-20261102-124413; build de preview das 22h)
- **Data**: 2026-11-02
- **Tarefa**: T-0065 (A) — RN-CORE-23 (docs/produto/03, seção 3)
- **Autor**: engenheiro-software (motor, API, CI) com o engenheiro-apps (shell) e o modulo-core (push)
- **Base**: ADR 0006/0009 (cursor `(updated_at, id)`, horizonte seguro, `versao_escopo`), ADR 0017 (segundo plano e
  retomada da carga), RF-CORE-09 (central de notificações)

## Contexto
As telas faziam consulta periódica curta (pedido a cada 10 s, Gestão a cada 60 s, BKO a cada 10–60 s) e a atualização
automática do shell rodava a sincronização completa: uma requisição por entidade (≈20) a cada disparo. Com 10.000 aparelhos
isso é carga sem retorno, e mesmo assim o vendedor esperava até um minuto para ver o pedido aprovado. O Alexandre fixou a
RN-CORE-23: Sincronizar manual, fila que sobe sozinha, push quando algo muda e uma atualização leve que começa com **uma**
consulta de novidades.

## Decisão
1. **Quatro caminhos, um motor** (`packages/platform-sdk/src/motor-sync.ts`):
   - **Sincronizar** (botão, puxar para baixo, tela de carga): `motor.sincronizar()` — envia a fila, puxa todas as entidades
     dos módulos efetivos pelo cursor de cada uma, roda as etapas extras e grava um **cursor-base de novidades**;
   - **Fila automática**: `motor.enviar()` com espera crescente (15 s a 5 min) só com item pendente; não consulta novidades;
   - **Atualização leve** (abrir o app, voltar depois de 30 min, a cada `sync_auto_min`): `motor.sincronizarNovidades()`;
   - **Push** (silencioso ou visível) com `data.entidades`: `motor.sincronizarNovidades({ entidades })` — puxa só essas.
   As duas sincronizações dividem a mesma promessa (uma por vez), como na ADR 0017.
2. **`GET /v1/sync/novidades?desde=<cursor>`** (`apps/api/src/sync.ts`; contrato `NovidadesRespostaSchema` no SDK):
   - resposta `{ entidades, cursor, horizonte, modulos_mudaram, modulos? }`;
   - entidades elegíveis = as que o pull serviria ao usuário: módulo efetivo, provedor com `puxar`, regra do promotor
     (RN-PRO-01/O-3). Cada provedor é consultado com `limite: 1` e `desde = (horizonte do cursor, UUID nulo)`: o filtro de
     escopo (RN-CORE-04) é o do próprio provedor, sem SQL novo nos módulos;
   - cursor opaco `n1|<horizonte>|<versao_licencas>|<versao_escopo>`. Licença ou parâmetros mudados = `modulos_mudaram`, a
     lista de `/v1/me/modulos` na própria resposta (o app aplica sem outra requisição) e todas as entidades; carteira/equipe
     mudada = todas as entidades (o pull de cada uma decide a ressincronização pela `versao_escopo`, ADR 0009 §4); cursor
     ausente, de outra versão ou ilegível = todas (nunca 400);
   - o horizonte é o mesmo do pull (ADR 0006) e só cresce; por isso nenhuma linha confirmada fica para trás.
3. **Cursor no aparelho** (`sync:novidades`): gravado **só depois** de puxar todas as entidades apontadas (pull que falha
   repete a mesma lista na próxima). A completa grava o cursor-base lido **antes** dos pulls; retomada de carga com entidades
   puladas não grava (elas foram puxadas antes daquele horizonte). Sem `transporte.novidades` (servidor antigo, modo
   demonstração) ou antes da primeira completa, a leve vira a completa. Custo: **sem mudança = 1 requisição; 1 entidade
   mudada = 2** (teste `motor-sync.novidades.test.ts` nos 3 armazenamentos; rota em `apps/api/test/sync.test.ts`).
4. **Etapas extras** (REST da Fase M, ex.: metas do Core) só rodam na completa; quem precisa de atualização leve migra para
   entidade de sync.
5. **`core.sync_auto_min`**: parâmetro do tenant em `plataforma.parametro`, sempre presente em `/v1/me/modulos` e nas
   novidades, padrão 30, mínimo 15, teto 1440 (`syncAutoMinEfetivo` no SDK; `intervaloSyncAutoMs` no `@macuxi/ui`).
6. **Push**: `data.entidades` (lista de nomes de sync, só do destinatário), `data.link` (rota interna do app ou `null`);
   silencioso = sem título e sem corpo, prioridade alta. Nada de dado pessoal em `data`. O servidor dispara nos eventos da
   RN-CORE-23 item 3 (modulo-core, `modules/core/api/push.ts`).
7. **Sem timer curto**: nenhum `setInterval`/`refetchInterval` abaixo de 15 min no app e no BKO. Passo do CI
   `timers de sincronização` (`scripts/ci/timers-sync.mjs`, `pnpm timers`); exceção legítima (relógio de tela, frases da
   carga) leva `timer-permitido: <motivo>`. `setTimeout` fica fora da varredura (debounce, animação, agendador calculado e
   reenvio da fila) e é revisado na mão.
8. **ADR 0017 retomada**: a retomada da carga e a tarefa em segundo plano continuam; a tarefa `macuxi-sync-delta` passa a
   chamar `sincronizarNovidades()` (a completa só sem cursor), com o mesmo lease de 2 min.

## Alternativas consideradas
- **WebSocket/SSE com o app aberto**: tempo real, mas conexão por aparelho (10.000 abertas) e nada com o app fechado;
  o push resolve os dois. Rejeitada para a v1.
- **Uma tabela `plataforma.mudanca` (log de mudanças por usuário)**: consulta de novidades numa linha só, mas exige gatilho
  em toda tabela sincronizada e fan-out por carteira. Fica como otimização se o teste de carga (p95 < 300 ms com 10.000
  aparelhos, depois da demo) reprovar a consulta por provedor.
- **Manter a completa periódica com intervalo maior**: simples, mas ≈20 requisições por disparo e sem aviso imediato.

## Consequências
- Rota nova na API; método opcional `novidades` no `TransporteSync` (o `transporteV1` do shell implementa).
- A consulta de novidades abre uma transação por provedor elegível (≈20 consultas com `limit 1` sobre o índice
  `(tenant_id, updated_at, id)`). Medir no teste de carga; se precisar, provedores ganham um `mudou?()` próprio ou a tabela
  de mudanças acima.
- Linhas gravadas entre a consulta de novidades e o pull podem ser apontadas de novo na leve seguinte (uma requisição a mais,
  nunca uma a menos).
- Telas deixam de ter polling próprio; dependem do estado do motor.
