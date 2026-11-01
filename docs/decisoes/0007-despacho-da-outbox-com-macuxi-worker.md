# ADR 0007 — Despacho da outbox entre tenants com o papel `macuxi_worker`

- **Status**: aceita · implementada na T-0022 (2026-10-31; ver "Implementação (T-0022)", que substitui o item 5)
- **Data**: 2026-10-31
- **Tarefa**: T-0004 (pendência 1 da T-0002 §6) · proposta original: [desenho T-0002 §5](../desenho/T-0002.md)
- **Autor**: engenheiro-software · concordância do banco-dados: R-20261031-093034

## Contexto
Os eventos são gravados em `plataforma.evento` na transação do fato (ADR 0006, `tx.publicar`). A tabela tem `FORCE ROW LEVEL
SECURITY` com política só para `macuxi_app` e `tenant_id = tenant_atual()`. O despachante precisa ler os pendentes de **todos**
os tenants, em ordem, com vários workers sem duplicar, sem abrir acesso aos dados de negócio.

## Decisão
1. **Papel `macuxi_worker`** (NOLOGIN na migração; LOGIN e senha pelo executor, como o `macuxi_app`), **sem `BYPASSRLS`**, com
   políticas próprias em `plataforma.evento` (`select` de todos os tenants; `update` só de `publicado_em`, `tentativas`,
   `ultimo_erro`) e nenhum grant em `core.*`, nos schemas dos módulos ou nas outras tabelas da plataforma.
2. O despachante lê lotes com `for update skip locked`, entrega cada envelope aos consumidores (fila pg-boss por consumidor,
   `singletonKey = evento_id:consumidor`) e marca `publicado_em`; falha incrementa `tentativas`/`ultimo_erro`.
3. O **handler** do consumidor nunca usa o papel do worker: abre `comTenant(poolApp, envelope.tenant_id, …)` com `macuxi_app`;
   consumo idempotente por `(consumidor, evento_id)` numa tabela `plataforma.evento_consumo` (RLS por tenant).
4. Envelope completo no banco: `plataforma.evento` ganha `usuario_id` e `request_id` (rastreio ponta a ponta; sem dado pessoal).
5. **pg-boss** (schema `pgboss` criado pelo migrador, `migrate: false` no runtime) entra junto do primeiro consumidor real; até
   lá a outbox acumula e nada é perdido. Dependência nova registrada aqui.

## Alternativas consideradas
- `macuxi_worker` **com `BYPASSRLS`**: o atributo vale para todas as tabelas; a restrição dependeria só de grants.
- Funções `SECURITY DEFINER` chamadas pelo `macuxi_app`: rodariam como o dono e dariam ao papel da API leitura dos eventos de
  todos os tenants. Fica como plano B se a nuvem gerenciada não permitir criar papel.
- Worker iterando tenant a tenant com `comTenant`: zero privilégio novo, mas N consultas por ciclo e sem `skip locked` global.

## Consequências
- Pedido ao banco-dados (migração 0003): papel, políticas, `evento_consumo`, colunas `usuario_id`/`request_id`, testes
  (worker lê A e B; não lê `core.*` nem `plataforma.usuario_modulo` → 42501; só atualiza as 3 colunas; não tem `BYPASSRLS`;
  `macuxi_app` sem contexto continua com 0 linhas).
- O processo do worker tem dois pools (`macuxi_worker` para outbox e pg-boss; `macuxi_app` para os handlers).
- Os módulos assinam eventos em `moduloApi` quando o despachante existir (extensão do contrato da ADR 0006, sem quebra).

## Implementação (T-0022, 2026-10-31)
Código: `apps/api/src/despachante.ts` (despachante), `apps/api/src/worker.ts` (processo), contrato `ConsumidorEvento` /
`ModuloApi.consumidores` em `packages/platform-sdk/src/api.ts`; teste com Postgres e dois tenants em
`apps/api/test/despachante.banco.test.ts`.

