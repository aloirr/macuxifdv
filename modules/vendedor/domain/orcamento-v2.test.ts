/**
 * T-0071 (desenho §1): orçamento v2 — validade do preço por data civil (RN-VEN-18), ações por situação e opções do Salvar
 * (RN-VEN-13). Funções puras; o "agora" é sempre argumento. T-0141: o orçamento não expira; só o preço congelado vale 7 dias.
 */
import { describe, expect, it } from 'vitest';

import { acoesDoOrcamento, avisoSoOrcamento, situacaoDoOrcamento, textoPrecoDe, validadeDoOrcamento, verificarTipoParaCliente } from './orcamento';

const MANAUS = 'America/Manaus';

describe('RN-VEN-18: validade do preço por data civil no fuso do tenant', () => {
  it('RN-VEN-18: criado em 2026-11-03T16:32Z (Manaus), 7 dias → data 2026-11-10 e o preço vale até 2026-11-11T04:00:00Z', () => {
    expect(validadeDoOrcamento('2026-11-03T16:32:00.000Z', 7, MANAUS)).toEqual({ data: '2026-11-10', ate: '2026-11-11T04:00:00.000Z' });
  });
  it('RN-VEN-18: a data civil é a do fuso, não a do UTC (02:00Z ainda é o dia anterior em Manaus)', () => {
    expect(validadeDoOrcamento('2026-11-04T02:00:00.000Z', 7, MANAUS).data).toBe('2026-11-10');
  });
  it('RN-VEN-18 (09/11): o orçamento não vence — passada a validade do preço, segue aberto', () => {
    const o = { status: 'received', validade_ate: '2026-11-11T04:00:00.000Z', convertido_pedido_id: null };
    expect(situacaoDoOrcamento(o, new Date('2026-11-11T03:59:59.000Z'))).toBe('aberto');
    expect(situacaoDoOrcamento(o, new Date('2026-11-11T04:00:00.000Z'))).toBe('aberto');
  });
});

describe('RN-VEN-18: ações por situação (desenho §1.2)', () => {
  it('RN-VEN-18: aberto — transformar, editar, duplicar, PDF e cancelar', () => {
    expect(acoesDoOrcamento('aberto')).toMatchObject({ pode_converter: true, pode_editar: true, pode_duplicar: true, pode_pdf: true, pode_cancelar: true });
  });
  it('RN-VEN-18: convertido — duplicar e PDF', () => {
    expect(acoesDoOrcamento('convertido')).toMatchObject({ pode_converter: false, pode_editar: false, pode_duplicar: true, pode_pdf: true, pode_cancelar: false });
  });
  it('RN-VEN-18: cancelado — só duplicar', () => {
    expect(acoesDoOrcamento('cancelado')).toMatchObject({ pode_converter: false, pode_editar: false, pode_duplicar: true, pode_pdf: false, pode_cancelar: false });
  });
});

describe('RN-VEN-13 (T-0071): cadastro incompleto ou bloqueado só faz orçamento', () => {
  const ok = { ativo: true, bloqueado: false, cadastro_incompleto: false, campos_faltantes: [] as string[] };
  it('RN-VEN-13: cliente completo faz pedido; incompleto, bloqueado ou inativo só orçamento (422)', () => {
    expect(verificarTipoParaCliente('pedido', ok)).toBeNull();
    for (const c of [{ ...ok, cadastro_incompleto: true, campos_faltantes: ['CEP'] }, { ...ok, bloqueado: true }, { ...ok, ativo: false }]) {
      expect(verificarTipoParaCliente('pedido', c)).toMatchObject({ codigo: 'RN-VEN-13', http: 422 });
      expect(verificarTipoParaCliente('orcamento', c)).toBeNull();
    }
    expect(verificarTipoParaCliente('pedido', { ...ok, cadastro_incompleto: true, campos_faltantes: ['CEP', 'e-mail'] })!.mensagem).toMatch(/CEP, e-mail/);
  });
  it('RN-VEN-13: avisoSoOrcamento e textoPrecoDe (única montagem do texto da data do preço)', () => {
    expect(textoPrecoDe('2026-11-10')).toBe('Preço de 10/11');
    expect(avisoSoOrcamento(ok)).toBeNull();
    expect(avisoSoOrcamento({ ...ok, bloqueado: true })).toMatch(/bloqueado/);
  });
});
