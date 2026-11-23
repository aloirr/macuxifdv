import { describe, expect, it } from 'vitest';
import { aplicarRetornoCliente, selecionarClientesPendentes, type ClienteNaFila } from './cliente-fila';

const U1 = '3f2b8c1e-7a4d-4e5b-9c6a-1d2e3f4a5b6c';
const U2 = '4f2b8c1e-7a4d-4e5b-9c6a-1d2e3f4a5b6d';
const T0 = '2026-11-23T12:00:00.000Z';
const linha = (o: Partial<ClienteNaFila> = {}): ClienteNaFila => ({ cliente_uuid: U1, estado: 'pendente', payload: { cliente_uuid: o.cliente_uuid ?? U1 }, aprovado_em: '2026-11-23T10:00:00.000Z', enviado_em: null, tentativas: 0, external_id: null, motivo: null, removido_em: null, ...o });
const ret = (o: Record<string, unknown> = {}) => ({ cliente_uuid: U1, status: 'vinculado' as const, external_id: 'C-100', ocorrido_em: T0, ...o });

describe('RN-INT-22: entrega ao Conector', () => {
  it('RN-INT-22: entrega pendentes por ordem de aprovação, com tentativa + 1, e marca como enviado', () => {
    const s = selecionarClientesPendentes([linha({ cliente_uuid: U2, aprovado_em: '2026-11-23T11:00:00.000Z' }), linha()], T0);
    expect(s.entregar.map((c) => c.cliente_uuid)).toEqual([U1, U2]);
    expect(s.entregar[0]!.tentativa).toBe(1);
    expect(s.atualizacoes[0]).toEqual({ cliente_uuid: U1, estado: 'enviado', enviado_em: T0, tentativas: 1 });
  });
  it('RN-INT-22: enviado antes do timeout não sai de novo; vencido volta com tentativa + 1', () => {
    expect(selecionarClientesPendentes([linha({ estado: 'enviado', enviado_em: '2026-11-23T11:55:00.000Z', tentativas: 1 })], T0).entregar).toHaveLength(0);
    const s = selecionarClientesPendentes([linha({ estado: 'enviado', enviado_em: '2026-11-23T11:30:00.000Z', tentativas: 1 })], T0);
    expect(s.entregar[0]!.tentativa).toBe(2);
    expect(s.reenviados).toEqual([U1]);
  });
  it('RN-INT-22: vinculado, rejeitado e removido não saem; o limite vale', () => {
    const fila = [linha({ estado: 'vinculado' }), linha({ estado: 'rejeitado' }), linha({ removido_em: T0 })];
    expect(selecionarClientesPendentes(fila, T0).entregar).toHaveLength(0);
    expect(selecionarClientesPendentes([linha(), linha({ cliente_uuid: U2 })], T0, { limite: 1 }).entregar).toHaveLength(1);
  });
});

describe('RN-INT-22: retorno do ERP', () => {
  it('RN-INT-22: cliente enviado + vinculado grava o código e publica o evento', () => {
    const r = aplicarRetornoCliente(linha({ estado: 'enviado' }), ret());
    expect(r).toMatchObject({ ok: true, repetido: false, publicar: true, atualizacao: { estado: 'vinculado', external_id: 'C-100' }, evento: { status: 'vinculado', external_id: 'C-100' } });
  });
  it('RN-INT-22: rejeitado_erp grava o motivo e fica rejeitado', () => {
    const r = aplicarRetornoCliente(linha({ estado: 'enviado' }), ret({ status: 'rejeitado_erp', external_id: null, motivo: ' CNPJ já existe ' }));
    expect(r).toMatchObject({ ok: true, publicar: true, atualizacao: { estado: 'rejeitado', external_id: null, motivo: 'CNPJ já existe' } });
  });
  it('RN-INT-22: o mesmo retorno de novo é repetição e não publica', () => {
    expect(aplicarRetornoCliente(linha({ estado: 'vinculado', external_id: 'C-100' }), ret())).toMatchObject({ ok: true, repetido: true, publicar: false });
    expect(aplicarRetornoCliente(linha({ estado: 'rejeitado', motivo: 'x' }), ret({ status: 'rejeitado_erp', external_id: null, motivo: 'x' }))).toMatchObject({ ok: true, repetido: true, publicar: false });
  });
  it('RN-INT-22: código diferente depois de vinculado é external_id_divergente (422)', () => {
    const r = aplicarRetornoCliente(linha({ estado: 'vinculado', external_id: 'C-100' }), ret({ external_id: 'C-200' }));
    expect(r).toMatchObject({ ok: false, codigo: 'external_id_divergente' });
  });
  it('RN-INT-22: cliente desconhecido, removido, ainda não entregue e rejeitado_erp após vínculo são recusados com mensagem e ação', () => {
    expect(aplicarRetornoCliente(null, ret())).toMatchObject({ ok: false, codigo: 'cliente_desconhecido' });
    expect(aplicarRetornoCliente(linha({ removido_em: T0 }), ret())).toMatchObject({ ok: false, codigo: 'cliente_desconhecido' });
    expect(aplicarRetornoCliente(linha(), ret())).toMatchObject({ ok: false, codigo: 'cliente_nao_entregue' });
    const r = aplicarRetornoCliente(linha({ estado: 'vinculado', external_id: 'C-100' }), ret({ status: 'rejeitado_erp', external_id: null, motivo: 'x' }));
    expect(r).toMatchObject({ ok: false, codigo: 'transicao_invalida' });
    expect(!r.ok && r.mensagem.length).toBeGreaterThan(20);
  });
  it('RN-INT-22: vínculo recusado depois (rejeitado pelo Core) não aceita outro código', () => {
    expect(aplicarRetornoCliente(linha({ estado: 'rejeitado', external_id: 'C-100', motivo: 'm' }), ret({ external_id: 'C-100' }))).toMatchObject({ ok: true, repetido: true, publicar: false });
    expect(aplicarRetornoCliente(linha({ estado: 'rejeitado', external_id: 'C-100', motivo: 'm' }), ret({ external_id: 'C-300' }))).toMatchObject({ ok: false, codigo: 'transicao_invalida' });
  });
});
