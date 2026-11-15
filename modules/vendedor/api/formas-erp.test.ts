import type { ClienteBanco } from '@macuxi/platform-sdk';
import { describe, expect, it } from 'vitest';
import { aplicarFormaDoErp, aplicarPrazoDoErp, percentualDoRegistro, ReferenciaAusente } from './formas-erp';

interface Linha {
  id: string;
  codigo: string;
  external_id: string | null;
  deleted_at: string | null;
}

/** Banco de mentira só para os SELECT/UPDATE/INSERT deste arquivo (a AVISTA semeada, a apagada e as do ERP). */
function banco(tabelas: { forma_pagamento: Linha[]; prazo_pagamento: Linha[] }) {
  const gravado: Array<{ sql: string; params: unknown[] }> = [];
  let seq = 100;
  const db = {
    async query(sql: string, params: unknown[] = []) {
      const t = /vendedor\.(forma_pagamento|prazo_pagamento)/.exec(sql)![1] as 'forma_pagamento' | 'prazo_pagamento';
      const linhas = tabelas[t];
      if (/^select id from .* where external_id = \$1/.test(sql.trim())) return { rows: linhas.filter((l) => l.external_id === params[0] && !l.deleted_at).map((l) => ({ id: l.id })) };
      if (/^select id from .* where codigo = \$1 and external_id is null/.test(sql.trim())) return { rows: linhas.filter((l) => l.codigo === params[0] && l.external_id === null && !l.deleted_at).map((l) => ({ id: l.id })) };
      gravado.push({ sql: sql.trim().split(' ')[0]!, params });
      if (/^insert/i.test(sql.trim())) {
        const id = `novo-${++seq}`;
        linhas.push({ id, codigo: String(params[1] ?? ''), external_id: String(params[0]), deleted_at: null });
        return { rows: [{ id }] };
      }
      return { rows: [] };
    },
  } as unknown as ClienteBanco;
  return { db, gravado };
}

