import { describe, expect, it } from 'vitest';
import { migrarSalvosGuardados } from './migrar-salvos';
import type { Rascunho } from './pedidos';

const rasc = (x: Partial<Rascunho> = {}): Rascunho =>
  ({ customer_id: 'c1', lines: { p1: 2 }, discount_pct: 0, payment_terms: '', visit_id: null, route_stop_id: null, updated_at: '2026-11-24T14:00:00Z', salvo_em: '2026-11-24T14:00:00Z', ...x }) as Rascunho;

function repoDe(inicial: Record<string, Rascunho>) {
  const mapa = { ...inicial };
  return {
    mapa,
    carregar: async () => ({ rascunhos: { ...mapa } }),
    guardarRascunho: async (k: string, r: Rascunho) => void (mapa[k] = r),
    limparRascunho: async (k: string) => void delete mapa[k],
  };
}

describe('RN-VEN-39/48: migração dos salvos guardados na chave do cliente', () => {
  it('RN-VEN-48: passa o salvo para a chave própria sem perder nada; o em digitação não muda', async () => {
    const salvo = rasc({ notice: 'aviso', lines: { p1: 2, p2: 1 } });
    const digitando = rasc({ customer_id: 'c2', salvo_em: null });
    const repo = repoDe({ c1: salvo, c2: digitando });
    let n = 0;
    expect(await migrarSalvosGuardados(repo, () => `u-${++n}`)).toEqual([{ de: 'c1', para: 'u-1' }]);
    expect(repo.mapa).toEqual({ 'u-1': salvo, c2: digitando });
  });
  it('RN-VEN-48: rodar de novo não duplica nem muda nada (idempotente)', async () => {
    const repo = repoDe({ c1: rasc() });
    let n = 0;
    await migrarSalvosGuardados(repo, () => `u-${++n}`);
    const foto = JSON.stringify(repo.mapa);
    expect(await migrarSalvosGuardados(repo, () => `u-${++n}`)).toEqual([]);
    expect(JSON.stringify(repo.mapa)).toBe(foto);
  });
  it('RN-VEN-48: gravação interrompida (cópia já existe, chave antiga também): só a antiga sai', async () => {
    const repo = repoDe({ c1: rasc(), 'u-7': rasc() });
    await migrarSalvosGuardados(repo, () => 'u-novo');
    expect(Object.keys(repo.mapa)).toEqual(['u-7']);
  });
});
