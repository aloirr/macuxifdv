import { describe, expect, it } from 'vitest';
import { rotaErrosLote, rotaLote } from './bko-lotes-consulta';
import { criarRotasConectores } from './bko-conectores';

describe('T-0087: rotas de consulta do lote aceitam o super-admin (ADR 0029)', () => {
  const conectores = criarRotasConectores({ pepper: () => undefined });
  it('RF-INT-04: lotes, erros e conectores (listar e criar) têm superAdmin aceita; ações de risco continuam só do usuário', () => {
    for (const r of [rotaLote, rotaErrosLote]) expect(r.superAdmin, r.caminho).toBe('aceita');
    const porChave = (m: string, c: string) => conectores.find((r) => r.metodo === m && r.caminho === c);
    expect(porChave('GET', 'conectores')?.superAdmin).toBe('aceita');
    expect(porChave('POST', 'conectores')?.superAdmin).toBe('aceita');
    expect(porChave('PATCH', 'conectores/:id')?.superAdmin).toBe('aceita');
    expect(conectores.filter((r) => r.superAdmin).length).toBe(3);
  });

  it('RF-INT-04: as duas rotas são de leitura do monitor (monitor.ver) e não existe mais rota de carga por arquivo', () => {
    for (const r of [rotaLote, rotaErrosLote]) expect([r.metodo, r.acao]).toEqual(['GET', 'monitor.ver']);
    expect([rotaLote.caminho, rotaErrosLote.caminho]).toEqual(['lotes/:id', 'lotes/:id/erros']);
  });
});
