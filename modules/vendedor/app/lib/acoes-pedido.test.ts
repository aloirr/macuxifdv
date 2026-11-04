import { describe, expect, it } from 'vitest';

import { estadoDasAcoes, rotuloDoNivel, TEXTO_SEM_ITENS, type EntradaAcoes } from './acoes-pedido';

const base: EntradaAcoes = {
  status: 'queued',
  naFila: true,
  offline: false,
  v1: true,
  ehVendedor: true,
  temItens: true,
  pode: { editar: true, cancelar: true },
  acoes: { can_edit: true, can_cancel: true, locked_reason: '' },
};

describe('ações do detalhe do pedido', () => {
  it('P-2: pedido ainda no aparelho pode ser editado e excluído pelo vendedor', () => {
    expect(estadoDasAcoes(base)).toEqual({ podeEditar: true, podeExcluir: true, motivoBloqueio: '' });
  });
  it('P-2: pedido aceito pelo servidor não se edita, explica e manda duplicar', () => {
    const r = estadoDasAcoes({ ...base, naFila: false, status: 'approved' });
    expect(r.podeEditar).toBe(false);
    expect(r.motivoBloqueio).toMatch(/Duplique/);
  });
  it('RN-PRO-01: sem a permissão da ação não edita nem exclui', () => {
    expect(estadoDasAcoes({ ...base, pode: { editar: false, cancelar: false } })).toMatchObject({ podeEditar: false, podeExcluir: false });
  });
  it('Gestão (não é o vendedor): não edita', () => {
    expect(estadoDasAcoes({ ...base, ehVendedor: false }).podeEditar).toBe(false);
  });
  it('sem sinal, pedido já enviado não exclui e diz por quê', () => {
    const r = estadoDasAcoes({ ...base, naFila: false, offline: true, ehVendedor: false });
    expect(r.podeExcluir).toBe(false);
    expect(r.motivoBloqueio).toMatch(/Sem sinal/);
  });
  it('sem itens no aparelho: texto de sincronização, não "com sinal"', () => {
    expect(estadoDasAcoes({ ...base, temItens: false }).motivoBloqueio).toBe(TEXTO_SEM_ITENS);
  });
  it('RN-VEN-18: orçamento aberto já recebido edita (com sinal) e explica a falta de sinal; sem permissão não edita', () => {
    const orc = { ...base, naFila: false, status: 'received', orcamentoAberto: true };
    expect(estadoDasAcoes(orc)).toMatchObject({ podeEditar: true, motivoBloqueio: '' });
    expect(estadoDasAcoes({ ...orc, offline: true })).toMatchObject({ podeEditar: false });
    expect(estadoDasAcoes({ ...orc, offline: true }).motivoBloqueio).toMatch(/Sem sinal/);
    expect(estadoDasAcoes({ ...orc, pode: { editar: false, cancelar: true } }).podeEditar).toBe(false);
  });
  it('rótulo do nível de aprovação', () => {
    expect(rotuloDoNivel('gerente')).toBe('Gerente');
  });
});
