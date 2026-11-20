import { describe, expect, it } from 'vitest';
import { descricaoPrazo, prazoMedioDias, validarPagamento, type FormaDePagamento, type PrazoDePagamento } from '../../domain/pagamento';
import { comForma, comValoresMantendoPercentual, comPrazo, opcoesDeForma, opcoesDePrazo, rascunhoComPagamentoPadrao, situacaoDoPagamento } from './pagamento-pedido';
import { rascunhoVazio } from './pedidos';

const f = (id: string, codigo: string, ordem: number): FormaDePagamento => ({ id, codigo, nome: codigo === 'PIX' ? 'Pix' : 'Boleto', ativo: true, ordem });
const p = (id: string, forma: string, parcelas: number[], ordem = 0): PrazoDePagamento => ({
  id,
  forma_pagamento_id: forma,
  codigo: id,
  descricao: descricaoPrazo(parcelas),
  parcelas_dias: parcelas,
  prazo_medio_dias: prazoMedioDias(parcelas),
  ordem,
  ativo: true,
});
const formas = [f('fpix', 'PIX', 1), f('fbol', 'BOLETO', 2)];
const prazos = [p('avista', 'fpix', [0]), p('b28', 'fbol', [28], 1), p('b2856', 'fbol', [28, 56], 2), p('b306090', 'fbol', [30, 60, 90], 3)];
const cliente = { formas_pagamento: null };
const r0 = rascunhoVazio('c1');

describe('RN-VEN-24/25: listas de forma e prazo no Novo pedido', () => {
  it('RN-VEN-24: o Prazo mostra só os prazos da forma, sem "médio"', () => {
    const o = opcoesDePrazo(prazos, 'fbol');
    expect(o.map((x) => x.rotulo)).toEqual(['28 dias', '28/56 dias', '30/60/90 dias']);
    expect(o.every((x) => !/médio/i.test(x.rotulo))).toBe(true);
  });
  it('RN-VEN-25: todos os prazos ativos da forma ficam disponíveis no app e são aceitos pela regra da API', () => {
    const o = opcoesDePrazo(prazos, 'fbol');
    expect(o.map((x) => x.id)).toEqual(['b28', 'b2856', 'b306090']);
    expect(o.every((x) => x.desabilitada === undefined)).toBe(true);
    for (const x of o) expect(validarPagamento({ forma: formas[1], prazo: prazos.find((z) => z.id === x.id), cliente })).toEqual({ ok: true });
  });
  it('RN-VEN-24: sem forma escolhida, o Prazo não tem opções', () => expect(opcoesDePrazo(prazos, null)).toEqual([]));
  it('RN-VEN-25: as formas seguem a lista do cliente', () => {
    const o = opcoesDeForma(formas, { formas_pagamento: ['PIX'] });
    expect(o.map((x) => x.id)).toEqual(['fpix', 'fbol']);
    expect(o[1]).toMatchObject({ desabilitada: true, motivo: 'Este cliente não aceita esta forma' });
    expect(o[0]!.desabilitada).toBeUndefined();
  });
});

describe('RN-VEN-24: padrão, troca de forma e pendências', () => {
  it('RN-VEN-24: o rascunho sem pagamento recebe a primeira forma permitida e o primeiro prazo', () => {
    const r = rascunhoComPagamentoPadrao(r0, formas, prazos, cliente);
    expect(r).toMatchObject({ forma_pagamento_id: 'fpix', prazo_pagamento_id: 'avista', payment_terms: 'Pix · À vista', condicao_pagamento_id: null });
  });
  it('RN-VEN-24: pagamento válido do rascunho não é trocado', () => {
    const r = comPrazo({ ...r0, forma_pagamento_id: 'fbol' }, 'b2856', formas, prazos);
    expect(rascunhoComPagamentoPadrao(r, formas, prazos, cliente)).toBe(r);
  });
  it('T-0129: escolher Boleto sem prazo ainda não volta para Pix / À vista (sem troca silenciosa)', () => {
    const r = comForma(rascunhoComPagamentoPadrao(r0, formas, prazos, cliente), formas[1]!, prazos);
    expect(r.prazo_pagamento_id).toBeNull();
    expect(rascunhoComPagamentoPadrao(r, formas, prazos, cliente)).toBe(r);
  });
  it('RN-VEN-25: forma que o cadastro não aceita não é trocada; a pendência pede outra forma', () => {
    const r = comPrazo(r0, 'b28', formas, prazos);
    const c = { formas_pagamento: ['PIX'] };
    expect(rascunhoComPagamentoPadrao(r, formas, prazos, c)).toBe(r);
    expect(situacaoDoPagamento(r, formas, prazos, c).tipo).toBe('invalido');
  });
  it('RN-VEN-24: trocar a forma limpa o prazo que não é dela e o envio fica pendente até escolher', () => {
    const r = comForma(comPrazo(r0, 'avista', formas, prazos), formas[1]!, prazos);
    expect(r).toMatchObject({ forma_pagamento_id: 'fbol', prazo_pagamento_id: null });
    expect(situacaoDoPagamento(r, formas, prazos, cliente).tipo).toBe('prazo');
  });
  it('RN-VEN-24: pagamento completo e permitido não tem pendência; sem forma, pede a forma', () => {
    expect(situacaoDoPagamento(comPrazo(r0, 'b28', formas, prazos), formas, prazos, cliente).tipo).toBe('ok');
    expect(situacaoDoPagamento(r0, formas, prazos, cliente).tipo).toBe('forma');
  });
  it('RN-VEN-25: a mesma regra da API recusa forma que o cliente não aceita', () => {
    const r = comPrazo(r0, 'b28', formas, prazos);
    expect(situacaoDoPagamento(r, formas, prazos, { ...cliente, formas_pagamento: ['PIX'] }).tipo).toBe('invalido');
  });
  it('RN-VEN-24: sem nenhuma forma no aparelho (antes do 1º sync), vale a condição legada e não trava', () => {
    expect(situacaoDoPagamento(r0, [], [], cliente).tipo).toBe('ok');
  });
  it('RN-VEN-24: todas as formas desativadas pede o cadastro no BKO', () => {
    expect(situacaoDoPagamento(r0, [{ ...formas[0]!, ativo: false }], prazos, cliente).tipo).toBe('sem_forma_permitida');
  });
});

describe('troca de prazo: desconto do pedido em R$ (legado)', () => {
  it('o R$ do pedido mantém o % sobre a nova tabela; os itens ficam para a RN-VEN-44', () => {
    const base = { ...rascunhoVazio('c1'), prazo_percentual_ajuste: 0, ajustes: { p1: { em: 'valor' as const, desconto_cents: 500 } }, ajuste_em: 'valor' as const, desconto_valor_cents: 1_000 };
    const r = comValoresMantendoPercentual(base, -1.71);
    expect(r.ajustes).toBe(base.ajustes);
    expect(r.desconto_valor_cents).toBe(983);
    expect(comValoresMantendoPercentual(base, 0)).toBe(base);
  });
});
