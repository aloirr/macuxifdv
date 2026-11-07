
## T-0089 — pagamento e crédito do cliente
- `core.financeiro_cliente@1` (API e aparelho, offline): `{cliente_id}` → `financeiro` (limite, saldo, `credito_disponivel_erp_cents`, bloqueio, `vencidos_qtd`, `vencidos_cents`, `maior_atraso_dias`, `atualizado_erp_em`) ou `null`. Domain: `domain/pagamento-cliente.ts` (RN-VEN-12/13/25).
- Cliente ganha `prazo_medio_max_dias` e `formas_pagamento` (códigos): pull, `core.cadastro_resumo@1`, consumidor do Hub (ausente = não altera; `null`/`[]` = limpa) e BKO (`PUT /v1/core/clientes/:id/pagamento`, ação `cliente.pagamento_editar`, analista e admin).