describe('P7 (T-0089): o consumidor adota pelo código a AVISTA semeada', () => {
  it('RN-VEN-24: a forma AVISTA do ERP adota a linha viva semeada (1 linha viva, com external_id), sem inserir outra', async () => {
    const t = { forma_pagamento: [{ id: 'f-semeada', codigo: 'AVISTA', external_id: null, deleted_at: null }], prazo_pagamento: [] };
    const { db, gravado } = banco(t);
    const r = await aplicarFormaDoErp(db, { external_id: 'FP-AV', codigo: 'avista', nome: 'À vista' });
    expect(r).toEqual({ id: 'f-semeada', acao: 'adotada' });
    expect(gravado.map((g) => g.sql)).toEqual(['update']);
    expect(gravado[0]!.params[1]).toBe('FP-AV');
  });
  it('RN-VEN-24: com a AVISTA apagada (a demo apaga a padrão), insere uma linha nova', async () => {
    const t = { forma_pagamento: [{ id: 'f-velha', codigo: 'AVISTA', external_id: null, deleted_at: '2026-11-01' }], prazo_pagamento: [] };
    const { db, gravado } = banco(t);
    const r = await aplicarFormaDoErp(db, { external_id: 'FP-AV', codigo: 'AVISTA', nome: 'À vista' });
    expect(r.acao).toBe('inserida');
    expect(r.id).not.toBe('f-velha');
    expect(gravado.map((g) => g.sql)).toEqual(['insert']);
  });
  it('RN-VEN-24: forma já conhecida pelo external_id só atualiza', async () => {
    const { db } = banco({ forma_pagamento: [{ id: 'f1', codigo: 'BOLETO', external_id: 'FP-BOL', deleted_at: null }], prazo_pagamento: [] });
    expect((await aplicarFormaDoErp(db, { external_id: 'FP-BOL', codigo: 'BOLETO', nome: 'Boleto bancário' })).acao).toBe('atualizada');
  });
  it('RN-VEN-24: o prazo AVISTA do ERP adota o prazo semeado e o prazo médio é calculado aqui', async () => {
    const t = {
      forma_pagamento: [{ id: 'f1', codigo: 'AVISTA', external_id: 'FP-AV', deleted_at: null }],
      prazo_pagamento: [{ id: 'p-semeado', codigo: 'AVISTA', external_id: null, deleted_at: null }],
    };
    const { db } = banco(t);
    const r = await aplicarPrazoDoErp(db, { external_id: 'PZ-AV', forma_external_id: 'FP-AV', codigo: 'AVISTA', parcelas_dias: [0], prazo_medio_dias: 99 });
    expect(r).toEqual({ id: 'p-semeado', acao: 'adotada', prazo_medio_dias: 0 });
  });
  it('RN-VEN-24: prazo 28/56 do ERP grava prazo médio 42 (o informado só confere)', async () => {
    const { db, gravado } = banco({ forma_pagamento: [{ id: 'f2', codigo: 'BOLETO', external_id: 'FP-BOL', deleted_at: null }], prazo_pagamento: [] });
    const r = await aplicarPrazoDoErp(db, { external_id: 'PZ-2856', forma_external_id: 'FP-BOL', codigo: 'bol-28-56', parcelas_dias: [28, 56] });
    expect(r).toMatchObject({ acao: 'inserida', prazo_medio_dias: 42 });
    expect(gravado[0]!.params).toContain(42);
    expect(gravado[0]!.params).toContain('28/56 dias');
  });
  it('RN-INT-04: prazo cuja forma ainda não chegou fica para reprocessar (referencia_ausente)', async () => {
    const { db } = banco({ forma_pagamento: [], prazo_pagamento: [] });
    await expect(aplicarPrazoDoErp(db, { external_id: 'PZ-1', forma_external_id: 'FP-X', codigo: 'X', parcelas_dias: [10] })).rejects.toBeInstanceOf(ReferenciaAusente);
  });
  it('RN-VEN-46: o percentual do ERP é gravado no prazo (insert) e ausente vale 0', async () => {
    const mk = () => banco({ forma_pagamento: [{ id: 'f2', codigo: 'BOLETO', external_id: 'FP-BOL', deleted_at: null }], prazo_pagamento: [] });
    const a = mk();
    await aplicarPrazoDoErp(a.db, { external_id: 'PZ-1', forma_external_id: 'FP-BOL', codigo: 'A', parcelas_dias: [0], percentual_ajuste: -1.71 });
    expect(a.gravado[0]!.sql).toBe('insert');
    expect(a.gravado[0]!.params).toContain(-1.71);
    const b = mk();
    await aplicarPrazoDoErp(b.db, { external_id: 'PZ-2', forma_external_id: 'FP-BOL', codigo: 'B', parcelas_dias: [0] });
    expect(b.gravado[0]!.params).toContain(0);
  });
  it('RN-VEN-46: na atualização o percentual do ERP também é gravado', async () => {
    const { db, gravado } = banco({ forma_pagamento: [{ id: 'f2', codigo: 'BOLETO', external_id: 'FP-BOL', deleted_at: null }], prazo_pagamento: [{ id: 'p1', codigo: 'A', external_id: 'PZ-1', deleted_at: null }] });
    await aplicarPrazoDoErp(db, { external_id: 'PZ-1', forma_external_id: 'FP-BOL', codigo: 'A', parcelas_dias: [0], percentual_ajuste: 3.5 });
    expect(gravado[0]!.sql).toBe('update');
    expect(gravado[0]!.params).toContain(3.5);
  });
  it('RN-VEN-46: leitura tolerante do registro: número válido passa; texto, fora da faixa ou ausente viram 0', () => {
    expect(percentualDoRegistro({ percentual_ajuste: -2.5 })).toBe(-2.5);
    expect(percentualDoRegistro({ percentual_ajuste: '1.5' })).toBe(1.5);
    expect(percentualDoRegistro({ percentual_ajuste: 'x' })).toBe(0);
    expect(percentualDoRegistro({ percentual_ajuste: 120 })).toBe(0);
    expect(percentualDoRegistro({})).toBe(0);
    expect(percentualDoRegistro(undefined)).toBe(0);
  });
});
