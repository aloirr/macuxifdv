# ADR 0022 — Tarefas periódicas dos módulos no worker

- **Situação:** proposta (2026-11-05, engenheiro-software, T-0039)
- **Relacionadas:** ADR 0007 (outbox e despachante), ADR 0012 (consultas), RN-CORE-02/03 (licença), RN-CORE-23 (nenhum timer abaixo de 15 min)

## Contexto
A T-0039 §2.3 passo 3 precisa de um alerta de etapa pendente do checkout "de hora em hora, por tenant"
(`alertarPendenciasVencidas` em `modules/core/api/etapas-pendencia.ts`). A plataforma só tinha dois gatilhos: rota HTTP e
evento da outbox (despachante). Não havia como um módulo declarar trabalho periódico, e cada módulo inventar o seu timer
quebraria a licença por tenant, o RLS e o limite de 15 min.

## Decisão
1. `ModuloApi.tarefas?: TarefaPeriodica[]` no platform-sdk, com `definirTarefa({ nome, cadaMin, executar(ctx) })`.
   `cadaMin` é múltiplo de `INTERVALO_MINIMO_TAREFA_MIN = 15` (validado em `definirTarefa` e em `definirModuloApi`).
   `ctx` (`ContextoTarefa`) = `tenantId`, `db` (transação do tenant, macuxi_app, RLS), `publicar`, `consultar` (usuário de
   sistema, ADR 0012), `parametros()` do módulo, `fuso()`, `agora()`, `log`. Mesmo formato do `ContextoConsumo` sem envelope.
   O resultado são contagens (`{ alertadas: 2 }`); só os números vão ao log.
2. O agendador (`apps/api/src/agendador.ts`) roda no processo do despachante (`worker.ts`). Acorda a cada 15 min fixos
   (subida incluída); cada tarefa volta quando passou o seu `cadaMin`. Para cada tenant ativo
   (`plataforma.tenants_ativos()`, função SECURITY DEFINER só para o `macuxi_worker`, que devolve só ids) lê licenças,
   parâmetros e fuso uma vez e roda as tarefas dos módulos **efetivos** no tenant, cada (tarefa, tenant) na sua transação
   `comTenant`, com `pg_try_advisory_xact_lock` (outro processo com a mesma tarefa e tenant pula).
3. A tarefa **tem de ser idempotente**: reinício do worker roda de novo; falha desfaz só aquele tenant, vai ao log e volta
   no período seguinte (sem retentativa rápida). Sem a função no banco ou sem tarefa instalada, o agendador não liga.

## Alternativas
- **pg-boss com `schedule`** — cron persistido e uma execução por cluster; é dependência nova e mais uma tabela/papel para
  pouca coisa hoje. Fica como evolução se houver tarefa que não pode rodar duas vezes.
- **Cron do sistema / job do Compose** chamando uma rota interna — mais uma peça de implantação, e a rota precisaria de
  autenticação de máquina e de iterar tenants fora do worker.
- **Timer por módulo** — cada um repetiria licença, RLS, log e o limite de 15 min.

## Consequências
- Um módulo agenda trabalho com uma linha no `definirModuloApi`; o Core registra `alerta_pendencia_checkout` (60 min).
- Precisão = período + até 15 min. Nada abaixo de 15 min (RN-CORE-23).
- Vários workers: a trava evita execução simultânea, não a repetição em momentos diferentes (por isso a idempotência).
- Pedido ao banco-dados: `plataforma.tenants_ativos()` (status `ativo`, `deleted_at is null`), `grant execute` só ao
  `macuxi_worker`, com teste.
