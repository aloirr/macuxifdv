import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Panel } from '@macuxi/ui/web';
import { VazioSimples } from './vazio-simples';
import { mostrarFiltrosDePara } from '../lib/apresentacao';

describe('vazio e cartão das tabelas (MC-0061, RD-0967)', () => {
  it('MC-0061: o vazio fica dentro do cartão branco com borda contínua e sem borda tracejada', () => {
    const html = renderToStaticMarkup(
      <Panel label="De-para de códigos">
        <VazioSimples titulo="Nenhum de-para ainda." testId="x" />
      </Panel>,
    );
    expect(html).toContain('bg-surface');
    expect(html).toContain('border-line');
    expect(html).toContain('rounded-2xl');
    expect(html).not.toContain('border-dashed');
    expect(html).toContain('Nenhum de-para ainda.');
  });

  it('RD-0967: com o De-para vazio não há filtros nem busca; com itens, há', () => {
    expect(mostrarFiltrosDePara(0)).toBe(false);
    expect(mostrarFiltrosDePara(3)).toBe(true);
  });
});
