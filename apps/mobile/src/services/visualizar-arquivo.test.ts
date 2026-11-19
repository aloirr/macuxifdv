/** T-0186 (RD-2356; P15 e P17): a porta `abrirArquivo` do Cliente 360 — o PDF abre o visor de PDF (`/pdf`), o resto o de foto. */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const sim = vi.hoisted(() => ({ fotos: [] as unknown[], rotas: [] as unknown[] }));

vi.mock('./visor-foto', () => ({ abrirFoto: (p: unknown) => sim.fotos.push(p) }));
vi.mock('expo-router', () => ({ router: { push: (r: unknown) => sim.rotas.push(r) } }));
// o índice de `@macuxi/core/app` (de onde vem `normalizarFormato`) puxa telas: os módulos nativos viram vazios
vi.mock('react-native', () => import('@/teste/nativo-vazio').then((m) => m.moduloVazio()));
vi.mock('react-native-safe-area-context', () => import('@/teste/nativo-vazio').then((m) => m.moduloVazio()));
vi.mock('react-native-svg', () => import('@/teste/nativo-vazio').then((m) => m.moduloVazio()));
vi.mock('@macuxi/ui/mobile', () => import('@/teste/nativo-vazio').then((m) => m.moduloVazio()));

import { abrirArquivo } from './visualizar-arquivo';

const ID = '0b9f6c3e-6a7d-4c1e-9f0a-2b3c4d5e6f70';

beforeEach(() => {
  sim.fotos.length = 0;
  sim.rotas.length = 0;
});

describe('abrirArquivo (porta do Core)', () => {
  it('imagem: o visor de foto comum, com o título e o subtítulo', () => {
    abrirArquivo({ arquivo_id: ID, titulo: 'Alvará', subtitulo: 'Vence em 10/12/2026', formato: 'jpg' });
    expect(sim.fotos).toEqual([{ arquivo_id: ID, titulo: 'Alvará', subtitulo: 'Vence em 10/12/2026' }]);
    expect(sim.rotas).toEqual([]);
  });

  it('sem formato (fachada): o mesmo visor de foto', () => {
    abrirArquivo({ arquivo_id: ID, titulo: 'Fachada', formato: null });
    abrirArquivo({ arquivo_id: ID, titulo: 'Fachada' });
    expect(sim.fotos).toEqual([
      { arquivo_id: ID, titulo: 'Fachada' },
      { arquivo_id: ID, titulo: 'Fachada' },
    ]);
  });

  it('PDF (NF e documento): o visor de PDF; arquivo inválido não abre nem lança', () => {
    abrirArquivo({ arquivo_id: ID, titulo: 'NF 123', formato: 'pdf' });
    abrirArquivo({ arquivo_id: ID, titulo: 'Contrato', formato: 'application/pdf' });
    expect(() => abrirArquivo({ arquivo_id: 'x', titulo: 'NF', formato: 'pdf' })).not.toThrow();
    expect(sim.rotas).toEqual([
      { pathname: '/pdf', params: { arquivo: ID, titulo: 'NF 123' } },
      { pathname: '/pdf', params: { arquivo: ID, titulo: 'Contrato' } },
    ]);
    expect(sim.fotos).toEqual([]);
  });
});
