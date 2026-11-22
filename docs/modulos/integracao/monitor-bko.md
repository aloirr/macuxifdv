# Integração ERP no BKO — página "Integração ERP" (T-0051, T-0173)

> RF-INT-04 (monitor); RN-INT-08 (pedidos no ERP), RN-INT-15 (status e ações do lote), RN-INT-16 (autorização do reprocessamento).
> Código: `modules/integracao/web/`.

## Onde fica
- Menu **Sistema → Integração ERP**, caminho `/integracao`, página `monitor` (`nav-integracao-monitor`, `pagina-integracao-monitor`).
- O shell (`apps/web/lib/modulos.ts`) registra `@macuxi/integracao/web`: a página aparece quando o módulo está **efetivo** (licença no tenant e no perfil, RN-CORE-01/03), o perfil é do módulo (**admin**, **analista**) e a ação **`monitor.ver`** permite.
- A tela confere de novo o perfil (`podeExecutar('monitor.ver', perfil)`); a proteção real é a API (licença, perfil por ação, tenant do token).

## O que a tela mostra (T-0173, v1.0.19)
- **Cabeçalho**: `conector · v<versão> · última carga recebida 15/11 às 01:02` (conector do lote mais recente) e **Atualizar**. Atualiza pelo `sync_auto_min` do tenant (RN-CORE-23). Fonte: `MonitorResumo` (`GET /v1/integracao/monitor`, `ROTA_MONITOR`).
- **Uma linha por entidade**, agregando os lotes recentes (a API devolve até 20 lotes por entidade, os mais recentes; assim a carga rara de uma entidade não some quando outra carrega o tempo todo). Colunas: **Entidade**; **Última carga** (`15/11 às 01:02 · falhou 01:03` quando o lote mais recente falhou, senão `· n lotes` se houver mais de um); **Situação** (`Com falha` exatamente quando a linha mostra Reprocessar, senão `Em dia`); **Linhas integradas** (`x de y` do lote mais recente, vazia se ele está em andamento ou foi cancelado, pois o cancelamento só vale antes da aplicação e nada foi gravado; `integradasDoLote` no domain); ações.
  - **Reprocessar** só com lote reprocessável (RN-INT-15: Com falha ou Concluído com avisos); refaz os lotes reprocessáveis da entidade (`POST /v1/integracao/lotes/:id/reprocessar`) e fecha o Histórico.
  - **Histórico (n)** abre o diálogo largo com os n lotes da entidade, na URL como `?historico=<entidade>`. Colunas: Recebido, Falhou (só lote que falhou), Situação, Linhas (vazia em andamento ou cancelado).
  - **Ver erros**, no Histórico, só no lote que falhou ou tem erro: abre a gaveta com o log do lote (`?lote=<uuid>`; o Histórico fica oculto e volta ao fechar a gaveta): `GET /v1/integracao/lotes/{id}/erros` (`ErrosLoteQuery` → `ErrosLoteResposta`), filtro por código, "Carregar mais" e CSV dos erros do filtro. O aviso `marca_concorrente_desconhecida` (T-0103) aparece aqui: é aviso, nunca erro; até 200 por lote, depois "e mais N".
  - **Cancelar** só no lote em andamento, com confirmação (`POST /v1/integracao/lotes/:id/cancelar`, ação `lote.cancelar`; 409 `lote_nao_esta_em_andamento`).
  - **5 status (RN-INT-15, `domain/status-lote.ts`)**: Em andamento (recebido, processando), Concluído, Concluído com avisos (`concluido_com_erros`), Com falha (`falhou`), Cancelado.
- **Autorização do reprocessamento (RN-INT-16)**: sem `lote.reprocessar`, o corpo leva `autorizador_id` (de `GET /v1/integracao/lotes/autorizadores`, consulta `core.usuarios_com_acao@1`) e `senha`, conferida pelo Core (porta `VerificadorSenha`, `core.credencial_conferir@1`). As frases das recusas vêm do domain e a tela mostra a da API. 5 erros em 15 min bloqueiam o autorizador (429); a auditoria grava quem autorizou, nunca a senha.

`GET /v1/integracao/monitor` devolve só o que alguma tela lê: `gerado_em`, `lotes_recentes`, `conectores` (versão do Conector, para o cabeçalho) e `resumo_pedidos`. Os alertas da integração (`montarAlertasMonitor`, causa e ação seguinte) ficam no domain até uma tela da área "Alertas" ler. Toda resposta passa pelo schema Zod do contrato antes de chegar à tela.

## Fora desta página
- **Cards "Pedidos no ERP"** (módulo Vendedor, início de BKO → Pedidos): leem `MonitorResumo.resumo_pedidos` (`resumoPedidosErp()` no domain, `ResumoPedidosErp` no contrato), sem cálculo no Vendedor.
- **De-para de códigos**: página `de-para` em **Parâmetros → Integração** (`parametros/integracao`). Lista com filtro por tipo e busca, "Novo de-para" em folha, código do Macuxi escolhido numa lista (`GET /v1/integracao/mapeamentos/codigos-macuxi?tipo=`). Lê com `monitor.ver`; grava, inativa e apaga com `mapeamento.editar` (admin ou analista). Regra (RN-INT-08): um correspondente **ativo** por código do Macuxi. Ao salvar uma condição de pagamento, os pedidos retidos por falta de de-para seguem para a fila na mesma transação; a área "Alertas" da página diz quais condições faltam e quantos pedidos esperam.

## CSV
Padrão do BKO (BOM, `;`, CRLF). Só códigos do ERP (`external_id`), contagens e mensagens do Hub — nunca valor de linha (o payload pode ter CPF/CNPJ, §14 do hub-api). Texto que começa com `=`, `+`, `-` ou `@` ganha apóstrofo (o Excel não executa como fórmula).

## Arquivos
- `web/index.ts` — `moduloWeb` (páginas `monitor` e `de-para`).
- `web/components/` — `monitor-page`, `entidades-panel`, `historico-dialog`, `lote-drawer`, `autorizar-reprocessamento`, `de-para-page`.
- `web/lib/` — `apresentacao` (rótulos, tons, `podeExecutar`), `entidades` (agrupa lotes por entidade, texto da última carga, cabeçalho), `reprocessar-lotes` (reprocessa os lotes da entidade sem parar no erro de um lote; texto do resultado), `filtros-url`, `use-filtros`, `csv`, `queries`.
- Testes: `web/lib/*.test.ts` e `web/components/*.test.ts` (puros, relógio de `@macuxi/comum/relogio`, sem hora fixa).

## Pendências
1. **e2e** (Playwright) da página — agente `testes`.
