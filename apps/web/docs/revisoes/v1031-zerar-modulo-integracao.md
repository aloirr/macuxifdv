# Revisão técnica — web do modulo-integracao (lote v1.0.31 "Zerar dados")

- Revisor: engenheiro-apps (revisão técnica de telas; visual, textos e "3 toques" ficam com o designer-ux).
- Escopo: `git diff origin/main...origin/nuvem/v1031-zerar-modulo-integracao -- modules/integracao/web` no SHA `c065ba26e`
  (MonitorPainel com `ClienteIntegracao` injetável, `menuDaEntidade`, `useMonitorDetalhes`, filtros na URL, `MonitorPage` do BKO).
- Data: 23/11/2026 (Manaus). Dono dos arquivos: `modulo-integracao`.
- Medição no portal falso (390 px), `apps/web/e2e/portal-zerar.spec.ts` verde nas duas larguras.

## Resultado: nenhum 🔴 · 1 🟡 · 4 🟢

### 🟡 corrigir

1. `modules/integracao/web/components/entidades-panel.tsx:60` — **R3-1 não fechou a 390 px.** Com a coluna Situação em 96 px, a coluna
   Entidade da "Cargas recentes" fica com 176 px (156 px úteis, 10 + 10 de respiro) e "Endereços de clientes" mede ~156,7 px na fonte
   de 15 px: continua cortado em "Endereços de client…" nos prints `apps/web/docs/prints/zerar-dados/05-monitor-celular.png` e
   `06-entidade-celular.png`. Na "Dados no Hub" e no "Leva junto:" o nome aparece inteiro. O selo mais largo ("Com falha") mede 74 px;
   com o respiro, a Situação cabe em **94 px**, o que dá 158 px úteis à Entidade. Sugestão: `largura: '94px'` e, no teste do painel,
   travar a soma (Situação ≥ selo + 20). Se o designer-ux preferir manter 96 px, o ganho tem de vir do ⋯ (`LARGURA_COLUNA_ACOES = 52`
   em `packages/ui/src/web/tabela-dados.ts:22`, dono designer-ux). Pronto quando o 05/06-celular mostrar o nome inteiro; o
   engenheiro-apps refaz os prints e pode acrescentar ao e2e a checagem `scrollWidth <= clientWidth` da célula.

### 🟢 sugestões

2. `modules/integracao/web/components/monitor-page.tsx:19` e `components/monitor-painel.tsx:29` — o BKO monta o
   `ClienteIntegracaoProvider` duas vezes (a página precisa dele para o `useMonitor` do cabeçalho, linha 27; o painel monta o seu de
   novo). Funciona (mesmo cliente, mesma chave, a consulta é única), mas o segundo é redundante no BKO. Opção: o `MonitorPainel` só
   monta o provider quando não há um em volta, ou a página passa o cliente sem o próprio provider.
3. `modules/integracao/web/lib/queries.ts:80` — a chave `['integracao', 'sync-auto-min']` não leva o escopo. Hoje está certo porque
   o portal passa `intervaloMs` (`apps/web/lib/portal-monitor.ts:28`) e a consulta fica desligada (linha 78), então o portal nunca chama
   `/v1/me/modulos`. Se outro chamador montar o painel sem `intervaloMs`, ele leria o `/me/modulos` do usuário, não o do tenant
   do cliente. Vale um comentário na interface (`cliente.tsx`, `intervaloMs`) dizendo que fora do BKO o campo é obrigatório, ou
   escopar a chave.
4. `modules/integracao/web/lib/use-filtros.ts:20` — o `replaceState` roda dentro da função de atualização do `setFiltros`. É
   idempotente (no StrictMode roda duas vezes sem efeito), mas efeito colateral em updater é frágil; pode ir para um `useEffect`
   sobre `filtros`. O `paraBusca(novo, window.location.search)` preservando a `?aba=` do portal está correto e coberto por teste.
5. `modules/integracao/web/lib/queries.ts:166` e `:176` — gravar/apagar mapeamento invalida só `qk.monitor(ESCOPO_BKO)`. Correto
   hoje (de-para é só do BKO); anotar no comentário da função para quem levar o de-para ao portal.

## Conferido sem achado

- **Offline e erros:** o `MonitorPainel` separa erro sem dados (mensagem da API, com `onRetry`) de erro com dados guardados
  ("Não deu para atualizar agora.", os dados ficam na tela via `placeholderData`). O React Query pausa a consulta sem rede e o
  `refetchInterval` segue o `sync_auto_min` (nunca abaixo de 15 min) ou o intervalo do portal.
