import { describe, expect, it } from 'vitest';
import { rotaErrosLote, rotaLote } from './bko-lotes-consulta';

describe('T-0087: rotas de consulta do lote aceitam o super-admin (ADR 0029)', () => {
  it('RF-INT-04: lotes e erros têm superAdmin aceita', () => {
    for (const r of [rotaLote, rotaErrosLote]) expect(r.superAdmin, r.caminho).toBe('aceita');
  });

  it('RF-INT-04: as duas rotas são de leitura do monitor (monitor.ver) e não existe mais rota de carga por arquivo', () => {
    for (const r of [rotaLote, rotaErrosLote]) expect([r.metodo, r.acao]).toEqual(['GET', 'monitor.ver']);
    expect([rotaLote.caminho, rotaErrosLote.caminho]).toEqual(['lotes/:id', 'lotes/:id/erros']);
  });
});
