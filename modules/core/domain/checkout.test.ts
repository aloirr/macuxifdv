import { describe, expect, it } from 'vitest';
import { avaliarCheckout, ehClienteFechado, type EtapaCheckoutAvaliavel } from './checkout';

const pesquisa: EtapaCheckoutAvaliavel = { rotulo: 'Pesquisa', obrigatoria: true, concluida: false };
const checklist: EtapaCheckoutAvaliavel = { rotulo: 'Checklist da loja', obrigatoria: true, concluida: false };
const opcional: EtapaCheckoutAvaliavel = { rotulo: 'Nota', obrigatoria: false, concluida: false };

describe('RN-CORE-14: cliente fechado', () => {
  it('RN-CORE-14: loja_fechada e acesso_negado são cliente fechado; os demais motivos não', () => {
    expect(ehClienteFechado('loja_fechada')).toBe(true);
    expect(ehClienteFechado('acesso_negado')).toBe(true);
    expect(ehClienteFechado('estoque_alto')).toBe(false);
    expect(ehClienteFechado(null)).toBe(false);
  });

  it('RN-CORE-14: cliente fechado sem foto da fachada bloqueia o checkout', () => {
    const r = avaliarCheckout({ resultado: 'no_order', motivo: 'loja_fechada', fotoFachada: false, etapas: [] });
    expect(r).toMatchObject({ pode: false, pendencias: ['foto_fachada'] });
  });

  it('RN-CORE-14: cliente fechado com foto dispensa todas as etapas obrigatórias', () => {
    const r = avaliarCheckout({ resultado: 'no_order', motivo: 'acesso_negado', fotoFachada: true, etapas: [pesquisa, checklist] });
    expect(r).toEqual({ pode: true, pendencias: [], etapasDispensadas: true });
  });
});

describe('RN-CORE-12: etapas obrigatórias do checkout', () => {
  it('RN-CORE-12: etapa obrigatória pendente bloqueia o checkout', () => {
    const r = avaliarCheckout({ resultado: 'order', motivo: null, fotoFachada: false, etapas: [pesquisa, opcional] });
    expect(r).toEqual({ pode: false, pendencias: ['Pesquisa'], etapasDispensadas: false });
  });
  it('RN-CORE-12: etapa obrigatória concluída libera', () => {
    const r = avaliarCheckout({ resultado: 'order', motivo: null, fotoFachada: false, etapas: [{ ...pesquisa, concluida: true }] });
    expect(r.pode).toBe(true);
  });
  it('RN-CORE-12: sem pedido exige motivo; motivo comum não dispensa etapas', () => {
    expect(avaliarCheckout({ resultado: 'no_order', motivo: null, fotoFachada: false, etapas: [] })).toMatchObject({ pode: false, pendencias: ['motivo'] });
    expect(avaliarCheckout({ resultado: 'no_order', motivo: 'estoque_alto', fotoFachada: false, etapas: [pesquisa] })).toMatchObject({ pode: false, pendencias: ['Pesquisa'] });
  });
  it('RN-CORE-12: resultado ainda não escolhido bloqueia', () => {
    expect(avaliarCheckout({ resultado: null, motivo: null, fotoFachada: false, etapas: [] }).pode).toBe(false);
  });
});
