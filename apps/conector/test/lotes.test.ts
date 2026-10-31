import { LoteEnvelope } from '@macuxi/integracao/contracts';
import { describe, expect, it } from 'vitest';
import { chaveDoLote, dividirRegistros, montarLotes } from '../src/lotes';

const reg = (i: number, extra = '') => ({ external_id: `c${i}`, alterado_em: '2026-01-01T00:00:00.000Z', razao_social: `Cliente ${i}${extra}` });
const entrada = (n: number, o: Partial<Parameters<typeof montarLotes>[0]> = {}) => ({
  entidade: 'cliente', modo: 'delta' as const, geracao: 1, registros: Array.from({ length: n }, (_, i) => reg(i)),
  cursorDeclarado: { alterado_em: '2026-01-01T00:00:00.000Z', external_id: 'c9' }, cursorLeitura: { alterado_em: '2026-01-01T00:00:00.000Z', external_id: 'c9' },
  maxLinhas: 5000, maxBytes: 4_000_000, enviadoEm: '2026-01-01T01:00:00.000Z', ...o,
});

describe('montagem de lotes no envelope do contrato', () => {
  it('o envelope montado passa no schema LoteEnvelope do contrato', () => {
    const [l] = montarLotes(entrada(2));
    expect(LoteEnvelope.safeParse(l?.envelope).success).toBe(true);
    expect(l?.envelope).toMatchObject({ versao_contrato: 'v1', entidade: 'cliente', modo: 'delta' });
  });

  it('divide por limite de linhas', () => {
    const lotes = montarLotes(entrada(7, { maxLinhas: 3 }));
    expect(lotes.map((l) => l.linhas)).toEqual([3, 3, 1]);
  });

  it('divide por limite de bytes, mesmo com poucas linhas', () => {
    const grandes = Array.from({ length: 5 }, (_, i) => reg(i, 'x'.repeat(1000)));
    const fatias = dividirRegistros(grandes, 5000, 2500);
    expect(fatias.length).toBeGreaterThan(1);
    expect(fatias.flat()).toHaveLength(5);
    for (const f of fatias) expect(Buffer.byteLength(JSON.stringify(f))).toBeLessThanOrEqual(2500);
  });

  it('um registro maior que o limite de bytes vai sozinho (nunca é perdido)', () => {
    const fatias = dividirRegistros([reg(1, 'y'.repeat(5000))], 10, 1000);
    expect(fatias).toHaveLength(1);
  });

  it('carga completa numera as partes e marca ultimo só no último lote da última página', () => {
    const sessao = { id: '11111111-1111-4111-8111-111111111111', primeiraParte: 3, ultimaPagina: true };
    const lotes = montarLotes(entrada(7, { modo: 'completo', maxLinhas: 3, sessao }));
    expect(lotes.map((l) => [l.parte, l.ultimo])).toEqual([[3, false], [4, false], [5, true]]);
    expect(lotes[2]?.envelope.sessao).toEqual({ id: sessao.id, parte: 5, ultimo: true });
    const naoUltima = montarLotes(entrada(3, { modo: 'completo', sessao: { ...sessao, ultimaPagina: false } }));
    expect(naoUltima.every((l) => !l.ultimo)).toBe(true);
  });

  it('só o último lote da página carrega o cursor a confirmar', () => {
    const lotes = montarLotes(entrada(7, { maxLinhas: 3 }));
    expect(lotes.map((l) => l.cursorConfirmar !== null)).toEqual([false, false, true]);
  });

  it('chave de idempotência: mesmo conteúdo → mesma chave; qualquer mudança → chave diferente', () => {
    const a = montarLotes(entrada(3))[0]?.chave;
    const b = montarLotes(entrada(3, { enviadoEm: '2030-01-01T00:00:00.000Z' }))[0]?.chave;
    expect(a).toBe(b); // o horário de montagem não entra na chave
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(montarLotes(entrada(4))[0]?.chave).not.toBe(a);
    expect(montarLotes(entrada(3, { geracao: 2 }))[0]?.chave).not.toBe(a);
    expect(montarLotes(entrada(3, { entidade: 'produto' }))[0]?.chave).not.toBe(a);
  });

  it('a chave não depende da ordem das propriedades nem de campos nulos', () => {
    const r1 = { external_id: 'a', alterado_em: 'x', nome: 'n' };
    const r2 = { nome: 'n', alterado_em: 'x', external_id: 'a', extra: null };
    expect(chaveDoLote({ entidade: 'cliente', modo: 'delta', geracao: 1, registros: [r1] })).toBe(chaveDoLote({ entidade: 'cliente', modo: 'delta', geracao: 1, registros: [r2] }));
  });
});
