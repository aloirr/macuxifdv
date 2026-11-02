import { describe, expect, it } from 'vitest';
import { cadastrosDaLoja, cadastroValeParaLoja, checklistDaLoja, metaDaCategoria } from './alvo';

const LOJA = { id: 'loja-1', segmento: 'supermercado' };
const c = (x: Partial<{ id: string; cliente_id: string | null; segmento: string | null; vigencia_inicio: string; vigencia_fim: string | null; deleted_at: string | null }>) => ({
  id: 'c',
  cliente_id: null,
  segmento: null,
  vigencia_inicio: '2026-10-01',
  vigencia_fim: null,
  deleted_at: null,
  ...x,
});

describe('RN-PRO-10: cadastro vigente e do alvo da loja', () => {
  it('RN-PRO-10: alvo = a loja, o segmento da loja ou todas (nulos)', () => {
    expect(cadastroValeParaLoja(c({}), LOJA, '2026-11-03')).toBe(true);
    expect(cadastroValeParaLoja(c({ cliente_id: 'loja-1' }), LOJA, '2026-11-03')).toBe(true);
    expect(cadastroValeParaLoja(c({ cliente_id: 'loja-2' }), LOJA, '2026-11-03')).toBe(false);
    expect(cadastroValeParaLoja(c({ segmento: 'supermercado' }), LOJA, '2026-11-03')).toBe(true);
    expect(cadastroValeParaLoja(c({ segmento: 'farmacia' }), LOJA, '2026-11-03')).toBe(false);
  });

  it('RN-PRO-10: fora da vigência ou removido não vale', () => {
    expect(cadastroValeParaLoja(c({ vigencia_inicio: '2026-11-04' }), LOJA, '2026-11-03')).toBe(false);
    expect(cadastroValeParaLoja(c({ vigencia_fim: '2026-11-02' }), LOJA, '2026-11-03')).toBe(false);
    expect(cadastroValeParaLoja(c({ vigencia_fim: '2026-11-03' }), LOJA, '2026-11-03')).toBe(true);
    expect(cadastroValeParaLoja(c({ deleted_at: '2026-11-01T00:00:00Z' }), LOJA, '2026-11-03')).toBe(false);
  });

  it('RN-PRO-10: lista filtra pelo alvo e pela vigência', () => {
    const r = cadastrosDaLoja([c({ id: 'a' }), c({ id: 'b', cliente_id: 'loja-2' }), c({ id: 'd', segmento: 'supermercado' })], LOJA, '2026-11-03');
    expect(r.map((x) => x.id)).toEqual(['a', 'd']);
  });

  it('RN-PRO-10: checklist = o mais específico (loja > segmento > todas) e, empatado, o de início mais recente', () => {
    const lista = [c({ id: 'geral' }), c({ id: 'seg', segmento: 'supermercado' }), c({ id: 'seg-novo', segmento: 'supermercado', vigencia_inicio: '2026-11-01' })];
    expect(checklistDaLoja(lista, LOJA, '2026-11-03')?.id).toBe('seg-novo');
    expect(checklistDaLoja([...lista, c({ id: 'loja', cliente_id: 'loja-1' })], LOJA, '2026-11-03')?.id).toBe('loja');
    expect(checklistDaLoja([c({ id: 'x', cliente_id: 'loja-9' })], LOJA, '2026-11-03')).toBeNull();
  });

  it('RN-PRO-03/10: meta da categoria = a mais específica vigente', () => {
    const metas = [
      { ...c({ id: 'm-geral' }), categoria_gondola_id: 'cat', meta_pct: 30 },
      { ...c({ id: 'm-loja', cliente_id: 'loja-1' }), categoria_gondola_id: 'cat', meta_pct: 45 },
      { ...c({ id: 'm-outra' }), categoria_gondola_id: 'outra', meta_pct: 10 },
    ];
    expect(metaDaCategoria(metas, 'cat', LOJA, '2026-11-03')).toMatchObject({ id: 'm-loja', meta_pct: 45 });
    expect(metaDaCategoria(metas, 'nada', LOJA, '2026-11-03')).toBeNull();
  });
});
