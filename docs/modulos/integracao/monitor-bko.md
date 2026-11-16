# Integração ERP no BKO — página "Integração ERP" (T-0051, T-0173)

> RF-INT-04 (monitor), RF-INT-06 (alertas); RN-INT-08 (pedidos no ERP), RN-INT-15 (status e ações do lote), RN-INT-16 (autorização do reprocessamento).
> Código: `modules/integracao/web/`.

## Onde fica
- Menu **Sistema → Integração ERP**, caminho `/integracao`, página `monitor` (`nav-integracao-monitor`, `pagina-integracao-monitor`).
- O shell (`apps/web/lib/modulos.ts`) registra `@macuxi/integracao/web`: a página aparece quando o módulo está **efetivo** (licença no tenant e no perfil, RN-CORE-01/03), o perfil é do módulo (**admin**, **analista**) e a ação **`monitor.ver`** permite.
- A tela confere de novo o perfil (`podeExecutar('monitor.ver', perfil)`); a proteção real é a API (licença, perfil por ação, tenant do token).

## O que a tela mostra (T-0173)
- Cabeçalho com **Atualizar**, filtros **Entidade** e **Status** (na URL) e a **tabela de lotes**: Entidade, Lote, Início, Duração, Conclusão, Status, Linhas integradas. Fonte: `MonitorResumo.lotes_recentes` (`GET /v1/integracao/monitor`, `ROTA_MONITOR`). Atualiza pelo `sync_auto_min` do tenant (RN-CORE-23).
- Clique na linha abre o **log do lote** (gaveta, `?lote=<uuid>`): `GET /v1/integracao/lotes/{id}/erros` (`ErrosLoteQuery` → `ErrosLoteResposta`), filtro por código, "Carregar mais" e CSV dos erros do filtro. O aviso `marca_concorrente_desconhecida` (T-0103) aparece aqui: é aviso, nunca erro; até 200 por lote, depois "e mais N".
- "⋯" só na linha que tem ação:
  - **5 status (RN-INT-15, `domain/status-lote.ts`)**: Em andamento (recebido, processando), Concluído, Concluído com avisos (`concluido_com_erros`), Com falha (`falhou`), Cancelado.
  - **Cancelar** só em andamento (`POST /v1/integracao/lotes/:id/cancelar`, ação `lote.cancelar`; 409 `lote_nao_esta_em_andamento`).
  - **Reprocessar** só em Com falha e Concluído com avisos (`POST /v1/integracao/lotes/:id/reprocessar`).
- **Autorização do reprocessamento (RN-INT-16)**: sem `lote.reprocessar`, o corpo leva `autorizador_id` (de `GET /v1/integracao/lotes/autorizadores`, consulta `core.usuarios_com_acao@1`) e `senha`, conferida pelo Core (porta `VerificadorSenha`, `core.credencial_conferir@1`). As frases das recusas vêm do domain e a tela mostra a da API. 5 erros em 15 min bloqueiam o autorizador (429); a auditoria grava quem autorizou, nunca a senha.

`GET /v1/integracao/monitor` devolve `gerado_em`, `alertas` (`montarAlertasMonitor`, causa e ação seguinte), `lotes_recentes` e `resumo_pedidos`. Toda resposta passa pelo schema Zod do contrato antes de chegar à tela.

## Fora desta página
- **Cards "Pedidos no ERP"** (módulo Vendedor, início de BKO → Pedidos): leem `MonitorResumo.resumo_pedidos` (`resumoPedidosErp()` no domain, `ResumoPedidosErp` no contrato), sem cálculo no Vendedor.
- **De-para de códigos**: página `de-para` em **Parâmetros → Integração** (`parametros/integracao`). Lista com filtro por tipo e busca, "Novo de-para" em folha, código do Macuxi escolhido numa lista (`GET /v1/integracao/mapeamentos/codigos-macuxi?tipo=`). Lê com `monitor.ver`; grava, inativa e apaga com `mapeamento.editar` (admin ou analista). Regra (RN-INT-08): um correspondente **ativo** por código do Macuxi. Ao salvar uma condição de pagamento, os pedidos retidos por falta de de-para seguem para a fila na mesma transação; a área "Alertas" da página diz quais condições faltam e quantos pedidos esperam.

## CSV
Padrão do BKO (BOM, `;`, CRLF). Só códigos do ERP (`external_id`), contagens e mensagens do Hub — nunca valor de linha (o payload pode ter CPF/CNPJ, §14 do hub-api). Texto que começa com `=`, `+`, `-` ou `@` ganha apóstrofo (o Excel não executa como fórmula).

## Arquivos
- `web/index.ts` — `moduloWeb` (páginas `monitor`, `de-para` e carga por arquivo).
- `web/components/` — `monitor-page`, `lotes-panel`, `lote-drawer`, `autorizar-reprocessamento`, `de-para-page`, `carga-arquivo-page`.
- `web/lib/` — `apresentacao` (rótulos, tons, `podeExecutar`), `filtros-url`, `use-filtros`, `csv`, `queries`.
- Testes: `web/lib/*.test.ts` e `web/components/*.test.ts` (puros, relógio de `@macuxi/comum/relogio`, sem hora fixa).

## Pendências
1. **Rota `GET /v1/integracao/lotes`** (`LoteListagemQuery` → `LoteListagem`): hoje a tela filtra os lotes recentes do monitor; com a rota, a lista passa a paginar no servidor.
2. **e2e** (Playwright) da página — agente `testes`.