1. **Sem pg-boss (substitui o item 5)**. A própria outbox é a fila: lote em ordem `(ocorrido_em, id)` com `for no key update skip locked`
   (vários processos sem duplicar), todos os consumidores do evento numa passada, retentativa por evento. A idempotência por
   `(consumidor, evento_id)` em `plataforma.evento_consumo` permite repetir o evento inteiro: quem já consumiu não roda de novo.
   Ganho: nenhuma dependência nova, nenhum schema `pgboss`, nada para o migrador. pg-boss volta a ser opção (ADR nova) se
   precisarmos de fila por consumidor com prioridade/agendamento ou de volume que a varredura da outbox não aguente.
2. **Consumidores declarados na API do módulo**: `definirModuloApi({ consumidores: [definirConsumidor({ evento, executar })] })`;
   a validação exige o evento em `consome` do manifesto e um consumidor por evento e módulo. Nome do consumidor em
   `evento_consumo` = id do módulo.
3. **Licença**: só recebe o módulo ativo no tenant (`plataforma.tenant_modulo` lida com `macuxi_app` em `comTenant`, mais as
   dependências do manifesto, RN-CORE-02/03; core sempre ativo). Evento sem consumidor ativo no tenant é marcado publicado (o módulo
   ligado depois não recebe o passado). Evento cujo nome não tem consumidor instalado **fica pendente** (não é marcado): um consumidor
   novo recebe o histórico.
4. **Handler**: `comTenant(tenant do envelope)` com `macuxi_app`; na MESMA transação, `insert into plataforma.evento_consumo … on
   conflict do nothing` e o efeito; se o handler lança, os dois desfazem. `ctx.publicar` publica evento do módulo consumidor na
   mesma transação, com o `request_id` do original. Efeito fora do banco (push HTTP) é "no mínimo uma vez".
5. **Retentativa**: falha → `tentativas + 1` e `ultimo_erro` (`<modulo>: <erro>`, até 500 caracteres, sem payload); espera
   5 s, 10 s, 20 s… até 15 min; com 10 tentativas o evento para (fica pendente; para reprocessar o administrador zera
   `tentativas`). O evento em espera sai do lote e os outros, de qualquer tenant, seguem. A ordem entre eventos não é garantida
   quando há retentativa (o consumidor usa `ocorrido_em`). A espera fica na memória do processo: reiniciar tenta de novo uma vez
   e dois processos não compartilham a espera. Se isso incomodar (vários workers), coluna `proxima_tentativa_em` com grant ao
   worker (pedido ao banco-dados).
6. **Processo separado da API** (decisão): `pnpm --filter api worker` (ou `dev:worker` com recarga). Motivos: a API escala por
   requisição e o despachante por fila; o papel `macuxi_worker` não entra no processo que atende a internet; parar a API não para a
   entrega. Falha fechada na subida: o pool do worker tem de ser `macuxi_worker` sem SUPERUSER/BYPASSRLS e o pool dos handlers
   `macuxi_app` (`verificarPapelWorker`, `BancoApp.verificar`). Log em JSON com `pino` (já era o logger do Fastify; agora
   dependência direta da API) com `tenant_id`, `modulo`, `evento`, `evento_id`, `request_id`.

### Como rodar localmente
```
pnpm --filter @macuxi/db banco:subir      # Postgres do db/docker-compose.yml (se ainda não estiver de pé)
pnpm --filter @macuxi/db migrar           # migrações (inclui a 0003 com macuxi_worker)
pnpm --filter api dev                     # API (outro terminal)
pnpm --filter api dev:worker              # despachante (outro terminal)
```
Variáveis (`.env`): `MACUXI_PG_WORKER_SENHA` (fora do local é obrigatória; no local vale a padrão), `MACUXI_PG_APP_SENHA`,
`MACUXI_DESPACHANTE_INTERVALO_MS` (1000), `MACUXI_DESPACHANTE_LOTE` (20), `MACUXI_DESPACHANTE_POOL` (4), `MACUXI_API_LOG` e as
dos handlers (ex.: `MACUXI_PUSH_ATIVO=1` para o push do Core). Eventos parados: `select id, nome, tentativas, ultimo_erro from
plataforma.evento where publicado_em is null and tentativas >= 10` como administrador.
