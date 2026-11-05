/**
 * Testes de guarda das partes instáveis do expo-router que o histórico por aba usa (ADR 0026; R-20261105-130317 E2).
 * Quebram se uma subida do expo-router mudar o que o shell assume, antes de o voltar do Android quebrar no aparelho:
 * (b) `UNSTABLE_router` ainda é lido pelo `useNavigationBuilder` e junta `{ ...original, ...overrides }`;
 * (c) o `router.replace('/m/pedido?id=…')` numa tela `/m/novo-pedido` chega ao Tabs como `REPLACE` com
 *     `payload.name === 'm/[...caminho]'` (montado pelas mesmas funções do expo-router: `findDivergentState` e
 *     `getPayloadFromStateRoute`), e o roteador do shell o troca por JUMP_TO marcado com `PARAM_SUBSTITUIR`.
 * (a) os cenários sobre o TabRouter do próprio pacote e o canário "sem o roteador do shell" ficam em historico-telas.test.ts.
 * (d) não se aplica: o shell não ouve mais o `__unsafe_action__` (E1).
 * Versão conferida: expo-router 57.0.x (react-navigation dentro do pacote). Subiu minor/major: rode estes testes e o
 * roteiro do voltar no aparelho (ADR 0026) antes de aceitar.
 */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

import { findDivergentState, getPayloadFromStateRoute } from 'expo-router/build/global-state/stateUtils';
import { TabRouter } from 'expo-router/build/react-navigation/routers/TabRouter';
import { describe, expect, it } from 'vitest';

import { comHistoricoDoShell, ehSubstituicaoDeModulo, PARAM_SUBSTITUIR, ROTA_MODULO } from './historico-telas';

const requerer = createRequire(import.meta.url);
const fonte = (modulo: string) => readFileSync(requerer.resolve(modulo), 'utf8');

describe('expo-router: APIs instáveis usadas pelo shell (ADR 0026)', () => {
  it('a versão do expo-router é a 57 (subir pede revisão da ADR 0026)', () => {
    const { version } = requerer('expo-router/package.json') as { version: string };
    expect(version.split('.')[0]).toBe('57');
  });

  it('(b) o useNavigationBuilder lê o UNSTABLE_router e junta original + sobrescritas', () => {
    const src = fonte('expo-router/build/react-navigation/core/useNavigationBuilder.js');
    expect(src).toMatch(/\bUNSTABLE_router\b[^;]*\.\.\.rest\s*}\s*=\s*options/);
    expect(src).toMatch(/const overrides = UNSTABLE_router\(original\);\s*return\s*{\s*\.\.\.original,\s*\.\.\.overrides,?\s*}/);
  });

  it('(c) o router.replace entre telas de módulo chega ao Tabs como REPLACE para m/[...caminho]', () => {
    // estado do aparelho: pilha raiz → (tabs) → tela /m/novo-pedido; o Tabs do shell usa o TabRouter (type 'tab')
    const opcoes = { routeNames: ['index', ROTA_MODULO, 'mais'], routeParamList: {}, routeGetIdList: {} };
    const tabs0 = TabRouter({ backBehavior: 'history' }).getInitialState(opcoes);
    expect(tabs0.type).toBe('tab');
    const tabs = { ...tabs0, index: 1, routes: tabs0.routes.map((r) => (r.name === ROTA_MODULO ? { ...r, params: { caminho: ['novo-pedido'] } } : r)) };
    const raiz = { type: 'stack', key: 'raiz', index: 0, routes: [{ name: '(tabs)', key: 'tabs-rota', state: tabs }] };
    // estado pedido por '/m/pedido?id=u1' (o que o getStateFromPath dá para a rota pega-tudo)
    const pedido = { routes: [{ name: '(tabs)', state: { routes: [{ name: ROTA_MODULO, params: { caminho: ['pedido'], id: 'u1' } }] } }] };
    const { navigationState, actionStateRoute } = findDivergentState(pedido as never, raiz as never, false);
    expect(navigationState?.key).toBe(tabs.key);
    const payload = getPayloadFromStateRoute(actionStateRoute ?? ({} as never));
    expect(payload.screen).toBe(ROTA_MODULO);
    expect(payload.params).toMatchObject({ caminho: ['pedido'], id: 'u1' });

    // o getNavigateAction mantém o REPLACE no Tabs 'tab' (só 'expo-tab' e 'drawer' viram JUMP_TO) e monta a ação assim
    const src = fonte('expo-router/build/global-state/getNavigationAction.js');
    expect(src).toMatch(/navigationState\.type === 'expo-tab'\)\s*{\s*type = 'JUMP_TO'/);
    expect(src).toMatch(/type === 'REPLACE' && navigationState\.type === 'drawer'/);
    expect(src).toMatch(/return\s*{\s*type,\s*target: navigationState\.key,\s*payload:\s*{[\s\S]{0,80}name: rootPayload\.screen,\s*params,/);
    expect(fonte('expo-router/build/global-state/router.js')).toMatch(/event: 'REPLACE'/);

    const acao = { type: 'REPLACE', target: tabs.key, payload: { name: payload.screen, params: payload.params } };
    expect(ehSubstituicaoDeModulo(acao)).toBe(true);
    // o roteador do shell troca por JUMP_TO (o histórico das abas fica) e marca a tela que abre
    const roteador = comHistoricoDoShell(TabRouter({ backBehavior: 'history' }));
    const depois = roteador.getStateForAction(tabs as never, acao as never, opcoes as never) as unknown as typeof tabs | null;
    const rota = depois?.routes[depois.index];
    expect(rota?.name).toBe(ROTA_MODULO);
    expect(rota?.params).toMatchObject({ caminho: ['pedido'], id: 'u1', [PARAM_SUBSTITUIR]: '1' });
    expect((depois as unknown as { history: unknown[] }).history.length).toBeGreaterThan(1);
  });
});
