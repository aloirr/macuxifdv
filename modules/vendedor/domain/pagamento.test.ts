import { describe, expect, it } from 'vitest';
import {
  creditoDoCartao,
  descricaoPrazo,
  avaliarPagamentoComVencido,
  exigeAprovacaoPorVencido,
  formasDaLista,
  formasDoCliente,
  pagamentoPadrao,
  prazoMedioDias,
  prazosDaForma,
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
  it('RN-VEN-25: prazo acima do prazo médio do cliente fica desabilitado', () => {
    const r = prazosDaForma(prazos, 'f2', 45);
    expect(r.map((x) => [x.prazo.id, x.habilitado])).toEqual([
      ['p28', true],
      ['p42', true],
      ['p60', false],
    ]);
    expect(r[2]?.motivo).toBe('acima_prazo_medio_cliente');
  });
  it('RN-VEN-25 (P1): cliente sem prazo médio máximo não tem teto', () => {
    expect(prazosDaForma(prazos, 'f2', null).every((x) => x.habilitado)).toBe(true);
  });
  it('RN-VEN-25: prazo médio igual ao máximo é permitido', () => {
    expect(prazosDaForma(prazos, 'f2', 42).find((x) => x.prazo.id === 'p42')?.habilitado).toBe(true);
  });
  it('RN-VEN-24: o padrão é a primeira forma permitida com o primeiro prazo habilitado', () => {
    const r = pagamentoPadrao(formasDoCliente(formas, ['BOLETO']), prazos, 30);
    expect(r?.forma.codigo).toBe('BOLETO');
    expect(r?.prazo.id).toBe('p28');
  });
  it('RN-VEN-24: sem forma ou sem prazo habilitado, não há padrão', () => {
    expect(pagamentoPadrao([], prazos, null)).toBeNull();
    expect(pagamentoPadrao([f('f2', 'BOLETO')], prazos, 10)).toBeNull();
  });
});

describe('RN-VEN-24/25: validarPagamento (app e API)', () => {
  const formas = [f('f1', 'PIX', 1), f('f2', 'BOLETO', 2)];
  const prazos = [p('pa', 'f1', [0]), p('p60', 'f2', [30, 60, 90]), p('p28', 'f2', [28])];
  const cliente = { prazo_medio_max_dias: 45, formas_pagamento: null as string[] | null };
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
  it('RN-VEN-25: prazo médio acima do máximo do cliente é recusado, mensagem em português', () => {
    const r = validarPagamento({ forma: formas[1], prazo: prazos[1], cliente });
    expect(r).toMatchObject({ ok: false, codigo: 'RN-VEN-25' });
    expect(r.ok === false && r.mensagem).toMatch(/prazo/i);
  });
});

describe('RN-VEN-13: título vencido', () => {
  it('RN-VEN-13: vencido há mais que o limite com prazo a prazo exige aprovação', () => {
    expect(exigeAprovacaoPorVencido({ maior_atraso_dias: 6, prazo_medio_dias: 28, limite_dias: 5 })).toBe(true);
  });
  it('RN-VEN-13 (P1 A): à vista também exige aprovação; dentro do limite não', () => {
    expect(exigeAprovacaoPorVencido({ maior_atraso_dias: 30, prazo_medio_dias: 0, limite_dias: 5 })).toBe(true);
    expect(exigeAprovacaoPorVencido({ maior_atraso_dias: 5, prazo_medio_dias: 28, limite_dias: 5 })).toBe(false);
  });
});

describe('RN-VEN-12: crédito do cartão', () => {
  const fin = { limite_cents: 100_000, saldo_aberto_cents: 30_000, credito_disponivel_erp_cents: null as number | null };
  it('RN-VEN-12: sem valor do ERP, disponível = limite − saldo − pedidos aprovados', () => {
    expect(creditoDoCartao(fin, [{ total_cents: 10_000, integrado: false }])).toEqual({ limite_cents: 100_000, disponivel_cents: 60_000 });
  });
  it('RN-VEN-12: com valor do ERP, só os aprovados ainda não integrados descontam', () => {
    const r = creditoDoCartao({ ...fin, credito_disponivel_erp_cents: 50_000 }, [
      { total_cents: 10_000, integrado: true },
      { total_cents: 5_000, integrado: false },
    ]);
    expect(r.disponivel_cents).toBe(45_000);
  });
  it('RN-VEN-12: pode ficar negativo', () => {
    expect(creditoDoCartao(fin, [{ total_cents: 90_000, integrado: false }]).disponivel_cents).toBe(-20_000);
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

describe('T-0129 / RN-VEN-13: cliente com título vencido não perde as formas, vai para aprovação', () => {
  const formas = [f('fpix', 'PIX', 1), f('fbol', 'BOLETO', 2), f('fcar', 'CARTAO', 3)];
  const prazos = [p('avista', 'fpix', [0]), p('b45', 'fbol', [45]), p('b60', 'fbol', [60])];
  const cliente = { prazo_medio_max_dias: 45, formas_pagamento: ['PIX', 'BOLETO', 'CARTAO'] };
  const vencido = { maior_atraso_dias: 12, limite_dias: 5 };
  it('RN-VEN-13: Boleto com prazo dentro do prazo médio do cliente inadimplente é válido e vai para aprovação', () => {
    expect(avaliarPagamentoComVencido({ forma: formas[1], prazo: prazos[1], cliente, ...vencido })).toEqual({ ok: true, destino: 'aprovacao' });
  });
  it('RN-VEN-13 (P1 A): à vista com título vencido também vai para aprovação', () => {
    expect(avaliarPagamentoComVencido({ forma: formas[0], prazo: prazos[0], cliente, ...vencido })).toEqual({ ok: true, destino: 'aprovacao' });
  });
  it('RN-VEN-25: Boleto acima do prazo médio segue recusado mesmo com título vencido', () => {
    expect(avaliarPagamentoComVencido({ forma: formas[1], prazo: prazos[2], cliente, ...vencido })).toMatchObject({ ok: false, codigo: 'RN-VEN-25' });
  });
  it('RN-VEN-13: atraso até o limite não manda para aprovação', () => {
    expect(avaliarPagamentoComVencido({ forma: formas[1], prazo: prazos[1], cliente, maior_atraso_dias: 5, limite_dias: 5 })).toEqual({ ok: true, destino: 'direto' });
  });
  it('RN-VEN-25: forma fora do cadastro do cliente aparece desabilitada, com o motivo, e as demais habilitadas', () => {
    const l = formasDaLista(formas, ['PIX', 'BOLETO']);
    expect(l.map((x) => [x.forma.codigo, x.habilitada])).toEqual([['PIX', true], ['BOLETO', true], ['CARTAO', false]]);
    expect(l[2]!.motivo).toBe('Este cliente não aceita esta forma');
  });
  it('RN-VEN-25: sem lista no cadastro, todas as formas ativas ficam habilitadas', () => {
    expect(formasDaLista(formas, null).every((x) => x.habilitada)).toBe(true);
  });
});
