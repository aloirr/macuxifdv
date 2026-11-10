
## T-0089 — pagamento e crédito do cliente
- `core.financeiro_cliente@1` (API e aparelho, offline): `{cliente_id}` → `financeiro` (limite, saldo, `credito_disponivel_erp_cents`, bloqueio, `vencidos_qtd`, `vencidos_cents`, `maior_atraso_dias`, `atualizado_erp_em`) ou `null`. Domain: `domain/pagamento-cliente.ts` (RN-VEN-12/13/25).
- Cliente ganha `prazo_medio_max_dias` e `formas_pagamento` (códigos): pull, `core.cadastro_resumo@1`, consumidor do Hub (ausente = não altera; `null`/`[]` = limpa) e BKO (`PUT /v1/core/clientes/:id/pagamento`, ação `cliente.pagamento_editar`, analista e admin).

## T-0151 — preço de venda e desconto máximo no pull do produto
- `ProdutoSyncSchema` ganha `preco_venda_cents` (nulo = sem preço) e `desconto_maximo_pct` (EFETIVO: do produto, senão o parâmetro `desconto_maximo_produto_pct` do tenant, senão 15), ambos opcionais e aditivos. Mudou o padrão do tenant: `PUT produtos/parametros` toca o `updated_at` dos produtos sem desconto próprio para o aparelho repuxar.

## T-0146 — RN-CORE-40 (indicadores de compra da ficha)
- `domain/cliente360.ts`: `mesNaJanela12`, `compraMediaMesCents` (total da janela de 12 meses ÷ 12, sempre), `semComprasNaJanela` e `resumoSemCompras`. Sem compra na janela, a ficha (Campo, Gestão e BKO) mostra "Sem compras em 12 meses" no lugar dos indicadores. A ficha usa só a janela de 12 meses (o 13º mês do sync fica fora). Selo do cabeçalho só "Bloqueado"; motivo e vencidos ficam no Financeiro.

## T-0149 — filial (RN-CORE-39, ADR 0040)
- Contrato `modules/core/contracts/filial.ts`: `Filial`, rotas do BKO e a consulta `core.filiais@1` (API e aparelho; `cliente_ids`, `external_ids`, `escopo: 'carteira'` → `da_carteira`). Sync: entidade `filial` (tenant) e `ClienteSync.filial_id`; `core.cadastro_resumo@1` traz `clientes[].filial_id` efetiva.
- Domain `domain/filial.ts`: `filialEfetiva`, `validarFilial`, `decidirApagarFilial`, `podeEditarFilialDoCliente`, `rotuloDaFilial`, `filialDoClienteDoErp`.
- API `api/filiais.ts`: `GET/POST/PUT/DELETE /v1/core/filiais` (`filial.ver` todos; `filial.editar` admin e analista) e `PUT /v1/core/clientes/:id/filial` (`cliente.filial_editar`; cliente do ERP recusa com 422 `RN-CORE-39`). Consumidor `integracao.filial.atualizado@1` (adota a padrão `0001` pelo código) e `filial_external_id` no consumidor do cliente (ausente não altera, nulo = padrão, desconhecida = `referencia_ausente`).
- BKO: Cadastros › Filiais; linha "Filial" no Cliente 360. Ficha do app: "Filial: 0002 · Boa Vista/RR".

## T-0147 — fotos do PDV (RN-CORE-38, ADR 0041)
- Contrato `contracts/fotos-pdv.ts`; domain `domain/fotos-pdv.ts` (`PERFIS_DOC_SENSIVEL` = admin, analista, gerente, supervisor; `validarTipoFoto`, `perfisDeLeitura`, `podeAbrirFoto`, `podeEnviarFoto`, `resumoFotos`, `podeVerFotoDoPdv`).
- API `api/fotos-pdv.ts`: tipos em `/v1/core/fotos-tipos` (`foto_tipo.editar`, admin) e `GET /v1/core/clientes/:id/fotos` (`cliente_foto.ver`; `arquivo_id` só nos tipos que o perfil abre). Pull `foto_tipo` (tenant) e `cliente_foto` (carteira, `arquivo_id` nulo no sensível).
- BKO: Cadastros › Fotos do PDV. Ficha do app: seção "Fotos do PDV" (tem/falta, cadeado) e botão "Foto do PDV" (desligado até o shell registrar o visualizador).
- Pendente: push `cliente_foto` e captura (dependem de `perfis_leitura` no SDK e da galeria no shell).
