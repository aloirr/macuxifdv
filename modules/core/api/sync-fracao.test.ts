import { describe, expect, it } from 'vitest';
import { entidadeProdutoUnidade, provedoresSyncCore } from './sync';
import { unidadesParaCliente } from './sync-fracao';

const linha = (fator: string | number, id = 'u1') => ({ id, updated_at: '2026-11-25T10:00:00.000000Z', deleted_at: null, produto_id: 'p1', unidade: 'CX', fator, ean: null, padrao: false, ativo: true }) as never;

describe('RN-VEN-15 v3 / ADR 0076 D6: pull de produto_unidade por versão do app', () => {
  it('RN-VEN-15: o numeric do banco (texto) vira número no fio, com ou sem fração', () => {
    const r = unidadesParaCliente([linha('12.0000'), linha('12.5000', 'u2')], true) as unknown as Array<{ fator: number }>;
    expect(r.map((l) => l.fator)).toEqual([12, 12.5]);
  });

  it('ADR 0076 D6: app sem cabeçalho ou abaixo da 1.0.36 (VERSAO_APP_FRACAO) não recebe a unidade de fator fracionário (mas recebe as inteiras)', () => {
    const r = unidadesParaCliente([linha('12.0000'), linha('12.5000', 'u2'), linha('1.0000', 'u3')], false) as unknown as Array<{ id: string; fator: number }>;
    expect(r.map((l) => l.id)).toEqual(['u1', 'u3']);
    expect(r.map((l) => l.fator)).toEqual([12, 1]);
  });

  it('ADR 0076 D6: o provedor do Core varia o escopo de produto_unidade por versão do app (1.0.36 aceita fração)', () => {
    const prov = provedoresSyncCore.find((p) => p.entidade === entidadeProdutoUnidade);
    expect(prov?.variacaoEscopo?.({ versaoApp: { doCliente: { variante: 'campo', versao: '1.0.36' } } } as never)).toBe('fracao=1');
    expect(prov?.variacaoEscopo?.({ versaoApp: { doCliente: { variante: 'campo', versao: '1.0.35' } } } as never)).toBe('fracao=0');
  });
});
