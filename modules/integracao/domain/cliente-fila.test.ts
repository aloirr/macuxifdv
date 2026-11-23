import { describe, expect, it } from 'vitest';
import { aplicarRetornoCliente, decidirEntradaClienteNaFila, errosRetornoSeguros, iguaisErrosRetorno, selecionarClientesPendentes, type ClienteNaFila } from './cliente-fila';

const U1 = '3f2b8c1e-7a4d-4e5b-9c6a-1d2e3f4a5b6c';
const U2 = '4f2b8c1e-7a4d-4e5b-9c6a-1d2e3f4a5b6d';
const T0 = '2026-11-23T12:00:00.000Z';
const H1 = 'a'.repeat(64);
const H2 = 'b'.repeat(64);
const linha = (o: Partial<ClienteNaFila> = {}): ClienteNaFila => ({ cliente_uuid: U1, estado: 'pendente', payload: { cliente_uuid: o.cliente_uuid ?? U1 }, recebido_em: '2026-11-23T10:00:00.000Z', enviado_em: null, tentativas: 0, external_id: null, motivo: null, removido_em: null, revisao: 1, hash: null, erros: null, ...o });
const ret = (o: Record<string, unknown> = {}) => ({ cliente_uuid: U1, status: 'vinculado' as const, external_id: 'C-100', ocorrido_em: T0, ...o });

