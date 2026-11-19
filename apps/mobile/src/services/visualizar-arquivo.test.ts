/** T-0186 (RD-2356; P15 e P17): a porta `abrirArquivo` do Cliente 360 abre o visor de foto comum (`/foto`, os bytes decidem). */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const sim = vi.hoisted(() => ({ fotos: [] as unknown[] }));

vi.mock('./visor-foto', () => ({ abrirFoto: (p: unknown) => sim.fotos.push(p) }));

import { abrirArquivo } from './visualizar-arquivo';

const ID = '0b9f6c3e-6a7d-4c1e-9f0a-2b3c4d5e6f70';

beforeEach(() => {
  sim.fotos.length = 0;
});

describe('abrirArquivo (porta do Core)', () => {
  it('imagem: o visor de foto comum, com o título e o subtítulo', () => {
    abrirArquivo({ arquivo_id: ID, titulo: 'Alvará', subtitulo: 'Vence em 10/12/2026', formato: 'jpg' });
    expect(sim.fotos).toEqual([{ arquivo_id: ID, titulo: 'Alvará', subtitulo: 'Vence em 10/12/2026' }]);
  });

  it('sem formato (fachada): o mesmo visor de foto', () => {
    abrirArquivo({ arquivo_id: ID, titulo: 'Fachada', formato: null });
    abrirArquivo({ arquivo_id: ID, titulo: 'Fachada' });
    expect(sim.fotos).toEqual([
      { arquivo_id: ID, titulo: 'Fachada' },
      { arquivo_id: ID, titulo: 'Fachada' },
    ]);
  });
});
