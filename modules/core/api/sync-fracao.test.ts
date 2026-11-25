import { describe, expect, it } from 'vitest';
import { unidadesParaCliente, variacaoFracaoUnidades } from './sync-fracao';

const linha = (fator: string | number, id = 'u1') => ({ id, updated_at: '2026-11-25T10:00:00.000000Z', deleted_at: null, produto_id: 'p1', unidade: 'CX', fator, ean: null, padrao: false, ativo: true }) as never;

describe('RN-VEN-15 v3 / ADR 0076 D6: pull de produto_unidade por versão do app', () => {
  it('RN-VEN-15: o numeric do banco (texto) vira número no fio, com ou sem fração', () => {
    const r = unidadesParaCliente([linha('12.0000'), linha('12.5000', 'u2')], true) as unknown as Array<{ fator: number }>;
    expect(r.map((l) => l.fator)).toEqual([12, 12.5]);
  });

  it('ADR 0076 D6: app sem cabeçalho ou abaixo da 1.0.35 não recebe a unidade de fator fracionário (mas recebe as inteiras)', () => {
    const r = unidadesParaCliente([linha('12.0000'), linha('12.5000', 'u2'), linha('1.0000', 'u3')], false) as unknown as Array<{ id: string; fator: number }>;
    expect(r.map((l) => l.id)).toEqual(['u1', 'u3']);
    expect(r.map((l) => l.fator)).toEqual([12, 1]);
  });

  it('ADR 0076 D6: a variação do escopo muda quando o app passa a aceitar fração (o app que atualiza baixa de novo)', () => {
    const antigo = variacaoFracaoUnidades(null);
    const v1032 = variacaoFracaoUnidades({ variante: 'campo', versao: '1.0.32' });
    const v1035 = variacaoFracaoUnidades({ variante: 'campo', versao: '1.0.35' });
    expect(antigo).toBe(v1032);
    expect(v1035).not.toBe(antigo);
    expect(variacaoFracaoUnidades({ variante: 'gestao', versao: '1.0.36' })).toBe(v1035);
  });
});
