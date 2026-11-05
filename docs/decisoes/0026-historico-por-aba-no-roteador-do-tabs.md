# ADR 0026 — Histórico das telas de módulo por aba no roteador do Tabs (`UNSTABLE_router` do expo-router 57)

- **Status**: aceita com condições (2026-11-05, engenheiro-software, revisão do lote L; condições na seção Decisão, itens 3 e 4)
- **Data**: 2026-11-05
- **Tarefa**: T-0071 (achado R-20261105-121434), com efeito na T-0072 (transição das telas)
- **Autor**: engenheiro-software
- **Código**: `apps/mobile/src/lib/historico-telas.ts`, `apps/mobile/src/app/(tabs)/_layout.tsx` (dono: engenheiro-apps)

## Contexto
Todas as telas de módulo do app moram numa rota só do Tabs: `(tabs)/m/[...caminho]`. Os módulos registram as telas no
`moduloApp`, e o shell monta só as telas dos módulos efetivos do usuário (ADR 0004). Por isso o expo-router não tem pilha
entre essas telas. Ir de uma tela de módulo para outra só troca os parâmetros da rota. Além disso, o `REPLACE` do TabRouter
do expo-router 57 tira a aba anterior do histórico das abas. Resultado: o voltar do Android saía do app.

O expo-router 57 vem com o react-navigation dentro do próprio pacote (`expo-router/build/react-navigation`). O TabRouter tem
um `TODO` sobre o `REPLACE`, então essa parte ainda deve mudar.

A correção do engenheiro-apps usa duas APIs que o próprio expo-router marca como instáveis:
1. **`UNSTABLE_router`**, prop do navegador. Ela envolve o `getStateForAction` do TabRouter. No `GO_BACK`, volta para a tela
   anterior da pilha da aba. No `REPLACE` entre telas de módulo, faz um `JUMP_TO`.
2. **o evento `__unsafe_action__`** do container de navegação. Ele marca que houve um `router.replace`, e a próxima tela que
   abrir, dentro de 1 s, substitui o topo da pilha.

## Alternativas
- **Pilha de verdade (um `Stack` por aba)**: é o caminho estável. Só que as abas vêm dos manifestos, e o TabRouter guarda uma
  rota por nome. Um Stack por aba exigiria rotas de arquivo por módulo, ou um navegador próprio. Isso muda a arquitetura do
  shell (ADR 0004) e não cabe nesta rodada.
- **Só `BackHandler` mais um `BackLink` próprio**: cobre o voltar do Android, mas não o `router.back()` nem o
  `router.canGoBack()` que os módulos já usam. A regra ficaria espalhada entre o shell e o kit.
- **Envolver o `router` do expo-router para os módulos**: obrigaria todos os módulos a trocar o import. Hoje eles usam
  `expo-router` direto.

## Decisão
1. **Aceito o `UNSTABLE_router`.** É um ponto único, no shell. É puro (o GO_BACK que roda "a seco" no `canGoBack` só lê o
   histórico), e os módulos não precisam saber dele. Se a prop sair do tipo do `Tabs`, o typecheck quebra.
2. **O `__unsafe_action__` com a janela de 1 s não fica.** Ele não aparece no tipo como API pública, pode parar de ser
   emitido sem quebrar o build, e a janela de tempo falha em aparelho lento. Num Android fraco com o sync rodando, a tela
   pode levar mais de 1 s para abrir depois de "Salvar como orçamento", e aí o editor fica na pilha. **Saída proposta**: o
   próprio `comHistoricoDoShell` marca a substituição no `JUMP_TO` que ele já monta, com um parâmetro interno
   (ex.: `__macuxi_substituir: '1'`). Os parâmetros `__*` já ficam fora da chave da tela. O `registrarTelaAberta` lê esse
   parâmetro em vez do relógio, e o `entradaDaRota` o tira dos `params` guardados, para que voltar a essa tela não conte
   como nova substituição. Com isso saem o listener, `marcarSubstituicao` e `VALIDADE_SINAL_MS`.
3. **Testes de guarda** (Node, Vitest). Eles quebram se a API instável mudar e não dependem de aparelho:
   - (já existe) os cenários de ponta a ponta sobre o **TabRouter vendorizado** (`historico-telas.test.ts`), mais o
     "canário" que prova o bug sem o roteador do shell;
   - (novo) `useNavigationBuilder` do pacote ainda aceita `UNSTABLE_router` e junta `{ ...original, ...overrides }`. Pode ser
     conferido no fonte de `expo-router/build/react-navigation/core/useNavigationBuilder.js` ou montando um navegador mínimo;
   - (novo) a ação que o `router.replace('/m/...')` gera, saída de `getPayloadFromStateRoute`/`findDivergentState` de
     `expo-router/build/global-state/stateUtils` se carregar no Node (senão, uma amostra gravada no aparelho), chega ao Tabs
     como `REPLACE` com `payload.name === 'm/[...caminho]'`, e o `ehSubstituicaoDeModulo`/`comHistoricoDoShell` a reconhecem;
   - (só se o item 2 não for feito) `BaseNavigationContainer` ainda emite `__unsafe_action__` com `data.action` e `data.noop`.
4. **Gate de atualização**: o `expo-router` fica em `~57.0.x` (só patch). Qualquer subida de minor/major do Expo passa por
   esta ADR. Antes do merge, os testes de guarda e o roteiro do voltar no aparelho (Pedidos → pedido → voltar → Início → sair;
   Salvar como orçamento → voltar não reabre o editor) precisam passar.

## Consequências
- O voltar do Android e o `BackLink` desempilham dentro da aba. Trocar de aba guarda a pilha de cada aba. O logout zera tudo.
- O shell depende de um detalhe interno do expo-router. O risco fica num só arquivo, com testes que avisam quando quebrar.
- Quando o expo-router corrigir o `REPLACE` do TabRouter, o canário fica vermelho. Aí revisamos se o `JUMP_TO` ainda é
  necessário.
- Se um dia as telas de módulo ganharem um Stack por aba, esta ADR é substituída e o `historico-telas.ts` sai.
