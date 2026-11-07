import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { ATALHO_POR_LINHA, mostrarAtalhoPorLinha } from './atalho-por-linha';

const base = { consulta: '', dentroDoPedido: false, niveis: 3, trilha: 0 };

describe('atalho "Ver por linha" (T-0085, RF-CAT-09)', () => {
  it('RF-CAT-09: aparece na vitrine sem busca, fora do pedido, com níveis ou trilha', () => {
    expect(mostrarAtalhoPorLinha(base)).toBe(true);
    expect(mostrarAtalhoPorLinha({ ...base, niveis: 0, trilha: 2 })).toBe(true);
  });
  it('RF-CAT-09: some com busca, dentro do pedido ou sem nada para mostrar', () => {
    expect(mostrarAtalhoPorLinha({ ...base, consulta: 'café' })).toBe(false);
    expect(mostrarAtalhoPorLinha({ ...base, dentroDoPedido: true })).toBe(false);
    expect(mostrarAtalhoPorLinha({ ...base, niveis: 0 })).toBe(false);
  });
  it('textos finais do designer-ux', () => {
    expect(ATALHO_POR_LINHA.rotulo).toBe('Ver por linha');
    expect(ATALHO_POR_LINHA.apoio).toBe('Sistema › grupo › linha');
  });
  it('RF-CAT-09: o toque chama irParaListaPorLinha com cliente e nó (e aceita sem cliente)', async () => {
    const push = vi.fn();
    vi.doMock('expo-router', () => ({ router: { push } }));
    const { irParaListaPorLinha } = await import('../rotas');
    irParaListaPorLinha('c1', 'n9');
    irParaListaPorLinha(null, null);
    expect(push).toHaveBeenNthCalledWith(1, '/m/lista-por-linha?cliente=c1&no=n9');
    expect(push).toHaveBeenNthCalledWith(2, '/m/lista-por-linha');
  });
  it('a tela liga o atalho ao irParaListaPorLinha(clienteId, noId) pelo LinhaAtalho do kit', () => {
    const fonte = readFileSync(join(__dirname, '../telas/catalogo.tsx'), 'utf8');
    expect(fonte).toMatch(/<LinhaAtalho[\s\S]*?onPress=\{\(\) => irParaListaPorLinha\(clienteId, noId\)\}/);
    expect(fonte).toContain('mostrarAtalhoPorLinha');
  });
});
