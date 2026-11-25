import { describe, expect, it } from 'vitest';
import {
  aplicaTetoDoCliente,
  descricaoDoPrazo,
  descricaoPrazo,
  formasDaLista,
  formasDoCliente,
  pagamentoPadrao,
  prazosDaForma,
  prazoMedioDias,
  tituloVencidoDias,
  validarPagamento,
  type FormaDePagamento,
  type PrazoDePagamento,
} from './pagamento';

const f = (id: string, codigo: string, ordem = 0, ativo = true): FormaDePagamento => ({ id, codigo, nome: codigo, ativo, ordem });
const p = (id: string, forma: string, parcelas: number[], ordem = 0, ativo = true): PrazoDePagamento => ({
  id,
  forma_pagamento_id: forma,
  codigo: id,
  descricao: descricaoPrazo(parcelas),
  parcelas_dias: parcelas,
  prazo_medio_dias: prazoMedioDias(parcelas),
  ordem,
  ativo,
});

describe('RN-VEN-24: prazo médio e descrição', () => {
  it('RN-VEN-24: 28/56 dá prazo médio 42', () => expect(prazoMedioDias([28, 56])).toBe(42));
  it('RN-VEN-24: 30/60/90 dá 60 e à vista dá 0', () => {
    expect(prazoMedioDias([30, 60, 90])).toBe(60);
    expect(prazoMedioDias([0])).toBe(0);
  });
  it('RN-VEN-24: arredonda para cima (30/45 = 38)', () => expect(prazoMedioDias([30, 45])).toBe(38));
  it('RN-VEN-24: lista vazia é erro de programação', () => expect(() => prazoMedioDias([])).toThrow());
  it('RN-VEN-24: a descrição mostra só o prazo, sem "médio"', () => {
    expect(descricaoPrazo([28, 56])).toBe('28/56 dias');
    expect(descricaoPrazo([28])).toBe('28 dias');
    expect(descricaoPrazo([0])).toBe('À vista');
    expect(descricaoPrazo([28, 56])).not.toMatch(/médio/);
  });

  it('RN-VEN-24: descricaoDoPrazo usa a descrição do ERP e, sem ela, o texto das parcelas', () => {
    expect(descricaoDoPrazo({ descricao: ' Boleto 28/56 ', parcelas_dias: [28, 56] })).toBe('Boleto 28/56');
    expect(descricaoDoPrazo({ descricao: '  ', parcelas_dias: [28, 56] })).toBe('28/56 dias');
    expect(descricaoDoPrazo({ parcelas_dias: [0] })).toBe('À vista');
  });
});

describe('RN-VEN-25: formas e prazos do cliente', () => {
  const formas = [f('f2', 'BOLETO', 2), f('f1', 'PIX', 1), f('f3', 'CARTAO', 3, false)];
  it('RN-VEN-25: lista do cliente nula ou vazia vale todas as ativas, por ordem', () => {
    expect(formasDoCliente(formas, null).map((x) => x.codigo)).toEqual(['PIX', 'BOLETO']);
    expect(formasDoCliente(formas, []).map((x) => x.codigo)).toEqual(['PIX', 'BOLETO']);
  });
  it('RN-VEN-25: filtra pelos códigos do cliente e ignora código sem forma', () => {
    expect(formasDoCliente(formas, ['BOLETO', 'XXX']).map((x) => x.codigo)).toEqual(['BOLETO']);
  });
  const prazos = [p('p60', 'f2', [30, 60, 90], 3), p('p28', 'f2', [28], 1), p('p42', 'f2', [28, 56], 2), p('pi', 'f2', [10], 4, false)];
  it('RN-VEN-24: o padrão é a primeira forma permitida com o primeiro prazo', () => {
    const r = pagamentoPadrao(formasDoCliente(formas, ['BOLETO']), prazos);
    expect(r?.forma.codigo).toBe('BOLETO');
    expect(r?.prazo.id).toBe('p28');
  });
  it('RN-VEN-24: sem forma ou sem prazo, não há padrão', () => {
    expect(pagamentoPadrao([], prazos)).toBeNull();
    expect(pagamentoPadrao([f('f2', 'BOLETO')], [])).toBeNull();
  });
});

