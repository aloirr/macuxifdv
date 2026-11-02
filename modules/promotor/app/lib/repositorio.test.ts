import type { ArmazenamentoSync } from '@macuxi/platform-sdk';
import { describe, expect, it } from 'vitest';
import { criarRepositorioLoja, visitaDaLoja } from './repositorio';

function memoria(): ArmazenamentoSync {
  const m = new Map<string, unknown>();
  return {
    ler: async <T>(k: string) => (m.has(k) ? (structuredClone(m.get(k)) as T) : null),
    gravar: async (k, v) => void (v == null ? m.delete(k) : m.set(k, structuredClone(v))),
    remover: async (k) => void m.delete(k),
    chaves: async (p) => [...m.keys()].filter((k) => k.startsWith(p)).sort(),
  };
}

const V = { id: 'vl-1', visita_id: 'core-1', cliente_id: 'loja', checklist_modelo_id: null, checkin_em: '2026-11-03T13:00:00.000Z', checkout_em: null, permanencia_min: null, desfecho: null, foto_fachada_id: null, observacao: null };

describe('estado local da aba Loja (offline)', () => {
  it('guarda a visita de loja e acha pela visita do Core', async () => {
    const r = criarRepositorioLoja(memoria());
    await r.guardarVisita(V);
    const d = await r.carregar();
    expect(visitaDaLoja(d, 'core-1')?.id).toBe('vl-1');
    expect(visitaDaLoja(d, 'core-2')).toBeNull();
    expect(visitaDaLoja(d, null)).toBeNull();
  });

  it('o mesmo assunto (chave) substitui o registro anterior da visita', async () => {
    const r = criarRepositorioLoja(memoria());
    await r.registrar('vl-1', { entidade: 'medicao_share', id: 'a', chave: 'share:cat', rotulo: '30%' });
    await r.registrar('vl-1', { entidade: 'medicao_share', id: 'b', chave: 'share:cat', rotulo: '35%' });
    await r.registrar('vl-1', { entidade: 'ruptura_item', id: 'c', chave: 'ruptura:mix', rotulo: 'Presente' });
    expect((await r.carregar()).registros['vl-1']!.map((x) => x.id)).toEqual(['b', 'c']);
  });

  it('último preço por loja e produto (RN-PRO-04)', async () => {
    const r = criarRepositorioLoja(memoria());
    await r.guardarPreco('loja', 'p1', 1090);
    expect((await r.carregar()).precos).toEqual({ 'loja:p1': 1090 });
  });
});
