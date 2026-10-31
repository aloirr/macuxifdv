import { describe, expect, it } from 'vitest';
import { avancarCursor, compararCursor, cursorDoLote, depoisDoCursor, maiorCursor } from './cursor';

const c = (alterado_em: string, external_id: string) => ({ alterado_em, external_id });

describe('RN-INT-05: cursor de delta (alterado_em, external_id)', () => {
  it('RN-INT-05: compara por instante e desempata por external_id', () => {
    expect(compararCursor(c('2026-10-31T10:00:00Z', 'A'), c('2026-10-31T11:00:00Z', 'A'))).toBeLessThan(0);
    expect(compararCursor(c('2026-10-31T10:00:00Z', 'B'), c('2026-10-31T10:00:00Z', 'A'))).toBeGreaterThan(0);
    expect(compararCursor(c('2026-10-31T10:00:00Z', 'A'), c('2026-10-31T10:00:00.000Z', 'A'))).toBe(0);
  });

  it('RN-INT-05: o cursor do lote é o maior par das linhas aceitas', () => {
    expect(cursorDoLote([c('2026-10-31T10:00:00Z', 'A'), c('2026-10-31T12:00:00Z', 'B'), c('2026-10-31T12:00:00Z', 'C'), c('2026-10-31T09:00:00Z', 'Z')])).toEqual(c('2026-10-31T12:00:00Z', 'C'));
    expect(cursorDoLote([])).toBeNull();
    expect(maiorCursor([null, c('2026-10-31T10:00:00Z', 'A'), null])).toEqual(c('2026-10-31T10:00:00Z', 'A'));
  });

  it('RN-INT-05: só avança quando o lote termina (concluido ou concluido_com_erros)', () => {
    const atual = c('2026-10-31T10:00:00Z', 'A');
    const novo = c('2026-10-31T12:00:00Z', 'B');
    expect(avancarCursor(atual, novo, 'concluido')).toEqual({ cursor: novo, avancou: true });
    expect(avancarCursor(atual, novo, 'concluido_com_erros')).toEqual({ cursor: novo, avancou: true });
    for (const s of ['recebido', 'processando', 'falhou'] as const) expect(avancarCursor(atual, novo, s)).toEqual({ cursor: atual, avancou: false });
  });

  it('RN-INT-05: nunca retrocede (reenvio antigo é aceito sem voltar o cursor)', () => {
    const atual = c('2026-10-31T12:00:00Z', 'B');
    expect(avancarCursor(atual, c('2026-10-30T08:00:00Z', 'A'), 'concluido')).toEqual({ cursor: atual, avancou: false });
    expect(avancarCursor(atual, atual, 'concluido').avancou).toBe(false);
    expect(avancarCursor(atual, null, 'concluido')).toEqual({ cursor: atual, avancou: false });
  });

  it('RN-INT-05: primeiro lote define o cursor', () => {
    const novo = c('2026-10-31T12:00:00Z', 'B');
    expect(avancarCursor(null, novo, 'concluido')).toEqual({ cursor: novo, avancou: true });
    expect(avancarCursor(null, null, 'concluido')).toEqual({ cursor: null, avancou: false });
  });

  it('RN-INT-05: depoisDoCursor decide quem o Conector deve enviar (par estritamente maior)', () => {
    const cur = c('2026-10-31T10:00:00Z', 'M');
    expect(depoisDoCursor(cur, c('2026-10-31T10:00:00Z', 'N'))).toBe(true);
    expect(depoisDoCursor(cur, c('2026-10-31T10:00:00Z', 'M'))).toBe(false);
    expect(depoisDoCursor(cur, c('2026-10-31T09:59:59Z', 'Z'))).toBe(false);
    expect(depoisDoCursor(null, c('2020-01-01T00:00:00Z', 'A'))).toBe(true);
  });
});