describe('RN-VEN-25: prazo médio máximo do cliente (ADR 0072)', () => {
  const prazos = [p('a', 'f1', [0], 1), p('b', 'f1', [30, 60], 2), p('c', 'f1', [30, 60, 90], 3)];
  it('RN-VEN-25: só vale o prazo com prazo médio até o teto do cliente (igual ao teto vale)', () => {
    expect(prazosDaForma(prazos, 'f1', 45).map((x) => x.id)).toEqual(['a', 'b']);
    expect(prazosDaForma(prazos, 'f1', 60).map((x) => x.id)).toEqual(['a', 'b', 'c']);
  });
  it('RN-VEN-25: teto nulo ou ausente = sem teto', () => {
    expect(prazosDaForma(prazos, 'f1', null)).toHaveLength(3);
    expect(prazosDaForma(prazos, 'f1')).toHaveLength(3);
  });
  it('RN-VEN-25: o padrão também respeita o teto', () => {
    expect(pagamentoPadrao([f('f1', 'X')], prazos, 0)?.prazo.id).toBe('a');
    expect(pagamentoPadrao([f('f1', 'X')], [prazos[1]!], 10)).toBeNull();
  });
  it('RN-VEN-25: prazo acima do teto é recusado com o motivo prazo_acima_do_cliente', () => {
    const forma = f('f1', 'X');
    const r = validarPagamento({ forma, prazo: prazos[2], cliente: { formas_pagamento: null, prazo_medio_max_dias: 45 } });
    expect(r).toMatchObject({ ok: false, codigo: 'RN-VEN-25', motivo: 'prazo_acima_do_cliente', mensagem: 'Este prazo passa do prazo médio do cliente. Escolha um prazo menor.' });
    expect(validarPagamento({ forma, prazo: prazos[2], cliente: { formas_pagamento: null, prazo_medio_max_dias: 60 } }).ok).toBe(true);
    expect(validarPagamento({ forma, prazo: prazos[2], cliente: { formas_pagamento: null } }).ok).toBe(true);
  });
});

describe('RN-VEN-24/25: validarPagamento (app e API)', () => {
  const formas = [f('f1', 'PIX', 1), f('f2', 'BOLETO', 2)];
  const prazos = [p('pa', 'f1', [0]), p('p60', 'f2', [30, 60, 90]), p('p28', 'f2', [28])];
  const cliente = { formas_pagamento: null as string[] | null };
  it('RN-VEN-24: forma e prazo coerentes e permitidos passam', () => {
    expect(validarPagamento({ forma: formas[1], prazo: prazos[2], cliente })).toEqual({ ok: true });
  });
  it('RN-VEN-24: forma inexistente, inativa ou prazo de outra forma é recusado', () => {
    expect(validarPagamento({ forma: undefined, prazo: prazos[2], cliente })).toMatchObject({ ok: false, codigo: 'RN-VEN-24' });
    expect(validarPagamento({ forma: { ...formas[1]!, ativo: false }, prazo: prazos[2], cliente })).toMatchObject({ ok: false, codigo: 'RN-VEN-24' });
    expect(validarPagamento({ forma: formas[0], prazo: prazos[2], cliente })).toMatchObject({ ok: false, codigo: 'RN-VEN-24' });
    expect(validarPagamento({ forma: formas[1], prazo: { ...prazos[2]!, ativo: false }, cliente })).toMatchObject({ ok: false, codigo: 'RN-VEN-24' });
  });
  it('RN-VEN-25: forma fora da lista do cliente é recusada', () => {
    expect(validarPagamento({ forma: formas[1], prazo: prazos[2], cliente: { ...cliente, formas_pagamento: ['PIX'] } })).toMatchObject({ ok: false, codigo: 'RN-VEN-25' });
  });
});

describe('RN-VEN-13: parâmetro titulo_vencido_dias', () => {
  it('RN-VEN-13: padrão 5, aceita número ou texto e ignora valor inválido', () => {
    expect(tituloVencidoDias({})).toBe(5);
    expect(tituloVencidoDias({ titulo_vencido_dias: 10 })).toBe(10);
    expect(tituloVencidoDias({ titulo_vencido_dias: '0' })).toBe(0);
    expect(tituloVencidoDias({ titulo_vencido_dias: -3 })).toBe(5);
    expect(tituloVencidoDias({ titulo_vencido_dias: 'x' })).toBe(5);
  });
});

describe('T-0129 / RN-VEN-25: formas do cliente', () => {
  const formas = [f('fpix', 'PIX', 1), f('fbol', 'BOLETO', 2), f('fcar', 'CARTAO', 3)];
  it('RN-VEN-25: forma fora do cadastro do cliente aparece desabilitada, com o motivo, e as demais habilitadas', () => {
    const l = formasDaLista(formas, ['PIX', 'BOLETO']);
    expect(l.map((x) => [x.forma.codigo, x.habilitada])).toEqual([['PIX', true], ['BOLETO', true], ['CARTAO', false]]);
    expect(l[2]!.motivo).toBe('Este cliente não aceita esta forma');
  });
  it('RN-VEN-25: sem lista no cadastro, todas as formas ativas ficam habilitadas', () => {
    expect(formasDaLista(formas, null).every((x) => x.habilitada)).toBe(true);
  });
});

describe('RN-VEN-25 (opção A): o teto só vale para o app v1.0.34 em diante', () => {
  it('RN-VEN-25: versão >= 1.0.34 aplica o teto', () => {
    for (const v of ['1.0.34', '1.0.35', '1.1.0', '2.0.0', '1.0.100']) expect(aplicaTetoDoCliente(v)).toBe(true);
  });
  it('RN-VEN-25: versão menor (APK v1.0.32) não aplica o teto', () => {
    for (const v of ['1.0.32', '1.0.33', '0.9.99', '1.0.9']) expect(aplicaTetoDoCliente(v)).toBe(false);
  });
  it('RN-VEN-25: ausente ou inválida não aplica o teto', () => {
    for (const v of [null, undefined, '', 'abc', '1.0', '1.0.34-beta']) expect(aplicaTetoDoCliente(v)).toBe(false);
  });
});