describe('RN-INT-22: entrega ao Conector', () => {
  it('RN-INT-22: entrega pendentes por ordem de aprovação, com tentativa + 1, e marca como enviado', () => {
    const s = selecionarClientesPendentes([linha({ cliente_uuid: U2, recebido_em: '2026-11-23T11:00:00.000Z' }), linha()], T0);
    expect(s.entregar.map((c) => c.cliente_uuid)).toEqual([U1, U2]);
    expect(s.entregar[0]!.tentativa).toBe(1);
    expect(s.atualizacoes[0]).toEqual({ cliente_uuid: U1, estado: 'enviado', enviado_em: T0, tentativas: 1 });
  });
  it('RN-INT-22: payload da v1.0.27 (aprovado_em) sai com recebido_em da coluna, sem o campo antigo', () => {
    const s = selecionarClientesPendentes([linha({ payload: { cliente_uuid: U1, aprovado_em: '2026-11-20T10:00:00.000Z' } })], T0);
    expect(s.entregar[0]).toEqual({ cliente_uuid: U1, recebido_em: '2026-11-23T10:00:00.000Z', codigo_fdv: null, revisao: 1, hash: null, tentativa: 1 });
  });
  it('RN-INT-22: entrega o Código FDV do payload (ADR 0069 §10); ausente ou fora do formato sai null', () => {
    const s = selecionarClientesPendentes([linha({ payload: { cliente_uuid: U1, codigo_fdv: '00012' } }), linha({ cliente_uuid: U2, payload: { cliente_uuid: U2, codigo_fdv: 12 } })], T0);
    expect(s.entregar.map((c) => c.codigo_fdv)).toEqual(['00012', null]);
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
  it('RN-INT-22: vinculado sobre rejeitado da mesma revisão vale (o ERP manda): grava, publica e limpa motivo e erros', () => {
    const erros = [{ campo: 'cep', codigo: 'CEP_INVALIDO', mensagem: 'CEP inválido' }];
    const r = aplicarRetornoCliente(linha({ estado: 'rejeitado', revisao: 2, motivo: 'm', erros }), ret({ revisao: 2 }));
    expect(r).toMatchObject({ ok: true, repetido: false, obsoleto: false, gravar: true, publicar: true, revisao: 2, atualizacao: { estado: 'vinculado', external_id: 'C-100', motivo: null, erros: null }, evento: { status: 'vinculado', external_id: 'C-100', revisao: 2 } });
    // sem revisao no retorno (Conector antigo) = a revisão da linha: também vale
    expect(aplicarRetornoCliente(linha({ estado: 'rejeitado', motivo: 'm' }), ret())).toMatchObject({ ok: true, gravar: true, publicar: true });
  });
  it('RN-INT-22: pendente da revisão atual nunca entregue segue cliente_nao_entregue, mesmo depois de rejeitado em revisão anterior', () => {
    expect(aplicarRetornoCliente(linha({ estado: 'pendente', revisao: 2 }), ret({ revisao: 2 }))).toMatchObject({ ok: false, codigo: 'cliente_nao_entregue' });
  });
});

describe('RN-INT-22: revisão do pré-cadastro (ADR 0069)', () => {
  it('RN-INT-22: entrega revisao e hash das colunas, nunca os do payload', () => {
    const s = selecionarClientesPendentes([linha({ revisao: 2, hash: H2, payload: { cliente_uuid: U1, revisao: 9, hash: H1 } })], T0);
    expect(s.entregar[0]).toMatchObject({ revisao: 2, hash: H2, tentativa: 1 });
  });
  it('RN-INT-22: o reenvio reabre a mesma linha só com revisão maior e linha não vinculada; sem linha, insere', () => {
    expect(decidirEntradaClienteNaFila(null, { revisao: 1 })).toBe('inserir');
    expect(decidirEntradaClienteNaFila({ revisao: 1, estado: 'rejeitado' }, { revisao: 2 })).toBe('reabrir');
    expect(decidirEntradaClienteNaFila({ revisao: 2, estado: 'rejeitado' }, { revisao: 2 })).toBe('nada');
    expect(decidirEntradaClienteNaFila({ revisao: 3, estado: 'pendente' }, { revisao: 2 })).toBe('nada');
    expect(decidirEntradaClienteNaFila({ revisao: 1, estado: 'vinculado' }, { revisao: 2 })).toBe('nada');
    expect(decidirEntradaClienteNaFila({ revisao: 1, estado: 'enviado' }, { revisao: 1 })).toBe('nada');
  });
  it('RN-INT-22: retorno com revisão maior que a da linha é revisao_desconhecida (422)', () => {
    const r = aplicarRetornoCliente(linha({ estado: 'enviado', revisao: 1 }), ret({ revisao: 2 }));
    expect(r).toMatchObject({ ok: false, codigo: 'revisao_desconhecida', erros: [{ campo: 'revisao' }] });
  });
  it('RN-INT-22: rejeitado_erp de revisão antiga não sobrescreve a nova (obsoleto, sem gravar nem publicar)', () => {
    for (const estado of ['pendente', 'enviado', 'rejeitado'] as const) {
      const r = aplicarRetornoCliente(linha({ estado, revisao: 2, motivo: estado === 'rejeitado' ? 'novo' : null }), ret({ status: 'rejeitado_erp', external_id: null, motivo: 'antigo', revisao: 1 }));
      expect(r).toMatchObject({ ok: true, obsoleto: true, gravar: false, publicar: false, repetido: false, revisao: 2 });
    }
  });
  it('RN-INT-22: vinculado de revisão antiga vale (o cliente existe no ERP): grava e publica com a revisão informada', () => {
    const r = aplicarRetornoCliente(linha({ estado: 'pendente', revisao: 2 }), ret({ revisao: 1 }));
    expect(r).toMatchObject({ ok: true, obsoleto: false, gravar: true, publicar: true, revisao: 2, atualizacao: { estado: 'vinculado', external_id: 'C-100', erros: null }, evento: { status: 'vinculado', revisao: 1 } });
    expect(aplicarRetornoCliente(linha({ estado: 'vinculado', external_id: 'C-100', revisao: 2 }), ret({ revisao: 1 }))).toMatchObject({ ok: true, repetido: true, gravar: false });
    expect(aplicarRetornoCliente(linha({ estado: 'vinculado', external_id: 'C-100', revisao: 2 }), ret({ revisao: 1, external_id: 'C-9' }))).toMatchObject({ ok: false, codigo: 'external_id_divergente' });
  });
  it('RN-INT-22: sem revisao no retorno vale a revisão atual da linha (Conector antigo); o evento leva a revisão', () => {
    const r = aplicarRetornoCliente(linha({ estado: 'enviado', revisao: 3 }), ret());
    expect(r).toMatchObject({ ok: true, revisao: 3, evento: { revisao: 3 } });
  });
  it('RN-INT-22: rejeitado_erp com erros por campo grava os erros mascarados e cortados; o evento leva os erros', () => {
    const erros = [{ campo: ' documento ', codigo: 'DUPLICADO', mensagem: 'CNPJ 12.345.678/0001-90 já existe' }, { campo: 'cep', codigo: 'INVALIDO', mensagem: 'x'.repeat(400) }];
    const r = aplicarRetornoCliente(linha({ estado: 'enviado' }), ret({ status: 'rejeitado_erp', external_id: null, motivo: 'Cadastro inválido', erros }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.atualizacao.erros).toEqual([{ campo: 'documento', codigo: 'DUPLICADO', mensagem: 'CNPJ [cnpj] já existe' }, { campo: 'cep', codigo: 'INVALIDO', mensagem: 'x'.repeat(300) }]);
    expect(r.evento.erros).toEqual(r.atualizacao.erros);
    expect(JSON.stringify(r)).not.toContain('12.345.678/0001-90');
  });
  it('RN-INT-22: mesma revisão, mesmo motivo e mesmos erros (em outra ordem) é repetição; motivo ou erros diferentes é fato novo', () => {
    const e1 = { campo: 'cep', codigo: 'INVALIDO', mensagem: 'CEP inválido' };
    const e2 = { campo: 'documento', codigo: 'DUPLICADO', mensagem: 'Já existe' };
    const rejeitada = linha({ estado: 'rejeitado', revisao: 2, motivo: 'Cadastro inválido', erros: [e1, e2] });
    const rej = (o: Record<string, unknown>) => ret({ status: 'rejeitado_erp', external_id: null, revisao: 2, ...o });
    expect(aplicarRetornoCliente(rejeitada, rej({ motivo: ' Cadastro inválido ', erros: [e2, e1] }))).toMatchObject({ ok: true, repetido: true, gravar: false, publicar: false });
    expect(aplicarRetornoCliente(rejeitada, rej({ motivo: 'Outro motivo', erros: [e1, e2] }))).toMatchObject({ ok: true, repetido: false, gravar: true, publicar: true, atualizacao: { motivo: 'Outro motivo' } });
    expect(aplicarRetornoCliente(rejeitada, rej({ motivo: 'Cadastro inválido', erros: [e1] }))).toMatchObject({ ok: true, repetido: false, gravar: true, publicar: true });
    expect(aplicarRetornoCliente(linha({ estado: 'rejeitado', motivo: 'm' }), rej({ revisao: undefined, motivo: 'm' }))).toMatchObject({ repetido: true });
  });
  it('RN-INT-22: comparação de erros e erros seguros (nulo = lista vazia; até 50)', () => {
    expect(iguaisErrosRetorno({ motivo: 'a', erros: null }, { motivo: ' a ', erros: [] })).toBe(true);
    expect(iguaisErrosRetorno({ motivo: 'a', erros: null }, { motivo: 'b', erros: null })).toBe(false);
    expect(errosRetornoSeguros(Array.from({ length: 60 }, (_, i) => ({ campo: `c${i}`, codigo: 'X', mensagem: 'm' })))).toHaveLength(50);
    expect(errosRetornoSeguros(undefined)).toEqual([]);
  });
  it('RN-INT-22: campo, código e mensagem do erro do ERP saem sem dado pessoal', () => {
    const [e] = errosRetornoSeguros([{ campo: ' fulano@x.com.br ', codigo: '123.456.789-09', mensagem: 'Fone (92) 99123-4567 inválido' }]);
    expect(e).toEqual({ campo: '[e-mail]', codigo: '[cpf]', mensagem: 'Fone [telefone] inválido' });
  });
});
