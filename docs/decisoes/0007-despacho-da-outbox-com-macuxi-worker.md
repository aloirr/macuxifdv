# ADR 0007 — Despacho da outbox entre tenants com o papel `macuxi_worker`

- **Status**: aceita (implementação do despachante quando entrar o primeiro consumidor real)
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
