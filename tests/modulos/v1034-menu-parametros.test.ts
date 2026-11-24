/**
 * v1.0.34 — DEFEITO B(a) do teste de campo do APK v1.0.32 (R-20261124-094002): no menu lateral do BKO, "PARÂMETROS" não tinha a seta (›)
 * de abrir opções como Acesso, Análise e Cadastros.
 * Decisão do Alexandre + premissa da sessão S3 (docs/design/menu-parametros/spec.md, revisão de 24/11): Parâmetros é GRUPO com seta e abre
 * com as suas seções, cada uma em `/parametros/<secao>`. A forma do menu (todo grupo com seta, Pesquisa, Treinamento, ordem) fica em
 * apps/web/lib/menu-bko.test.ts; aqui, o casamento entre módulos: as opções do grupo × as seções da página Parâmetros.
 * Menu montado como o shell monta (registro real dos 8 módulos, admin, `menu-bko.fixture.ts`).
 */
import { describe, expect, it } from 'vitest';

import { montarMenuAdmin } from '../../apps/web/lib/menu-bko.fixture';

describe('v1.0.34 B(a) — o grupo Parâmetros do menu do BKO abre com as seções da página', () => {
  const { grupos, secoes } = montarMenuAdmin();
  const parametros = grupos.find((g) => g.id === 'parametros');

  it('Parâmetros abre com UMA opção por seção, cada uma em /parametros/<secao>, na ordem e com o rótulo da página', () => {
    expect(secoes.length, 'a página Parâmetros tem seções').toBeGreaterThan(1);
    expect(parametros!.itens.map((i) => [i.href, i.label])).toEqual(secoes.map((s) => [`/${s.caminho}`, s.rotulo]));
    expect(parametros!.itens.every((i) => /^\/parametros\/[a-z0-9-]+$/.test(i.href)), 'nenhuma opção aponta para /parametros sem seção').toBe(true);
  });
});