- **Cache e invalidação:** chaves do monitor, detalhes, autorizadores e erros levam o escopo (`bko` ou `portal:<tenant>`), sem mistura
  de tenants. `qk.detalhes` fica sob o prefixo `qk.monitor`, então reprocessar/cancelar atualiza também os detalhes do portal;
  `chaveDoCacheIntegracao(escopo)` cobre tudo após o "Zerar dados" (`apps/web/components/portal/secao-monitor.tsx:88`).
  `useReprocessarLote` mantém `gcTime: 0` (senha do autorizador fora do cache).
- **Acessibilidade do ⋯:** o `TabelaDados` dá ao botão o rótulo "Ações de <entidade>" (`packages/ui/src/web/tabela-dados-componente.tsx:95`);
  o "Reprocessar" fica desligado durante um reprocesso (`lib/entidades.ts`, `menuDaEntidade`) e só aparece com falha reprocessável
  (RN-INT-15).
- **testId:** `menuDaEntidade` mantém `integracao.entidade.reprocessar.<entidade>` e `integracao.entidade.historico.<entidade>` dos botões
  antigos; o ⋯ ganha `integracao.entidades.acoes.<entidade>`, usado pelo e2e.
- **`/me/modulos` no portal:** não é chamado (cliente com `intervaloMs`); `codigoDoErro` lê `code` (BKO) e `codigo` (portal), então
  RN-INT-16 (pedir autorizador) funciona nos dois clientes.
- **Efeitos no BKO:** `MonitorPage` mantém a checagem `monitor.ver`, o cabeçalho e o `data-testid="pagina-integracao-monitor-conteudo"`;
  as rotas seguem só em `/v1/integracao/*`; nenhuma regra de negócio nova na tela (reprocessável e em andamento vêm do `domain`).
  Lint, typecheck, 444 testes do `apps/web` e os 16 e2e do portal verdes com o merge do `c065ba26e`.

## Rodada 2 — `31faad3d7` (23/11/2026, Manaus)

Merge do `31faad3d7` no `nuvem/v1030-zerar-engenheiro-apps`; prints 05–07 refeitos (1280 e 390 px, escala 2). O e2e do portal
(`apps/web/e2e/portal-zerar.spec.ts`) passa a medir, nas duas larguras, a largura do texto "Endereços de clientes" (Range) contra a
largura útil da célula da Entidade na "Cargas recentes" e na "Dados no Hub".

### Resultado: nenhum 🔴 · 1 🟡 novo · os 5 achados da rodada 1 fechados

- **1 🟡 (R3-1, nome cortado) — fechado.** A 390 px a Entidade da "Cargas recentes" tem 158 px úteis e o texto mede 156,3 px
  (na "Dados no Hub", 237 px úteis). O 05-celular e o 06-celular mostram "Endereços de clientes" inteiro.
- **2 🟢 (provider duplo) — fechado.** `MonitorPage` sem provider próprio; `useMonitor(cliente)` no cabeçalho, um só provider (o do painel).
- **3 🟢 (chave do `sync-auto-min`) — fechado.** `qk.syncAutoMin(escopo)`; `intervaloMs` documentado como obrigatório fora do BKO.
- **4 🟢 (`replaceState` no updater) — fechado.** Efeito sobre os filtros (`urlComFiltros`), com teste.
- **5 🟢 (invalidação do de-para) — fechado.** Invalida o monitor do escopo do cliente (`chavesAposMapeamento`), com teste.

### 🟡 novo — corrigir

6. `modules/integracao/web/components/entidades-panel.tsx:60` — **a 94 px o selo "Com falha" passou a ser cortado.** Medido no
   navegador: o selo tem **74,16 px** (não 74, arredondamento meu na rodada 1), a célula tem 94 − 20 = 74 px úteis, o `truncate`
   da célula entra e aparece um "··" vermelho logo depois de "Com falha" em Produtos e Preços, nas duas larguras (05-monitor e
   05-monitor-celular; `scrollWidth` 107 × `clientWidth` 94). Correção: `largura: '95px'` (75 px úteis ≥ 74,16; a Entidade fica com
   157 px úteis ≥ 156,3, folga de 0,7 px) e, no teste do painel, travar Situação ≥ 75. Folga tão curta depende da fonte; se o
   designer-ux quiser margem, o ganho vem do ⋯ (`LARGURA_COLUNA_ACOES = 52` em `packages/ui/src/web/tabela-dados.ts:22`). Pronto
   quando o 05/05-celular mostrar "Com falha" sem o "··" e "Endereços de clientes" inteiro; o engenheiro-apps refaz os prints e
   acrescenta ao e2e a mesma medição na célula da Situação.

Lint, typecheck, 444 testes do `apps/web` e os 16 e2e do portal verdes com o merge do `31faad3d7`.
