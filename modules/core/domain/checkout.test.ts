import { describe, expect, it } from 'vitest';
import { avaliarCheckout, ehClienteFechado, type EtapaCheckoutAvaliavel, avaliarCheckoutVisita } from './checkout';

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

describe('avaliarCheckoutVisita — resultado × Vendedor efetivo (RN-CORE-12 e RN-CORE-14)', () => {
  const etapaPendente = { rotulo: 'Pesquisa', obrigatoria: true, concluida: false };
  const base = { vendedorEfetivo: true, temMotivo: false, motivoClienteFechado: false, fotoFachada: false, temPedido: false, etapas: [] };

  it('RN-CORE-12: sem pedido exige motivo quando o Vendedor está ativo', () => {
    const r = avaliarCheckoutVisita({ ...base, resultado: 'sem_pedido' });
    expect(r.pode).toBe(false);
    expect(r.pendencias).toEqual(['motivo']);
    expect(avaliarCheckoutVisita({ ...base, resultado: 'sem_pedido', temMotivo: true }).pode).toBe(true);
  });

  it('RN-CORE-12: promotor (sem Vendedor efetivo) fecha como atendido sem motivo', () => {
    expect(avaliarCheckoutVisita({ ...base, vendedorEfetivo: false, resultado: 'atendido' }).pode).toBe(true);
  });

  it('RN-CORE-12: com Vendedor efetivo, "atendido" não vale — escolha pedido ou sem pedido', () => {
    expect(avaliarCheckoutVisita({ ...base, resultado: 'atendido' }).pendencias).toEqual(['resultado']);
  });

  it('RN-CORE-12: resultado com pedido exige o pedido feito na visita', () => {
    expect(avaliarCheckoutVisita({ ...base, resultado: 'pedido' }).pendencias).toEqual(['pedido']);
    expect(avaliarCheckoutVisita({ ...base, resultado: 'pedido', temPedido: true }).pode).toBe(true);
  });

  it('RN-CORE-12: etapa obrigatória pendente de módulo ativo bloqueia o checkout', () => {
    const r = avaliarCheckoutVisita({ ...base, resultado: 'sem_pedido', temMotivo: true, etapas: [etapaPendente] });
    expect(r.pendencias).toEqual(['Pesquisa']);
  });

  it('RN-CORE-14: cliente fechado exige motivo da lista fechada e foto da fachada', () => {
    const r = avaliarCheckoutVisita({ ...base, resultado: 'cliente_fechado' });
    expect(r.pendencias).toEqual(['motivo', 'foto_fachada']);
    expect(avaliarCheckoutVisita({ ...base, resultado: 'cliente_fechado', motivoClienteFechado: true, fotoFachada: true }).pode).toBe(true);
  });

  it('RN-CORE-14: cliente fechado dispensa as etapas obrigatórias (pesquisa, checklist)', () => {
    const r = avaliarCheckoutVisita({ ...base, vendedorEfetivo: false, resultado: 'cliente_fechado', motivoClienteFechado: true, fotoFachada: true, etapas: [etapaPendente] });
    expect(r.pode).toBe(true);
    expect(r.etapasDispensadas).toBe(true);
  });
});
