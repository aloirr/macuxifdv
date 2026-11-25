import { describe, expect, it } from 'vitest';

import { fotoPdvTrancada, linhaDaFotoDoPdv, pedidoDeAbrirFotoPdv } from './foto-fachada';

const ARQ = '11111111-1111-4111-8111-111111111111';

describe('RN-CORE-38: cadeado na ficha', () => {
  it('RN-CORE-38: cadeado só no tipo que não é fachada e que tem foto; sem foto, sem cadeado', () => {
    expect(fotoPdvTrancada({ fachada: false, situacao: 'tem' })).toBe(true);
    expect(fotoPdvTrancada({ fachada: false, situacao: 'falta' })).toBe(false);
    expect(fotoPdvTrancada({ fachada: true, situacao: 'tem' })).toBe(false);
  });
});

describe('RN-CORE-38: o olho de cada linha abre a foto do próprio tipo', () => {
  const ALV = '22222222-2222-4222-8222-222222222222';
  const base = { tipo_id: 'T-ALV', nome: 'Alvará', obrigatorio: false, sensivel: true, fachada: false, situacao: 'tem' as const, na_fila: false, tirada_em: '2026-11-09T02:30:00Z', arquivo_id: ALV };
  const o = { tz: 'America/Manaus', podeAbrir: true, podeEnviar: true };
  it('RN-CORE-38: o pedido leva o arquivo da própria linha, "<Nome> · data" no fuso do tenant; sem data, só o nome', () => {
    expect(pedidoDeAbrirFotoPdv('Atacadinho', { ...base, nome: 'Fachada', arquivo_id: ARQ }, 'America/Manaus')).toEqual({ arquivo_id: ARQ, titulo: 'Atacadinho', subtitulo: 'Fachada · 08/11/2026' });
    expect(pedidoDeAbrirFotoPdv('X', { ...base, tirada_em: null }, 'America/Manaus')?.subtitulo).toBe('Alvará');
    expect(pedidoDeAbrirFotoPdv('X', { ...base, arquivo_id: null }, 'America/Manaus')).toBeNull();
  });
  it('RN-CORE-38: só a linha decide: tipo trancado, sem foto, sem arquivo ou sem visualizador não liga o olho', () => {
    expect(linhaDaFotoDoPdv(base, o)).toMatchObject({ trancada: true, ver: { ligado: false } });
    expect(linhaDaFotoDoPdv({ ...base, fachada: true }, o)).toMatchObject({ trancada: false, data: '08/11/2026', ver: { ligado: true } });
    expect(linhaDaFotoDoPdv({ ...base, fachada: true }, { ...o, podeAbrir: false }).ver.ligado).toBe(false);
    expect(linhaDaFotoDoPdv({ ...base, fachada: true, arquivo_id: null }, o).ver.ligado).toBe(false);
    expect(linhaDaFotoDoPdv({ ...base, fachada: true, situacao: 'falta' }, o)).toMatchObject({ trancada: false, data: '—', ver: { ligado: false } });
  });
});
