# Monitor do Hub no BKO — página "Integração ERP" (T-0051)

> RF-INT-04 (monitor), RF-INT-06 (reconciliação); RN-INT-06 (inativação em massa, P-3), RN-INT-08 (pedidos no ERP, P-4).
> Especificação dos blocos: [`hub-api.md` §13](hub-api.md). Código: `modules/integracao/web/`.

## Onde fica
- Menu **Integração ERP** (grupo Administração), caminho `/integracao`, página `monitor` (`nav-integracao-monitor`, `pagina-integracao-monitor`).
- O shell (`apps/web/lib/modulos.ts`) já registra `@macuxi/integracao/web`: a página aparece sozinha quando o módulo está **efetivo** (licença no tenant e no perfil, RN-CORE-01/03), o perfil é do módulo (**admin**, **analista**) e a ação **`monitor.ver`** permite. Nada a montar no shell.
- A tela confere de novo o perfil (`podeExecutar('monitor.ver', perfil)`) e mostra a mensagem do domain se não puder; a proteção real é a API (licença, perfil por ação, tenant do token).

## O que a tela mostra
| Bloco | Fonte | Observações |
|---|---|---|
| KPIs | `MonitorResumo` | Conectores no ar, lotes com erro (entre os recentes), inativações aguardando, pedidos presos + retidos |
| Alertas | `MonitorResumo.alertas` (`montarAlertasMonitor`) | críticos primeiro; texto com causa e ação seguinte |
| Conectores | `MonitorResumo.conectores` | saúde (`avaliarSaudeConector`, na API), "há N min" desde o último sinal contra o relógio da tela (`relogioReal`, renovado a cada 30 s), versão × política, entidades, prefixo da chave e convivência da anterior |
| Inativação em massa | `MonitorResumo.pendencias_inativacao` + `POST /v1/integracao/inativacoes/{id}/decidir` | Confirmar/Recusar com motivo opcional (≤ 300). Botões só para **admin/analista** (P-3, `autorizarAcaoIntegracao`) e só dentro da validade (`situacaoPendencia`, RN-INT-06). CSV com o resumo e a amostra (≤ 50 códigos do ERP) |
| Carga por entidade | `MonitorResumo.cargas` | ordem de dependência, estado, lotes, erros, o que espera |
| Lotes recentes | `MonitorResumo.lotes_recentes` (20 mais recentes) | filtros **na URL** (`conector`, `entidade`, `status`, `com_erro=1`), CSV do que está filtrado; clique abre a gaveta (`?lote=<uuid>`) |
| Erros por linha (gaveta) | `GET /v1/integracao/lotes/{id}/erros` (`ErrosLoteQuery` → `ErrosLoteResposta`) | filtro por código, "Carregar mais" (100 por página), CSV com todos os erros do filtro (páginas de 500, teto 20.000) |
| Pedidos no ERP | `MonitorResumo.pedidos` + alertas `pedido_preso`, `pedido_retido_sem_mapeamento`, `retorno_com_itens_descartados`, `cancelamento_recusado` (T-0114) | contagem por estado, presos, retidos, os erros de retorno das últimas 24 h e os cancelamentos que o ERP recusou (pedido e motivo; some quando o ERP informa o cancelamento) |

Atualização automática a cada 30 s (o sinal do Conector é a cada 1 min). Toda resposta passa pelo schema Zod do contrato antes de chegar à tela.

## CSV
Padrão do BKO (BOM, `;`, CRLF). Só códigos do ERP (`external_id`), contagens e mensagens do Hub — nunca valor de linha (o payload pode ter CPF/CNPJ, §14 do hub-api). Texto que começa com `=`, `+`, `-` ou `@` ganha apóstrofo (o Excel não executa como fórmula).

## Arquivos
- `web/index.ts` — `moduloWeb` (página `monitor`).
- `web/components/` — `monitor-page`, `alertas-panel`, `conectores-panel`, `inativacoes-panel`, `lotes-panel`, `lote-drawer`, `pedidos-panel`.
- `web/lib/` — `apresentacao` (rótulos, tons, `tempoDesde`, `podeExecutar`, `decisaoDaPendencia`), `filtros-url`, `use-filtros`, `csv`, `queries`.
- Testes: `web/lib/*.test.ts` (puros, relógio de `@macuxi/comum/relogio`, sem hora fixa) e `web/components/paineis.render.test.ts` (renderização no servidor: botões de decisão por perfil e validade, sinal de vida).

## Pendências (fora da T-0051 nuvem)
1. **Rota `GET /v1/integracao/lotes/{id}/erros`** — implementada em `modules/integracao/api/bko-carga-arquivo.ts` (T-0032, carga por arquivo): `ErrosLoteQuery` → `ErrosLoteResposta`, paginada, filtro por `codigo`/`reprocessavel`; a gaveta já a consome. Junto veio `GET /v1/integracao/lotes/{id}` (`LoteResultado`).
2. **Rota `GET /v1/integracao/lotes`** (`LoteListagemQuery` → `LoteListagem`) — a tela filtra os 20 lotes recentes do monitor; com a rota, a lista passa a paginar no servidor (`paraQueryLotes` já monta a query do contrato).
3. **Lista "Erros de retorno"** (`pedido_retorno_erro`: pedido, nota, sequência, `external_id` do produto, motivo; CSV) — falta contrato Zod público (hoje `ErroRetornoMonitor` é interface do domain) e rota (proposta: `GET /v1/integracao/pedidos/erros-retorno`). A tela mostra o alerta agregado.
4. **CSV completo dos candidatos da inativação** (hoje: amostra de 50) — rota que recalcula a lista (hub-api.md, `pendencia_inativacao`).
5. **Reprocessar lote** (`POST /v1/integracao/lotes/{id}/reprocessar`, `lote.reprocessar`), **Conectores/chave/política** (telas de `conector.gerenciar`) e **mapeamento** — próximas telas.
6. **e2e** (Playwright) da página com a base demo — agente `testes`, local.
7. **Vitest do módulo com JSX automático** (`esbuild: { jsx: 'automatic' }`) — hoje o teste de renderização define `React` global.

## De-para de códigos e aviso de marca desconhecida (T-0120, T-0103)
- **Painel "De-para de códigos"** (rodapé da página): lista condição de pagamento, depósito e status ERP ↔ Macuxi. Lê com `monitor.ver` (`GET /v1/integracao/mapeamentos`); salva, inativa, apaga e reprocessa com `mapeamento.editar` (admin ou analista; `PUT/DELETE /v1/integracao/mapeamentos`, `POST /v1/integracao/pedidos/reprocessar-retidos`). Regra (RN-INT-08): um correspondente **ativo** por condição do Macuxi; a API recusa o segundo com a ação seguinte. Ao salvar uma condição de pagamento, os pedidos **retidos por falta de de-para** são reavaliados na mesma transação e seguem para a fila. Quando há pedidos retidos, o painel avisa quais condições faltam e quantos pedidos esperam, com botão "Preencher".
- **Aviso `marca_concorrente_desconhecida`** na gaveta do lote: o Hub consome `catalogo.referencia.marca_desconhecida@1` e acrescenta o aviso ao lote que originou a linha ("Produto ABC: marca "X" não cadastrada; a referência foi carregada sem marca resolvida"). É aviso, nunca erro; limite de 200 avisos por lote, depois "e mais N" (`avisos_omitidos`).
