/**
 * RD-0088: a porta do visor de foto comum — `abrirFoto` abre a rota `/foto` com a fonte do módulo (arquivo da plataforma ou
 * endereço já resolvido), recusa fonte inválida sem lançar, e chega aos módulos pelo ambiente do aparelho
 * (`ambiente.abrirFoto`).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const sim = vi.hoisted(() => ({ empurrados: [] as unknown[] }));

vi.mock('expo-router', () => ({ router: { push: (r: unknown) => sim.empurrados.push(r) } }));
vi.mock('./device', () => ({ uuid: () => '00000000-0000-4000-8000-000000000000', posicaoAgora: async () => null }));

import { criarAmbienteDoAparelho } from './ambiente';
import type { ApiClient } from './api';
import { abrirFoto } from './visor-foto';

const ID = '0b9f6c3e-6a7d-4c1e-9f0a-2b3c4d5e6f70';

beforeEach(() => {
  sim.empurrados.length = 0;
});

describe('abrirFoto', () => {
  it('foto do PDV: abre /foto com o arquivo, o título e o subtítulo', () => {
    expect(abrirFoto({ arquivo_id: ID, titulo: 'Atacadinho', subtitulo: 'Fachada · 08/11/2026' })).toBe(true);
    expect(sim.empurrados).toEqual([{ pathname: '/foto', params: { arquivo: ID, titulo: 'Atacadinho', subtitulo: 'Fachada · 08/11/2026' } }]);
  });

  it('foto do produto: abre /foto com o endereço do cache', () => {
    expect(abrirFoto({ uri: 'file:///cache/miniaturas/a-v1.jpg', titulo: 'Filtro PSL 55' })).toBe(true);
    expect(sim.empurrados).toEqual([{ pathname: '/foto', params: { uri: 'file:///cache/miniaturas/a-v1.jpg', titulo: 'Filtro PSL 55' } }]);
  });

  it('fonte inválida: não abre e não lança', () => {
    expect(abrirFoto({ arquivo_id: 'nao-e-uuid' })).toBe(false);
    expect(abrirFoto({ uri: 'javascript:alert(1)' })).toBe(false);
    expect(sim.empurrados).toEqual([]);
  });
});

describe('ambiente do aparelho', () => {
  it('entrega o visor aos módulos (`ambiente.abrirFoto`) quando o shell o fornece', () => {
    const fontes = { api: () => ({}) as ApiClient, online: () => true, usuario: () => null };
    const comVisor = criarAmbienteDoAparelho({ ...fontes, abrirFoto }) as { abrirFoto?: typeof abrirFoto };
    expect(comVisor.abrirFoto).toBe(abrirFoto);
    expect('abrirFoto' in criarAmbienteDoAparelho(fontes)).toBe(false);
  });
});
